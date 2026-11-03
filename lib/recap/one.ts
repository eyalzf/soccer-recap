/**
 * ONE website (one.co.il) as a recap source, parameterized by ONE
 * league id: 10 = La Liga (user decision 2026-11-03: secondary
 * source after the preferred YouTube channel) and 8 = Serie A
 * (user decision 2026-11-03: LEADING source for Italian
 * leading-teams games, before any YouTube channel).
 *
 * Unlike Sport5, ONE needs no index harvest and no title parsing:
 * - Discovery: ONE's league API returns the whole season's fixtures
 *   in one call (all 38 rounds, 380 games) with ONE's own match ids,
 *   Hebrew team names, scores and dates. The fixture list is cached
 *   in storage for 1h (scores for the cross-check refresh hourly).
 * - Per game: the fixture is matched by Israel calendar day + Hebrew
 *   team names (either order) + exact score. Unplayed fixtures
 *   (scores -1/-1) never match; ≥2 matches suppress the result as
 *   ambiguous, mirroring Sport5.
 * - Video: GET /api/match/<id>/summary-video returns availability
 *   plus the video files. A future/uncovered match returns
 *   {"available": false} — a clean miss, so the cascade falls through
 *   to bulk/general.
 *
 * Embedding: ONE's own player uses a native <video> tag, and the
 * candidate carries the same thing via `embedUrl` (the S3 failover
 * MP4 over HTTPS). The primary CDN host (wow4geo) is geo-restricted
 * — from non-Israeli egress it 301s to a geo_prohibit clip — while
 * the S3 failover plays globally (verified from US egress), so the
 * failover is the embed URL and the ONE match page (`url`) is the
 * fallback link. `external: true` keeps the above-bulk exclusivity
 * machinery working; the UI renders an inline <video> player
 * whenever `embedUrl` is an MP4 instead of a link-out card.
 *
 * The summary API carries no publish date. The candidate's
 * `publishedAt` is therefore the game day: the video is
 * fixture-mapped to this game, so the game-day-or-after filter and
 * date proximity stay correct, and no other fixture's video can
 * leak in through title matching.
 */
import { normHeCompare } from './match';
import { pget, pset } from './persist';
import { lookupClubEn } from '../teamIndex';
import type { GameInput, RawCandidate } from './types';

export const oneLeagueUrl = (leagueId: number) =>
  `https://www.one.co.il/api/league/${leagueId}?quick=1`;
export const oneMatchUrl = (id: number) => `https://www.one.co.il/match/${id}`;
const oneSummaryUrl = (id: number) =>
  `https://www.one.co.il/api/match/${id}/summary-video`;
/**
 * Storage key for a league's fixtures. League 10 keeps the original
 * key (the La Liga source shipped first); other leagues get a
 * suffixed key, so each league's fixtures cache independently.
 */
export function fixturesKeyForLeague(leagueId: number): string {
  return leagueId === 10
    ? 'external/one-fixtures.json'
    : `external/one-fixtures-${leagueId}.json`;
}
const FIXTURES_TTL_MS = 60 * 60 * 1000;
const ONE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export interface OneFixtureTeam {
  name: string;
  shortName?: string;
  /** null for unplayed fixtures (ONE reports -1/-1). */
  score: number | null;
}

export interface OneFixture {
  id: number;
  round: string;
  /** ONE's local (Israel) kickoff datetime, no offset, e.g. 2026-10-31T15:00:00. */
  date: string;
  homeTeam: OneFixtureTeam;
  awayTeam: OneFixtureTeam;
}

export interface OneSummary {
  available: boolean;
  videoId?: number;
  title?: string;
  /** "HH:MM:SS" string, e.g. "00:02:48". */
  duration?: string;
  poster?: string;
  hd?: string;
  sd?: string;
  mobile?: string;
  failover?: string;
}

interface OneFixturesRecord {
  items: OneFixture[];
}

async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': ONE_UA, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`ONE ${res.status} for ${url}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && v >= 0 ? v : null;
}

