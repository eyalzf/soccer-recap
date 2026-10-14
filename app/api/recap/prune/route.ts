import { NextRequest } from 'next/server';
import { pdel, plist, storageConfigured } from '@/lib/recap/persist';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Weekly DB pruning (Vercel cron, see vercel.json): delete game-result
 * records untouched for 120 days. Old games are extremely unlikely to be
 * reviewed, so this bounds storage instead of a read-path TTL — the
 * game cache itself never expires logically.
 *
 * Security: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when
 * the CRON_SECRET env var is set. The endpoint refuses to run without it
 * (503) and rejects a wrong token (401), so random hits can't wipe the
 * cache. Set CRON_SECRET in the Vercel dashboard (any random string);
 * Vercel injects it into cron requests automatically.
 */
const PRUNE_AFTER_MS = 120 * 86400000;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response(JSON.stringify({ error: 'CRON_SECRET not configured' }), {
      status: 503,
    });
  }
  if ((req.headers.get('authorization') ?? '') !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }
  if (!storageConfigured()) {
    return new Response(JSON.stringify({ error: 'storage not configured' }), {
      status: 503,
    });
  }

  const now = Date.now();
  let cursor: string | undefined;
  let scanned = 0;
  let deleted = 0;
  do {
    const page = await plist('game/', cursor, 1000);
    const stale = page.items.filter((b) => now - b.uploadedAt > PRUNE_AFTER_MS);
    scanned += page.items.length;
    if (stale.length) {
      await pdel(stale.map((b) => b.pathname));
      deleted += stale.length;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return Response.json({ ok: true, scanned, deleted });
}
