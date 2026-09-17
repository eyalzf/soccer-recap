import { NextRequest } from 'next/server';
import { filterCandidate, hasHighlightIntent, isPreferredChannel } from '@/lib/recap/match';
import { rankCandidates } from '@/lib/recap/rank';
import { englishQuery, hebrewQuery, youtubeSearch } from '@/lib/recap/sources';
import type { YouTubeSearchJob } from '@/lib/recap/sources';
import { searchPlanFor } from '@/lib/recap/leaguePlans';
import { bulkScan, channelsForGame, scanPriorityChannel } from '@/lib/recap/bulk';
import { pget, pset } from '@/lib/recap/persist';
import { emptyTierStats, logSearch } from '@/lib/recap/searchLog';
import type { SearchWinner, SourceAccess } from '@/lib/recap/searchLog';
import { loadFixture, MATCHER_VERSION } from '@/lib/recap/fixtures';
import type { GameInput, RankedCandidate, RawCandidate } from '@/lib/recap/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DAY = 86400000;
// Game-level cache policy (design doc, as clarified: the 120-day window is
// for DB pruning, not cache invalidation — old games are extremely
// unlikely to be reviewed, so a weekly cron deletes game blobs untouched
// for 120 days instead of the read path expiring them):
// - a cache younger than 1h is served directly;
// - games played less than 3 days ago are re-fetched (late uploads — IPFL
//   extended cuts land 2-4 days out — must be picked up);
// - older games always serve the cache;
// - consecutive runs can only ADD to existing results (append-only merge).
const SERVE_MS = 3600 * 1000;
const REFRESH_WINDOW = 3 * DAY;
// Negative cache: games with no highlights yet must not re-run the pipeline
// on every view. Refinement on top of the doc: without it, a highlight-less
// fresh game would re-run the full pipeline hourly for 3 days straight.
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
 *  season). Versioned so matcher/policy changes auto-invalidate. */
function gameCacheKey(game: GameInput): string {
  const seg = (s: string) => encodeURIComponent(s).replace(/[%().]/g, '_');
  return `game/v7/${game.league}/${seg(game.home)}-${seg(game.away)}-${seg(game.dateISO)}`;
}

interface CachedGame {
  results: RankedCandidate[];
  empty: boolean;
}

/**
 * Append-only merge: consecutive runs can only add to existing results.
 * New videos are unioned in (dedupe by videoId) and the union re-ranked so
 * a newly found extended highlight still outranks an older standard one.
 */