function strOrUndef(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

/** Full-season fixture list for one ONE league, cached 1h in storage. */
export async function loadOneFixtures(leagueId = 10): Promise<OneFixture[]> {
  const key = fixturesKeyForLeague(leagueId);
  try {
    const rec = await pget<OneFixturesRecord>(key);
    if (
      rec &&
      Array.isArray(rec.val?.items) &&
      rec.val.items.length > 0 &&
      Date.now() - rec.fetchedAt < FIXTURES_TTL_MS
    ) {
      return rec.val.items;
    }
  } catch {
    // Fall through to a live fetch.
  }
  const data = (await fetchJson(oneLeagueUrl(leagueId))) as {
    matches?: Record<string, Record<string, unknown>[]>;
  };
  const items: OneFixture[] = [];
  for (const roundMatches of Object.values(data.matches ?? {})) {
    for (const m of roundMatches) {
      const home = (m.homeTeam ?? {}) as Record<string, unknown>;
      const away = (m.awayTeam ?? {}) as Record<string, unknown>;
      if (typeof m.id !== 'number' || typeof home.name !== 'string' || typeof away.name !== 'string') {
        continue;
      }
      items.push({
        id: m.id,
        round: typeof m.round === 'string' ? m.round : '',
        date: typeof m.date === 'string' ? m.date : '',
        homeTeam: {
          name: home.name,
          shortName: strOrUndef(home.shortName),
          score: numOrNull(home.score),
        },
        awayTeam: {
          name: away.name,
          shortName: strOrUndef(away.shortName),
          score: numOrNull(away.score),
        },
      });
    }
  }
  if (items.length > 0) {
    try {
      await pset(key, { items } satisfies OneFixturesRecord);
    } catch {
      // Cache failure must not fail the search.
    }
  }
  return items;
}

/** Our game's UTC kickoff as an Israel calendar date (YYYY-MM-DD). */
export function jerusalemDate(dateISO: string): string {
  const d = new Date(dateISO);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Hebrew name variants for one of our English club names. */
export type HebrewVariants = (englishName: string) => string[];

/** Registry-based resolver: canonical Hebrew name + registered aliases. */
export function registryHebrewVariants(englishName: string): string[] {
  const club = lookupClubEn(englishName);
  if (!club) return [];
  return [club.he, ...(club.heAliases ?? [])].filter(
    (h): h is string => typeof h === 'string' && h.length > 0
  );
}

export function mapOneMatch(
  fixtures: OneFixture[],
  game: GameInput,
  variants: HebrewVariants
): { match: OneFixture | null; ambiguous: boolean } {
  if (game.homeScore == null || game.awayScore == null) {
    return { match: null, ambiguous: false };
  }
  const day = jerusalemDate(game.dateISO);
  if (!day) return { match: null, ambiguous: false };
  const homeVars = new Set(variants(game.home).map(normHeCompare));
  const awayVars = new Set(variants(game.away).map(normHeCompare));
  if (homeVars.size === 0 || awayVars.size === 0) {
    return { match: null, ambiguous: false };
  }
  const hits: OneFixture[] = [];
  for (const f of fixtures) {
    if (f.homeTeam.score == null || f.awayTeam.score == null) continue;
    if (f.date.slice(0, 10) !== day) continue;
    const fh = normHeCompare(f.homeTeam.name);
    const fa = normHeCompare(f.awayTeam.name);
    const straight =
      homeVars.has(fh) &&
      awayVars.has(fa) &&
      f.homeTeam.score === game.homeScore &&
      f.awayTeam.score === game.awayScore;
    const swapped =
      homeVars.has(fa) &&
      awayVars.has(fh) &&
      f.awayTeam.score === game.homeScore &&
      f.homeTeam.score === game.awayScore;
    if (straight || swapped) hits.push(f);
  }
  if (hits.length === 1) return { match: hits[0], ambiguous: false };
  if (hits.length > 1) return { match: null, ambiguous: true };
  return { match: null, ambiguous: false };
}

/** Parse the summary-video JSON defensively; null when unrecognizable. */
export function parseSummary(data: unknown): OneSummary | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.available !== 'boolean') return null;
  return {
    available: d.available,
    videoId: numOrUndef(d.videoId),
    title: strOrUndef(d.title),
    duration: strOrUndef(d.duration),
    poster: strOrUndef(d.poster),
    hd: strOrUndef(d.hd),
    sd: strOrUndef(d.sd),
    mobile: strOrUndef(d.mobile),
    failover: strOrUndef(d.failover),
  };
}

