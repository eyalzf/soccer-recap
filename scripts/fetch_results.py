#!/usr/bin/env python3
"""Daily listings pipeline: FotMob API (via parse.bot) -> per-league JSON.

- Resolves the 4 league IDs via get_leagues (expected: PL 47, LaLiga 87,
  Israel 127, UCL 42).
- Backfills the current season via get_historical_match_results (one call
  per league) when no local data file exists; re-checks the season weekly
  so a rollover triggers a fresh backfill.
- Incrementally fetches get_matches_by_date for days missing since the
  last run (capped), merging new finished games.
- Writes data/<slug>.json: {league, league_id, season, updated_at,
  team_ids, games[]}. The app serves these files; it never calls
  parse.bot at request time.

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
HISTORICAL_CHECK_DAYS = 7

# Parse free tier: 5 requests/minute. Pace calls and retry on 429.
_MIN_INTERVAL = 12.0
_LAST_CALL = 0.0


def call(endpoint, params=None, retries=3):
    global _LAST_CALL
    url = f"{API}/{endpoint}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    last_err = None
    for attempt in range(retries):
        wait = _MIN_INTERVAL - (time.monotonic() - _LAST_CALL)
        if wait > 0:
            time.sleep(wait)
        _LAST_CALL = time.monotonic()
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
    league_ids = resolve_league_ids()

    for slug, lid in league_ids.items():
        path = f"data/{slug}.json"
        existing = load_json(path) or {}
        games_by_id = {}
        # name -> FotMob team id, accumulated across runs for badge backfill.
        team_ids = dict(existing.get("team_ids") or {})
        season = existing.get("season")
        last_check = existing.get("last_historical_check")

        if historical_check_due(existing):
            hist = ok_data(call("get_historical_match_results", {"league_id": lid}),
                           "get_historical_match_results")
            season = hist.get("season")
            last_check = now_iso
            if not existing.get("games") or existing.get("season") != season:
                print(f"{slug}: backfilling season {season}", flush=True)
                for m in hist.get("matches") or []:
                    g = norm_historical(m)
                    if g:
                        games_by_id[g["id"]] = g
            else:
                for g in existing.get("games", []):
                    games_by_id[g["id"]] = g
                print(f"{slug}: season {season} unchanged "
                      f"({len(games_by_id)} stored games)", flush=True)
        else:
            for g in existing.get("games", []):
                games_by_id[g["id"]] = g
            print(f"{slug}: loaded {len(games_by_id)} stored games "
                  f"(season {season})", flush=True)

        # Incremental catch-up for days missing since the last stored game.
        dates = sorted(g["dateISO"][:10] for g in games_by_id.values()
                       if g.get("dateISO"))
        if dates:
            last = datetime.date.fromisoformat(dates[-1])
            today = datetime.date.today()
            missing = []
            d = last + datetime.timedelta(days=1)
            while d < today and len(missing) < MAX_CATCHUP_DAYS:
                missing.append(d)
                d += datetime.timedelta(days=1)
            for d in missing:
                ds = d.strftime("%Y%m%d")
                data = ok_data(call("get_matches_by_date", {"date": ds}),
                               "get_matches_by_date")
                added = harvest_daily(data, lid, games_by_id, team_ids)
                print(f"{slug}: {ds} +{added} games", flush=True)

        # Cold start: when the map is still empty the backfill may already
        # be current (or the missing days had no games for this league, e.g.
        # UCL between matchdays), leaving no team IDs to build crests from.
        # Scan the last 7 days once so backfilled games gain crests.
        if not team_ids:
            today = datetime.date.today()
            for back in range(1, 8):
                ds = (today - datetime.timedelta(days=back)).strftime("%Y%m%d")
                try:
                    data = ok_data(call("get_matches_by_date", {"date": ds}),
                                   "get_matches_by_date")
                except RuntimeError as e:
                    print(f"{slug}: harvest {ds} failed: {e}", flush=True)
                    continue
                leagues = data.get("leagues") or []
                lg = next((l for l in leagues
                           if str(l.get("id")) == str(lid)), None)
                n_matches = len(lg.get("matches") or []) if lg else 0
                added = harvest_daily(data, lid, games_by_id, team_ids)
                print(f"{slug}: harvest {ds}: {len(leagues)} leagues, "
                      f"league {lid} present={lg is not None} "
                      f"matches={n_matches} +{added} games, "
                      f"ids={len(team_ids)}", flush=True)
            print(f"{slug}: cold-start harvest -> {len(team_ids)} team ids",
                  flush=True)

        # Enrich older games' badges from the accumulated name->id map.
        # The historical and daily feeds sometimes spell a team slightly
        # differently (accents, apostrophes, FC suffixes), so match
        # tolerantly: exact, then accent/case/punctuation-insensitive,
        # then a high-threshold fuzzy fallback.
        norm_map = {norm_team_name(k): v for k, v in team_ids.items()}
        norm_keys = list(norm_map.keys())

        def team_id_for(name):
            if name in team_ids:
                return team_ids[name]
            nk = norm_team_name(name)
            if nk in norm_map:
                return norm_map[nk]
            best = difflib.get_close_matches(nk, norm_keys, n=1, cutoff=0.9)
            return norm_map[best[0]] if best else None

        for g in games_by_id.values():
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
        for g in games_by_id.values():
            key = (g["dateISO"][:10], g["home"], g["away"])
            prev = deduped.get(key)
            if prev is None or (not prev.get("homeBadge") and g.get("homeBadge")):
                deduped[key] = g
        games = sorted(deduped.values(), key=lambda g: g["dateISO"], reverse=True)

        out = {
            "league": slug,
            "league_id": lid,
            "season": season,
            "updated_at": now_iso,
            "last_historical_check": last_check,
            "team_ids": team_ids,
            "games": games,
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
        print(f"{slug}: wrote {len(games)} games -> {path}", flush=True)

    print("done")


if __name__ == "__main__":
    main()