function mergeResults(
  prev: RankedCandidate[],
  next: RankedCandidate[],
  game: GameInput
): RankedCandidate[] {
  const seen = new Set(prev.map((c) => c.videoId ?? c.id));
  const added = next.filter((c) => !seen.has(c.videoId ?? c.id));
  if (!added.length) return prev;
  return rankCandidates([...prev, ...added], game);
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
 *  1. Preferred channels: uploads playlists (1 unit / 50 videos, cached 1h
 *     per channel ID in Blob), matched app-side. Stop at the first channel
 *     with a proper highlight.
 *  2. Curated bulk pool: same playlist mechanism. Team-scoped club
 *     channels are only scanned for their own club's games; league-wide
 *     channels (aggregators, broadcasters) always. Aggregated, matched
 *     app-side.
 *  3. General search.list fallback (100 units per language), only when
 *     tiers 1+2 find nothing.
 * Game results persist in Blob with no read-path TTL (120-day pruning is
 * handled by the weekly /api/recap/prune cron); consecutive runs only ADD
 * to existing results (append-only merge). A 429 stops everything and is
 * never cached.
 */
async function computeRecap(game: GameInput, debug: boolean): Promise<ComputeResult> {
  const key = gameCacheKey(game);
  const sources: SourceAccess[] = [];
  const logEntry = {
    t: Date.now(),
    home: game.home,
    away: game.away,
    league: game.league,
    date: game.dateISO,
    preferred: emptyTierStats(),
    bulk: emptyTierStats(),
    general: emptyTierStats(),
    sources,
  };
  const logCached = async (rec: { val: CachedGame }) => {
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
  };
  let prevResults: RankedCandidate[] = [];
  if (!debug) {
    const rec = await pget<CachedGame>(key);
    const now = Date.now();
    // No logical TTL on the read path: a cached game is served (or
    // refreshed+merged) regardless of age. Expiry is handled by pruning —
    // the weekly /api/recap/prune cron deletes game blobs untouched for
    // 120 days.
    if (rec) {
      const cacheAge = now - rec.fetchedAt;
      const gameAge = now - Date.parse(game.dateISO);
      // Design-doc retrieval logic: <=1h serve cached; game <3d old
      // re-fetch; otherwise always serve cached. Negative backoff keeps
      // highlight-less games from re-running the pipeline hourly.
      const serveCached =
        cacheAge <= SERVE_MS ||
        gameAge >= REFRESH_WINDOW ||
        (rec.val.empty && cacheAge <= NEGATIVE_TTL);
      if (serveCached) {
        await logCached(rec);
        return { results: rec.val.results, ytRateLimited: false, diag: [] };
      }
      prevResults = rec.val.results;
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
  // search. (Deliberately stricter than the doc's "non-empty filtered
  // list": stopping on a news clip would hide real highlights.)
  const hasProperHighlight = () => accepted.some((c) => hasHighlightIntent(c.title));

  // Per-channel kept counts, so bulk per-channel stats can report
  // fetched vs matched per raw data source (design-doc logging).
  const keptByChannel = new Map<string, number>();
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
        if (c.channelName)
          keptByChannel.set(c.channelName, (keptByChannel.get(c.channelName) ?? 0) + 1);
      } else if (debug && rejected.length < 10) {
        rejected.push({ title: c.title, channel: c.channelName, reason: f.reason });
      }
    }
    if (debug) diag.push({ search: label, fetched: raw.length, kept, ...(rejected.length ? { rejected } : {}) });
    return kept;
  };

  const runSearch = async (
    label: string,
    job: YouTubeSearchJob,
    diagExtra?: Record<string, unknown>
  ): Promise<{ kept: number; fetched: number }> => {
    try {
      const raw = await youtubeSearch(game, job);
      const kept = ingest(label, raw);
      if (debug) Object.assign(diag[diag.length - 1], diagExtra);
      return { kept, fetched: raw.length };
    } catch (e) {
      /* a failing search must not fail the whole run */
      const msg = (e as Error)?.message ?? String(e);
      if (msg === 'HTTP 429') ytRateLimited = true;
      if (debug) diag.push({ search: label, error: msg });
      return { kept: 0, fetched: 0 };
    }
  };

  // Tier 1: preferred channels in priority order, scanned via their
  // uploads playlists (cheap) and matched app-side. Stop at the first
  // channel with a proper highlight result. A 429 means the rate limiter
  // is engaged: further calls would fail too, so stop.
  let winner: SearchWinner = 'none';
  for (const src of channelsForGame(plan.preferred, game)) {
    if (ytRateLimited) break;
    const scan = await scanPriorityChannel(src, game);
    if (scan.error) {
      if (scan.error === 'HTTP 429') ytRateLimited = true;
      if (debug) diag.push({ search: 'preferred:' + src.handle, skipped: scan.error });
      sources.push({ label: src.handle, kind: 'preferred', cached: false, fetched: 0, kept: 0 });
      continue;
    }
    logEntry.preferred.ran += 1;
    const kept = ingest('preferred:' + src.handle, scan.candidates);
    logEntry.preferred.kept += kept;
    sources.push({
      label: src.handle,
      kind: 'preferred',
      cached: scan.cached,
      fetched: scan.fetched,
      kept,
    });
    if (debug)
      diag.push({
        search: 'preferred:' + src.handle,
        channelId: scan.channelId,
        fetched: scan.fetched,
        kept,
        cached: scan.cached,
      });
    if (hasProperHighlight()) break;
  }
  if (hasProperHighlight()) winner = 'preferred';

  // Tier 2: curated bulk pool (uploads playlists, app-side matching).
  if (!ytRateLimited && winner === 'none' && plan.bulk.length > 0) {
    const bulk = await bulkScan(game);
    if (bulk.ytRateLimited) ytRateLimited = true;
    logEntry.bulk.ran += 1;
    const keptBefore = new Map(keptByChannel);
    logEntry.bulk.kept += ingest('bulk', bulk.candidates);
    for (const ch of bulk.perChannel) {
      const kept =
        (keptByChannel.get(ch.label) ?? 0) - (keptBefore.get(ch.label) ?? 0);
      sources.push({
        label: ch.label,
        kind: 'bulk',
        cached: ch.cached,
        fetched: ch.fetched,
        kept,
      });
    }
    if (debug) diag.push(...bulk.diag);
    if (hasProperHighlight()) winner = 'bulk';
  }

  // Tier 3: general-search fallback, only when tiers 1+2 found nothing.
  if (!ytRateLimited && winner === 'none') {
    for (const lang of plan.fallbackLangs) {
      const q = lang === 'he' ? hebrewQuery(game) : englishQuery(game);
      logEntry.general.ran += 1;
      const { kept, fetched } = await runSearch('general:' + lang, { q, lang });
      logEntry.general.kept += kept;
      sources.push({ label: 'general:' + lang, kind: 'general', cached: false, fetched, kept });
      if (ytRateLimited || hasProperHighlight()) break;
    }
    if (hasProperHighlight()) winner = 'general';
  } else if (debug) {
    diag.push({ shortCircuited: true });
  }

  const finalRanked = rankCandidates(visible(accepted), game);
  // Append-only: merge into the previous cached results; consecutive runs
  // only add, never remove.
  const merged = mergeResults(prevResults, finalRanked, game);
  // Log which tiers ran and which one won. Awaited together with the
  // game-cache write below so the Blob write completes before the response
  // is sent (a fire-and-forget write may never run on Vercel).
  // Debug runs are excluded: they bypass the cache and would skew stats.
  const logPromise = !debug
    ? logSearch({
        ...logEntry,
        winner,
        results: merged.length,
        rateLimited: ytRateLimited,
      })
    : null;
  // Persist every outcome (including empty) with no read-path TTL.
  // Expiry is by pruning: /api/recap/prune (weekly Vercel cron) deletes
  // game blobs untouched for 120 days.
  // Never cache a rate-limited run: an empty result from HTTP 429 must not
  // poison the cache. Debug runs bypass the cache so they always reflect a
  // live search.
  const persistPromise =
    !debug && !ytRateLimited
      ? pset(key, {
          results: merged,
          empty: merged.length === 0,
        } satisfies CachedGame)
      : null;
  await Promise.all([logPromise, persistPromise]);
  return { results: merged, ytRateLimited, diag };
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