/** "00:02:48" -> 168. Unparseable -> undefined (fail open). */
export function parseDurationSec(duration?: string): number | undefined {
  if (!duration) return undefined;
  const m = /^(\d+):(\d{2}):(\d{2})$/.exec(duration.trim());
  if (!m) return undefined;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** S3 failover URLs arrive as http; the app page is https, so upgrade. */
export function httpsUrl(url?: string): string | undefined {
  if (!url) return undefined;
  return url.replace(/^http:/, 'https:');
}

/**
 * Build the embeddable candidate for a mapped fixture + available
 * summary. Null when the summary lacks a playable file (the cascade
 * then falls through to bulk/general).
 */
export function buildOneCandidate(
  game: GameInput,
  match: OneFixture,
  summary: OneSummary
): RawCandidate | null {
  if (!summary.available || !summary.videoId || !summary.title) return null;
  // Failover first: it plays globally, while the primary CDN host is
  // geo-restricted. HD next, mobile (.m4v) last.
  const mp4 =
    httpsUrl(summary.failover) ??
    httpsUrl(summary.hd) ??
    httpsUrl(summary.mobile);
  if (!mp4) return null;
  return {
    id: `one:${summary.videoId}`,
    title: summary.title,
    url: oneMatchUrl(match.id),
    source: 'one',
    embedUrl: mp4,
    thumbnail: summary.poster,
    // Fixture-mapped video: the game day is its publish window (see
    // the module header). Keeps the game-day-or-after filter and
    // date proximity correct without a real publish date.
    publishedAt: game.dateISO,
    durationSec: parseDurationSec(summary.duration),
    channelName: 'ONE',
    external: true,
    lang: 'he',
  };
}

export interface OneSearchResult {
  candidate: RawCandidate | null;
  considered: Array<{
    title: string;
    keep: boolean;
    reason: string;
    matchId?: number;
  }>;
  ambiguous: boolean;
}

/**
 * Full provider run for one game. Never throws — any failure yields
 * an empty match with whatever diagnostics were gathered.
 */
export async function oneSearch(
  game: GameInput,
  opts?: {
    /** Plan config for this provider; leagueId selects the ONE league (default 10). */
    cfg?: { leagueId?: number };
    fixtures?: OneFixture[];
    fetchSummary?: (id: number) => Promise<OneSummary | null>;
  }
): Promise<OneSearchResult> {
  try {
    const leagueId = opts?.cfg?.leagueId ?? 10;
    const fixtures = opts?.fixtures ?? (await loadOneFixtures(leagueId));
    const { match, ambiguous } = mapOneMatch(
      fixtures,
      game,
      registryHebrewVariants
    );
    if (ambiguous) return { candidate: null, considered: [], ambiguous: true };
    if (!match) return { candidate: null, considered: [], ambiguous: false };
    const fetchSummary =
      opts?.fetchSummary ??
      (async (id: number) => parseSummary(await fetchJson(oneSummaryUrl(id))));
    const summary = await fetchSummary(match.id);
    // Diagnostics title when no video title exists: the fixture matchup.
    const matchup = `${match.homeTeam.name}–${match.awayTeam.name}`;
    if (!summary) {
      return {
        candidate: null,
        considered: [{ title: matchup, keep: false, reason: 'fetch-failed', matchId: match.id }],
        ambiguous: false,
      };
    }
    if (!summary.available) {
      return {
        candidate: null,
        considered: [{ title: matchup, keep: false, reason: 'unavailable', matchId: match.id }],
        ambiguous: false,
      };
    }
    const candidate = buildOneCandidate(game, match, summary);
    if (!candidate) {
      return {
        candidate: null,
        considered: [
          { title: summary.title ?? matchup, keep: false, reason: 'no-video', matchId: match.id },
        ],
        ambiguous: false,
      };
    }
    return {
      candidate,
      considered: [
        { title: candidate.title, keep: true, reason: 'ok', matchId: match.id },
      ],
      ambiguous: false,
    };
  } catch {
    return { candidate: null, considered: [], ambiguous: false };
  }
}
