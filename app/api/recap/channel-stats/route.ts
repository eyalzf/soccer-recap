import { NextRequest, NextResponse } from 'next/server';
import { getChannelStats } from '@/lib/recap/channelStats';
import {
  addToDenyList,
  getDenyList,
  removeFromDenyList,
} from '@/lib/recap/denyList';

export const dynamic = 'force-dynamic';

/**
 * GET /api/recap/channel-stats
 * Every channel that kept a result in the last 14 days (all tiers),
 * aggregated from the search log, plus the current deny list.
 */
async function payload() {
  const stats = await getChannelStats();
  const denied = await getDenyList();
  return {
    channels: stats.channels,
    denied,
    searchesSeen: stats.searchesSeen,
  };
}

export async function GET() {
  return NextResponse.json(await payload());
}

/**
 * POST /api/recap/channel-stats
 * Body: { action: 'deny'|'undeny', channel?, channelId?, handle?, reason? }
 * - deny: add the channel to the deny list (runtime effect, no deploy);
 *   takes effect on the next search/read via the serve-time filter.
 * - undeny: remove the matching deny entry (404 when nothing matches).
 * Both return the fresh GET payload.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    channel?: string;
    channelId?: string;
    handle?: string;
    reason?: string;
  };
  const { action, channel, channelId, handle } = body;
  if (action !== 'deny' && action !== 'undeny') {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }
  if (!channel && !channelId && !handle) {
    return NextResponse.json(
      { error: 'channel, channelId or handle required' },
      { status: 400 }
    );
  }

  if (action === 'deny') {
    await addToDenyList({
      channel: channel ?? channelId ?? (handle as string),
      channelId,
      handle,
      reason: body.reason ?? 'manual: all-channels view',
      deadCount: 0,
    });
  } else {
    const removed = await removeFromDenyList({ channelId, handle, channel });
    if (!removed) {
      return NextResponse.json(
        { error: 'no matching deny entry' },
        { status: 404 }
      );
    }
  }
  return NextResponse.json(await payload());
}
