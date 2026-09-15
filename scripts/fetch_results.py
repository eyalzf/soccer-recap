#!/usr/bin/env python3
"""Daily listings pipeline: FotMob API (via parse.bot) -> per-league JSON.

Credit-conscious design (parse.bot free tier: 200 credits/month):
- League IDs are resolved once and cached in the data files; get_leagues
  is only called when a file is missing (first run).
- Each league tracks `checked_through`: the last date fully pulled via
  matches_by_date. A date is never fetched twice for the same league.
- Each calendar date is fetched ONCE per run and the payload is shared
  across all four leagues (matches_by_date returns every league).
- The season backfill check runs monthly, not weekly.
- All calls are paced to the 5 req/min limit with retries on HTTP 429.

Flow per run:
- Backfill the current season via get_historical_match_results (one call
  per league) when no local data file exists; re-checks the season monthly
  so a rollover triggers a fresh backfill.
- Incrementally fetches get_matches_by_date for dates after
  checked_through (capped), merging new finished games.
- Cold-start harvest: when a league's team-id map is still empty, fetch
  only the dates on which it actually has stored games.
- Writes data/<slug>.json: {league, league_id, season, updated_at,
  checked_through, team_ids, games[]}. The app serves these files; it
  never calls parse.bot at request time.

Team crests: matches_by_date carries FotMob team IDs, so badge URLs use
FotMob's image CDN. A persistent name->id map per league file lets older
backfilled games gain crests once their teams appear in a daily fetch.

Credit budget: ~1 (leagues) + ~1 (daily) calls/day, plus 4/week for the
season check - well under the 200/month free tier.

Requires PARSE_BOT_API_KEY in the environment (GitHub Actions secret).
Exits non-zero without touching data files when the API is unreachable,
so the workflow fails loudly instead of committing empty data.
"""
import datetime
import difflib
import json
import os
import re
import sys
import time
import unicodedata
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

TEAM_LOGO = "https://images.fotmob.com/image_resources/logo/teamlogo/{id}.png"

# slug -> (expected parse.bot league id, name keywords for resolution, country code)
LEAGUES = {
    "premier-league": (47, ["premier league"], "ENG"),
    "la-liga": (87, ["laliga", "la liga", "primera"], "ESP"),
    "israeli-league": (127, ["israel", "ligat"], "ISR"),
    "champions-league": (42, ["champions league"], "INT"),
}
MAX_CATCHUP_DAYS = 14
HISTORICAL_CHECK_DAYS = 30

# Parse free tier: 5 requests/minute. Pace calls and retry on 429.
_MIN_INTERVAL = 12.0
_LAST_CALL = 0.0
_CALL_COUNT = 0


