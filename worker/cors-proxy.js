// Optional: your own CORS proxy as a Cloudflare Worker.
// Why: curlbus.app does not send CORS headers, so browsers block direct
// fetch() calls. The site falls back to free public CORS proxies, which can
// be flaky. Deploying this worker (free tier, ~5 minutes of setup) gives you
// a reliable same-purpose proxy, then point the site at it.
//
// Deploy:
//   1. Create a free Cloudflare account -> Workers -> Create Worker
//   2. Paste this file as the worker code and Deploy.
//   3. In js/app.js, add your worker URL as the first entry of `attempts`,
//      e.g. 'https://bus-times-cors.<your-subdomain>.workers.dev/?url=' +
//      encodeURIComponent(url)

export default {
  async fetch(req) {
    const reqUrl = new URL(req.url);
    const target =
      reqUrl.searchParams.get('url') || 'https://curlbus.app' + reqUrl.pathname;
    if (!target.startsWith('https://curlbus.app/')) {
      return new Response('Only curlbus.app is proxied', { status: 403 });
    }
    const upstream = await fetch(target, {
      headers: { Accept: 'application/json' },
    });
    const res = new Response(upstream.body, upstream);
    res.headers.set('Access-Control-Allow-Origin', '*');
    res.headers.set('Cache-Control', 'no-store');
    return res;
  },
};
