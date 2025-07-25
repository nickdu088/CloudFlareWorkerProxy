# 🌐 Online Proxy with Cloudflare Workers

A simple, secure proxy built using [Cloudflare Workers](https://developers.cloudflare.com/workers/), allowing users to fetch and browse external websites through your domain. HTML pages are rewritten to keep all links and scripts within the proxy.

---

## 🚀 Features

- ✅ HTML Form interface for entering target URLs  
- ✅ Proxy fetches and serves external content securely  
- ✅ Rewrites internal links and JavaScript navigation to remain within the proxy  
- ✅ Blocks unsafe protocols like `file://`, `javascript:`, and `.onion` domains  
- ✅ Strips sensitive headers (`Set-Cookie`, `Content-Security-Policy`, etc.)  
- ✅ Configurable to restrict target URLs (optional whitelist)  
- 🛠️ Designed to be easily extended with support for CSS/JS/image handling and caching  

---
