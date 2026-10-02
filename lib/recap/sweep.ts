/**
 * Weekly playability sweep: find videos in the game-result caches that can
 * no longer be played (deleted/private, embedding disabled, region-blocked
 * in Israel), remove them, and propose "known offender" channels for the
 * deny list.
 *
 * This module holds the pure decision logic (criteria, proposal merging);
 * the I/O lives in app/api/recap/sweep/route.ts. Kept side-effect free so
 * scripts/deny_list_test.ts can exercise it with zero quota.
 */

export type DeadReason = 'deleted' | 'not-embeddable' | 'region-blocked';

/** Per-video liveness verdict from a fresh videos.list lookup. */
export interface VideoCheck {
  videoId: string;
  dead: boolean;
  reason?: DeadReason;
  title: string;
  channel: string;
  channelId?: string;
  handle?: string;
  game: string;
}

/** Deny-list proposal criteria (user-approved 2026-09-30). */
export const DENY_VOLUME_THRESHOLD = 3; // 3+ dead videos in the window
export const DENY_RATE_THRESHOLD = 0.5; // …or >=50% dead…
export const DENY_RATE_MIN_DEAD = 2; // …with at least 2 dead
/** A discarded proposal re-surfaces after this many NEW dead videos. */
export const DENY_DISCARD_RESURFACE = 2;

export interface ChannelDeathStats {
  channel: string;
  channelId?: string;
  handle?: string;
  dead: number;
  total: number;
  sampleTitles: string[];
  games: string[];
  /** League slugs whose preferred/bulk plans include this channel. */
  inPlans: string[];
}

export type ProposalStatus = 'pending' | 'denied' | 'discarded';

export interface SweepProposal extends ChannelDeathStats {
  criterion: 'volume' | 'rate';
  status: ProposalStatus;
  deadAtProposal: number;
  deadAtDiscard?: number;
  deniedAt?: number;
}

export interface SweepReport {
  lastRun: number;
  ok: boolean;
  error?: string;
  partial?: boolean;
  gamesScanned: number;
  videosChecked: number;
  deadRemoved: number;
  /** Videos purged because their channel is deny-listed. */
  deniedRemoved: number;
  /** Videos purged because their title matches the EXCLUDED policy. */
  vetoedRemoved: number;
  removed: Array<{
    videoId: string;
    title: string;
    channel: string;
    channelId?: string;
    game: string;
    /** 'deny-listed' | 'veto:<keyword>'; undefined for dead videos. */
    reason?: string;
  }>;
  proposals: SweepProposal[];
}

export const emptyReport = (): SweepReport => ({
  lastRun: 0,
  ok: true,
  gamesScanned: 0,
  videosChecked: 0,
  deadRemoved: 0,
  deniedRemoved: 0,
  vetoedRemoved: 0,
  removed: [],
  proposals: [],
});

/** Does this channel's death stats meet the deny-list criteria? */
export function denyCriterion(
  s: Pick<ChannelDeathStats, 'dead' | 'total'>
): 'volume' | 'rate' | null {
  if (s.dead >= DENY_VOLUME_THRESHOLD) return 'volume';
  if (
    s.dead >= DENY_RATE_MIN_DEAD &&
    s.total > 0 &&
    s.dead / s.total >= DENY_RATE_THRESHOLD
  )
    return 'rate';
  return null;
}

/**
 * Merge freshly computed death stats into the previous report's proposals.
 * - New qualifiers become pending proposals.
 * - Pending proposals refresh their counts.
 * - Denied proposals stay denied (the deny list is the source of truth).
 * - Discarded proposals re-surface only after DENY_DISCARD_RESURFACE new
 *   dead videos beyond the discard baseline ("discard zeroes the counts").
 */
export function mergeProposals(
  prev: SweepProposal[],
  stats: ChannelDeathStats[]
): SweepProposal[] {
  const byKey = new Map(prev.map((p) => [proposalKey(p), p]));
  const out: SweepProposal[] = [];
  for (const s of stats) {
    const key = proposalKey(s);
    const criterion = denyCriterion(s);
    const existing = byKey.get(key);
    if (!criterion) {
      // No longer qualifies: keep denied/discarded history, drop stale pending.
      if (existing && existing.status !== 'pending') out.push(existing);
      continue;
    }
    if (!existing) {
      out.push({
        ...s,
        criterion,
        status: 'pending',
        deadAtProposal: s.dead,
      });
      continue;
    }
    if (existing.status === 'denied') {
      out.push(existing);
      continue;
    }
    if (existing.status === 'discarded') {
      const baseline = existing.deadAtDiscard ?? existing.deadAtProposal;
      if (s.dead >= baseline + DENY_DISCARD_RESURFACE) {
        out.push({
          ...existing,
          ...s,
          criterion,
          status: 'pending',
          deadAtProposal: s.dead,
          deadAtDiscard: undefined,
        });
      } else {
        out.push(existing);
      }
      continue;
    }
    // Pending: refresh counts.
    out.push({ ...existing, ...s, criterion });
  }
  // Keep denied/discarded proposals that had no fresh stats (channel quiet).
  for (const p of prev) {
    if (!stats.some((s) => proposalKey(s) === proposalKey(p))) out.push(p);
  }
  // De-dupe by key, preserving first occurrence order.
  const seen = new Set<string>();
  return out.filter((p) => {
    const k = proposalKey(p);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function proposalKey(p: {
  channelId?: string;
  handle?: string;
  channel: string;
}): string {
  return p.channelId ?? (p.handle ? `h:${p.handle}` : `t:${p.channel}`);
}
