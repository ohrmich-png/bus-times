// CORS proxy as a Cloudflare Worker (free tier).
// Proxies allowlisted JSON APIs that don't send CORS headers, so the
// GitHub Pages sites can fetch them directly from the browser.
//
// Allowlisted hosts:
//   - https://curlbus.app/            (bus-times live arrivals)
//   - https://opensky-network.org/    (flight-radar ADS-B positions)
//
// Deploy:
//   1. Cloudflare dashboard -> Workers & Pages -> bus-times-cors -> Edit code
//   2. Paste this file and Deploy.

const ALLOWED = [
  'https://curlbus.app/',
  'https://opensky-network.org/',
];

export default {
  async fetch(req) {
    const reqUrl = new URL(req.url);
    const target =
      reqUrl.searchParams.get('url') || 'https://curlbus.app' + reqUrl.pathname;
    if (!ALLOWED.some((p) => target.startsWith(p))) {
      return new Response('Only allowlisted hosts are proxied', { status: 403 });
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
