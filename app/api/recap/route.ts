import { NextRequest } from 'next/server';
import { cacheGet, cacheSet } from '@/lib/cache';
import { filterCandidate, hasHighlightIntent, isPreferredChannel } from '@/lib/recap/match';
import { rankCandidates } from '@/lib/recap/rank';
import { channelIdForHandle, englishQuery, hebrewQuery, youtubeSearch } from '@/lib/recap/sources';
import type { YouTubeSearchJob } from '@/lib/recap/sources';
import { searchPlanFor } from '@/lib/recap/leaguePlans';
import { loadFixture, MATCHER_VERSION } from '@/lib/recap/fixtures';
import type { GameInput, RankedCandidate, RawCandidate } from '@/lib/recap/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

/**
 * Progressive recap search over Server-Sent Events.
 * Per-league plan (see lib/recap/leaguePlans.ts): preferred channels are
 * tried in priority order, one search each, stopping at the first with a
 * proper highlight result; only then does the general-search fallback run.
 * Each completed search is merged, re-ranked and streamed immediately.
 */
export async function GET(req: NextRequest) {
  // Fixture mode: replay a recorded search with zero YouTube quota, for
  // validation. Event shapes are identical to a live search.
  const fixtureSlug = req.nextUrl.searchParams.get('fixture');
  if (fixtureSlug) return replayFixture(fixtureSlug);

  const game = parseGame(req.nextUrl.searchParams);
  if (!game) {
    return new Response(JSON.stringify({ error: 'missing params' }), { status: 400 });
  }

  const cacheKey =
    `recap:${game.league}:${game.home}:${game.away}:${game.dateISO}:` +
    `${game.homeScore}-${game.awayScore}`;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      const debug = req.nextUrl.searchParams.get('debug') === '1';
      const cached = debug ? undefined : cacheGet<RankedCandidate[]>(cacheKey);
      if (cached) {
        send({ type: 'batch', results: cached, pending: 0 });
        send({ type: 'done', results: cached, ytRateLimited: false });
        controller.close();
        return;
      }

      const accepted: RawCandidate[] = [];
      const seen = new Set<string>();
      // Per-group diagnostics (counts + error messages, no secrets) so a
      // failing source can be identified without server log access.
      const diag: Array<Record<string, unknown>> = [];
      // True when YouTube rate-limited us: the UI should say "try again
      // later" instead of showing an empty "no recaps" state.
      let ytRateLimited = false;
      // When preferred channels (IPFL / ONE on YouTube) have an actual
      // highlights video for the game, everything else is excluded as lower
      // quality. Punditry/news from those channels does not trigger this.
      const visible = (list: RawCandidate[]): RawCandidate[] => {
        const pref = list.filter(isPreferredChannel);
        return pref.some((c) => hasHighlightIntent(c.title)) ? pref : list;
      };
      // Per-league search plan: preferred channels in priority order, then
      // general-search fallback languages. Non-YouTube sources are omitted.
      const plan = searchPlanFor(game.league);

      send({ type: 'start', pending: 1 });
      const emit = (pending: number) => {
        send({ type: 'batch', results: rankCandidates(visible(accepted), game), pending });
      };
      // "Proper" = an accepted candidate with highlight intent. A preferred
      // channel returning only punditry does not count and does not stop
      // the search.
      const hasProperHighlight = () =>
        accepted.some((c) => hasHighlightIntent(c.title));

      const runSearch = async (
        label: string,
        job: YouTubeSearchJob,
        diagExtra?: Record<string, unknown>
      ) => {
        try {
          const raw = await youtubeSearch(game, job);
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
          if (debug)
            diag.push({
              search: label,
              fetched: raw.length,
              kept,
              ...diagExtra,
              ...(rejected.length ? { rejected } : {}),
            });
        } catch (e) {
          /* a failing search must not fail the whole run */
          const msg = (e as Error)?.message ?? String(e);
          if (msg === 'HTTP 429') ytRateLimited = true;
          if (debug) diag.push({ search: label, error: msg });
        }
        emit(1);
      };

      // Phase 1: preferred channels in priority order, one search each
      // (YouTube allows a single channelId per search.list call). Stop at
      // the first channel with a proper highlight result. A 429 means the
      // rate limiter is engaged: further calls would fail too, so stop.
      for (const src of plan.preferred) {
        if (ytRateLimited) break;
        const channelId = await channelIdForHandle(src.handle);
        if (!channelId) {
          if (debug) diag.push({ search: 'preferred:' + src.handle, skipped: 'unresolved handle' });
          continue;
        }
        const q = src.lang === 'he' ? hebrewQuery(game) : englishQuery(game);
        await runSearch(
          'preferred:' + src.handle,
          {
            q,
            channelId,
            handle: src.handle,
            lang: src.lang,
          },
          { channelId, q }
        );
        if (hasProperHighlight()) break;
      }

      // Phase 2: general-search fallback, only when no preferred channel hit.
      if (!ytRateLimited && !hasProperHighlight()) {
        for (const lang of plan.fallbackLangs) {
          const q = lang === 'he' ? hebrewQuery(game) : englishQuery(game);
          await runSearch('general:' + lang, { q, lang });
          if (ytRateLimited || hasProperHighlight()) break;
        }
      } else if (debug) {
        diag.push({ shortCircuited: true });
      }
      emit(0);

      const finalRanked = rankCandidates(visible(accepted), game);
      // Recaps for a finished game don't change; cache long to spare YouTube
      // API quota (a fresh search costs 1-3 search calls thanks to the
      // per-league priority short-circuit). Debug runs bypass the cache so
      // they always reflect a live search. Never cache a rate-limited run:
      // an empty result from HTTP 429 must not poison the cache for 24h.
      if (!debug && !ytRateLimited) cacheSet(cacheKey, finalRanked, 24 * 3600 * 1000);
      send({ type: 'done', results: finalRanked, ytRateLimited, ...(debug ? { diag } : {}) });
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
