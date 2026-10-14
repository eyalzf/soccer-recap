/**
 * All-channels statistics, derived from the search log.
 *
 * The candidates module (channelCandidates.ts) only surfaces general-tier
 * winners as bulk-pool suggestions. This module aggregates EVERY channel
 * that kept at least one result in the window, across all tiers, and adds
 * roster rows for curated-plan channels that were quiet in the window, so
 * the channel-management page can show the full picture — split into
 * general / curated / per-team / blocked sections — and block channels
 * via the deny list (lib/recap/denyList.ts, runtime effect, no deploy).
 * Read-only aggregation; the deny list is the source of truth for what
 * is blocked.
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
  external: number;
  general: number;
}

/** One curated-plan membership of a channel, in one league. */
export interface ChannelScope {
  league: string;
  /** Team scope when the plan entry is team-scoped (club/FA channels). */
  teams?: string[];
}

/**
 * Section the channel-management view files a row under. Precedence:
 * blocked (deny-listed) > per-team (any team-scoped plan entry) >
 * curated (any plan membership) > general (kept results, in no plan).
 */
export type ChannelClassification =
  | 'blocked'
  | 'per-team'
  | 'curated'
  | 'general';

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
  /** every curated-plan membership across all leagues, with team scope */
  scopeByLeague: ChannelScope[];
  /** section classification (see ChannelClassification) */
  classification: ChannelClassification;
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
 * One curated-plan entry (preferred or bulk) with its identity keys.
 * Kept log entries carry the channel's YouTube title (not its handle),
 * so title↔label and title↔handle matches are both attempted; the
 * handle is also indexed with any trailing digit run stripped, because
 * ONE's handle is 'one-1004' while its channel title is 'ONE'.
 */
interface PlanEntryInfo {
  league: string;
  channelId?: string;
  handle?: string;
  label?: string;
  teams?: string[];
  /** `id:<channelId>` identity key, when the entry carries an ID. */
  idKey?: string;
  /** `n:<normalized>` keys derived from the handle (incl. digits-stripped). */
  handleKeys: string[];
  /** `n:<normalized>` key derived from the label, when present. */
  labelKey?: string;
}

function planEntryInfo(
  league: string,
  ch: {
    channelId?: string;
    handle?: string;
    label?: string;
    teams?: string[];
  }
): PlanEntryInfo {
  const handleKeys: string[] = [];
  if (ch.handle) {
    const h = norm(ch.handle.replace(/^@/, ''));
    if (h) handleKeys.push(`n:${h}`);
    const stripped = h.replace(/\d+$/, '');
    if (stripped && stripped !== h) handleKeys.push(`n:${stripped}`);
  }
  return {
    league,
    channelId: ch.channelId,
    handle: ch.handle,
    label: ch.label,
    teams: ch.teams,
    idKey: ch.channelId ? `id:${ch.channelId}` : undefined,
    handleKeys,
    labelKey: ch.label ? `n:${norm(ch.label)}` : undefined,
  };
}

const PLAN_ENTRIES: PlanEntryInfo[] = (() => {
  const out: PlanEntryInfo[] = [];
  for (const league of ALL_SLUGS) {
    const plan = searchPlanFor(league);
    for (const ch of [...plan.preferred, ...plan.bulk]) {
      out.push(planEntryInfo(league, ch));
    }
  }
  return out;
})();

/** Does a plan entry identify this channel (title + optional channelId)? */
function entryMatchesChannel(
  e: PlanEntryInfo,
  titleNorm: string,
  channelId?: string
): boolean {
  if (channelId && e.idKey === `id:${channelId}`) return true;
  const key = `n:${titleNorm}`;
  return e.labelKey === key || e.handleKeys.includes(key);
}

/**
 * All curated-plan memberships of a channel across every league, in
 * league-registry order; a membership carries the union of the team
 * scopes of the entries it matched in that league (no `teams` when
 * every matched entry is league-wide).
 */
export function scopeForChannel(
  channel: string,
  channelId?: string
): ChannelScope[] {
  const titleNorm = norm(channel);
  const byLeague = new Map<string, Set<string>>();
  for (const e of PLAN_ENTRIES) {
    if (!entryMatchesChannel(e, titleNorm, channelId)) continue;
    let teams = byLeague.get(e.league);
    if (!teams) {
      teams = new Set();
      byLeague.set(e.league, teams);
    }
    if (e.teams) for (const t of e.teams) teams.add(t);
  }
  return [...byLeague.entries()].map(([league, teams]) =>
    teams.size ? { league, teams: [...teams] } : { league }
  );
}

/** League slugs whose curated plan (preferred or bulk) includes this channel. */
export function plansForChannel(channel: string, channelId?: string): string[] {
  return scopeForChannel(channel, channelId).map((s) => s.league);
}

