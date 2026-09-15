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
 * Source groups (Hebrew YouTube, English YouTube, trusted Hebrew channels,
 * Sport1, Sport5, ONE) run in parallel; each completed batch is merged,
 * re-ranked and streamed to the client immediately.
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

      const cached = cacheGet<RankedCandidate[]>(cacheKey);
      if (cached) {
        send({ type: 'batch', results: cached, pending: 0 });
        send({ type: 'done', results: cached });
        controller.close();
        return;
      }

      const accepted: RawCandidate[] = [];
      const seen = new Set<string>();
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

      let pending = groups.length;
      const emit = () => {
        send({ type: 'batch', results: rankCandidates(visible(accepted), game), pending });
      };
      send({ type: 'start', pending });

      await Promise.all(
        groups.map(async (g) => {
          try {
            const raw = await g.run();
            for (const c of raw) {
              if (seen.has(c.id)) continue;
              seen.add(c.id);
              if (filterCandidate(c, game).keep) accepted.push(c);
            }
          } catch {
            /* a failing source group must not fail the whole search */
          }
          pending -= 1;
          emit();
        })
      );

      const finalRanked = rankCandidates(visible(accepted), game);
      cacheSet(cacheKey, finalRanked, 6 * 3600 * 1000);
      send({ type: 'done', results: finalRanked });
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
