addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

const HTML_FORM = `
<!DOCTYPE html>
<html>
<head>
  <title>Online Proxy</title>
  <style>
    body { font-family: sans-serif; margin: 2em; }
    input[type="text"] { width: 400px; padding: 0.5em; }
    input[type="submit"] { padding: 0.5em 1em; }
    #url-display { margin-top: 1em; color: #333; }
  </style>
</head>
<body>
  <h1>Online Proxy</h1>
  <form method="GET" id="proxy-form">
    <input type="text" name="url" id="url-input" placeholder="Enter URL (e.g. https://example.com)" required />
    <input type="submit" value="Go" />
  </form>
  <div id="url-display"></div>
  <script>
    document.getElementById('proxy-form').addEventListener('submit', function(e) {
      const input = document.getElementById('url-input');
      document.getElementById('url-display').textContent = 'Requested URL: ' + input.value;
    });
  </script>
</body>
</html>
`;

// Optional: domain whitelist (leave empty to allow all)
const ALLOWED_HOSTS = [];

function isValidUrl(url) {
  try {
    const u = new URL(url);
    return (
      ['http:', 'https:'].includes(u.protocol) &&
      !u.hostname.endsWith('.onion') && // block Tor links
      !u.protocol.startsWith('file') && // block local access
      (ALLOWED_HOSTS.length === 0 || ALLOWED_HOSTS.includes(u.hostname))
    );
  } catch (err) {
    return false;
  }
}

function sanitizeHeaders(headers) {
  const newHeaders = new Headers(headers);
  // Remove sensitive headers
  ['set-cookie', 'set-cookie2', 'content-security-policy', 'content-security-policy-report-only'].forEach(h => {
    newHeaders.delete(h);
  });
  return newHeaders;
}

async function handleRequest(request) {
  const url = new URL(request.url);
  const target = url.searchParams.get('url');

  if (!target) {
    return new Response(HTML_FORM, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=UTF-8' },
    });
  }

  if (!isValidUrl(target)) {
    return new Response('Invalid or blocked URL.', { status: 400 });
  }

  try {
    const targetUrl = new URL(target);
    const proxyRequest = new Request(target, {
      method: request.method,
      headers: request.headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      redirect: 'manual'
    });

    const response = await fetch(proxyRequest);
    const contentType = response.headers.get('content-type') || '';
    const headers = sanitizeHeaders(response.headers);

    // Handle redirect manually
    if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
      const location = response.headers.get('location');
      let resolvedLocation;
      try {
        resolvedLocation = new URL(location, targetUrl).href;
      } catch (e) {
        return new Response('Invalid redirect location', { status: 502 });
      }

      const proxiedLocation = `/?url=${encodeURIComponent(resolvedLocation)}`;
      return new Response(null, {
        status: response.status,
        headers: {
          ...Object.fromEntries(headers),
          location: proxiedLocation
        }
      });
    }

    if (contentType.includes('text/html')) {
      let html = await response.text();

      html = html.replace(
        /\b(href|src|action|formaction)=["']([^"']+)["']/gi,
        (match, attr, link) => {
          if (link.startsWith('#') || link.startsWith('javascript:')) return match;
          try {
            const resolved = new URL(link, targetUrl).href;
            return `${attr}="/?url=${encodeURIComponent(resolved)}"`;
          } catch {
            return match;
          }
        }
      );

      html = html.replace(
        /\b(location\.href\s*=\s*|window\.open\s*\(|fetch\s*\(|XMLHttpRequest\.open\s*\(\s*['"](?:GET|POST|PUT|DELETE|OPTIONS|HEAD)['"]\s*,\s*)["']([^"']+)["']/gi,
        (match, prefix, link) => {
          if (link.startsWith('#') || link.startsWith('javascript:')) return match;
          try {
            const resolved = new URL(link, targetUrl).href;
            return `${prefix}"${'/?url=' + encodeURIComponent(resolved)}"`;
          } catch {
            return match;
          }
        }
      );

      return new Response(html, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });

  } catch (err) {
    return new Response('Error fetching target: ' + err.toString(), { status: 502 });
  }
}
