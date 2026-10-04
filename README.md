# 🚌 Bus Times — זמני אוטובוס

A personal real-time Israeli bus times website for Yokneam Illit. A map of all
bus stops in the area, click any stop for live upcoming buses, star your
regular stops to keep them in a favorites panel with auto-refreshing ETAs.

Live at: **https://ohrmich-png.github.io/bus-times/**

## How it works

- **Stop map data** (`data/stops.json`) is baked in at build time from the
  Israel Ministry of Transport GTFS static feed, filtered to the Yokneam
  Illit bounding box. Refreshed weekly by GitHub Actions
  (`.github/workflows/refresh-stops.yml`), or manually with
  `python scripts/build_stops.py`.
- **Live arrivals** come from [curlbus.app](https://curlbus.app) — a free
  public JSON API over the Ministry of Transport's SIRI real-time feed, no
  API key needed. The site tries a direct fetch first; since curlbus.app
  doesn't send CORS headers, it falls back to a public CORS proxy
  (`api.allorigins.win`) automatically.
- **Favorites** are stored in the browser's `localStorage` — no account,
  no server.
- Pure static site (HTML + Leaflet + vanilla JS), deployed with GitHub Pages.

## Live data & CORS

Live arrivals come from [curlbus.app](https://curlbus.app) (Ministry of
Transport SIRI feed, free, no key). Browsers block direct `fetch()` to it
because it sends no `Access-Control-Allow-Origin` header, so the site tries
a chain of fallbacks: direct → `api.allorigins.win` → `api.codetabs.com` →
`api.cors.lol`. Free public CORS proxies can be flaky; a polite request to
add CORS headers is open at
[elad661/curlbus#32](https://github.com/elad661/curlbus/issues/32) — if that
lands, the direct fetch just works.

For a rock-solid setup, deploy the optional Cloudflare Worker in
[`worker/cors-proxy.js`](worker/cors-proxy.js) (free tier, ~5 min) and add
your worker URL as the first fallback in `js/app.js`.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Refresh the stop list manually

```sh
python3 scripts/build_stops.py
```

## License

MIT — see [LICENSE](LICENSE).
