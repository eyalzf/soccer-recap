/**
 * External sources dispatcher.
 *
 * Where the external tier runs is plan-driven (see
 * LeagueSearchPlan.externalPosition): by default after the curated
 * bulk tier, only when no proper highlight was kept; a plan may place
 * it above bulk, where a hit is exclusive. Either way, a league whose
 * plan configures external sources never falls through to general
 * YouTube search unless the plan sets `externalTerminal: false`
 * (the external tier is terminal). Providers return third-party
 * results: Sport5 renders as an "open at source" card and is never
 * embedded; ONE returns an embeddable MP4 (`embedUrl`) rendered as
 * an inline <video> player.
 *
 * Adding a provider = one new module + one case here; plans and the
 * pipeline stay untouched.
 */
import { oneSearch } from './one';
import { sport5Search } from './sport5';
import {
  externalRunsFirst,
  scopeMatches,
  type ExternalSourceConfig,
  type LeagueSearchPlan,
} from './leaguePlans';
import type { GameInput, RawCandidate } from './types';

/** Diagnostics item shared by all providers (Sport5's shape conforms). */
export interface ExternalConsidered {
  /** Always present: the video title, or the fixture matchup when no video exists. */
  title: string;
  keep: boolean;
  /** 'ok' when kept; otherwise the rejection reason. */
  reason: string;
}

export interface ExternalSearchResult {
  /** At most one result per provider (ambiguity suppresses it). */
  candidates: RawCandidate[];
  /** Items the provider considered (diagnostics). */
  considered: ExternalConsidered[];
  /** True when ≥2 items matched and the result was suppressed. */
  ambiguous: boolean;
}

/**
 * Read-path exclusivity for plans that place the external tier above
 * bulk (`externalPosition: 'above-bulk'`): when the list contains an
 * external result, that result is the game's whole result set and
 * every other source is suppressed. The recap route applies this to
 * fresh computes, append-only merges and cached reads alike — so a
 * game cached with bulk results self-corrects on its next refresh
 * once an external result exists for it. Below-bulk plans (and lists
 * without an external result) pass through unchanged. When the game
 * is given, exclusivity applies only when at least one external
 * result's own provider scope matches the game: a provider with its
 * own firstScope is gated by that scope, a provider without one by
 * the plan-level scope (Sport5: PSG Ligue 1 only). So a ONE result
 * on an Italian game is exclusive, while a stale external result on
 * an out-of-scope game does not suppress that game's bulk results.
 * Callers without a game keep the plan-level behavior.
 */
export function applyExternalExclusivity<T extends RawCandidate>(
  plan: LeagueSearchPlan,
  list: T[],
  game?: { home: string; away: string; competition?: string | null }
): T[] {
  if (plan.externalPosition !== 'above-bulk') return list;
  const ext = list.filter((c) => c.external === true);
  if (ext.length === 0) return list;
  if (!game) return ext;
  const qualifies = ext.some((c) => {
    const cfg = (plan.external ?? []).find((e) => e.provider === c.source);
    if (!cfg) return true;
    if (cfg.firstScope) return scopeMatches(cfg.firstScope, game);
    return externalRunsFirst(plan, game);
  });
  return qualifies ? ext : list;
}

export async function runExternalSource(
  cfg: ExternalSourceConfig,
  game: GameInput
): Promise<ExternalSearchResult> {
  switch (cfg.provider) {
    case 'sport5': {
      const r = await sport5Search(game, cfg);
      return {
        candidates: r.candidate ? [r.candidate] : [],
        considered: r.considered,
        ambiguous: r.ambiguous,
      };
    }
    case 'one': {
      const r = await oneSearch(game, { cfg });
      return {
        candidates: r.candidate ? [r.candidate] : [],
        considered: r.considered,
        ambiguous: r.ambiguous,
      };
    }
    default:
      return { candidates: [], considered: [], ambiguous: false };
  }
}
