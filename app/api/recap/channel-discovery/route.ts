import { NextRequest, NextResponse } from 'next/server';
import { searchPlanFor } from '@/lib/recap/leaguePlans';
import { englishQuery, hebrewQuery, youtubeSearch } from '@/lib/recap/sources';
import { filterCandidate, hasHighlightIntent } from '@/lib/recap/match';
import type { GameInput } from '@/lib/recap/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const numOrNull = (v: string | null): number | null => {
  if (v == null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
};

interface DiscoveredVideo {
  title: string;
  videoId?: string;
  channelTitle?: string;
  channelId?: string;
  publishedAt?: string;
  durationSec?: number;
  kept: boolean;
  properHighlight: boolean;
  reason?: string;
}

interface SearchReport {
  lang: string;
  q: string;
  fetched?: number;
  error?: string;
  results: DiscoveredVideo[];
}

/**
 * GET /api/recap/channel-discovery?league=&home=&away=&date=&hs=&as=
 *
 * Channel-finding diagnostic: run ONLY the general-search tier (every
 * fallback language in the league plan) for one seed game, applying the
 * real matcher to every result. Each result carries the uploader's
 * channelId so candidate channels can be extracted for the coverage pass.
 *
 * No preferred/bulk tiers, no search-log write, no game-cache read/write.
 * A 429 stops the remaining languages; nothing is retried.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const game: GameInput = {
    league: sp.get('league') ?? '',
    home: sp.get('home') ?? '',
    away: sp.get('away') ?? '',
    dateISO: sp.get('date') ?? '',
    homeScore: numOrNull(sp.get('hs')),
    awayScore: numOrNull(sp.get('as')),
  };
  if (!game.league || !game.home || !game.away || !game.dateISO) {
    return NextResponse.json(
      { error: 'league, home, away, date required (hs/as optional)' },
      { status: 400 }
    );
  }

  const plan = searchPlanFor(game.league);
  const searches: SearchReport[] = [];
  let ytRateLimited = false;

  for (const lang of plan.fallbackLangs) {
    if (ytRateLimited) break;
    const q = lang === 'he' ? hebrewQuery(game) : englishQuery(game);
    const report: SearchReport = { lang, q, results: [] };
    try {
      const raw = await youtubeSearch(game, { q, lang });
      report.fetched = raw.length;
      for (const c of raw) {
        const f = filterCandidate(c, game);
        report.results.push({
          title: c.title,
          videoId: c.videoId,
          channelTitle: c.channelName,
          channelId: c.channelId,
          publishedAt: c.publishedAt,
          durationSec: c.durationSec,
          kept: f.keep,
          properHighlight: f.keep && hasHighlightIntent(c.title),
          ...(f.keep ? {} : { reason: f.reason }),
        });
      }
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      if (msg === 'HTTP 429') ytRateLimited = true;
      report.error = msg;
    }
    searches.push(report);
  }

  return NextResponse.json({ game, searches, ytRateLimited });
}
