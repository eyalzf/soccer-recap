import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cacheGet, cacheSet } from './cache';
import {
  getLeague,
  getNationalCompetition,
  isNationalSlug,
  type LeagueSlug,
  type NationalCompetitionSlug,
} from './leagues';

/**
 * Listings data source: per-league JSON files built by the daily
 * `fetch-results` GitHub Actions workflow (scripts/fetch_results.py),
 * which pulls finished matches from the FotMob API via parse.bot.
 *
 * The app never calls parse.bot at request time. It reads the committed
 * files from GitHub (always current within minutes of the daily update),
 * falling back to the copy bundled with the deployment if that fetch fails.
 *
 * File shape: { league, league_id, season, updated_at, games: StoredGame[] }
 */

const DATA_BASE =
  'https://raw.githubusercontent.com/eyalzf/soccer-recap/main/data';
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
  /** Competition stage/round label, e.g. "שלב הבתים" (nations) or "מחזור 5" (clubs). */
  stage: string | null;
}

export interface LeagueGamesResult {
  games: GameRecord[];
  /** Last fetch error when games is empty; null on success. */
  error: string | null;
}

interface StoredGame {
  id?: string;
  home?: string;
  away?: string;
  dateISO?: string;
  homeScore?: number | null;
  awayScore?: number | null;
  homeBadge?: string | null;
  awayBadge?: string | null;
  stage?: string | null;
}

interface StoredFile {
  games?: StoredGame[];
}

async function fetchJson(url: string, timeoutMs = 15000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(t);
  }
}

async function loadLeagueFile(slug: string): Promise<StoredFile | null> {
  const cacheKey = `datafile:${slug}`;
  const cached = cacheGet<StoredFile>(cacheKey);
  if (cached) return cached;

  // Primary: the committed file on GitHub (fresh within minutes of the daily update).
  try {
    const data = (await fetchJson(`${DATA_BASE}/${slug}.json`)) as StoredFile;
    if (data && Array.isArray(data.games)) {
      cacheSet(cacheKey, data, 10 * 60 * 1000);
      return data;
    }
  } catch {
    // Fall through to the bundled copy.
  }

  // Fallback: the copy bundled with this deployment.
  try {
    const raw = await readFile(join(process.cwd(), 'data', `${slug}.json`), 'utf8');
    const data = JSON.parse(raw) as StoredFile;
    if (data && Array.isArray(data.games)) {
      cacheSet(cacheKey, data, 10 * 60 * 1000);
      return data;
    }
  } catch {
    // No data available.
  }
  return null;
}

/**
 * Current-season games for a league, most recent first.
 * Only includes finished games that kicked off at least 5 hours ago.
 *
 * National competitions additionally prune games older than 3 months, so a
 * competition chip with no recent games disappears from selection until it
 * has games again (per the נבחרות visibility rule).
 */
export async function getLeagueGames(
  slug: LeagueSlug | NationalCompetitionSlug
): Promise<LeagueGamesResult> {
  const cacheKey = `games:${slug}`;
  const cached = cacheGet<GameRecord[]>(cacheKey);
  // An empty cached entry is a brief negative-cache marker from a failed fetch:
  // fall through and retry instead of serving it as a real result.
  if (cached && cached.length > 0) return { games: cached, error: null };

  const league = getLeague(slug) ?? getNationalCompetition(slug);
  if (!league) return { games: [], error: `unknown league ${slug}` };

  const file = await loadLeagueFile(slug);
  if (!file) {
    cacheSet(cacheKey, [], 60 * 1000);
    return { games: [], error: 'results data unavailable' };
  }

  const now = Date.now();
  // National competitions: hide games older than 3 months (visibility rule).
  const national = isNationalSlug(slug);
  const MAX_AGE_MS = 90 * 24 * 3600 * 1000;
  const games: GameRecord[] = [];
  for (const g of file.games ?? []) {
    if (!g.home || !g.away || !g.dateISO) continue;
    if (!Number.isInteger(g.homeScore) || !Number.isInteger(g.awayScore)) continue;
    const ts = Date.parse(g.dateISO);
    if (Number.isNaN(ts)) continue;
    if (now - ts < FIVE_HOURS_MS) continue; // kicked off less than 5 hours ago
    if (national && now - ts > MAX_AGE_MS) continue; // older than 3 months
    const homeScore = g.homeScore;
    const awayScore = g.awayScore;
    if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore)) continue;
    games.push({
      id: g.id ?? `${g.dateISO}|${g.home}|${g.away}`,
      home: g.home,
      away: g.away,
      dateISO: new Date(ts).toISOString(),
      homeScore: homeScore as number,
      awayScore: awayScore as number,
      // FotMob exposes no event photos; the UI composites the two crests.
      thumb: null,
      // Identity-explicit: home badge is the HOME team's crest, away badge the AWAY team's.
      homeBadge: g.homeBadge || null,
      awayBadge: g.awayBadge || null,
      leagueBadge: league.badge,
      stage: g.stage || null,
    });
  }
  games.sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1));

  if (games.length > 0) {
    // Never cache an empty result long-term: a failed fetch must not poison the cache.
    cacheSet(cacheKey, games, 10 * 60 * 1000);
    return { games, error: null };
  }
  // Brief negative cache so an outage doesn't hammer the file fetch.
  cacheSet(cacheKey, [], 60 * 1000);
  return { games: [], error: 'no games in results data' };
}
