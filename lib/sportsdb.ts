import { cacheGet, cacheSet } from './cache';
import { getLeague, type LeagueSlug } from './leagues';

const API = 'https://www.thesportsdb.com/api/v1/json';
const KEY = process.env.THESPORTSDB_KEY || '3';
const SEASON = '2026-2027';
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

interface SportsDbEvent {
  idEvent: string;
  strHomeTeam: string;
  strAwayTeam: string;
  strTimestamp: string;
  intHomeScore: string | null;
  intAwayScore: string | null;
  strThumb: string | null;
  strHomeTeamBadge: string | null;
  strAwayTeamBadge: string | null;
  strLeagueBadge: string | null;
}

async function fetchJson(url: string, timeoutMs = 15000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(t);
  }
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

  const data = (await fetchJson(
    `${API}/${KEY}/eventsseason.php?id=${league.sportsdbId}&s=${SEASON}`
  )) as { events?: SportsDbEvent[] };

  const now = Date.now();
  const games: GameRecord[] = [];

  for (const e of data.events ?? []) {
    const hs = e.intHomeScore == null || e.intHomeScore === '' ? null : parseInt(e.intHomeScore, 10);
    const as = e.intAwayScore == null || e.intAwayScore === '' ? null : parseInt(e.intAwayScore, 10);
    if (hs == null || as == null) continue; // not played yet
    if (!e.strTimestamp) continue;
    const ts = Date.parse(e.strTimestamp + 'Z'); // TheSportsDB timestamps are UTC
    if (Number.isNaN(ts)) continue;
    if (now - ts < FIVE_HOURS_MS) continue; // ended less than 5 hours ago

    games.push({
      id: e.idEvent,
      home: e.strHomeTeam,
      away: e.strAwayTeam,
      dateISO: new Date(ts).toISOString(),
      homeScore: hs,
      awayScore: as,
      thumb: e.strThumb || null,
      homeBadge: e.strHomeTeamBadge || null,
      awayBadge: e.strAwayTeamBadge || null,
      leagueBadge: e.strLeagueBadge || null,
    });
  }

  games.sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1));
  cacheSet(cacheKey, games, 30 * 60 * 1000);
  return games;
}
