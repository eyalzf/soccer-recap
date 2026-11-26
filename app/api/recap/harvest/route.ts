import { NextRequest } from 'next/server';
import { refreshSport5Index, SPORT5_INDEX_KEY } from '@/lib/recap/sport5';
import { pget, storageConfigured } from '@/lib/recap/persist';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Scheduled Sport5 harvest (cron, see vercel.json).
 *
 * Clicks are the only thing that drives harvesting today: the index
 * only refreshes inside loadSport5Index, which runs when a recap
 * compute touches a Sport5-plan game. A video that rotates off the
 * homepage rail (~13-17h) before any compute happens is never
 * captured, even though it stays on the site — the preview incident
 * on 2026-11-26 (Lille/Inter/Atletico items 568931/32/33 missing
 * from the cold preview index) is the extreme form. The video
 * news-sitemap widened the capture window to ~2 days; this endpoint
 * closes the remaining gap by harvesting on a schedule instead of
 * on clicks.
 *
 * - GET with the cron Authorization header (`Bearer <CRON_SECRET>`,
 *   injected by Vercel cron or sent by the scheduled pinger) → runs
 *   a forced harvest of all three sources (rail + Ligue 1 page +
 *   video news-sitemap) and returns the summary.
 * - GET without it → public status (index size + last harvest time),
 *   for monitoring; it triggers nothing.
 * - 503 when storage is not configured; the harvest itself never
 *   throws (a fully failed harvest returns the stored index).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authed =
    !!secret && req.headers.get('authorization') === `Bearer ${secret}`;
  if (!authed) {
    let items = 0;
    let lastHarvest = 0;
    try {
      const rec = await pget<{ items: unknown[] }>(SPORT5_INDEX_KEY);
      if (rec && Array.isArray(rec.val?.items)) {
        items = rec.val.items.length;
        lastHarvest = rec.fetchedAt;
      }
    } catch {
      /* unreadable index = unknown size */
    }
    return Response.json({ ok: true, harvest: 'sport5', items, lastHarvest });
  }
  if (!storageConfigured()) {
    return Response.json(
      { ok: false, error: 'storage not configured' },
      { status: 503 }
    );
  }
  const r = await refreshSport5Index();
  return Response.json({
    ok: true,
    items: r.items.length,
    added: r.added,
    refreshed: r.refreshed,
    sources: r.sources,
  });
}
