/**
 * Bulk-channel candidate suggestions, derived from the search log.
 *
 * Every kept result records its channel (see searchLog.ts KeptChannel).
 * This module aggregates general-tier wins per channel per league and
 * surfaces channels with 3+ hits that are not already curated.
 *
 * Decisions (add / discard) persist in Blob at channel-ops/decisions.json
 * (Blob-only, no external services). A discard zeroes the count: the
 * channel re-surfaces only after 3 NEW hits beyond the discard point.
 */
import { readSearchLog, type KeptChannel, type SearchLogDay } from './searchLog';
import { searchPlanFor } from './leaguePlans';
import { pget, pset } from './persist';
import { isDeniedChannel, getDenySet, type DenySet } from './denyList';

export const CANDIDATE_HIT_THRESHOLD = 3;
const LOG_DAYS = 14;
const OPS_KEY = 'channel-ops/decisions.json';

export interface SuggestedScope {
  league: string;
  /** Team-scoped addition when the wins concentrate on one or two teams. */
  teams?: string[];
}

/** Distinct games a channel won per team, strongest first. */
export interface TeamWin {
  team: string;
  games: number;
}

export interface ChannelCandidate {
  /** `${league}::${channelId | 't:'+normalized title}` — stable across calls. */
  key: string;
  /** channel title as reported by YouTube */
  channel: string;
  channelId?: string;
  league: string;
  /** kept general-tier results in the window */
  hits: number;
  /** distinct games those hits came from */
  games: number;
  /** up to 3 sample result titles */
  sampleTitles: string[];
  /** teams involved in the winning games (strongest first; for scope override) */
  teams: string[];
  /** wins per team (distinct games), strongest first */
  teamWins: TeamWin[];
  scope: SuggestedScope;
}

export interface ChannelDecision {
  key: string;
  channel: string;
  channelId?: string;
  league: string;
  teams?: string[];
  t: number;
  /** hits counted at discard time; re-surface after +3 new hits */
  countAtDiscard?: number;
}

export interface ChannelOpsState {
  discarded: ChannelDecision[];
  /** approved additions, not yet deployed into leaguePlans */
  pending: ChannelDecision[];
  /** additions already deployed */
  added: ChannelDecision[];
}

export interface CandidatesResult {
  candidates: ChannelCandidate[];
  ops: ChannelOpsState;
  /** non-cache searches seen in the window (context for the counts) */
  searchesSeen: number;
  hitThreshold: number;
}

const norm = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9\u0590-\u05ff]/g, '');

const channelKeyPart = (c: KeptChannel): string => c.chId ?? `t:${norm(c.ch)}`;

/** Share of a channel's games one team must cover to suggest team scope. */
export const SCOPE_DOMINANT_SHARE = 0.7;
/** Share the top two teams must jointly cover to suggest a two-team scope. */
export const SCOPE_PAIR_SHARE = 0.85;

/**
 * Scope suggestion from the per-team win distribution (user-approved
 * 2026-10-02): one dominant team -> that team; two teams jointly covering
 * almost everything -> both; otherwise league-wide. Always overridable in
 * the UI. A single game never suggests team scope.
 */
function suggestScope(league: string, teamWins: TeamWin[], a: Agg): SuggestedScope {
  const total = a.games.size;
  if (total >= 2 && teamWins.length > 0) {
    const [t1, t2] = teamWins;
    if (t1.games / total >= SCOPE_DOMINANT_SHARE) {
      return { league, teams: [t1.team] };
    }
    if (t2) {
      const covered = new Set([
        ...(a.teamGames.get(t1.team) ?? []),
        ...(a.teamGames.get(t2.team) ?? []),
      ]);
      if (covered.size / total >= SCOPE_PAIR_SHARE) {
        return { league, teams: [t1.team, t2.team] };
      }
    }
  }
  return { league };
}

/** All curated channel identities for a league (preferred + bulk). */
function planIdentities(league: string): Set<string> {
  const plan = searchPlanFor(league);
  const ids = new Set<string>();
  for (const ch of [...plan.preferred, ...plan.bulk]) {
    if (ch.channelId) ids.add(ch.channelId);
    const label = (ch as { label?: string }).label;
    if (label) ids.add(norm(label));
    if (ch.handle) ids.add(norm(ch.handle.replace(/^@/, '')));
  }
  return ids;
}

function alreadyCurated(
  league: string,
  title: string,
  channelId?: string
): boolean {
  const ids = planIdentities(league);
  if (channelId && ids.has(channelId)) return true;
  return ids.has(norm(title));
}

