import { NextRequest } from 'next/server';
import { filterCandidate, hasHighlightIntent, isPreferredChannel } from '@/lib/recap/match';
import { rankCandidates } from '@/lib/recap/rank';
import { englishQuery, hebrewQuery, sport1Search, youtubeSearch } from '@/lib/recap/sources';
import type { YouTubeSearchJob } from '@/lib/recap/sources';
import { searchPlanFor } from '@/lib/recap/leaguePlans';
import type { BulkChannel } from '@/lib/recap/leaguePlans';
import { bulkScan, channelsForGame, scanPriorityChannel } from '@/lib/recap/bulk';
import { applyExternalExclusivity, runExternalSource } from '@/lib/recap/external';
import { pget, pset } from '@/lib/recap/persist';
import { emptyTierStats, logSearch } from '@/lib/recap/searchLog';
import type { KeptChannel, RejectedChannel, SearchWinner, SourceAccess } from '@/lib/recap/searchLog';
import { loadFixture, MATCHER_VERSION } from '@/lib/recap/fixtures';
import type { GameInput, RankedCandidate, RawCandidate } from '@/lib/recap/types';
import { getDenySet, isDeniedPlanEntry, dropDeniedCandidates } from '@/lib/recap/denyList';

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
 *  season). Versioned so matcher/policy changes auto-invalidate.
 *  v10 (2026-10-14): the external (Sport5) tier — UCL caches written by
 *  v9 may hold general-search results that the external-configured plan
 *  must never serve again, so the old namespace is orphaned.
 *  v11 (2026-10-18): the sub-minute ('too-short') filter — v10 caches
 *  may hold sub-60s clips the matcher now rejects, so they are orphaned
 *  rather than served until their natural refresh. */
