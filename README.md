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