/** Section classification; precedence blocked > per-team > curated > general. */
export function classifyChannel(
  denied: boolean,
  scopeByLeague: ChannelScope[]
): ChannelClassification {
  if (denied) return 'blocked';
  if (scopeByLeague.some((s) => s.teams?.length)) return 'per-team';
  if (scopeByLeague.length > 0) return 'curated';
  return 'general';
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
 * one row per channel, plus roster rows for quiet curated channels.
 * Exported for zero-quota unit testing.
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
            tiers: { sport1: 0, preferred: 0, bulk: 0, external: 0, general: 0 },
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

  const channels: ChannelStat[] = [...aggs.entries()].map(([key, a]) => {
    const scopeByLeague = scopeForChannel(a.channel, a.channelId);
    const deniedFlag = denied
      ? isDeniedChannel(
          { channelId: a.channelId, channelHandle: null },
          denied
        )
      : false;
    return {
      key,
      channel: a.channel,
      channelId: a.channelId,
      kept: a.kept,
      games: a.games.size,
      tiers: a.tiers,
      leagues: [...a.leagues].sort(),
      sampleTitles: a.titles,
      lastSeen: a.lastSeen,
      denied: deniedFlag,
      inPlans: scopeByLeague.map((s) => s.league),
      scopeByLeague,
      classification: classifyChannel(deniedFlag, scopeByLeague),
    };
  });
  // Roster rows for curated channels that kept nothing in the window.
  channels.push(...rosterRows(channels, denied));
  channels.sort(
    (x, y) =>
      y.kept - x.kept ||
      y.games - x.games ||
      (x.channel < y.channel ? -1 : x.channel > y.channel ? 1 : 0)
  );
  return { channels, searchesSeen };
}

interface RosterAcc {
  channelId?: string;
  handle?: string;
  label?: string;
  /** league -> union of team scopes across the merged entries */
  scopes: Map<string, Set<string>>;
}

/**
 * Roster rows for curated-plan channels with NO kept result in the
 * window: the management view lists the full curated pool (and lets it
 * be blocked) even when a channel was quiet. Plan entries merge by
 * identity — channelId first, then normalized handle (incl. the
 * digits-stripped variant), then normalized label/title — into a log
 * row when one matches (that row's scope already covers the entry via
 * scopeForChannel) or into a shared roster row otherwise, so a channel
 * curated in several leagues still yields exactly one row.
 */
function rosterRows(
  logRows: ChannelStat[],
  denied?: DenySet
): ChannelStat[] {
  const rowByIdentity = new Map<string, ChannelStat>();
  for (const row of logRows) {
    if (row.channelId) rowByIdentity.set(`id:${row.channelId}`, row);
    const nk = `n:${norm(row.channel)}`;
    if (!rowByIdentity.has(nk)) rowByIdentity.set(nk, row);
  }
  const findLogRow = (e: PlanEntryInfo): ChannelStat | undefined => {
    if (e.idKey) {
      const r = rowByIdentity.get(e.idKey);
      if (r) return r;
    }
    for (const k of e.handleKeys) {
      const r = rowByIdentity.get(k);
      if (r) return r;
    }
    if (e.labelKey) return rowByIdentity.get(e.labelKey);
    return undefined;
  };

  const accByIdentity = new Map<string, RosterAcc>();
  const accs: RosterAcc[] = [];
  for (const e of PLAN_ENTRIES) {
    if (findLogRow(e)) continue; // merged into the log row's scope
    const keys = [
      ...(e.idKey ? [e.idKey] : []),
      ...e.handleKeys,
      ...(e.labelKey ? [e.labelKey] : []),
    ];
    let acc: RosterAcc | undefined;
    for (const k of keys) {
      acc = accByIdentity.get(k);
      if (acc) break;
    }
    if (!acc) {
      acc = { scopes: new Map() };
      accs.push(acc);
    }
    for (const k of keys) {
      if (!accByIdentity.has(k)) accByIdentity.set(k, acc);
    }
    if (!acc.channelId && e.channelId) acc.channelId = e.channelId;
    if (!acc.handle && e.handle) acc.handle = e.handle;
    if (!acc.label && e.label) acc.label = e.label;
    let teams = acc.scopes.get(e.league);
    if (!teams) {
      teams = new Set();
      acc.scopes.set(e.league, teams);
    }
    if (e.teams) for (const t of e.teams) teams.add(t);
  }

  const logKeys = new Set(logRows.map((r) => r.key));
  const out: ChannelStat[] = [];
  for (const acc of accs) {
    // Display name: label ?? handle ?? channelId (every plan entry
    // carries at least one of the three).
    const name = acc.label ?? acc.handle ?? (acc.channelId as string);
    const key = acc.channelId ?? `t:${norm(name)}`;
    if (logKeys.has(key)) continue;
    const scopeByLeague: ChannelScope[] = ALL_SLUGS.filter((l) =>
      acc.scopes.has(l)
    ).map((league) => {
      const teams = acc.scopes.get(league) as Set<string>;
      return teams.size ? { league, teams: [...teams] } : { league };
    });
    const deniedFlag = denied
      ? isDeniedChannel(
          { channelId: acc.channelId, channelHandle: acc.handle ?? null },
          denied
        )
      : false;
    out.push({
      key,
      channel: name,
      channelId: acc.channelId,
      kept: 0,
      games: 0,
      tiers: { sport1: 0, preferred: 0, bulk: 0, external: 0, general: 0 },
      leagues: scopeByLeague.map((s) => s.league).sort(),
      sampleTitles: [],
      lastSeen: 0,
      denied: deniedFlag,
      inPlans: scopeByLeague.map((s) => s.league),
      scopeByLeague,
      classification: classifyChannel(deniedFlag, scopeByLeague),
    });
  }
  return out;
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
