#!/usr/bin/env python3
"""Phase 1 (exploratory): dump raw parse.bot FotMob API responses.

Calls get_leagues, get_historical_match_results (param variants) and
get_matches_by_date, saving every raw response under data/raw/ for
inspection. The committed per-league files are built in phase 2 once
the exact shapes are known.

Requires PARSE_BOT_API_KEY in the environment (GitHub Actions secret).
"""
import datetime
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error

API = "https://api.parse.bot/scraper/645b8e03-271d-4c85-97e7-35d5733a2d78"
KEY = os.environ.get("PARSE_BOT_API_KEY", "")
if not KEY:
    print("FATAL: PARSE_BOT_API_KEY secret is not set. "
          "Add it under repo Settings -> Secrets and variables -> Actions.",
          flush=True)
    sys.exit(1)


def call(endpoint, params=None):
    url = f"{API}/{endpoint}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        url, headers={"X-API-Key": KEY, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8", "replace")[:800]
        except Exception:
            body = "<unreadable>"
        return e.code, {"http_error": e.code, "body": body}
    except Exception as e:  # noqa: BLE001
        return -1, {"transport_error": str(e)}


def dump(name, obj):
    os.makedirs("data/raw", exist_ok=True)
    path = f"data/raw/{name}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    print(f"saved {path}", flush=True)


def find_leagues(node, out):
    """Recursively collect {id, name} dicts from a grouped league listing."""
    if isinstance(node, dict):
        if isinstance(node.get("id"), (int, float)) and isinstance(node.get("name"), str):
            out.append({"id": int(node["id"]), "name": node["name"],
                        "ccode": node.get("ccode"), "pageUrl": node.get("pageUrl")})
        for v in node.values():
            find_leagues(v, out)
    elif isinstance(node, list):
        for v in node:
            find_leagues(v, out)


def main():
    # 1. League catalogue (no params).
    status, leagues = call("get_leagues")
    dump("leagues", {"status": status, "body": leagues})
    found = []
    if status == 200:
        find_leagues(leagues, found)
        print(f"found {len(found)} leagues", flush=True)
        for lg in found:
            n = lg["name"].lower()
            if any(k in n for k in ("israel", "premier league", "la liga",
                                    "primera", "champions league", "ligat")):
                print(f"  CANDIDATE id={lg['id']} name={lg['name']!r} ccode={lg.get('ccode')}",
                      flush=True)

    # 2. Historical results for Israel (id 127, verified by user) — try param variants.
    for pname in ("league_id", "id", "leagueId"):
        status, res = call("get_historical_match_results", {pname: 127})
        dump(f"historical_israel_{pname}", {"status": status, "body": res})
        preview = json.dumps(res, ensure_ascii=False)[:300]
        print(f"historical {pname}=127 -> {status}: {preview}", flush=True)

    # 3. Matches by date (yesterday) — all leagues, one call.
    yesterday = (datetime.date.today() - datetime.timedelta(days=1)).strftime("%Y%m%d")
    status, res = call("get_matches_by_date", {"date": yesterday})
    dump("matches_by_date", {"status": status, "body": res})
    print(f"matches_by_date {yesterday} -> {status}, "
          f"{len(json.dumps(res, ensure_ascii=False))} chars", flush=True)


if __name__ == "__main__":
    main()
