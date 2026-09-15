import { cacheGet, cacheSet } from './cache';
import { getLeague, type LeagueSlug } from './leagues';

/**
 * Listings data source: Sofascore's unofficial API (no key required).
 *
 * Endpoints:
 *   GET /api/v1/unique-tournament/{utid}/seasons            -> first entry is the current season
 *   GET /api/v1/unique-tournament/{utid}/season/{sid}/events/last/{page}
 *   Team crest:  https://api.sofascore.com/api/v1/team/{teamId}/image
 *   League logo: https://api.sofascore.com/api/v1/unique-tournament/{utid}/image
 *
 * Politeness: games are cached 30 min, season resolution 24 h. A full refresh
 * costs 2 requests per league (last/0 + last/1); never hammer this endpoint.
 */

const API = 'https://www.sofascore.com/api/v1';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const FIVE_HOURS_MS = 5 * 3600 * 1000;

export interface GameRecord {
  id: string;
  home: string;
  away: string;
  /** ISO UTC datetime of kickoff */
  dateISO: string;
  homeScore: number | null;
  awayScore: number | null;
  thumb: string | null;
  homeBadge: string | null;
  awayBadge: string | null;
  leagueBadge: string | null;
}

interface SofaTeam {
  id?: number;
  name?: string;
  shortName?: string;
  nameCode?: string;
}

interface SofaEvent {
  id?: number;
  homeTeam?: SofaTeam;
  awayTeam?: SofaTeam;
  homeScore?: { current?: number };
  awayScore?: { current?: number };
  startTimestamp?: number;
  status?: { type?: string };
}

async function fetchJson(url: string, timeoutMs = 20000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(t);
  }
}

/** Resolve the current season id for a league; falls back to the last-known id. */
async function resolveSeasonId(slug: LeagueSlug): Promise<number> {
  const league = getLeague(slug);
  if (!league) throw new Error(`unknown league ${slug}`);
  const cacheKey = `sofa-season:${slug}`;
  const cached = cacheGet<number>(cacheKey);
  if (cached) return cached;
  try {
    const data = (await fetchJson(`${API}/unique-tournament/${league.sofascoreUtid}/seasons`)) as {
      seasons?: Array<{ id?: number }>;
    };
    const id = data.seasons?.[0]?.id;
    if (typeof id === 'number') {
      cacheSet(cacheKey, id, 24 * 3600 * 1000);
      return id;
    }
  } catch {
    // fall through to the hardcoded fallback
  }
  return league.sofascoreSeasonId;
}

/**
 * Current-season games for a league, most recent first.
 * Only includes games that ended at least 5 hours ago.
 */
export async function getLeagueGames(slug: LeagueSlug): Promise<GameRecord[]> {
  const cacheKey = `games:${slug}`;
  const cached = cacheGet<GameRecord[]>(cacheKey);
  if (cached) return cached;

  const league = getLeague(slug);
  if (!league) return [];

  const seasonId = await resolveSeasonId(slug);

  // last/0 = most recent ~26-30 events; last/1 extends the pool for page 1.
  const pages = await Promise.all(
    [0, 1].map(async (p) => {
      try {
        const data = (await fetchJson(
          `${API}/unique-tournament/${league.sofascoreUtid}/season/${seasonId}/events/last/${p}`
        )) as { events?: SofaEvent[] };
        return data.events ?? [];
      } catch {
        return [] as SofaEvent[];
      }
    })
  );

  const now = Date.now();
  const seen = new Set<number>();
  const games: GameRecord[] = [];

  for (const e of pages.flat()) {
    if (e.id == null || seen.has(e.id)) continue;
    seen.add(e.id);
    if (e.status?.type !== 'finished') continue;
    const hs = e.homeScore?.current;
    const as = e.awayScore?.current;
    if (hs == null || as == null) continue;
    const ts = (e.startTimestamp ?? 0) * 1000;
    if (!ts || Number.isNaN(ts)) continue;
    if (now - ts < FIVE_HOURS_MS) continue; // ended less than 5 hours ago
    const homeId = e.homeTeam?.id;
    const awayId = e.awayTeam?.id;
    if (homeId == null || awayId == null) continue;

    games.push({
      id: String(e.id),
      home: e.homeTeam?.name ?? '',
      away: e.awayTeam?.name ?? '',
      dateISO: new Date(ts).toISOString(),
      homeScore: hs,
      awayScore: as,
      // Sofascore exposes no event photos; the UI composites the two crests.
      thumb: null,
      // Identity-explicit: home badge is the HOME team's crest, away badge the AWAY team's.
      homeBadge: `https://api.sofascore.com/api/v1/team/${homeId}/image`,
      awayBadge: `https://api.sofascore.com/api/v1/team/${awayId}/image`,
      leagueBadge: `https://api.sofascore.com/api/v1/unique-tournament/${league.sofascoreUtid}/image`,
    });
  }

  games.sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1));
  cacheSet(cacheKey, games, 30 * 60 * 1000);
  return games;
}
