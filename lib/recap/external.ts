/**
 * External (link-out) sources dispatcher.
 *
 * External providers run after the curated YouTube tiers and only when
 * no proper highlight was kept; a league whose plan configures external
 * sources never falls through to general YouTube search (the external
 * tier is terminal — see LeagueSearchPlan.external). Providers return
 * link-out results: rendered as "open at source" cards, never embedded.
 *
 * Adding a provider = one new module + one case here; plans and the
 * pipeline stay untouched.
 */
import { sport5Search, type Sport5Considered } from './sport5';
import type { ExternalSourceConfig } from './leaguePlans';
import type { GameInput, RawCandidate } from './types';

export interface ExternalSearchResult {
  /** At most one result per provider (ambiguity suppresses it). */
  candidates: RawCandidate[];
  /** Index/catalog items the provider considered (diagnostics). */
  considered: Sport5Considered[];
  /** True when ≥2 items matched and the result was suppressed. */
  ambiguous: boolean;
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
