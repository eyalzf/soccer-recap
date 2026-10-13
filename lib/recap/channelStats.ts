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
import { readSearchLog, type KeptChannel, type SearchLogDay } from './searchLog';
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
