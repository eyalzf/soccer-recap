/**
 * All-channels statistics, derived from the search log.
 *
 * The candidates module (channelCandidates.ts) only surfaces general-tier
 * winners as bulk-pool suggestions. This module aggregates EVERY channel
 * that kept at least one result in the window, across all tiers, so the
 * channel-management page can show the full picture — including channels
 * whose videos look valid but are irrelevant for this app — and block
 * them via the deny list (lib/recap/denyList.ts, runtime effect, no
 * deploy). Read-only aggregation; the deny list is the source of truth
 * for what is blocked.
 */
import {
  readSearchLog,
  type KeptChannel,
  type RejectedChannel,
  type SearchLogDay,
} from './searchLog';
import { searchPlanFor } from './leaguePlans';
import { LEAGUES, NATIONAL_COMPETITIONS } from '../leagues';
import { getDenySet, isDeniedChannel, type DenySet } from './denyList';

const LOG_DAYS = 14;

export interface ChannelTierCounts {
  sport1: number;
  preferred: number;
  bulk: number;
  general: number;
}

export interface ChannelStat {
  /** channelId when known, else `t:`+normalized title — stable across calls. */
  key: string;
  /** channel title as reported by YouTube */
  channel: string;
  channelId?: string;
  /** kept results across all tiers in the window */
  kept: number;
  /** distinct games those results came from */
  games: number;
  /** kept results per tier */
  tiers: ChannelTierCounts;
  /** league slugs the channel kept results in */
  leagues: string[];
  /** up to 3 sample result titles */
  sampleTitles: string[];
  /** time of the most recent search that kept a result from this channel */
  lastSeen: number;
  /** currently on the deny list */
  denied: boolean;
  /** league slugs whose curated plan (preferred or bulk) includes this channel */
  inPlans: string[];
}

export interface ChannelStatsResult {
  channels: ChannelStat[];
  /** non-cache searches seen in the window (context for the counts) */
  searchesSeen: number;
}

const norm = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9\u0590-\u05ff]/g, '');

const channelKeyPart = (c: KeptChannel): string =>
  c.chId ?? `t:${norm(c.ch)}`;

/** Every league/competition slug that can carry a search plan. */
const ALL_SLUGS: string[] = [
  ...LEAGUES.map((l) => l.slug as string),
  ...NATIONAL_COMPETITIONS.map((l) => l.slug as string),
];

/**
 * Identity keys for one league's plan entries: `id:<channelId>` plus
 * `n:<normalized>` forms of the label and the handle. Kept log entries
 * carry the channel's YouTube title (not its handle), so title↔label and
 * title↔handle matches are both attempted; the handle is also indexed
 * with any trailing digit run stripped, because ONE's handle is
 * 'one-1004' while its channel title is 'ONE'.
 */
function planIdentities(league: string): Set<string> {
  const plan = searchPlanFor(league);
  const ids = new Set<string>();
  for (const ch of [...plan.preferred, ...plan.bulk]) {
    if (ch.channelId) ids.add(`id:${ch.channelId}`);
    const label = (ch as { label?: string }).label;
    if (label) ids.add(`n:${norm(label)}`);
    if (ch.handle) {
      const h = norm(ch.handle.replace(/^@/, ''));
      if (h) ids.add(`n:${h}`);
      const stripped = h.replace(/\d+$/, '');
      if (stripped && stripped !== h) ids.add(`n:${stripped}`);
    }
  }
  return ids;
}

const PLAN_IDENTITIES: Array<{ league: string; ids: Set<string> }> =
  ALL_SLUGS.map((league) => ({ league, ids: planIdentities(league) }));

/** League slugs whose curated plan (preferred or bulk) includes this channel. */
export function plansForChannel(channel: string, channelId?: string): string[] {
  const out: string[] = [];
  const byTitle = `n:${norm(channel)}`;
  for (const { league, ids } of PLAN_IDENTITIES) {
    if ((channelId && ids.has(`id:${channelId}`)) || ids.has(byTitle)) {
      out.push(league);
    }
  }
  return out;
}

export async function getChannelStats(): Promise<ChannelStatsResult> {
  const days = await readSearchLog(LOG_DAYS);
  const deny = await getDenySet();
  return aggregateChannelStats(days, deny);
}

