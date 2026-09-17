import { NextRequest } from 'next/server';
import { filterCandidate, hasHighlightIntent, isPreferredChannel } from '@/lib/recap/match';
import { rankCandidates } from '@/lib/recap/rank';
import { channelIdForHandle, englishQuery, hebrewQuery, youtubeSearch } from '@/lib/recap/sources';
import type { YouTubeSearchJob } from '@/lib/recap/sources';
import { searchPlanFor } from '@/lib/recap/leaguePlans';
import { bulkScan } from '@/lib/recap/bulk';
import { pget, pset } from '@/lib/recap/persist';
import { emptyTierStats, logSearch } from '@/lib/recap/searchLog';
import type { SearchWinner } from '@/lib/recap/searchLog';
import { loadFixture, MATCHER_VERSION } from '@/lib/recap/fixtures';
import type { GameInput, RankedCandidate, RawCandidate } from '@/lib/recap/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DAY = 86400000;
// Games older than this are "settled": highlights no longer appear, so
// results are cached long (persisted in Blob). Fresher games get a short
// TTL so late uploads (IPFL extended cuts land 2-4 days out) are picked up.
const SETTLED_MS = 5 * DAY;
const FRESH_TTL = 6 * 3600 * 1000;
const SETTLED_TTL = 30 * DAY;
// Negative cache: games with no highlights yet (listed 5h after kickoff,
// highlights take 1-3 days) must not re-run the pipeline on every view.
const NEGATIVE_TTL = 2 * 3600 * 1000;

/**
 * Replay a recorded fixture as the SSE stream, with small delays between
 * events so progressive UI behavior is exercised. Costs no YouTube quota.
 */