def call(endpoint, params=None, retries=3):
    global _LAST_CALL, _CALL_COUNT
    url = f"{API}/{endpoint}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    last_err = None
    for attempt in range(retries):
        wait = _MIN_INTERVAL - (time.monotonic() - _LAST_CALL)
        if wait > 0:
            time.sleep(wait)
        _LAST_CALL = time.monotonic()
        _CALL_COUNT += 1
        req = urllib.request.Request(
            url, headers={"X-API-Key": KEY, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            try:
                body = e.read().decode("utf-8", "replace")[:300]
            except Exception:
                body = "<unreadable>"
            last_err = (f"{endpoint} HTTP {e.code}: {body}")
            if e.code == 429 and attempt < retries - 1:
                time.sleep(20 * (attempt + 1))
                continue
            raise RuntimeError(last_err) from e
        except Exception as e:
            raise RuntimeError(f"{endpoint} transport error: {e}") from e
    raise RuntimeError(last_err or f"{endpoint}: retries exhausted")


def ok_data(res, endpoint):
    if not isinstance(res, dict) or res.get("status") != "success":
        raise RuntimeError(f"{endpoint}: unsuccessful envelope: "
                           f"{json.dumps(res)[:300]}")
    return res.get("data")


def find_leagues(node, out):
    if isinstance(node, dict):
        if isinstance(node.get("id"), (int, float)) and isinstance(node.get("name"), str):
            out.append(node)
        for v in node.values():
            find_leagues(v, out)
    elif isinstance(node, list):
        for v in node:
            find_leagues(v, out)


def resolve_league_ids():
    data = ok_data(call("get_leagues"), "get_leagues")
    found = []
    find_leagues(data, found)
    print(f"get_leagues: {len(found)} leagues", flush=True)
    resolved = {}
    for slug, (expected, keywords, ccode) in LEAGUES.items():
        candidates = [lg for lg in found
                      if any(k in str(lg.get("name", "")).lower() for k in keywords)]
        match = None
        # Prefer the candidate from the expected country (many countries
        # have a league literally named "Premier League").
        for lg in candidates:
            if str(lg.get("ccode", "")).upper() == ccode:
                match = lg
                break
        match = match or (candidates[0] if candidates else None)
        if match and int(match["id"]) != expected:
            print(f"NOTE: {slug} resolved to id={match['id']} "
                  f"(expected {expected}); using resolved", flush=True)
        if not match:
            print(f"WARNING: {slug} not found in get_leagues; "
                  f"falling back to expected id {expected}", flush=True)
        resolved[slug] = int(match["id"]) if match else expected
        print(f"  {slug} -> {resolved[slug]}", flush=True)
    return resolved


def norm_team_name(s):
    """Tolerant team-name key: lowercase, no accents/punctuation."""
    s = (s or "").lower()
    s = unicodedata.normalize("NFD", s)
    s = re.sub(r"[\u0300-\u036f]", "", s)
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def norm_historical(m):
    """Normalize one get_historical_match_results record, or None."""
    if m.get("status") != "finished":
        return None
    ft = (m.get("regulation_score") or {}).get("ft") or {}
    hs, aws = ft.get("home"), ft.get("away")
    if not isinstance(hs, int) or not isinstance(aws, int):
        return None
    if not m.get("home_team") or not m.get("away_team") or not m.get("date"):
        return None
    return {
        "id": str(m.get("match_id")),
        "home": m["home_team"],
        "away": m["away_team"],
        "dateISO": m["date"],
        "homeScore": hs,
        "awayScore": aws,
        "homeBadge": None,
        "awayBadge": None,
    }


def norm_daily(m):
    """Normalize one get_matches_by_date match, or None. Returns (game, team_ids)."""
    st = m.get("status") or {}
    reason = (st.get("reason") or {}).get("longKey", "")
    if not (st.get("finished") or reason == "finished"):
        return None
    home, away = m.get("home") or {}, m.get("away") or {}
    hs, aws = home.get("score"), away.get("score")
    if not isinstance(hs, int) or not isinstance(aws, int):
        return None
    if not home.get("name") or not away.get("name"):
        return None
    date_iso = st.get("utcTime")
    if not date_iso and isinstance(m.get("timeTS"), (int, float)):
        # timeTS is epoch milliseconds.
        date_iso = datetime.datetime.fromtimestamp(
            m["timeTS"] / 1000, tz=datetime.timezone.utc).isoformat()
    if not date_iso:
        return None
    tids = {}
    if home.get("id"):
        tids[home["name"]] = int(home["id"])
    if away.get("id"):
        tids[away["name"]] = int(away["id"])
    game = {
        "id": str(m.get("id")),
        "home": home["name"],
        "away": away["name"],
        "dateISO": date_iso,
        "homeScore": hs,
        "awayScore": aws,
        "homeBadge": TEAM_LOGO.format(id=home["id"]) if home.get("id") else None,
        "awayBadge": TEAM_LOGO.format(id=away["id"]) if away.get("id") else None,
    }
    return game, tids


def load_json(path):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return None


def harvest_daily(data, lid, games_by_id, team_ids):
    """Merge one get_matches_by_date payload into the league's games.

    Returns the number of new games added. Always accumulates team ids,
    even for already-known games.
    """
    added = 0
    for lg in (data.get("leagues") or []):
        try:
            lg_id = int(lg.get("id", -1))
        except (TypeError, ValueError):
            continue
        if lg_id != lid:
            continue
        for m in lg.get("matches") or []:
            r = norm_daily(m)
            if not r:
                continue
            g, tids = r
            team_ids.update(tids)
            if g["id"] not in games_by_id:
                games_by_id[g["id"]] = g
                added += 1
    return added


def historical_check_due(existing):
    """True when the season backfill should be (re)checked."""
    if not existing or not existing.get("games"):
        return True
    last = existing.get("last_historical_check")
    if not last:
        return True
    try:
        age = (datetime.datetime.now(datetime.timezone.utc)
               - datetime.datetime.fromisoformat(last))
        return age.days >= HISTORICAL_CHECK_DAYS
    except Exception:
        return True


def main():
    os.makedirs("data", exist_ok=True)
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    today = datetime.date.today()
    yesterday = today - datetime.timedelta(days=1)

    # League IDs are stable; reuse the IDs stored in the data files and
    # only hit get_leagues when a file is missing them (first run).
    league_ids = {}
    for slug in LEAGUES:
        d = load_json(f"data/{slug}.json") or {}
        if d.get("league_id"):
            league_ids[slug] = int(d["league_id"])
    if len(league_ids) < len(LEAGUES):
        league_ids = resolve_league_ids()
    else:
        print("league ids cached: " + ", ".join(
            f"{s}={i}" for s, i in league_ids.items()), flush=True)

    # Per-league state.
    states = {}
    for slug, lid in league_ids.items():
        existing = load_json(f"data/{slug}.json") or {}
        states[slug] = {
            "lid": lid,
            "games": {g["id"]: g for g in existing.get("games", [])},
            # name -> FotMob team id, accumulated for badge backfill.
            "team_ids": dict(existing.get("team_ids") or {}),
            "season": existing.get("season"),
            "last_check": existing.get("last_historical_check"),
            # Last date fully pulled via matches_by_date. Never re-fetch
            # at or before this date: each calendar date costs API calls,
            # so every date is fetched at most once per league.
            "checked_through": existing.get("checked_through"),
        }

    # Season backfill / rollover check (monthly; 1 call per league when due).
    for slug, st in states.items():
        lid = st["lid"]
        proxy = {"games": list(st["games"].values()),
                 "season": st["season"],
                 "last_historical_check": st["last_check"]}
        if historical_check_due(proxy):
            hist = ok_data(call("get_historical_match_results",
                                 {"league_id": lid}),
                           "get_historical_match_results")
            new_season = hist.get("season")
            st["last_check"] = now_iso
            if not st["games"] or st["season"] != new_season:
                if st["season"]:
                    print(f"{slug}: season rollover {st['season']} -> "
                          f"{new_season}; re-backfilling", flush=True)
                else:
                    print(f"{slug}: backfilling season {new_season}",
                          flush=True)
                st["season"] = new_season
                st["games"] = {}
                for m in hist.get("matches") or []:
                    g = norm_historical(m)
                    if g:
                        st["games"][g["id"]] = g
                # team_ids are kept: FotMob team ids are stable across
                # seasons, and reusing them saves harvest calls.
            else:
                st["season"] = new_season
                print(f"{slug}: season {st['season']} unchanged "
                      f"({len(st['games'])} stored games)", flush=True)
        else:
            print(f"{slug}: loaded {len(st['games'])} stored games "
                  f"(season {st['season']})", flush=True)
        # One-time migration: the backfill was verified current today, so
        # start the watermark at yesterday. This trusts the backfill for
        # earlier dates rather than re-fetching them at 1 credit each.
        if not st["checked_through"]:
            st["checked_through"] = yesterday.isoformat()

    # Incremental catch-up. Collect the union of dates the leagues still
    # need and fetch each date ONCE; matches_by_date returns every league,
    # so the payload is then distributed to whichever leagues want it.
    wanted = {}  # date -> set of slugs
    for slug, st in states.items():
        start = datetime.date.fromisoformat(st["checked_through"])
        d = start + datetime.timedelta(days=1)
        while d <= yesterday and (d - start).days <= MAX_CATCHUP_DAYS:
            wanted.setdefault(d, set()).add(slug)
            d += datetime.timedelta(days=1)

    payloads = {}
    for d in sorted(wanted):
        ds = d.strftime("%Y%m%d")
        try:
            payloads[d] = ok_data(call("get_matches_by_date", {"date": ds}),
                                  "get_matches_by_date")
        except RuntimeError as e:
            print(f"daily {ds} failed: {e}", flush=True)
    print(f"incremental: fetched {len(payloads)}/{len(wanted)} dates",
          flush=True)

    for slug, st in states.items():
        cur = datetime.date.fromisoformat(st["checked_through"])
        for d in sorted(wanted):
            if slug not in wanted[d]:
                continue
            if d not in payloads:
                break  # failed date: retry it next run, don't skip it
            added = harvest_daily(payloads[d], st["lid"],
                                  st["games"], st["team_ids"])
            if added:
                print(f"{slug}: {d} +{added} games", flush=True)
            cur = d
        st["checked_through"] = cur.isoformat()

    # Cold start: a league whose team-id map is still empty never saw its
    # teams via matches_by_date (e.g. UCL between matchdays). Fetch only
    # the dates on which it actually has stored games — no blind scanning.
    for slug, st in states.items():
        if st["team_ids"]:
            continue
        game_dates = sorted({g["dateISO"][:10] for g in st["games"].values()
                             if g.get("dateISO")}, reverse=True)[:7]
        for ds10 in game_dates:
            d = datetime.date.fromisoformat(ds10)
            if d in payloads:
                data = payloads[d]
            else:
                try:
                    data = ok_data(call("get_matches_by_date",
                                         {"date": d.strftime("%Y%m%d")}),
                                   "get_matches_by_date")
                except RuntimeError as e:
                    print(f"{slug}: harvest {ds10} failed: {e}", flush=True)
                    continue
            leagues = data.get("leagues") or []
            lg = next((l for l in leagues
                       if str(l.get("id")) == str(st["lid"])), None)
            before = len(st["team_ids"])
            harvest_daily(data, st["lid"], st["games"], st["team_ids"])
            print(f"{slug}: harvest {ds10}: league present={lg is not None} "
                  f"matches={len(lg.get('matches') or []) if lg else 0} "
                  f"+{len(st['team_ids']) - before} ids", flush=True)
        print(f"{slug}: cold-start harvest -> {len(st['team_ids'])} team ids",
              flush=True)

    # Enrich older games' badges from the accumulated name->id map.
    # The historical and daily feeds sometimes spell a team slightly
    # differently (accents, apostrophes, FC suffixes), so match
    # tolerantly: exact, then accent/case/punctuation-insensitive,
    # then a high-threshold fuzzy fallback.
    for slug, st in states.items():
        team_ids = st["team_ids"]
        norm_map = {norm_team_name(k): v for k, v in team_ids.items()}
        norm_keys = list(norm_map.keys())

        def team_id_for(name, _ids=team_ids,
                        _nmap=norm_map, _nkeys=norm_keys):
            if name in _ids:
                return _ids[name]
            nk = norm_team_name(name)
            if nk in _nmap:
                return _nmap[nk]
            best = difflib.get_close_matches(nk, _nkeys, n=1, cutoff=0.9)
            return _nmap[best[0]] if best else None

        for g in st["games"].values():
            if not g.get("homeBadge"):
                tid = team_id_for(g["home"])
                if tid:
                    g["homeBadge"] = TEAM_LOGO.format(id=tid)
            if not g.get("awayBadge"):
                tid = team_id_for(g["away"])
                if tid:
                    g["awayBadge"] = TEAM_LOGO.format(id=tid)

        # Safety net: dedupe on (date, home, away) in case the two sources
        # ever describe the same fixture with different ids. Prefer the
        # entry that carries crest URLs.
        deduped = {}
        for g in st["games"].values():
            key = (g["dateISO"][:10], g["home"], g["away"])
            prev = deduped.get(key)
            if prev is None or (not prev.get("homeBadge") and g.get("homeBadge")):
                deduped[key] = g
        games = sorted(deduped.values(), key=lambda g: g["dateISO"],
                       reverse=True)

        out = {
            "league": slug,
            "league_id": st["lid"],
            "season": st["season"],
            "updated_at": now_iso,
            "last_historical_check": st["last_check"],
            "checked_through": st["checked_through"],
            "team_ids": team_ids,
            "games": games,
        }
        path = f"data/{slug}.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
        print(f"{slug}: wrote {len(games)} games -> {path}", flush=True)

    print(f"done (API calls this run: {_CALL_COUNT})")


if __name__ == "__main__":
    main()