interface Agg {
  channel: string;
  channelId?: string;
  kept: number;
  games: Set<string>;
  tiers: ChannelTierCounts;
  leagues: Set<string>;
  titles: string[];
  lastSeen: number;
}

/**
 * Pure aggregation: every kept result in the log -> per-channel stats,
 * one row per channel. Exported for zero-quota unit testing.
 */
export function aggregateChannelStats(
  days: SearchLogDay[],
  denied?: DenySet
): ChannelStatsResult {
  const aggs = new Map<string, Agg>();
  let searchesSeen = 0;

  for (const d of days) {
    for (const e of d.entries) {
      if (e.cached || !e.channels?.length) continue;
      searchesSeen += 1;
      const gameId = `${e.league}|${e.home}|${e.away}|${e.date}`;
      for (const c of e.channels) {
        const key = channelKeyPart(c);
        let a = aggs.get(key);
        if (!a) {
          a = {
            channel: c.ch,
            channelId: c.chId,
            kept: 0,
            games: new Set(),
            tiers: { sport1: 0, preferred: 0, bulk: 0, general: 0 },
            leagues: new Set(),
            titles: [],
            lastSeen: 0,
          };
          aggs.set(key, a);
        }
        a.kept += 1;
        a.games.add(gameId);
        a.tiers[c.tier] += 1;
        a.leagues.add(e.league);
        if (a.titles.length < 3) a.titles.push(c.t);
        if (e.t > a.lastSeen) a.lastSeen = e.t;
      }
    }
  }

  const channels: ChannelStat[] = [...aggs.entries()].map(([key, a]) => ({
    key,
    channel: a.channel,
    channelId: a.channelId,
    kept: a.kept,
    games: a.games.size,
    tiers: a.tiers,
    leagues: [...a.leagues].sort(),
    sampleTitles: a.titles,
    lastSeen: a.lastSeen,
    denied: denied
      ? isDeniedChannel(
          { channelId: a.channelId, channelHandle: null },
          denied
        )
      : false,
    inPlans: plansForChannel(a.channel, a.channelId),
  }));
  channels.sort(
    (x, y) =>
      y.kept - x.kept ||
      y.games - x.games ||
      (x.channel < y.channel ? -1 : x.channel > y.channel ? 1 : 0)
  );
  return { channels, searchesSeen };
}

/* ------------------------------------------------------------------ */
/* Noise-channel proposals: channels that are repeatedly filtered on  */
/* title/content yet never keep a single result — "obvious offenders" */
/* for the deny list (user decision 2026-10-13: start conservative,   */
/* zero-kept only). Derived from the per-entry rejection tallies the  */
/* recap route now persists (searchLog.ts RejectedChannel). Entries   */
/* logged before the tally existed simply contribute nothing.         */
/* ------------------------------------------------------------------ */

/** Minimum content-filtered candidates in the window to qualify. */
export const NOISE_MIN_FILTERED = 10;
/** Minimum distinct games with a content-filtered candidate to qualify. */
export const NOISE_MIN_GAMES = 4;

/**
 * Rejection reasons that are NOT title/content signals: the video was
 * unplayable (embedding disabled, region-blocked — the weekly sweep's
 * territory), the game itself was unresolvable, or the channel is
 * already blocked. Everything else filterCandidate returns counts:
 * 'teams', 'competition', 'excluded', 'language', 'date', 'too-long',
 * 'score', 'score-reversed', 'press-conference', 'prematch'.
 */
const NON_CONTENT_REASONS = new Set([
  'deny-listed',
  'not-embeddable',
  'region-blocked',
  'unknown-team',
]);

export interface NoiseReasonCount {
  reason: string;
  count: number;
}

export interface NoiseProposal {
  /** channelId when known, else `t:`+normalized title — as in ChannelStat. */
  key: string;
  /** channel title as reported by YouTube */
  channel: string;
  channelId?: string;
  /** content-filtered candidates in the window */
  filtered: number;
  /** distinct games those rejections came from */
  games: number;
  /** content-reason breakdown, count desc */
  reasons: NoiseReasonCount[];
  /** up to 3 rejected video titles from across the window */
  sampleTitles: string[];
  /** time of the most recent search that content-filtered this channel */
  lastSeen: number;
}

