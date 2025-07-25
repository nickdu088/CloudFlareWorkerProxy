addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request))
})

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
        const form = document.getElementById('proxy-form');
        const input = document.getElementById('url-input');
        const display = document.getElementById('url-display');
        form.addEventListener('submit', function(e) {
            display.textContent = 'Requested URL: ' + input.value;
        });
    </script>
</body>
</html>
`;

async function handleRequest(request) {
    const url = new URL(request.url)
    const target = url.searchParams.get('url')
    if (!target) {
        return new Response(HTML_FORM, {
            status: 200,
            headers: { 'content-type': 'text/html; charset=UTF-8' }
        })
    }

    try {
        const proxyRequest = new Request(target, {
            method: request.method,
            headers: request.headers,
            body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
            redirect: 'manual'
        })

        const response = await fetch(proxyRequest)
        // Remove potentially sensitive headers
        const headers = new Headers(response.headers)
        headers.delete('set-cookie')
        headers.delete('set-cookie2')

        // If the response is HTML, rewrite links to go through the proxy
        const contentType = headers.get('content-type') || ''
        if (contentType.includes('text/html')) {
            let text = await response.text()
            // Rewrite href/src attributes to go through the proxy
            // Replace href/src/action/form URLs and also URLs in inline JS (e.g., location.href, window.open, fetch, XMLHttpRequest)
            // 1. HTML attributes (href, src, action, formaction)
            text = text.replace(
                /\b(href|src|action|formaction)=["']([^"']+)["']/gi,
                (match, attr, link) => {
                    // Ignore anchors and javascript: links
                    if (link.startsWith('#') || link.startsWith('javascript:')) return match
                    let proxiedUrl
                    try {
                        proxiedUrl = new URL(link, target).href
                    } catch {
                        return match
                    }
                    return `${attr}="/?url=${encodeURIComponent(proxiedUrl)}"`
                }
            )
            // 2. Inline JS: location.href = "...", window.open("..."), fetch("..."), XMLHttpRequest.open("...", ...)
            text = text.replace(
                /\b(location\.href\s*=\s*|window\.open\s*\(|fetch\s*\(|XMLHttpRequest\.open\s*\(\s*['"](?:GET|POST|PUT|DELETE|OPTIONS|HEAD)['"]\s*,\s*)["']([^"']+)["']/gi,
                (match, prefix, link) => {
                    // Ignore anchors and javascript: links
                    if (link.startsWith('#') || link.startsWith('javascript:')) return match
                    let proxiedUrl
                    try {
                        proxiedUrl = new URL(link, target).href
                    } catch {
                        return match
                    }
                    // For window.open/fetch/XMLHttpRequest.open, preserve the function call structure
                    if (prefix.endsWith('(')) {
                        return `${prefix}"${'/?url=' + encodeURIComponent(proxiedUrl)}"`
                    }
                    // For assignment (location.href = ...)
                    return `${prefix}"${'/?url=' + encodeURIComponent(proxiedUrl)}"`
                }
            )
            return new Response(text, {
                status: response.status,
                statusText: response.statusText,
                headers
            })
        }

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers
        })
    } catch (err) {
        return new Response('Error fetching target: ' + err.toString(), { status: 502 })
    }
}