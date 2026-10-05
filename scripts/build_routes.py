#!/usr/bin/env python3
"""
Build data/routes.json and data/route_stops.json from the Israel
Ministry of Transport GTFS static feed.

routes.json: every bus line (route_short_name) with its directional
variants. In MOT GTFS each direction is its own route_id, so each entry
is one selectable direction:
  {"n": "14", "id": "2319", "a": "דן", "from": "קאנטרי דקל-תל אביב יפו",
   "to": "מסוף הלוחמים", "first": "12345", "last": "67890"}
(first/last = stop codes of the route pattern endpoints, used to match
live vehicles to the right direction.)

route_stops.json: {"route_id": ["stop_code", ...]} ordered stop codes per
route, used to draw the route and to sample stops for live bus positions.
Lazy-loaded by the site only when a line is selected.

GTFS text files are UTF-8 *with BOM* — read with utf-8-sig.

Usage: python scripts/build_routes.py
Exits 0 even if the download fails (keeps existing data files).
"""

import csv
import json
import re
import sys
import tempfile
import urllib.request
import zipfile
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_ROUTES = ROOT / "data" / "routes.json"
OUT_STOPS = ROOT / "data" / "route_stops.json"

GTFS_URLS = [
    "https://gtfs.mot.gov.il/gtfsfiles/israel-public-transportation.zip",
]

# trailing direction/branch marker in route_long_name, e.g. "-1#", "-20", "-3כ"
MARKER_RE = re.compile(r"-\d+[א-ת#]?$")


def clean_endpoint(s: str) -> str:
    s = (s or "").strip()
    s = MARKER_RE.sub("", s)
    return s.strip()


def download(url: str) -> Path:
    tmp = Path(tempfile.mkdtemp()) / "gtfs.zip"
    req = urllib.request.Request(url, headers={"User-Agent": "bus-times/1.0"})
    with urllib.request.urlopen(req, timeout=300) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    return tmp


def main() -> int:
    zip_path = None
    for url in GTFS_URLS:
        try:
            print(f"Downloading {url} ...", flush=True)
            zip_path = download(url)
            break
        except Exception as e:  # noqa: BLE001 - keep old data on any failure
            print(f"WARNING: could not download {url}: {e}", file=sys.stderr)

    if zip_path is None:
        print("WARNING: GTFS download failed; keeping existing route data", file=sys.stderr)
        return 0

    with zipfile.ZipFile(zip_path) as zf:
        def open_txt(name):
            return (line.decode("utf-8-sig") for line in zf.open(name))

        print("Reading agency.txt ...", flush=True)
        agency = {}
        for row in csv.DictReader(open_txt("agency.txt")):
            agency[row["agency_id"]] = (row.get("agency_name") or "").strip()

        print("Reading routes.txt ...", flush=True)
        routes = {}  # route_id -> dict
        for row in csv.DictReader(open_txt("routes.txt")):
            short = (row.get("route_short_name") or "").strip()
            if not short:
                continue
            long_name = (row.get("route_long_name") or "").strip()
            origin, dest = "", ""
            if "<->" in long_name:
                o, d = long_name.split("<->", 1)
                origin, dest = clean_endpoint(o), clean_endpoint(d)
            routes[row["route_id"]] = {
                "n": short,
                "a": agency.get(row.get("agency_id"), ""),
                "from": origin,
                "to": dest,
                "trips": [],
            }

        print("Reading trips.txt ...", flush=True)
        trip2route = {}
        headsigns = defaultdict(Counter)
        for row in csv.DictReader(open_txt("trips.txt")):
            rid = row["route_id"]
            if rid not in routes:
                continue
            tid = row["trip_id"]
            trip2route[tid] = rid
            hs = (row.get("trip_headsign") or "").strip()
            if hs:
                headsigns[rid][hs] += 1
            routes[rid]["trips"].append(tid)

        print("Pass 1 over stop_times.txt (count stops per trip) ...", flush=True)
        trip_counts = Counter()
        for row in csv.DictReader(open_txt("stop_times.txt")):
            tid = row["trip_id"]
            if tid in trip2route:
                trip_counts[tid] += 1

        # representative trip per route = the one with the most stops
        best_trip = {}
        for rid, r in routes.items():
            best, best_n = None, -1
            for tid in r["trips"]:
                n = trip_counts.get(tid, 0)
                if n > best_n:
                    best, best_n = tid, n
            if best:
                best_trip[rid] = best
        print(f"Representative trips chosen for {len(best_trip)} routes", flush=True)
        del trip_counts

        print("Reading stops.txt (stop_id -> stop_code) ...", flush=True)
        id2code = {}
        for row in csv.DictReader(open_txt("stops.txt")):
            if row.get("location_type", "0") == "0":
                code = (row.get("stop_code") or "").strip()
                if code:
                    id2code[row["stop_id"]] = code

        print("Pass 2 over stop_times.txt (collect stop sequences) ...", flush=True)
        wanted = set(best_trip.values())
        seq = defaultdict(list)  # trip_id -> [(sequence, stop_code)]
        for row in csv.DictReader(open_txt("stop_times.txt")):
            tid = row["trip_id"]
            if tid not in wanted:
                continue
            code = id2code.get(row["stop_id"])
            if not code:
                continue
            try:
                s = int(row["stop_sequence"])
            except ValueError:
                continue
            seq[tid].append((s, code))

    print("Assembling outputs ...", flush=True)
    route_entries = []
    stop_map = {}
    for rid, r in routes.items():
        tid = best_trip.get(rid)
        if not tid or tid not in seq:
            continue
        stops = [c for _, c in sorted(seq[tid])]
        # dedupe consecutive duplicates (can happen with loop routes)
        dedup = [stops[0]]
        for c in stops[1:]:
            if c != dedup[-1]:
                dedup.append(c)
        if len(dedup) < 2:
            continue
        hs = headsigns[rid].most_common(1)
        to = hs[0][0] if hs else r["to"]
        route_entries.append({
            "n": r["n"],
            "id": rid,
            "a": r["a"],
            "from": r["from"],
            "to": to,
            "first": dedup[0],
            "last": dedup[-1],
        })
        stop_map[rid] = dedup

    route_entries.sort(key=lambda e: (e["n"].zfill(10) if e["n"].isdigit() else e["n"], e["id"]))

    OUT_ROUTES.parent.mkdir(parents=True, exist_ok=True)
    OUT_ROUTES.write_text(json.dumps(
        {"generated": date.today().isoformat(), "count": len(route_entries),
         "routes": route_entries},
        ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    OUT_STOPS.write_text(json.dumps(
        {"generated": date.today().isoformat(), "count": len(stop_map),
         "routes": stop_map},
        ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT_ROUTES} ({len(route_entries)} route variants)")
    print(f"Wrote {OUT_STOPS} ({len(stop_map)} stop sequences)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
