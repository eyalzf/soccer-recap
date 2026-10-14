/**
 * External (link-out) sources dispatcher.
 *
 * Where the external tier runs is plan-driven (see
 * LeagueSearchPlan.externalPosition): by default after the curated
 * bulk tier, only when no proper highlight was kept; a plan may place
 * it above bulk, where a hit is exclusive. Either way, a league whose
 * plan configures external sources never falls through to general
 * YouTube search (the external tier is terminal). Providers return
 * link-out results: rendered as "open at source" cards, never embedded.
 *
 * Adding a provider = one new module + one case here; plans and the
 * pipeline stay untouched.
 */
import { sport5Search, type Sport5Considered } from './sport5';
import type { ExternalSourceConfig, LeagueSearchPlan } from './leaguePlans';
import type { GameInput, RawCandidate } from './types';

export interface ExternalSearchResult {
  /** At most one result per provider (ambiguity suppresses it). */
  candidates: RawCandidate[];
  /** Index/catalog items the provider considered (diagnostics). */
  considered: Sport5Considered[];
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
 * without an external result) pass through unchanged.
 */
export function applyExternalExclusivity<T extends RawCandidate>(
  plan: LeagueSearchPlan,
  list: T[]
): T[] {
  if (plan.externalPosition !== 'above-bulk') return list;
  const ext = list.filter((c) => c.external === true);
  return ext.length > 0 ? ext : list;
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
    default:
      return { candidates: [], considered: [], ambiguous: false };
  }
}
