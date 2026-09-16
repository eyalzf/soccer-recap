/**
 * Per-league YouTube search plans.
 *
 * Each league defines its preferred channels in priority order, plus the
 * general-search fallback languages. The recap route tries the preferred
 * channels one by one (stopping at the first with a proper highlight
 * result) and only then falls back to general search.
 *
 * To add a new source: add one line to the league's `preferred` list:
 *   { handle: '<YouTube handle without the @>', lang: 'he' | 'en' }
 * `lang` selects the query language used when searching that channel.
 * If the handle doesn't resolve to a channel, the source is skipped
 * silently and the next priority is tried.
 */
export interface PreferredChannel {
  /** YouTube handle without the leading @, e.g. 'Ipflofficial'. */
  handle: string;
  /** Query language for searches scoped to this channel. */
  lang: 'he' | 'en';
}

export interface LeagueSearchPlan {
  /** Preferred channels, tried in order (first = highest priority). */
  preferred: PreferredChannel[];
  /** General-search fallback, tried in order when no preferred channel hit. */
  fallbackLangs: Array<'he' | 'en'>;
}

export const LEAGUE_SEARCH_PLANS: Record<string, LeagueSearchPlan> = {
  'israeli-league': {
    preferred: [
      { handle: 'Ipflofficial', lang: 'he' },
      { handle: 'FootballYom1', lang: 'he' },
    ],
    fallbackLangs: ['he', 'en'],
  },
  'la-liga': {
    preferred: [{ handle: 'one-1004', lang: 'he' }],
    fallbackLangs: ['en'],
  },
  'champions-league': {
    preferred: [{ handle: 'sportsextra', lang: 'en' }],
    fallbackLangs: ['en'],
  },
  'premier-league': {
    preferred: [],
    fallbackLangs: ['en'],
  },
};

/** Unknown league slugs get English general search only. */
export function searchPlanFor(league: string): LeagueSearchPlan {
  return LEAGUE_SEARCH_PLANS[league] ?? { preferred: [], fallbackLangs: ['en'] };
}
