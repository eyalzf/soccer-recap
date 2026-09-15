import { cacheGet, cacheSet } from './cache';
import { getLeague, type LeagueSlug } from './leagues';

/**
 * Listings data source: SportScore's public API (no key required, anonymous access).
 *
 * Endpoints:
 *   GET /api/v1/fixtures/?sport=football&date=YYYY-MM-DD&status=finished&competition={slug}&limit=200
 *   GET /api/v1/search/?q=...   (competition slug discovery)
 *
 * Competition slugs (verified live):
 *   israel-premier-league | english-premier-league | spanish-la-liga | uefa-champions-league
 *
 * Data shape per match: { home, away, home_logo, away_logo, home_score, away_score
 * (strings), status ("finished"), time (ISO UTC), competition, competition_logo, url }
 *
 * Politeness: games cached 30 min. A cold-cache refresh walks back day-by-day
 * (max ~21 days, stops early once 20 games are collected). One retry with a
 * short backoff on 5xx. Never hammer this endpoint.
 */

const API = 'https://sportscore.com/api/v1';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const FIVE_HOURS_MS = 5 * 3600 * 1000;
/** Walk back at most this many days looking for finished games. */
const MAX_WALKBACK_DAYS = 21;
/** Stop the walkback once we have at least this many games (covers 2 app pages). */
const TARGET_GAMES = 20;

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

interface SportScoreMatch {
  home?: string;
  away?: string;
  home_logo?: string;
  away_logo?: string;
  home_score?: string;
  away_score?: string;
  status?: string;
  time?: string;
  competition?: string;
  competition_logo?: string;
  url?: string;
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

/** Fetch with one retry + short backoff on 5xx (SportScore has shown transient 503s). */
async function fetchJsonRetry(url: string): Promise<{ data: unknown; error: string | null }> {
  try {
    return { data: await fetchJson(url), error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const is5xx = /HTTP 5\d\d/.test(msg);
    if (!is5xx) return { data: null, error: msg };
    await new Promise((r) => setTimeout(r, 2000));
    try {
      return { data: await fetchJson(url), error: null };
    } catch (e2) {
      return { data: null, error: e2 instanceof Error ? e2.message : String(e2) };
    }
  }
}

export interface LeagueGamesResult {
  games: GameRecord[];
  /** Last fetch error when games is empty; null on success. */
  error: string | null;
}

function toGameRecord(m: SportScoreMatch): GameRecord | null {
  // status "finished" is the exact value observed live; the query already filters for it.
  if (m.status !== 'finished') return null;
  const hs = parseInt(m.home_score ?? '', 10);
  const as = parseInt(m.away_score ?? '', 10);
  if (!Number.isFinite(hs) || !Number.isFinite(as)) return null;
  const ts = m.time ? Date.parse(m.time) : NaN;
  if (!m.home || !m.away || Number.isNaN(ts)) return null;
  if (Date.now() - ts < FIVE_HOURS_MS) return null; // kicked off less than 5 hours ago
  return {
    id: `${m.time}|${m.home}|${m.away}`,
    home: m.home,
    away: m.away,
    dateISO: new Date(ts).toISOString(),
    homeScore: hs,
    awayScore: as,
    // SportScore exposes no event photos; the UI composites the two crests.
    thumb: null,
    // Identity-explicit: home badge is the HOME team's crest, away badge the AWAY team's.
    homeBadge: m.home_logo || null,
    awayBadge: m.away_logo || null,
    leagueBadge: m.competition_logo || null,
  };
}

/**
 * Current-season games for a league, most recent first.
 * Only includes games that kicked off at least 5 hours ago.
 */
export async function getLeagueGames(slug: LeagueSlug): Promise<LeagueGamesResult> {
  const cacheKey = `games:${slug}`;
  const cached = cacheGet<GameRecord[]>(cacheKey);
  // An empty cached entry is a brief negative-cache marker from a failed fetch:
  // fall through and retry instead of serving it as a real result.
  if (cached && cached.length > 0) return { games: cached, error: null };

  const league = getLeague(slug);
  if (!league) return { games: [], error: `unknown league ${slug}` };

  const games: GameRecord[] = [];
  const seen = new Set<string>();
  let lastError: string | null = null;

  // Walk back day-by-day (UTC) collecting finished games; stop early at TARGET_GAMES.
  for (let back = 0; back < MAX_WALKBACK_DAYS && games.length < TARGET_GAMES; back++) {
    const d = new Date(Date.now() - back * 86400000);
    const dateStr = d.toISOString().slice(0, 10);
    const { data, error } = await fetchJsonRetry(
      `${API}/fixtures/?sport=football&date=${dateStr}&status=finished&competition=${league.sportscoreSlug}&limit=200`
    );
    if (error) {
      lastError = `${dateStr}: ${error}`;
      continue;
    }
    const matches = ((data as { matches?: SportScoreMatch[] } | null)?.matches ?? []) as SportScoreMatch[];
    for (const m of matches) {
      const g = toGameRecord(m);
      if (!g || seen.has(g.id)) continue;
      seen.add(g.id);
      games.push(g);
    }
  }

  games.sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1));
  if (games.length > 0) {
    // Never cache an empty result long-term: a failed fetch must not poison the cache.
    cacheSet(cacheKey, games, 30 * 60 * 1000);
    return { games, error: null };
  }
  // Brief negative cache so an outage doesn't hammer the API.
  cacheSet(cacheKey, [], 60 * 1000);
  return { games: [], error: lastError ?? 'no games returned' };
}
