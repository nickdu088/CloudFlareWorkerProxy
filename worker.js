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
    input[type="text"], input[type="url"] {
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
      input[type="submit"],
      input[type="url"] {
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
    <input type="url" name="url" id="url-input" placeholder="Enter URL (e.g. https://example.com)" required />
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

    window.addEventListener('pageshow', () => {
      loading.style.display = 'none';
    });
  </script>
</body>
</html>
`;

const ALLOWED_HOSTS = [];

/**
 * URL validation
 */
function isValidUrl(url) {
  try {
    const u = new URL(url);
    return (
      ['http:', 'https:'].includes(u.protocol) &&
      !u.hostname.endsWith('.onion') &&
      !u.protocol.startsWith('file') &&
      (ALLOWED_HOSTS.length === 0 || ALLOWED_HOSTS.includes(u.hostname))
    );
  } catch {
    return false;
  }
}

/**
 * Sanitize headers, keep set-cookie but rewrite domains.
 */
function sanitizeHeaders(headers, proxyHost) {
  const newHeaders = new Headers();
  for (const [key, value] of headers.entries()) {
    const keyLower = key.toLowerCase();
    if (
      ['content-security-policy', 'content-security-policy-report-only', 'clear-site-data'].includes(
        keyLower
      )
    ) {
      continue;
    }
    // We handle set-cookie separately
    if (keyLower === 'set-cookie') {
      continue;
    }
    newHeaders.append(key, value);
  }
  return newHeaders;
}

/**
 * Rewrite Set-Cookie headers domains to proxy domain
 */
function rewriteSetCookieHeaders(setCookieHeaders, proxyHost) {
  return setCookieHeaders.map(cookieStr => {
    // Remove Domain attribute so cookie defaults to proxy domain
    return cookieStr
      .replace(/domain=[^;]+;/i, '') // Remove Domain attribute if present
      .replace(/;\s*$/, ''); // Clean trailing ;
  });
}

/**
 * Rewrite URLs inside CSS (url(...) syntax)
 */
function rewriteCssUrls(cssText, baseUrl) {
  return cssText.replace(
    /url\(\s*(['"]?)([^"')]+)\1\s*\)/gi,
    (match, quote, url) => {
      if (
        url.startsWith('data:') ||
        url.startsWith('http://') ||
        url.startsWith('https://') ||
        url.startsWith('//')
      ) {
        try {
          const resolved = new URL(url, baseUrl).href;
          return `url("${'/?url=' + encodeURIComponent(resolved)}")`;
        } catch {
          return match;
        }
      }
      try {
        const resolved = new URL(url, baseUrl).href;
        return `url("${'/?url=' + encodeURIComponent(resolved)}")`;
      } catch {
        return match;
      }
    }
  );
}

/**
 * Rewrite URLs in HTML and JS
 */
function rewriteHtmlUrls(html, baseUrl) {
  // Rewrite HTML attributes
  html = html.replace(
    /\b(href|src|action|formaction)=["']([^"']+)["']/gi,
    (match, attr, link) => {
      if (
        link.startsWith('#') ||
        link.startsWith('javascript:') ||
        link.startsWith('data:')
      )
        return match;
      try {
        const resolved = new URL(link, baseUrl).href;
        return `${attr}="/?url=${encodeURIComponent(resolved)}"`;
      } catch {
        return match;
      }
    }
  );

  // Rewrite URLs in JS calls
  html = html.replace(
    /\b(location\.href\s*=\s*|window\.open\s*\(|fetch\s*\(|XMLHttpRequest\.open\s*\(\s*['"](?:GET|POST|PUT|DELETE|OPTIONS|HEAD)['"]\s*,\s*)["']([^"']+)["']/gi,
    (match, prefix, link) => {
      if (
        link.startsWith('#') ||
        link.startsWith('javascript:') ||
        link.startsWith('data:')
      )
        return match;
      try {
        const resolved = new URL(link, baseUrl).href;
        return `${prefix}"${'/?url=' + encodeURIComponent(resolved)}"`;
      } catch {
        return match;
      }
    }
  );

  return html;
}

/**
 * Inject UI enhancements (Home button)
 */
function injectUI(html) {
  const injection = `
    <style>
      #proxy-home-button {
        position: fixed;
        top: 10px;
        right: 10px;
        background: #007bff;
        color: white;
        padding: 8px 12px;
        font-family: sans-serif;
        font-size: 14px;
        border-radius: 4px;
        text-decoration: none;
        z-index: 9999;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        transition: background-color 0.3s ease;
      }
      #proxy-home-button:hover {
        background: #0056b3;
      }
    </style>
    <a href="/" id="proxy-home-button" title="Back to proxy home">Home</a>
  `;

  if (html.includes('</body>')) {
    return html.replace('</body>', injection + '</body>');
  }
  return html + injection;
}

async function handleRequest(request) {
  const url = new URL(request.url);
  let target = url.searchParams.get('url');

  // Add https:// if no protocol specified
  if (target && !/^https?:\/\//i.test(target)) {
    target = 'https://' + target;
  }

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
    const proxyHost = url.host;

    // Forward cookies from client to target
    const clientCookies = request.headers.get('cookie');
    const proxyRequestHeaders = new Headers(request.headers);
    if (clientCookies) {
      proxyRequestHeaders.set('cookie', clientCookies);
    }

    const proxyRequest = new Request(target, {
      method: request.method,
      headers: proxyRequestHeaders,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      redirect: 'manual',
    });

    const response = await fetch(proxyRequest);

    // Handle redirect responses
    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.has('location')
    ) {
      const location = response.headers.get('location');
      let resolvedLocation;
      try {
        resolvedLocation = new URL(location, targetUrl).href;
      } catch {
        return new Response('Invalid redirect location', { status: 502 });
      }
      const proxiedLocation = `/?url=${encodeURIComponent(resolvedLocation)}`;

      // Rewrite Set-Cookie headers
      const setCookieRaw = [];
      if (typeof response.headers.raw === 'function') {
        const rawHeaders = response.headers.raw();
        if (rawHeaders['set-cookie']) {
          setCookieRaw.push(...rawHeaders['set-cookie']);
        }
      }
      const newHeaders = sanitizeHeaders(response.headers, proxyHost);
      rewriteSetCookieHeaders(setCookieRaw, proxyHost).forEach(cookie => {
        newHeaders.append('set-cookie', cookie);
      });

      return new Response(null, {
        status: response.status,
        headers: {
          ...Object.fromEntries(newHeaders),
          location: proxiedLocation,
        },
      });
    }

    const contentType = response.headers.get('content-type') || '';

    // Rewrite Set-Cookie headers for normal responses
    const rawSetCookie = [];
    if (typeof response.headers.raw === 'function') {
      const rawHeaders = response.headers.raw();
      if (rawHeaders['set-cookie']) {
        rawSetCookie.push(...rawHeaders['set-cookie']);
      }
    }
    const newHeaders = sanitizeHeaders(response.headers, proxyHost);
    rewriteSetCookieHeaders(rawSetCookie, proxyHost).forEach(cookie => {
      newHeaders.append('set-cookie', cookie);
    });

    // HTML response - rewrite URLs & inject UI + base tag
    if (contentType.includes('text/html')) {
      let html = await response.text();

      html = rewriteHtmlUrls(html, targetUrl);
      html = injectUI(html);

      if (html.includes('<head>')) {
        html = html.replace(
          /<head>/i,
          `<head><base href="${targetUrl.origin}${targetUrl.pathname}">`
        );
      }

      return new Response(html, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }

    // CSS response - rewrite url(...) inside CSS
    if (
      contentType.includes('text/css') ||
      contentType.includes('application/css')
    ) {
      let cssText = await response.text();
      cssText = rewriteCssUrls(cssText, targetUrl);

      return new Response(cssText, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }

    // Other content types - just proxy as is
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  } catch (err) {
    return new Response('Error fetching target: ' + err.toString(), { status: 502 });
  }
}