async function replayFixture(slug: string): Promise<Response> {
  const fixture = await loadFixture(slug);
  if (!fixture) {
    return new Response(JSON.stringify({ error: 'unknown fixture' }), { status: 404 });
  }
  const stale = fixture.matcherVersion !== MATCHER_VERSION;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (const ev of fixture.events) {
        const out =
          ev['type'] === 'done'
            ? { ...ev, fixture: { slug, recordedAt: fixture.recordedAt, stale } }
            : ev;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(out)}\n\n`));
        await new Promise((r) => setTimeout(r, 200));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

function parseGame(sp: URLSearchParams): GameInput | null {
  const home = sp.get('home') || '';
  const away = sp.get('away') || '';
  const dateISO = sp.get('date') || '';
  if (!home || !away || !dateISO) return null;
  const num = (v: string | null): number | null =>
    v == null || v === '' ? null : parseInt(v, 10);
  return {
    home,
    away,
    dateISO,
    league: sp.get('league') || 'premier-league',
    homeScore: num(sp.get('hs')),
    awayScore: num(sp.get('as')),
  };
}

/** Persisted per-game cache key: league + teams + date (teams meet twice a
 *  season). Versioned so matcher changes auto-invalidate. */
function gameCacheKey(game: GameInput): string {
  const seg = (s: string) => encodeURIComponent(s).replace(/[%().]/g, '_');
  return `game/v4/${game.league}/${seg(game.home)}-${seg(game.away)}-${seg(game.dateISO)}`;
}

interface CachedGame {
  results: RankedCandidate[];
  empty: boolean;
}

function ttlFor(game: GameInput, empty: boolean): number {
  if (Date.now() - Date.parse(game.dateISO) > SETTLED_MS) return SETTLED_TTL;
  if (empty) return NEGATIVE_TTL;
  return FRESH_TTL;
}

interface ComputeResult {
  results: RankedCandidate[];
  ytRateLimited: boolean;
  diag: Array<Record<string, unknown>>;
}

// Stampede protection: concurrent requests for the same game share one
// in-flight computation (per instance; Blob persistence covers the rest).
const inflight = new Map<string, Promise<ComputeResult>>();

/**
 * Three-tier recap search:
 *  1. Preferred channels (search.list, 100 units each), stop at the first
 *     proper highlight.
 *  2. Curated bulk pool: uploads playlists (1 unit / 50 videos, cached 6h
 *     in Blob), aggregated across all channels, matched app-side.
 *  3. General search.list fallback, only when tiers 1+2 find nothing.
 * Results (including empty ones) are persisted with a TTL that depends on
 * game age. A 429 stops everything and is never cached.
 */
async function computeRecap(game: GameInput, debug: boolean): Promise<ComputeResult> {
  const key = gameCacheKey(game);
  const logEntry = {
    t: Date.now(),
    home: game.home,
    away: game.away,
    league: game.league,
    date: game.dateISO,
    preferred: emptyTierStats(),
    bulk: emptyTierStats(),
    general: emptyTierStats(),
  };
  if (!debug) {
    const rec = await pget<CachedGame>(key);
    if (rec && Date.now() - rec.fetchedAt < ttlFor(game, rec.val.empty)) {
      // Cache hit: no tier ran. Still logged so fallback frequency is
      // measured against real searches, not cache serves. Awaited: on
      // Vercel a fire-and-forget write may never run after the response
      // is sent. logSearch never throws, so awaiting is safe.
      await logSearch({
        ...logEntry,
        cached: true,
        winner: 'cache' as SearchWinner,
        results: rec.val.results.length,
        rateLimited: false,
      });
      return { results: rec.val.results, ytRateLimited: false, diag: [] };
    }
  }

  const accepted: RawCandidate[] = [];
  const seen = new Set<string>();
  const diag: Array<Record<string, unknown>> = [];
  let ytRateLimited = false;
  // When preferred channels (IPFL / ONE on YouTube) have an actual
  // highlights video for the game, everything else is excluded as lower
  // quality. Punditry/news from those channels does not trigger this.
  const visible = (list: RawCandidate[]): RawCandidate[] => {
    const pref = list.filter(isPreferredChannel);
    return pref.some((c) => hasHighlightIntent(c.title)) ? pref : list;
  };
  const plan = searchPlanFor(game.league);
  // "Proper" = an accepted candidate with highlight intent. A preferred
  // channel returning only punditry does not count and does not stop the
  // search.
  const hasProperHighlight = () => accepted.some((c) => hasHighlightIntent(c.title));

  const ingest = (label: string, raw: RawCandidate[]): number => {
    let kept = 0;
    const rejected: Array<{ title: string; channel?: string; reason: string }> = [];
    for (const c of raw) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const f = filterCandidate(c, game);
      if (f.keep) {
        accepted.push(c);
        kept += 1;
      } else if (debug && rejected.length < 10) {
        rejected.push({ title: c.title, channel: c.channelName, reason: f.reason });
      }
    }
    if (debug) diag.push({ search: label, fetched: raw.length, kept, ...(rejected.length ? { rejected } : {}) });
    return kept;
  };

  const runSearch = async (label: string, job: YouTubeSearchJob, diagExtra?: Record<string, unknown>): Promise<number> => {
    try {
      const raw = await youtubeSearch(game, job);
      const kept = ingest(label, raw);
      if (debug) Object.assign(diag[diag.length - 1], diagExtra);
      return kept;
    } catch (e) {
      /* a failing search must not fail the whole run */
      const msg = (e as Error)?.message ?? String(e);
      if (msg === 'HTTP 429') ytRateLimited = true;
      if (debug) diag.push({ search: label, error: msg });
      return 0;
    }
  };

  // Tier 1: preferred channels in priority order, one search each
  // (YouTube allows a single channelId per search.list call). Stop at the
  // first channel with a proper highlight result. A 429 means the rate
  // limiter is engaged: further calls would fail too, so stop.
  let winner: SearchWinner = 'none';
  for (const src of plan.preferred) {
    if (ytRateLimited) break;
    const channelId = await channelIdForHandle(src.handle);
    if (!channelId) {
      if (debug) diag.push({ search: 'preferred:' + src.handle, skipped: 'unresolved handle' });
      continue;
    }
    const q = src.lang === 'he' ? hebrewQuery(game) : englishQuery(game);
    logEntry.preferred.ran += 1;
    logEntry.preferred.kept += await runSearch(
      'preferred:' + src.handle,
      { q, channelId, handle: src.handle, lang: src.lang },
      { channelId, q }
    );
    if (hasProperHighlight()) break;
  }
  if (hasProperHighlight()) winner = 'preferred';

  // Tier 2: curated bulk pool (uploads playlists, app-side matching).
  if (!ytRateLimited && winner === 'none' && plan.bulk.length > 0) {
    const bulk = await bulkScan(game);
    if (bulk.ytRateLimited) ytRateLimited = true;
    logEntry.bulk.ran += 1;
    logEntry.bulk.kept += ingest('bulk', bulk.candidates);
    if (debug) diag.push(...bulk.diag);
    if (hasProperHighlight()) winner = 'bulk';
  }

  // Tier 3: general-search fallback, only when tiers 1+2 found nothing.
  if (!ytRateLimited && winner === 'none') {
    for (const lang of plan.fallbackLangs) {
      const q = lang === 'he' ? hebrewQuery(game) : englishQuery(game);
      logEntry.general.ran += 1;
      logEntry.general.kept += await runSearch('general:' + lang, { q, lang });
      if (ytRateLimited || hasProperHighlight()) break;
    }
    if (hasProperHighlight()) winner = 'general';
  } else if (debug) {
    diag.push({ shortCircuited: true });
  }

  const finalRanked = rankCandidates(visible(accepted), game);
  // Log which tiers ran and which one won. Awaited together with the
  // game-cache write below so the Blob write completes before the response
  // is sent (a fire-and-forget write may never run on Vercel).
  // Debug runs are excluded: they bypass the cache and would skew stats.
  const logPromise = !debug
    ? logSearch({
        ...logEntry,
        winner,
        results: finalRanked.length,
        rateLimited: ytRateLimited,
      })
    : null;
  // Persist every outcome (including empty) with an age-appropriate TTL.
  // Never cache a rate-limited run: an empty result from HTTP 429 must not
  // poison the cache. Debug runs bypass the cache so they always reflect a
  // live search.
  const persistPromise =
    !debug && !ytRateLimited
      ? pset(key, {
          results: finalRanked,
          empty: finalRanked.length === 0,
        } satisfies CachedGame)
      : null;
  await Promise.all([logPromise, persistPromise]);
  return { results: finalRanked, ytRateLimited, diag };
}

export async function GET(req: NextRequest) {
  // Fixture mode: replay a recorded search with zero YouTube quota, for
  // validation. Event shapes are identical to a live search.
  const fixtureSlug = req.nextUrl.searchParams.get('fixture');
  if (fixtureSlug) return replayFixture(fixtureSlug);

  const game = parseGame(req.nextUrl.searchParams);
  if (!game) {
    return new Response(JSON.stringify({ error: 'missing params' }), { status: 400 });
  }

  const debug = req.nextUrl.searchParams.get('debug') === '1';
  const flightKey = gameCacheKey(game) + (debug ? ':debug' : '');
  let promise = inflight.get(flightKey);
  if (!promise) {
    promise = computeRecap(game, debug).finally(() => inflight.delete(flightKey));
    inflight.set(flightKey, promise);
  }
  const { results, ytRateLimited, diag } = await promise;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      send({ type: 'batch', results, pending: 0 });
      send({ type: 'done', results, ytRateLimited, ...(debug ? { diag } : {}) });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