export async function readOps(): Promise<ChannelOpsState> {
  try {
    const rec = await pget<ChannelOpsState>(OPS_KEY);
    if (rec?.val) {
      return {
        discarded: rec.val.discarded ?? [],
        pending: rec.val.pending ?? [],
        added: rec.val.added ?? [],
      };
    }
  } catch {
    /* fall through to empty state */
  }
  return { discarded: [], pending: [], added: [] };
}

export async function writeOps(ops: ChannelOpsState): Promise<void> {
  await pset(OPS_KEY, ops);
}

interface AggGame {
  home: string;
  away: string;
}

interface Agg {
  channel: string;
  channelId?: string;
  league: string;
  hits: number;
  games: Map<string, AggGame>;
  titles: string[];
  teamSet: Set<string>;
  /** team -> distinct game ids the channel won involving that team */
  teamGames: Map<string, Set<string>>;
}

export async function getChannelCandidates(): Promise<CandidatesResult> {
  const days = await readSearchLog(LOG_DAYS);
  const ops = await readOps();
  const deny = await getDenySet();
  return aggregateCandidates(days, ops, deny);
}

/**
 * Pure aggregation: general-tier channel wins -> candidate suggestions.
 * Exported for zero-quota unit testing.
 */
export function aggregateCandidates(
  days: SearchLogDay[],
  ops: ChannelOpsState,
  denied?: DenySet
): CandidatesResult {
  const aggs = new Map<string, Agg>();
  let searchesSeen = 0;

  for (const d of days) {
    for (const e of d.entries) {
      if (e.cached || !e.channels?.length) continue;
      searchesSeen += 1;
      const gameId = `${e.league}|${e.home}|${e.away}|${e.date}`;
      for (const c of e.channels) {
        if (c.tier !== 'general') continue;
        const key = `${e.league}::${channelKeyPart(c)}`;
        let a = aggs.get(key);
        if (!a) {
          a = {
            channel: c.ch,
            channelId: c.chId,
            league: e.league,
            hits: 0,
            games: new Map(),
            titles: [],
            teamSet: new Set(),
            teamGames: new Map(),
          };
          aggs.set(key, a);
        }
        a.hits += 1;
        if (!a.games.has(gameId)) a.games.set(gameId, { home: e.home, away: e.away });
        a.teamSet.add(e.home);
        a.teamSet.add(e.away);
        for (const t of [e.home, e.away]) {
          let s = a.teamGames.get(t);
          if (!s) {
            s = new Set();
            a.teamGames.set(t, s);
          }
          s.add(gameId);
        }
        if (a.titles.length < 3) a.titles.push(c.t);
      }
    }
  }

  const decided = new Map<string, ChannelDecision>();
  for (const dec of [...ops.discarded, ...ops.pending, ...ops.added]) {
    decided.set(dec.key, dec);
  }

  const candidates: ChannelCandidate[] = [];
  for (const [key, a] of aggs) {
    if (a.hits < CANDIDATE_HIT_THRESHOLD) continue;
    if (alreadyCurated(a.league, a.channel, a.channelId)) continue;
    // A deny-listed channel must never be proposed for the bulk pool.
    if (
      denied &&
      isDeniedChannel({ channelId: a.channelId, channelHandle: null }, denied)
    )
      continue;
    const dec = decided.get(key);
    if (dec) {
      if (dec.countAtDiscard != null) {
        // Discarded: re-surface only after 3 NEW hits beyond the discard point.
        if (a.hits < dec.countAtDiscard + CANDIDATE_HIT_THRESHOLD) continue;
      } else {
        continue; // pending approval or already added
      }
    }
    // Per-team win distribution + scope suggestion (dominant team / top
    // pair -> team scope; otherwise league-wide). User can override.
    const teamWins: TeamWin[] = [...a.teamGames.entries()]
      .map(([team, s]) => ({ team, games: s.size }))
      .sort((x, y) => y.games - x.games || (x.team < y.team ? -1 : x.team > y.team ? 1 : 0));
    const scope = suggestScope(a.league, teamWins, a);
    candidates.push({
      key,
      channel: a.channel,
      channelId: a.channelId,
      league: a.league,
      hits: a.hits,
      games: a.games.size,
      sampleTitles: a.titles,
      teams: teamWins.map((t) => t.team).slice(0, 12),
      teamWins: teamWins.slice(0, 8),
      scope,
    });
  }
  candidates.sort((x, y) => y.hits - x.hits || y.games - x.games);

  return { candidates, ops, searchesSeen, hitThreshold: CANDIDATE_HIT_THRESHOLD };
}
