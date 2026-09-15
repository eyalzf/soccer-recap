import { NextRequest } from 'next/server';
import { cacheGet, cacheSet } from '@/lib/cache';
import { filterCandidate, hasHighlightIntent, isPreferredChannel } from '@/lib/recap/match';
import { rankCandidates } from '@/lib/recap/rank';
import { fetchWebSource, fetchYouTube } from '@/lib/recap/sources';
import type { GameInput, RankedCandidate, RawCandidate } from '@/lib/recap/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
 * Two phases: phase 1 runs the most-likely sources (trusted Hebrew channels
 * for the Israeli league, Hebrew+English YouTube otherwise, plus the free
 * web sources); phase 2 (the fallback) runs only if phase 1 produced no
 * proper highlight result. Each completed group is merged, re-ranked and
 * streamed to the client immediately.
 */
export async function GET(req: NextRequest) {
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
      const groups: Array<{ name: string; run: () => Promise<RawCandidate[]> }> = [
        { name: 'youtube-he', run: () => fetchYouTube(game, 'he') },
        { name: 'youtube-en', run: () => fetchYouTube(game, 'en') },
        { name: 'youtube-trusted', run: () => fetchYouTube(game, 'trusted') },
        { name: 'sport1', run: () => fetchWebSource(game, 'sport1') },
        { name: 'sport5', run: () => fetchWebSource(game, 'sport5') },
        { name: 'one', run: () => fetchWebSource(game, 'one') },
      ];
      const byName = new Map(groups.map((g) => [g.name, g]));

      // Two-phase search to save YouTube API calls (100 quota units each).
      // Phase 1 runs the most-likely sources; phase 2 (English fallback /
      // trusted channels for foreign leagues) runs only if phase 1 produced
      // no proper highlight result. Web sources cost no quota, so they ride
      // along in phase 1.
      // Note: YouTube search.list accepts a single channelId per call, so the
      // trusted group is inherently 2 calls (IPFL + ONE), not 1.
      const isIsraeli = game.league === 'israeli-league';
      const phase1Names = isIsraeli
        ? ['youtube-trusted', 'sport1', 'sport5', 'one']
        : ['youtube-he', 'youtube-en', 'sport1', 'sport5', 'one'];
      const phase2Names = isIsraeli
        ? ['youtube-he', 'youtube-en']
        : ['youtube-trusted'];

      let pending = 0;
      const emit = () => {
        send({ type: 'batch', results: rankCandidates(visible(accepted), game), pending });
      };
      const runGroup = async (g: { name: string; run: () => Promise<RawCandidate[]> }) => {
        try {
          const raw = await g.run();
          let kept = 0;
          for (const c of raw) {
            if (seen.has(c.id)) continue;
            seen.add(c.id);
            if (filterCandidate(c, game).keep) {
              accepted.push(c);
              kept += 1;
            }
          }
          if (debug) diag.push({ group: g.name, fetched: raw.length, kept });
        } catch (e) {
          /* a failing source group must not fail the whole search */
          const msg = (e as Error)?.message ?? String(e);
          if (msg === 'HTTP 429' && g.name.startsWith('youtube')) ytRateLimited = true;
          if (debug) diag.push({ group: g.name, error: msg });
        }
        pending -= 1;
        emit();
      };

      const phase1 = phase1Names.map((n) => byName.get(n)!);
      pending = phase1.length;
      send({ type: 'start', pending });
      await Promise.all(phase1.map(runGroup));

      // Short-circuit: a proper highlight result means no English fallback
      // (and no further YouTube calls) are needed.
      const hasProperHighlight = accepted.some((c) => hasHighlightIntent(c.title));
      if (!hasProperHighlight) {
        const phase2 = phase2Names.map((n) => byName.get(n)!);
        pending = phase2.length;
        send({ type: 'start', pending });
        await Promise.all(phase2.map(runGroup));
      } else if (debug) {
        diag.push({ shortCircuited: true, skipped: phase2Names });
      }

      const finalRanked = rankCandidates(visible(accepted), game);
      // Recaps for a finished game don't change; cache long to spare YouTube
      // API quota (a fresh search costs 2-4 search calls thanks to the
      // two-phase short-circuit). Debug runs bypass the cache so they always
      // reflect a live search. Never cache a rate-limited run: an empty
      // result from HTTP 429 must not poison the cache for 24h.
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
