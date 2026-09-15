# תקצירים — Soccer Game Recaps (standalone)

Hebrew RTL web app showing recent soccer game results and recap videos.
Built with Next.js 15 (App Router) + TypeScript.

## Leagues

- Premier League, La Liga, Israeli Premier League, UEFA Champions League
- Game data: TheSportsDB free API, current 2026–27 season
- Only games that ended at least 5 hours ago are listed

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `YOUTUBE_API_KEY` | No | YouTube Data API v3 key for video search. If missing, YouTube is skipped gracefully and other sources are still returned. |
| `THESPORTSDB_KEY` | No | TheSportsDB API key. Defaults to the free demo key `3` (limited results). |

Set them in Vercel: Project → Settings → Environment Variables.

## Develop

```bash
npm install
npm run dev
```

## Deploy

Push to `main` — Vercel auto-deploys.
