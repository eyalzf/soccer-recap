# Recap fixtures — quota-free validation

Recorded `/api/recap` SSE streams. Replaying one costs **zero YouTube API
quota**; recording one costs a single fresh search.

## Recording (costs quota — do this sparingly)

Run right after the daily YouTube quota reset (midnight Pacific = 10:00 IDT):

```bash
python3 scripts/record_fixture.py --slug real-madrid-inter-ucl \
  --label "Real Madrid 2-1 Inter (UCL)" \
  --home "Real Madrid" --away Inter --date 2026-09-16 \
  --league champions-league --hs 2 --as 1 \
  --home-he "ריאל מדריד" --away-he "אינטר"
```

Then commit `fixtures/recap/<slug>.json` and push — the next Vercel deploy
serves it. Re-record only when the search/filter/rank pipeline changes, not
per deploy.

## Replaying (free)

- Browse at `/fixtures`, tap a fixture to open the real recap dialog in
  replay mode (`/api/recap?...&fixture=<slug>`). Event shapes are identical
  to a live search, including progressive `batch` updates.
- Slugs are strictly validated (`[a-z0-9-]`); unknown slugs return 404.

## Staleness

Each fixture records `matcherVersion`. Bump `MATCHER_VERSION` in
`lib/recap/fixtures.ts` whenever `lib/recap/match.ts`, `rank.ts`,
`leaguePlans.ts` or `sources.ts` change — the fixtures page then flags older
fixtures as stale instead of silently trusting them.

## Player testing (free)

`/test-player?videoId=<id>` renders the resume-capable player directly with
no search involved — for playback, resume and watched-state checks.
