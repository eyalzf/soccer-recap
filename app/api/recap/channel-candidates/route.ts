import { NextRequest, NextResponse } from 'next/server';
import {
  getChannelCandidates,
  writeOps,
  type ChannelDecision,
} from '@/lib/recap/channelCandidates';

export const dynamic = 'force-dynamic';

/**
 * GET /api/recap/channel-candidates
 * Bulk-channel suggestions aggregated from the search log: channels that
 * won 3+ general-tier results and are not already curated.
 */
export async function GET() {
  const res = await getChannelCandidates();
  return NextResponse.json(res);
}

/**
 * POST /api/recap/channel-candidates
 * Body: { action: 'discard'|'add'|'cancel-pending', key: string, teams?: string[] }
 * - discard: zero the channel's count; it re-surfaces after 3 new hits.
 * - add: approve the channel for the suggested scope; recorded as pending
 *   until deployed into the league plan (preview -> approve -> production).
 * - cancel-pending: withdraw a pending approval.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    key?: string;
    teams?: string[];
  };
  const { action, key } = body;
  if (!action || !key) {
    return NextResponse.json({ error: 'action and key required' }, { status: 400 });
  }
  const res = await getChannelCandidates();
  const cand = res.candidates.find((c) => c.key === key);
  const ops = res.ops;
  const now = Date.now();
  const dropKey = (list: ChannelDecision[]) => list.filter((d) => d.key !== key);

  if (action === 'discard') {
    if (!cand) return NextResponse.json({ error: 'candidate not found' }, { status: 404 });
    ops.discarded = dropKey(ops.discarded);
    ops.discarded.push({
      key: cand.key,
      channel: cand.channel,
      channelId: cand.channelId,
      league: cand.league,
      t: now,
      countAtDiscard: cand.hits,
    });
    ops.pending = dropKey(ops.pending);
  } else if (action === 'add') {
    if (!cand) return NextResponse.json({ error: 'candidate not found' }, { status: 404 });
    const teams = body.teams?.length ? body.teams : cand.scope.teams;
    ops.pending = dropKey(ops.pending);
    ops.pending.push({
      key: cand.key,
      channel: cand.channel,
      channelId: cand.channelId,
      league: cand.league,
      teams,
      t: now,
    });
    ops.discarded = dropKey(ops.discarded);
  } else if (action === 'cancel-pending') {
    ops.pending = dropKey(ops.pending);
  } else {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }

  await writeOps(ops);
  return NextResponse.json(await getChannelCandidates());
}
