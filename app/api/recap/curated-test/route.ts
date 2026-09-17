import { NextRequest, NextResponse } from 'next/server';
import { searchPlanFor } from '@/lib/recap/leaguePlans';
import { getChannelVideos } from '@/lib/recap/bulk';
import { channelIdForHandle, ytVideoMeta } from '@/lib/recap/sources';
import { filterCandidate, hasHighlightIntent } from '@/lib/recap/match';
import type { GameInput, RawCandidate } from '@/lib/recap/types';

export const dynamic = 'force-dynamic';

const DAY = 86400000;

const numOrNull = (v: string | null): number | null => {
  if (v == null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
};

interface ChannelReport {
  label: string;
  channelId?: string;
  skipped?: string;
  videos?: number;
  kept?: number;
  properHighlight?: boolean;
  rejectReasons?: Record<string, number>;
  rejectedExamples?: Array<{ title: string; reason: string }>;
  keptTitles?: string[];
}

/**
 * GET /api/recap/curated-test?league=&home=&away=&date=&hs=&as=
 *
 * Diagnostic: run ONLY the curated tiers (preferred + bulk) for one game,
 * scanning each channel's uploads playlist and applying the real matcher.
 * No general-search fallback, no search-log write, no game-cache read/write.
 *
 * NOTE: production's preferred tier uses search.list scoped to the channel
 * (100 quota units); this test scans the channel's uploads playlist instead
 * (1 unit/page, Blob-cached) so the test stays quota-cheap. The matcher and
 * fail reasons are identical; hit counts may differ slightly from live.
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
  const olderThanISO = new Date(Date.parse(game.dateISO) - 2 * DAY).toISOString();
  let ytRateLimited = false;
  const tiers: Array<{ tier: string; channels: ChannelReport[] }> = [];

  for (const tierName of ['preferred', 'bulk'] as const) {
    const channels: ChannelReport[] = [];
    for (const entry of plan[tierName]) {
      const label =
        tierName === 'preferred'
          ? `preferred:@${entry.handle}`
          : (entry as { label: string }).label;
      if (ytRateLimited) {
        channels.push({ label, skipped: 'rate-limited' });
        continue;
      }
      const handle = (entry as { handle?: string }).handle;
      const entryChannelId = (entry as { channelId?: string }).channelId;
      let channelId: string | null = null;
      try {
        channelId =
          entryChannelId ?? (handle ? await channelIdForHandle(handle) : null);
      } catch {
        channelId = null;
      }
      if (!channelId) {
        channels.push({ label, skipped: 'unresolved handle' });
        continue;
      }
      let videos;
      try {
        videos = await getChannelVideos(channelId, olderThanISO);
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e);
        if (msg === 'HTTP 429') ytRateLimited = true;
        channels.push({ label, channelId, skipped: msg });
        continue;
      }
      let metas: Awaited<ReturnType<typeof ytVideoMeta>>;
      try {
        metas = await ytVideoMeta(videos.map((v) => v.id));
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e);
        if (msg === 'HTTP 429') ytRateLimited = true;
        channels.push({ label, channelId, skipped: 'meta: ' + msg });
        continue;
      }
      const rejectReasons: Record<string, number> = {};
      const rejectedExamples: Array<{ title: string; reason: string }> = [];
      const keptTitles: string[] = [];
      let keptCount = 0;
      let properHighlight = false;
      for (const v of videos) {
        const m = metas.get(v.id);
        const c: RawCandidate = {
          id: `yt:${v.id}`,
          title: v.title,
          url: `https://www.youtube.com/watch?v=${v.id}`,
          source: 'youtube',
          videoId: v.id,
          publishedAt: v.publishedAt,
          thumbnail: v.thumbnail,
          durationSec: m?.duration,
          embeddable: m?.embeddable ?? undefined,
          audioLang: m?.audioLang ?? undefined,
          blockedInIL: m?.blockedInIL,
          channelName: label,
          channelHandle: handle,
          bulk: tierName === 'bulk',
          lang: /[֐-׿]/.test(v.title) ? 'he' : 'en',
        };
        const f = filterCandidate(c, game);
        if (f.keep) {
          keptCount += 1;
          if (keptTitles.length < 5) keptTitles.push(v.title);
          if (hasHighlightIntent(v.title)) properHighlight = true;
        } else {
          rejectReasons[f.reason] = (rejectReasons[f.reason] ?? 0) + 1;
          if (rejectedExamples.length < 8)
            rejectedExamples.push({ title: v.title.slice(0, 90), reason: f.reason });
        }
      }
      channels.push({
        label,
        channelId,
        videos: videos.length,
        kept: keptCount,
        properHighlight,
        rejectReasons,
        rejectedExamples,
        keptTitles,
      });
    }
    tiers.push({ tier: tierName, channels });
  }

  return NextResponse.json({ game, tiers, ytRateLimited });
}
