#!/usr/bin/env python3
"""
Build data/stops.json from the Israel Ministry of Transport GTFS static feed.

Filters stops to the Yokneam Illit area bounding box and keeps only the
fields the site needs: stop_code (the number on the physical sign, used by
the curlbus.app live API), stop_name, stop_lat, stop_lon.

GTFS text files are UTF-8 *with BOM* — they must be read with utf-8-sig
or Hebrew names come out as mojibake.

Usage: python scripts/build_stops.py
Exits 0 even if the download fails (keeps the existing stops.json),
because gtfs.mot.gov.il is not reachable from every network.
"""

import csv
import json
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

# Yokneam Illit area bounding box
LAT_MIN, LAT_MAX = 32.58, 32.67
LON_MIN, LON_MAX = 35.07, 35.16


def download(url: str) -> Path:
    tmp = Path(tempfile.mkdtemp()) / "gtfs.zip"
    req = urllib.request.Request(url, headers={"User-Agent": "bus-times/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
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
    with zipfile.ZipFile(zip_path) as zf:
        with zf.open("stops.txt") as f:
            # utf-8-sig strips the BOM present in MOT GTFS files
            text = (line.decode("utf-8-sig") for line in f)
            for row in csv.DictReader(text):
                try:
                    lat, lon = float(row["stop_lat"]), float(row["stop_lon"])
                except (ValueError, KeyError):
                    continue
                if LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX:
                    code = row.get("stop_code", "").strip()
                    if not code:
                        continue
                    stops.append({
                        "stop_code": code,
                        "stop_name": row.get("stop_name", "").strip(),
                        "stop_lat": round(lat, 6),
                        "stop_lon": round(lon, 6),
                    })

    stops.sort(key=lambda s: s["stop_code"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated": date.today().isoformat(),
        "count": len(stops),
        "bbox": {"lat": [LAT_MIN, LAT_MAX], "lon": [LON_MIN, LON_MAX]},
        "stops": stops,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Wrote {OUT} with {len(stops)} stops")
    return 0


if __name__ == "__main__":
    sys.exit(main())
