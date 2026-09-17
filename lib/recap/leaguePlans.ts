/**
 * Per-league YouTube search plans.
 *
 * Three tiers, tried in order:
 *  1. `preferred` — trusted channels, searched one by one via search.list
 *     (100 units each). First proper highlight result stops the cascade.
 *  2. `bulk` — curated channel pool: recent-uploads playlists are fetched
 *     (1 unit per 50 videos, cached 6h in Blob) and matched app-side with
 *     our own filter/rank logic. Aggregated across ALL bulk channels.
 *  3. General search.list fallback (100 units per language), only when
 *     tiers 1+2 produce nothing.
 *
 * To add a new source: add one line to the league's `preferred` or `bulk`
 * list. Bulk entries take a `handle` (without @) or a raw `channelId`
 * (use when the handle is unknown). If a handle doesn't resolve to a
 * channel, the source is skipped silently.
 */
export interface PreferredChannel {
  /** YouTube handle without the leading @, e.g. 'Ipflofficial'. */
  handle: string;
  /** Query language for searches scoped to this channel. */
  lang: 'he' | 'en';
}

export interface BulkChannel {
  /** YouTube handle without the leading @ (preferred). */
  handle?: string;
  /** Raw UC channel ID (alternative when the handle is unknown). */
  channelId?: string;
  /** Human label for diagnostics. */
  label: string;
}

export interface LeagueSearchPlan {
  /** Preferred channels, tried in order (first = highest priority). */
  preferred: PreferredChannel[];
  /** Curated bulk pool: uploads playlists scanned + matched app-side. */
  bulk: BulkChannel[];
  /** General-search fallback, tried in order when tiers 1+2 find nothing. */
  fallbackLangs: Array<'he' | 'en'>;
}

