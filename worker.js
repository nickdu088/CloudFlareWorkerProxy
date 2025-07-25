addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

const HTML_FORM = `
<!DOCTYPE html>
<html>
<head>
  <title>Online Proxy</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body {
      font-family: sans-serif;
      margin: 2em;
      max-width: 600px;
      margin-left: auto;
      margin-right: auto;
    }

    input[type="text"] {
      width: 100%;
      padding: 0.75em;
      margin-bottom: 1em;
      box-sizing: border-box;
      font-size: 1em;
    }

    input[type="submit"] {
      padding: 0.75em 1.5em;
      font-size: 1em;
      cursor: pointer;
    }

    #url-display {
      margin-top: 1em;
      color: #333;
    }

    #loading {
      display: none;
      margin-top: 1em;
      font-style: italic;
      color: #888;
    }

    @media (prefers-color-scheme: dark) {
      body {
        background-color: #121212;
        color: #f0f0f0;
      }

      input[type="text"],
      input[type="submit"] {
        background-color: #1e1e1e;
        color: #fff;
        border: 1px solid #444;
      }

      #loading {
        color: #ccc;
      }
    }
  </style>
</head>
<body>
  <h1>Online Proxy</h1>
  <form method="GET" id="proxy-form">
    <input type="text" name="url" id="url-input" placeholder="Enter URL (e.g. https://example.com)" required />
    <input type="submit" value="Go" />
  </form>
  <div id="url-display"></div>
  <div id="loading">Loading...</div>

  <script>
    const form = document.getElementById('proxy-form');
    const input = document.getElementById('url-input');
    const display = document.getElementById('url-display');
    const loading = document.getElementById('loading');

    form.addEventListener('submit', function(e) {
      display.textContent = 'Requested URL: ' + input.value;
      loading.style.display = 'block';
    });

    // Hide loading after navigation completes (optional fallback)
    window.addEventListener('pageshow', () => {
      loading.style.display = 'none';
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