const rejectedKeyPart = (r: RejectedChannel): string =>
  r.chId ?? `t:${norm(r.ch)}`;

interface NoiseAgg {
  channel: string;
  channelId?: string;
  filtered: number;
  games: Set<string>;
  reasons: Map<string, number>;
  titles: string[];
  lastSeen: number;
}

/**
 * Pure aggregation: rejection tallies -> deny-list proposals.
 *
 * A channel qualifies ONLY if, across the whole window:
 *  - it accumulated >= NOISE_MIN_FILTERED content-filtered candidates,
 *  - spread over >= NOISE_MIN_GAMES distinct games,
 *  - it kept ZERO results (any kept result, any tier, excludes it —
 *    good channels post plenty of non-highlight content that the
 *    matcher filters by design; only pure-noise channels qualify),
 *  - it is not curated in any league plan, and
 *  - it is not already deny-listed.
 * Exported for zero-quota unit testing.
 */
export function aggregateNoiseProposals(
  days: SearchLogDay[],
  denied?: DenySet
): NoiseProposal[] {
  // Any channel with a kept result anywhere in the window is out.
  const keptKeys = new Set<string>();
  for (const d of days) {
    for (const e of d.entries) {
      if (e.cached || !e.channels?.length) continue;
      for (const c of e.channels) keptKeys.add(channelKeyPart(c));
    }
  }

  const aggs = new Map<string, NoiseAgg>();
  for (const d of days) {
    for (const e of d.entries) {
      if (e.cached || !e.rejected?.length) continue;
      const gameId = `${e.league}|${e.home}|${e.away}|${e.date}`;
      for (const r of e.rejected) {
        // Content-filtered count for this channel in this search.
        let content = 0;
        const contentReasons: Array<[string, number]> = [];
        for (const [reason, count] of Object.entries(r.reasons)) {
          if (NON_CONTENT_REASONS.has(reason)) continue;
          content += count;
          contentReasons.push([reason, count]);
        }
        if (content === 0) continue;
        const key = rejectedKeyPart(r);
        let a = aggs.get(key);
        if (!a) {
          a = {
            channel: r.ch,
            channelId: r.chId,
            filtered: 0,
            games: new Set(),
            reasons: new Map(),
            titles: [],
            lastSeen: 0,
          };
          aggs.set(key, a);
        }
        a.filtered += content;
        a.games.add(gameId);
        for (const [reason, count] of contentReasons) {
          a.reasons.set(reason, (a.reasons.get(reason) ?? 0) + count);
        }
        for (const s of r.samples) {
          if (a.titles.length >= 3) break;
          a.titles.push(s);
        }
        if (e.t > a.lastSeen) a.lastSeen = e.t;
      }
    }
  }

  const proposals: NoiseProposal[] = [];
  for (const [key, a] of aggs) {
    if (a.filtered < NOISE_MIN_FILTERED) continue;
    if (a.games.size < NOISE_MIN_GAMES) continue;
    if (keptKeys.has(key)) continue;
    if (plansForChannel(a.channel, a.channelId).length > 0) continue;
    if (
      denied &&
      isDeniedChannel({ channelId: a.channelId, channelHandle: null }, denied)
    )
      continue;
    proposals.push({
      key,
      channel: a.channel,
      channelId: a.channelId,
      filtered: a.filtered,
      games: a.games.size,
      reasons: [...a.reasons.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort(
          (x, y) =>
            y.count - x.count || (x.reason < y.reason ? -1 : x.reason > y.reason ? 1 : 0)
        ),
      sampleTitles: a.titles,
      lastSeen: a.lastSeen,
    });
  }
  proposals.sort(
    (x, y) =>
      y.filtered - x.filtered ||
      y.games - x.games ||
      (x.channel < y.channel ? -1 : x.channel > y.channel ? 1 : 0)
  );
  return proposals;
}

export async function getNoiseProposals(): Promise<NoiseProposal[]> {
  const days = await readSearchLog(LOG_DAYS);
  const deny = await getDenySet();
  return aggregateNoiseProposals(days, deny);
}