export const LEAGUE_SEARCH_PLANS: Record<string, LeagueSearchPlan> = {
  'israeli-league': {
    preferred: [
      { handle: 'Ipflofficial', lang: 'he' },
      // NOTE: @FootballYom1 is stale (repurposed as a gaming channel since
      // ~2025); the real "כדורגל TV" recap channel is @FootballTV10.
      { handle: 'FootballTV10', lang: 'he' },
    ],
    bulk: [
      // Official club channels (Hebrew recap coverage for big clubs).
      { channelId: 'UC-oWQqnf8B8a_TsmVi0mTUg', label: 'Maccabi Tel Aviv FC' },
      { handle: 'mhfootballclub', label: 'Maccabi Haifa' },
      { handle: 'HapoelTelAvivFC', label: 'Hapoel Tel Aviv' },
      // Hebrew recap aggregators (last resort: takedown risk, verify
      // Israel availability + recency after quota reset).
      { handle: 'Taktzirim0', label: 'תקצירים' },
      { handle: 'basketball9m', label: 'micro recap channel' },
      // TODO(verify): Hapoel Jerusalem FC, Beitar Jerusalem official,
      // כדורגל.2, FCBJ_edit, Green And Glory, DicapOr, adix — handles
      // unknown; resolve via forHandle (1 unit each) after quota reset.
    ],
    fallbackLangs: ['he', 'en'],
  },
  'la-liga': {
    preferred: [{ handle: 'one-1004', lang: 'he' }],
    bulk: [
      { handle: 'laliga', label: 'LaLiga official' },
      { handle: 'realmadrid', label: 'Real Madrid' },
      { handle: 'atleticodemadrid', label: 'Atletico Madrid' },
      { handle: 'villarrealcf', label: 'Villarreal CF' },
      // Real Betis: legacy user URL; handle unconfirmed.
      { channelId: 'UCeB7JZwcar2fVoK2w2f9OwA', label: 'Real Betis' },
      { handle: 'ESPNFC', label: 'ESPN FC' },
      // Club channels verified in the 2026-09-17 curation round (language
      // veto lifted for curated tiers; press-conference exclusion added).
      { handle: 'AthleticClubTV', label: 'Athletic Club' },
      { handle: 'GetafeCFmedia', label: 'Getafe CF' },
      { handle: 'realsociedadtv', label: 'Real Sociedad' },
      // Celta: handle unconfirmed; use the verified channel ID.
      { channelId: 'UCCJLVZYqRb_85b2Flpg04cg', label: 'RC Celta' },
      // TODO(verify): Premier Sports, Sky Sports Football, FC Barcelona
      // (LaLiga rights block club highlights), beIN regional (geo-blocked).
    ],
    fallbackLangs: ['en'],
  },
  'champions-league': {
    // No suitable universal priority channel: CBS Sports Golazo and TNT
    // Sports are geo-blocked in Israel, beIN SPORTS posts Arabic commentary
    // only, and SPORTS EXTRA proved unreliable. Official club channels are
    // the curated pool instead.
    preferred: [],
    bulk: [
      { handle: 'realmadrid', label: 'Real Madrid' },
      { handle: 'FCBarcelona', label: 'FC Barcelona' },
      { handle: 'LiverpoolFC', label: 'Liverpool' },
      { handle: 'Arsenal', label: 'Arsenal' },
      { handle: 'ManCity', label: 'Man City' },
      { handle: 'Inter', label: 'Inter' },
      { handle: 'FCBayern', label: 'Bayern' },
      { handle: 'BVB', label: 'Dortmund' },
      { handle: 'atleticodemadrid', label: 'Atletico Madrid' },
      { handle: 'Juventus', label: 'Juventus' },
      { handle: 'ChelseaFC', label: 'Chelsea' },
      { handle: 'PSG', label: 'PSG' },
      { handle: 'SLBenfica', label: 'Benfica' },
      { handle: 'AFCAjax', label: 'Ajax' },
      // Club channels verified in the 2026-09-17 curation round (language
      // veto lifted for curated tiers; press-conference exclusion added).
      { handle: 'SportingCP', label: 'Sporting CP' },
      { handle: 'PSV', label: 'PSV Eindhoven' },
      { handle: 'clubbrugge', label: 'Club Brugge' },
      // TODO(verify): Tottenham (handle unconfirmed), UEFA (matchday
      // roundups only — rejected by per-game matching anyway).
    ],
    fallbackLangs: ['en'],
  },
  'premier-league': {
    preferred: [],
    bulk: [
      // User-verified 2026-09-17: @skysportspremierleague is the active
      // channel (the old 'SkySportsPL' handle resolves to a near-dead one).
      { handle: 'skysportspremierleague', label: 'Sky Sports Premier League' },
      { handle: 'mancity', label: 'Man City' },
      { handle: 'manutd', label: 'Man Utd' },
      { handle: 'Arsenal', label: 'Arsenal' },
      { handle: 'LiverpoolFC', label: 'Liverpool' },
      { handle: 'chelseafc', label: 'Chelsea' },
      // Club channels verified in the 2026-09-17 curation round.
      { handle: 'tottenhamhotspur', label: 'Tottenham Hotspur' },
      { handle: 'sunderlandafc', label: 'Sunderland AFC' },
      { handle: 'NottinghamForestFC', label: 'Nottingham Forest' },
      { handle: 'avfcofficial', label: 'Aston Villa' },
      // Leeds / Bournemouth: handles unconfirmed; use verified channel IDs.
      { channelId: 'UCRHkt-FUeYUG-ybo1Koh2WA', label: 'Leeds United' },
      { channelId: 'UCeOCuVSSweaEj6oVtJZEKQw', label: 'AFC Bournemouth' },
    ],
    fallbackLangs: ['en'],
  },
};

/** Unknown league slugs get English general search only. */
export function searchPlanFor(league: string): LeagueSearchPlan {
  return LEAGUE_SEARCH_PLANS[league] ?? { preferred: [], bulk: [], fallbackLangs: ['en'] };
}
