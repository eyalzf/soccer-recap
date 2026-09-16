#!/usr/bin/env python3
"""Record a live /api/recap SSE stream to a fixture JSON file.

This is the ONLY fixture operation that costs YouTube quota (one fresh
search per fixture). Run it right after the daily quota reset (midnight PT
= 10:00 IDT) and never as part of routine validation.

Usage:
    python3 scripts/record_fixture.py --slug real-madrid-inter-ucl \\
        --label "Real Madrid 2-1 Inter (UCL)" \\
        --home "Real Madrid" --away Inter --date 2026-09-16 \\
        --league champions-league --hs 2 --as 1 \\
        --home-he "ריאל מדריד" --away-he "אינטר" \\
        --base-url https://soccer-recap.vercel.app

After recording, commit fixtures/recap/<slug>.json and push: the next
Vercel deploy serves it for quota-free replay.
"""
import argparse
import datetime
import json
import os
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def stream_events(url: str):
    req = urllib.request.Request(url, headers={"Accept": "text/event-stream"})
    events = []
    with urllib.request.urlopen(req, timeout=90) as resp:
        buf = ""
        while True:
            chunk = resp.read(4096)
            if not chunk:
                break
            buf += chunk.decode("utf-8", "replace")
            while "\n\n" in buf:
                raw, buf = buf.split("\n\n", 1)
                for line in raw.splitlines():
                    if line.startswith("data: "):
                        events.append(json.loads(line[6:]))
    return events


def main() -> int:
    ap = argparse.ArgumentParser(description="Record a recap fixture")
    ap.add_argument("--slug", required=True)
    ap.add_argument("--label", required=True)
    ap.add_argument("--home", required=True)
    ap.add_argument("--away", required=True)
    ap.add_argument("--date", required=True, help="dateISO, e.g. 2026-09-16")
    ap.add_argument("--league", required=True)
    ap.add_argument("--hs", default="")
    ap.add_argument("--as", default="")
    ap.add_argument("--home-he", default="")
    ap.add_argument("--away-he", default="")
    ap.add_argument("--base-url", default="https://soccer-recap.vercel.app")
    ap.add_argument("--debug", dest="debug", action="store_true", default=True,
                    help="record with debug=1 so fixtures carry per-search diagnostics")
    ap.add_argument("--no-debug", dest="debug", action="store_false")
    args = ap.parse_args()

    import re
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,80}", args.slug):
        print("bad slug (lowercase letters, digits, dashes only)", file=sys.stderr)
        return 2

    q = urllib.parse.urlencode({
        "home": args.home, "away": args.away, "date": args.date,
        "league": args.league, "hs": args.hs, "as": getattr(args, "as"),
        "debug": "1" if args.debug else "0",
    })
    url = args.base_url.rstrip("/") + "/api/recap?" + q
    print("streaming:", url)
    events = stream_events(url)
    print(f"captured {len(events)} events")
    if not events or events[-1].get("type") != "done":
        print("WARNING: stream did not end with a done event", file=sys.stderr)

    fixture = {
        "slug": args.slug,
        "label": args.label,
        "request": {
            "home": args.home, "away": args.away, "date": args.date,
            "league": args.league, "hs": args.hs, "as": getattr(args, "as"),
            "homeHe": args.home_he or args.home,
            "awayHe": args.away_he or args.away,
        },
        "matcherVersion": 1,
        "recordedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "events": events,
    }
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fixtures", "recap")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, args.slug + ".json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(fixture, f, ensure_ascii=False, indent=2)
    print("wrote", out)
    done_ev = events[-1] if events else {}
    print("final results:", len(done_ev.get("results", [])),
          "| rateLimited:", done_ev.get("ytRateLimited"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
