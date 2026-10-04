#!/usr/bin/env python3
"""
Build data/stops.json from the Israel Ministry of Transport GTFS static feed.

Includes ALL Israeli bus stops (no bounding-box filter) and keeps only the
fields the site needs: stop_code (the number on the physical sign, used by
the curlbus.app live API), stop_name, city (parsed from stop_desc),
stop_lat, stop_lon. Output is minified JSON.

GTFS text files are UTF-8 *with BOM* — they must be read with utf-8-sig
or Hebrew names come out as mojibake.

Usage: python scripts/build_stops.py
Exits 0 even if the download fails (keeps the existing stops.json),
because gtfs.mot.gov.il is not reachable from every network.
"""

import csv
import json
import re
import sys
import tempfile
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "stops.json"

GTFS_URLS = [
    "https://gtfs.mot.gov.il/gtfsfiles/israel-public-transportation.zip",
]

CITY_RE = re.compile(r"עיר:\s*(.*?)\s*רציף:")


def download(url: str) -> Path:
    tmp = Path(tempfile.mkdtemp()) / "gtfs.zip"
    req = urllib.request.Request(url, headers={"User-Agent": "bus-times/1.0"})
    with urllib.request.urlopen(req, timeout=180) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    return tmp


def main() -> int:
    zip_path = None
    for url in GTFS_URLS:
        try:
            print(f"Downloading {url} ...")
            zip_path = download(url)
            break
        except Exception as e:  # noqa: BLE001 - keep old data on any failure
            print(f"WARNING: could not download {url}: {e}", file=sys.stderr)

    if zip_path is None:
        print("WARNING: GTFS download failed; keeping existing stops.json", file=sys.stderr)
        return 0

    stops = []
    seen_codes = set()
    with zipfile.ZipFile(zip_path) as zf:
        with zf.open("stops.txt") as f:
            # utf-8-sig strips the BOM present in MOT GTFS files
            text = (line.decode("utf-8-sig") for line in f)
            for row in csv.DictReader(text):
                try:
                    lat, lon = float(row["stop_lat"]), float(row["stop_lon"])
                except (ValueError, KeyError):
                    continue
                if row.get("location_type", "0") != "0":
                    continue
                code = (row.get("stop_code") or "").strip()
                if not code or code in seen_codes:
                    continue
                seen_codes.add(code)
                m = CITY_RE.search(row.get("stop_desc") or "")
                stops.append({
                    "stop_code": code,
                    "stop_name": (row.get("stop_name") or "").strip(),
                    "city": m.group(1).strip() if m else "",
                    "stop_lat": round(lat, 6),
                    "stop_lon": round(lon, 6),
                })

    stops.sort(key=lambda s: s["stop_code"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated": date.today().isoformat(),
        "count": len(stops),
        "scope": "israel",
        "stops": stops,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT} with {len(stops)} stops")
    return 0


if __name__ == "__main__":
    sys.exit(main())