function gameCacheKey(game: GameInput): string {
  const seg = (s: string) => encodeURIComponent(s).replace(/[%().]/g, '_');
  return `game/v11/${game.league}/${seg(game.home)}-${seg(game.away)}-${seg(game.dateISO)}`;
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
 * Recap search tiers (Sport1 web runs first where the plan opts in):
 *  1. Preferred channels: uploads playlists (1 unit / 50 videos, cached 1h
 *     per channel ID in Blob), matched app-side. Stop at the first channel
 *     with a proper highlight.
 *  2. Curated bulk pool: same playlist mechanism. Team-scoped club
 *     channels are only scanned for their own club's games; league-wide
 *     channels (aggregators, broadcasters) always. Aggregated, matched
 *     app-side.
 *  2.5. External link-out sources (plan-configured; Sport5 for the UCL):
 *     harvested + matched app-side, rendered as "open at source" links.
 *     Position is plan-driven (`externalPosition`): by default the tier
 *     runs here, after bulk, only when tiers 1+2 kept no proper
 *     highlight; an 'above-bulk' plan runs it before tier 2 instead,
 *     and a hit there is exclusive (bulk never runs, and non-external
 *     results are suppressed — see applyExternalExclusivity). When a
 *     plan configures external sources, tier 3 never runs for that
 *     league.
 *  3. General search.list fallback (100 units per language), only when
 *     tiers 1+2 find nothing and no external source is configured.
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
    sport1: emptyTierStats(),
    preferred: emptyTierStats(),
    bulk: emptyTierStats(),
    external: emptyTierStats(),
    general: emptyTierStats(),
    sources,
    channels: [] as KeptChannel[],
  };
  const logCached = async (count: number) => {
    // Cache hit: no tier ran. Still logged so fallback frequency is
    // measured against real searches, not cache serves. Awaited: on
    // Vercel a fire-and-forget write may never run after the response
    // is sent. logSearch never throws, so awaiting is safe.
    await logSearch({
      ...logEntry,
      cached: true,
      winner: 'cache' as SearchWinner,
      results: count,
      rateLimited: false,
    });
  };
  // Deny-listed channels are suppressed everywhere: filterCandidate
  // rejects their videos in fresh searches, plan entries are skipped
  // before scanning, and cached results are deny-filtered on read so a
  // denial takes effect immediately instead of at the next weekly sweep.
  const denySet = await getDenySet();
  const plan = searchPlanFor(game.league);
  // Preferred-channel exclusivity: when a preferred channel (IPFL / ONE)
  // has results for a game, everything else is excluded as lower quality.
  // By default this triggers only on a proper highlight (punditry/news
  // from those channels does not count); a league may declare
  // `preferredStopRule: 'any'` in its plan, making ANY kept preferred
  // result exclusive (LaLiga / ONE). Applied to fresh results and to
  // cached results on read, so plan changes take effect immediately
  // instead of waiting for caches to age out.
  // External exclusivity composes on top of it: for a plan that places
  // the external tier above bulk, an external result in the list is the
  // game's whole result set (applyExternalExclusivity no-ops for every
  // other plan).
  const visible = <T extends RawCandidate>(list: T[]): T[] => {
    let out = list;
    const pref = list.filter(isPreferredChannel);
    if (pref.length) {
      if (pref.some((c) => hasHighlightIntent(c.title))) out = pref;
      else if (plan.preferredStopRule === 'any') out = pref;
    }
    return applyExternalExclusivity(plan, out);
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
      // Cached results get the same read-path treatment as fresh ones:
      // deny-listed channels dropped, and preferred-channel exclusivity
      // applied — both take effect immediately on read.
      const cachedResults = visible(dropDeniedCandidates(rec.val.results, denySet));
      // Design-doc retrieval logic: <=1h serve cached; game <3d old
      // re-fetch; otherwise always serve cached. Negative backoff keeps
      // highlight-less games from re-running the pipeline hourly.
      const serveCached =
        cacheAge <= SERVE_MS ||
        gameAge >= REFRESH_WINDOW ||
        (rec.val.empty && cacheAge <= NEGATIVE_TTL);
      // If denying emptied a non-empty cache, don't serve the empty list:
      // fall through to a fresh search so allowed channels can refill it.
      if (serveCached && (cachedResults.length > 0 || rec.val.results.length === 0)) {
        await logCached(cachedResults.length);
        return { results: cachedResults, ytRateLimited: false, diag: [] };
      }
      prevResults = cachedResults;
    }
  }

  const accepted: RawCandidate[] = [];
  const seen = new Set<string>();
  const diag: Array<Record<string, unknown>> = [];
  let ytRateLimited = false;
  // Deny-listed plan entries are skipped before any quota is spent
  // scanning them (the denySet itself is loaded before the cache read,
  // above).
  // "Proper" = an accepted candidate with highlight intent. A preferred
  // channel returning only punditry does not count and does not stop the
  // search. (Deliberately stricter than the doc's "non-empty filtered
  // list": stopping on a news clip would hide real highlights.)
  const hasProperHighlight = () => accepted.some((c) => hasHighlightIntent(c.title));

  // Per-channel kept counts, so bulk per-channel stats can report
  // fetched vs matched per raw data source (design-doc logging).
  const keptByChannel = new Map<string, number>();
  // Cap the per-entry kept-channel record: enough for curation review,
  // small enough to keep daily log blobs lean.
  const MAX_KEPT_CHANNEL_LOG = 15;
  // Per-channel REJECTION tallies for the search log (noise-channel
  // proposals): which channels keep getting filtered on title/content.
  // Keyed like the kept-channel aggregation (channelId, else normalized
  // title). Log-only — never affects what is accepted or returned.
  const rejectedNorm = (s: string): string =>
    s.toLowerCase().replace(/[^a-z0-9\u0590-\u05ff]/g, '');
  const rejectedByChannel = new Map<string, RejectedChannel>();
  const MAX_REJECTED_CHANNEL_LOG = 12;
  const rejectedLog = (): RejectedChannel[] =>
    [...rejectedByChannel.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, MAX_REJECTED_CHANNEL_LOG);
  const ingest = (
    label: string,
    raw: RawCandidate[],
    tier: 'sport1' | 'preferred' | 'bulk' | 'external' | 'general'
  ): number => {
    let kept = 0;
    const rejected: Array<{ title: string; channel?: string; reason: string }> = [];
    for (const c of raw) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const f = filterCandidate(c, game, denySet);
      if (f.keep) {
        accepted.push(c);
        kept += 1;
        if (c.channelName)
          keptByChannel.set(c.channelName, (keptByChannel.get(c.channelName) ?? 0) + 1);
        // Record the winning channel for bulk-candidate review.
        if (logEntry.channels.length < MAX_KEPT_CHANNEL_LOG) {
          logEntry.channels.push({
            v: c.videoId ?? c.id,
            ch: c.channelName ?? label,
            chId: c.channelId,
            tier,
            t: c.title.slice(0, 120),
          });
        }
      } else {
        if (debug && rejected.length < 10) {
          rejected.push({ title: c.title, channel: c.channelName, reason: f.reason });
        }
        // Tally the rejection for the search log. 'deny-listed' is
        // skipped: the channel is already blocked, so the count would
        // only add noise to the noise-proposal data.
        if (c.channelName && f.reason !== 'deny-listed') {
          const rkey = c.channelId ?? `t:${rejectedNorm(c.channelName)}`;
          let rj = rejectedByChannel.get(rkey);
          if (!rj) {
            rj = {
              ch: c.channelName,
              chId: c.channelId,
              n: 0,
              reasons: {},
              samples: [],
            };
            rejectedByChannel.set(rkey, rj);
          }
          rj.n += 1;
          rj.reasons[f.reason] = (rj.reasons[f.reason] ?? 0) + 1;
          if (rj.samples.length < 2) rj.samples.push(c.title.slice(0, 120));
        }
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
      const kept = ingest(label, raw, 'general');
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

  let winner: SearchWinner = 'none';

  // Tier 0: Sport1 web (per-league opt-in; Nations League). Sport1 is the
  // priority source: any result it yields for the game ends the search —
  // no YouTube tier runs and no quota is spent (user decision 2026-10-02:
  // "when results are identified it should not continue to other sources").
  if (plan.sport1) {
    try {
      const raw = await sport1Search(game);
      logEntry.sport1.ran += 1;
      const kept = ingest('sport1', raw, 'sport1');
      logEntry.sport1.kept += kept;
      sources.push({ label: 'sport1', kind: 'sport1', cached: false, fetched: raw.length, kept });
    } catch (e) {
      if (debug) diag.push({ search: 'sport1', error: (e as Error)?.message ?? String(e) });
    }
    if (logEntry.sport1.kept > 0) winner = 'sport1';
  }

  // Tier 1: preferred channels in priority order, scanned via their
  // uploads playlists (cheap) and matched app-side. Stop at the first
  // channel with a proper highlight result. A 429 means the rate limiter
  // is engaged: further calls would fail too, so stop.
  for (const src of channelsForGame(plan.preferred, game).filter(
    (s) => !isDeniedPlanEntry(s, denySet)
  )) {
    if (winner !== 'none' || ytRateLimited) break;
    const scan = await scanPriorityChannel(src, game);
    const srcLabel = src.handle ?? src.channelId ?? 'preferred';
    if (scan.error) {
      if (scan.error === 'HTTP 429') ytRateLimited = true;
      if (debug) diag.push({ search: 'preferred:' + srcLabel, skipped: scan.error });
      sources.push({ label: srcLabel, kind: 'preferred', cached: false, fetched: 0, kept: 0 });
      continue;
    }
    logEntry.preferred.ran += 1;
    const kept = ingest('preferred:' + srcLabel, scan.candidates, 'preferred');
    logEntry.preferred.kept += kept;
    sources.push({
      label: srcLabel,
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
    // Plan-declared stop rule: 'highlight' (default) stops only on a
    // proper highlight; 'any' stops on this channel's first kept result.
    if (plan.preferredStopRule === 'any' ? kept > 0 : hasProperHighlight()) break;
  }
  if (
    winner === 'none' &&
    (plan.preferredStopRule === 'any'
      ? logEntry.preferred.kept > 0
      : hasProperHighlight())
  )
    winner = 'preferred';

  // External link-out tier (plan-configured; Sport5 for the UCL).
  // Position is plan-driven: 'below-bulk' (default) it runs after the
  // bulk tier, only when the curated tiers kept no proper highlight;
  // 'above-bulk' it runs here, before bulk, and a hit is exclusive
  // (bulk never runs). It costs no YouTube quota, so a YouTube 429 does
  // not stop it. A league with external sources configured NEVER falls
  // through to general search — this tier is terminal in both
  // positions, even when it finds nothing (user decision 2026-10-14).
  const externalCfgs = plan.external ?? [];
  const externalAboveBulk =
    plan.externalPosition === 'above-bulk' && externalCfgs.length > 0;
  const runExternalTier = async (): Promise<void> => {
    for (const cfg of externalCfgs) {
      try {
        const r = await runExternalSource(cfg, game);
        logEntry.external.ran += 1;
        const kept = ingest('external:' + cfg.provider, r.candidates, 'external');
        logEntry.external.kept += kept;
        sources.push({
          label: cfg.provider,
          kind: 'external',
          cached: false,
          fetched: r.considered.length,
          kept,
        });
        if (debug)
          diag.push({
            search: 'external:' + cfg.provider,
            fetched: r.considered.length,
            kept,
            ambiguous: r.ambiguous,
            considered: r.considered
              .filter((c) => c.keep || c.reason !== 'category')
              .slice(0, 40),
          });
        if (kept > 0) winner = 'external';
      } catch (e) {
        if (debug)
          diag.push({
            search: 'external:' + cfg.provider,
            error: (e as Error)?.message ?? String(e),
          });
      }
    }
  };
  if (externalAboveBulk && winner === 'none') await runExternalTier();

  // Tier 2: curated bulk pool (uploads playlists, app-side matching).
  // Team-scoped channels (club / FA channels) are scanned FIRST: when
  // they yield a proper highlight, league-wide channels are not scanned
  // at all. When they yield only non-highlight results, those are kept
  // and the league-wide channels run too. This is the general rule for
  // every league, driven purely by the plan's `teams` tags (user
  // decision 2026-10-02: team channels first; league channels only when
  // there is no suitable team-channel result).
  if (!ytRateLimited && winner === 'none' && plan.bulk.length > 0) {
    const runBulkPhase = async (entries: BulkChannel[]) => {
      const bulk = await bulkScan(game, entries);
      if (bulk.ytRateLimited) ytRateLimited = true;
      logEntry.bulk.ran += 1;
      const keptBefore = new Map(keptByChannel);
      logEntry.bulk.kept += ingest('bulk', bulk.candidates, 'bulk');
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
    };
    const applicable = channelsForGame(plan.bulk, game);
    const teamEntries = applicable.filter((e) => e.teams?.length);
    const leagueEntries = applicable.filter((e) => !e.teams?.length);
    if (teamEntries.length > 0) await runBulkPhase(teamEntries);
    if (!ytRateLimited && !hasProperHighlight() && leagueEntries.length > 0) {
      await runBulkPhase(leagueEntries);
    }
    if (hasProperHighlight()) winner = 'bulk';
  }

  // Tier 2.5: external link-out sources in the default (below-bulk)
  // position — runs only when the curated tiers kept no proper
  // highlight. Above-bulk plans already ran the tier before tier 2.
  if (!externalAboveBulk && winner === 'none' && externalCfgs.length > 0) {
    await runExternalTier();
  }

  // Tier 3: general-search fallback, only when tiers 1+2 found nothing
  // and the league configures no external source.
  if (!ytRateLimited && winner === 'none' && externalCfgs.length === 0) {
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
  // only add, never remove. Exclusivity is applied to the merged set too,
  // so a preferred result arriving in a later refresh displaces older
  // non-preferred results instead of accumulating alongside them.
  const merged = visible(mergeResults(prevResults, finalRanked, game));
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
        // Rejection tallies ride along on fresh searches only; cache-hit
        // entries (logged via logCached above) never ran a tier, so they
        // correctly carry no `rejected` field.
        ...(rejectedByChannel.size ? { rejected: rejectedLog() } : {}),
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
