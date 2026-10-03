/**
 * Per-league search plans: ALL league-specific configuration for the
 * recap pipeline lives here — which channels/sources serve the league,
 * how the preferred tier stops, which title keywords contradict the
 * competition, which global exclusions are waived, and which
 * competition names earn a ranking boost.
 *
 * The pipeline code (matcher, ranker, bulk scanner, API route) is
 * league-agnostic: it reads these plans and applies one rule set to
 * every league. Adding or reconfiguring a league must only ever
 * require editing this file (plus the league registry and fixtures
 * data) — never the business logic.
 *
 * Three tiers, tried in order:
 *  1. `preferred` — trusted channels, scanned via their uploads playlists
 *     (1 unit per 50 videos, cached 1h in Blob per channel ID) and matched
 *     app-side. First proper highlight result stops the cascade.
 *  2. `bulk` — curated channel pool: same uploads-playlist mechanism.
 *     Team-scoped entries (club channels) are only scanned for their own
 *     club's games; league-wide entries (aggregators, broadcasters) always.
 *     Aggregated across the selected channels, matched app-side.
 *  3. General search.list fallback (100 units per language), only when
 *     tiers 1+2 produce nothing.
 *
 * To add a new source: add one line to the league's `preferred` or `bulk`
 * list. Bulk entries take a `handle` (without @) or a raw `channelId`
 * (use when the handle is unknown). If a handle doesn't resolve to a
 * channel, the source is skipped silently.
 *
 * Club channels are defined ONCE in CLUB_CHANNELS below (keyed by the
 * club's English team name) and referenced from league plans via
 * clubChannel('Team'). The definition — handle or channel ID — lives in
 * exactly one place even when the club plays in several of the app's
 * competitions (e.g. Real Madrid in La Liga and the Champions League),
 * so a handle change or a newly validated club channel lands everywhere
 * at once. League-wide channels (aggregators, broadcasters) stay as
 * plain bulk literals in the plans: they are not tied to one club.
 */
export interface PreferredChannel {
  /** YouTube handle without the leading @, e.g. 'Ipflofficial'. */
  handle?: string;
  /** Raw UC channel ID (alternative when the handle is unknown). */
  channelId?: string;
  /** Query language for searches scoped to this channel. */
  lang: 'he' | 'en';
  /**
   * Max uploads-playlist pages to scan (50 videos/page, newest first,
   * early-stop once videos predate the game). Default 3.
   */
  pages?: number;
  /**
   * When set, this channel is only consulted for games involving one of
   * these teams (English names, alias-aware). Unset = league-wide.
   */
  teams?: string[];
}

export interface BulkChannel {
  /** YouTube handle without the leading @ (preferred). */
  handle?: string;
  /** Raw UC channel ID (alternative when the handle is unknown). */
  channelId?: string;
  /** Human label for diagnostics. */
  label: string;
  /**
   * When set, this channel is only scanned for games involving one of
   * these teams (English names, alias-aware via the club index with a
   * substring fallback). Club channels are team-scoped; aggregators and
   * league/broadcaster channels stay league-wide (unset).
   */
  teams?: string[];
}

export interface LeagueSearchPlan {
  /** Preferred channels, tried in order (first = highest priority). */
  preferred: PreferredChannel[];
  /** Curated bulk pool: uploads playlists scanned + matched app-side. */
  bulk: BulkChannel[];
  /**
   * Max uploads-playlist pages per bulk channel (50 videos/page, newest
   * first, early-stop once videos predate the game). Default 10.
   */
  bulkPages?: number;
  /** General-search fallback, tried in order when tiers 1+2 find nothing. */
  fallbackLangs: Array<'he' | 'en'>;
  /**
   * How the preferred tier stops the cascade:
   *  - 'highlight' (default): only a proper highlight result stops the
   *    cascade, and preferred results are exclusive only when one of them
   *    is a proper highlight.
   *  - 'any': the first preferred channel with ANY kept result stops the
   *    cascade, and preferred results are exclusive (every other result —
   *    including cached ones — is dropped). For a channel whose per-game
   *    upload is reliably the best recap even without highlight wording in
   *    the title (LaLiga/ONE, user decision 2026-10-02; CONCACAF official
   *    channel, user decision 2026-10-03).
   */
  preferredStopRule?: 'any' | 'highlight';
  /**
   * Title keywords (lowercase substrings) that contradict this
   * competition: a title naming another competition is vetoed. League
   * configuration for the matcher — the matcher itself is league-agnostic.
   */
  contradictions?: string[];
  /**
   * Terms from the matcher's global excluded-categories list that do NOT
   * apply in this league (e.g. friendlies waive 'friendly' / 'ידידות',
   * which every legitimate title carries there).
   */
  excludedWaivers?: string[];
  /**
   * Competition-name variants (lowercase substrings) that earn a ranking
   * boost when named in a title. League configuration for the ranker.
   */
  competitionTerms?: string[];
  /**
   * Sport1 (Maariv/Walla site) as a priority source: checked before every
   * YouTube tier; any result it yields for a game ends the search (no
   * other source is consulted). Consumes no quota (plain REST + page
   * fetches). Enabled only where the user approved it (UEFA Nations
   * League).
   */
  sport1?: boolean;
}

export interface ClubChannelDef {
  /** YouTube handle without the leading @ (preferred). */
  handle?: string;
  /** Raw UC channel ID (alternative when the handle is unknown). */
  channelId?: string;
  /** Human label for diagnostics. */
  label: string;
}

/**
 * Official club channels, defined ONCE and shared by every league plan
 * (see the file header). Keyed by the club's English team name as used in
 * the fixtures data. Most entries were verified in the 2026-09-17
 * curation rounds (language veto lifted for curated tiers; press-
 * conference exclusion added); later additions carry their own
 * verification note. A channel lands here only after it kept proper
 * highlights for its own club across several real games (validated via
 * /api/recap/curated-test) — a channel that posts for many clubs belongs
 * in a league plan as a league-wide literal instead.
 */
export const CLUB_CHANNELS: Record<string, ClubChannelDef> = {
  // Israel
  'Maccabi Tel Aviv': { channelId: 'UC-oWQqnf8B8a_TsmVi0mTUg', label: 'Maccabi Tel Aviv FC' },
  'Maccabi Haifa': { handle: 'mhfootballclub', label: 'Maccabi Haifa' },
  'Hapoel Tel Aviv': { handle: 'HapoelTelAvivFC', label: 'Hapoel Tel Aviv' },
  // Spain
  Barcelona: { handle: 'FCBarcelona', label: 'FC Barcelona' },
  'Real Madrid': { handle: 'realmadrid', label: 'Real Madrid' },
  'Atletico Madrid': { handle: 'atleticodemadrid', label: 'Atletico Madrid' },
  Villarreal: { handle: 'villarrealcf', label: 'Villarreal CF' },
  // Real Betis: legacy user URL; handle unconfirmed.
  'Real Betis': { channelId: 'UCeB7JZwcar2fVoK2w2f9OwA', label: 'Real Betis' },
  // Sevilla / Espanyol: validated 2026-10-02 via curated-test — proper
  // highlight kept in 5/5 (Sevilla FC) and 3/3 (RCD Espanyol) of their
  // own La Liga games; nothing kept for other clubs' games.
  Sevilla: { handle: 'SevillaFC', label: 'Sevilla FC' },
  Espanyol: { handle: 'rcdespanyol', label: 'RCD Espanyol' },
  'Athletic Club': { handle: 'AthleticClubTV', label: 'Athletic Club' },
  Getafe: { handle: 'GetafeCFmedia', label: 'Getafe CF' },
  'Real Sociedad': { handle: 'realsociedadtv', label: 'Real Sociedad' },
  // Celta: handle unconfirmed; use the verified channel ID.
  Celta: { channelId: 'UCCJLVZYqRb_85b2Flpg04cg', label: 'RC Celta' },
  // England
  'Manchester City': { handle: 'mancity', label: 'Man City' },
  'Manchester United': { handle: 'manutd', label: 'Man Utd' },
  Arsenal: { handle: 'Arsenal', label: 'Arsenal' },
  Liverpool: { handle: 'LiverpoolFC', label: 'Liverpool' },
  Chelsea: { handle: 'chelseafc', label: 'Chelsea' },
  'Tottenham Hotspur': { handle: 'tottenhamhotspur', label: 'Tottenham Hotspur' },
  Sunderland: { handle: 'sunderlandafc', label: 'Sunderland AFC' },
  'Nottingham Forest': { handle: 'NottinghamForestFC', label: 'Nottingham Forest' },
  'Aston Villa': { handle: 'avfcofficial', label: 'Aston Villa' },
  // Leeds / Bournemouth: handles unconfirmed; use verified channel IDs.
  'Leeds United': { channelId: 'UCRHkt-FUeYUG-ybo1Koh2WA', label: 'Leeds United' },
  Bournemouth: { channelId: 'UCeOCuVSSweaEj6oVtJZEKQw', label: 'AFC Bournemouth' },
  // 2026-09-30: verified via /api/recap/curated-test on Newcastle–Hull
  // (kept 4, proper highlight incl. "City's fightback nearly enough!
  // Newcastle United 2-1 Hull City | Premier League Highlights").
  'Hull City': { handle: 'hullcityofficial', label: 'Hull City' },
  // Everton: validated 2026-10-02 via curated-test — proper highlight
  // kept in 3/3 of Everton's Premier League games.
  Everton: { handle: 'Everton', label: 'Everton' },
  // Italy / Germany / France / Portugal / Netherlands / Belgium
  Inter: { handle: 'Inter', label: 'Inter' },
  Juventus: { handle: 'Juventus', label: 'Juventus' },
  'Bayern Munich': { handle: 'FCBayern', label: 'Bayern' },
  'Borussia Dortmund': { handle: 'BVB', label: 'Dortmund' },
  'Paris Saint-Germain': { handle: 'PSG', label: 'PSG' },
  Benfica: { handle: 'SLBenfica', label: 'Benfica' },
  Ajax: { handle: 'AFCAjax', label: 'Ajax' },
  'Sporting CP': { handle: 'SportingCP', label: 'Sporting CP' },
  'PSV Eindhoven': { handle: 'PSV', label: 'PSV Eindhoven' },
  'Club Brugge': { handle: 'clubbrugge', label: 'Club Brugge' },
};

/**
 * Resolve a club's shared channel definition into a team-scoped bulk
 * entry for one league plan. Throws on an unknown club name: plan
 * entries are code, so a typo must fail loudly in tests rather than
 * silently drop coverage in production.
 */
export function clubChannel(team: string): BulkChannel {
  const def = CLUB_CHANNELS[team];
  if (!def) throw new Error(`clubChannel: no club channel defined for '${team}'`);
  return { ...def, teams: [team] };
}

export const LEAGUE_SEARCH_PLANS: Record<string, LeagueSearchPlan> = {
  'israeli-league': {
    contradictions: [
      'גביע המדינה', 'גביע הטוטו', 'state cup', 'toto cup',
      'champions league', 'ליגת האלופות', 'conference league', 'קונפרנס ליג',
    ],
    competitionTerms: [
      'ליגת העל', 'ligat haal',
    ],
    preferred: [
      { handle: 'Ipflofficial', lang: 'he' },
      // NOTE: @FootballYom1 is stale (repurposed as a gaming channel since
      // ~2025); the real "כדורגל TV" recap channel is @FootballTV10.
      { handle: 'FootballTV10', lang: 'he' },
    ],
    bulk: [
      // Official club channels (Hebrew recap coverage for big clubs).
      // Team-scoped: only scanned for their own club's games. Definitions
      // live in CLUB_CHANNELS (see above).
      clubChannel('Maccabi Tel Aviv'),
      clubChannel('Maccabi Haifa'),
      clubChannel('Hapoel Tel Aviv'),
      // Hebrew recap aggregators (last resort: takedown risk, verify
      // Israel availability + recency after quota reset).
      { handle: 'Taktzirim0', label: 'תקצירים' },
      { handle: 'basketball9m', label: 'micro recap channel' },
      // כדורגל ישראלי: verified in the 2026-09-17 round-2 curation
      // (8/10 proper-highlight coverage on the 10-game test).
      { channelId: 'UC5TtVDq_BSplSOHf7lb2AGQ', label: 'כדורגל ישראלי' },
      // TODO(verify): Hapoel Jerusalem FC, Beitar Jerusalem official,
      // כדורגל.2, FCBJ_edit, Green And Glory, DicapOr, adix — handles
      // unknown; resolve via forHandle (1 unit each) after quota reset.
    ],
    fallbackLangs: ['he', 'en'],
  },
  'la-liga': {
    contradictions: [
      'copa del rey', 'גביע המלך', 'supercopa', 'סופר קאפ',
      'champions league', 'ליגת האלופות', 'europa league', 'הליגה האירופית',
    ],
    competitionTerms: [
      'la liga', 'לה ליגה',
    ],
    preferred: [{ handle: 'one-1004', lang: 'he' }],
    // ONE's per-game upload is consistently the best La Liga recap even
    // when its title carries no highlight wording, so any kept ONE result
    // stops the cascade and is exclusive (user decision 2026-10-02).
    preferredStopRule: 'any',
    bulk: [
      // LaLiga official (@laliga) is on the deny list — its videos are
      // embedding-blocked (user report 2026-10-02). Do not re-add here.
      // Club channels first (team-scoped, from CLUB_CHANNELS), then the
      // league-wide ESPN FC.
      clubChannel('Barcelona'),
      clubChannel('Real Madrid'),
      clubChannel('Atletico Madrid'),
      clubChannel('Villarreal'),
      clubChannel('Real Betis'),
      clubChannel('Sevilla'),
      clubChannel('Espanyol'),
      { handle: 'ESPNFC', label: 'ESPN FC' },
      clubChannel('Athletic Club'),
      clubChannel('Getafe'),
      clubChannel('Real Sociedad'),
      clubChannel('Celta'),
      // TODO(verify): Premier Sports, Sky Sports Football, FC Barcelona
      // (LaLiga rights block club highlights), beIN regional (geo-blocked).
    ],
    fallbackLangs: ['en'],
  },
  'champions-league': {
    contradictions: [
      'premier league', 'פרמייר ליג', 'la liga', 'לה ליגה', 'ligue 1',
      'serie a', 'סרייה א', 'bundesliga', 'בונדסליגה', 'fa cup', 'גביע אנגלי',
      'copa del rey', 'גביע המלך', 'eredivisie', 'ליגת העל',
    ],
    competitionTerms: [
      'champions league', 'ליגת האלופות', 'ucl',
    ],
    // No suitable universal priority channel: CBS Sports Golazo and TNT
    // Sports are geo-blocked in Israel, beIN SPORTS posts Arabic commentary
    // only, and SPORTS EXTRA proved unreliable. Official club channels are
    // the curated pool instead.
    preferred: [],
    bulk: [
      clubChannel('Real Madrid'),
      clubChannel('Barcelona'),
      clubChannel('Liverpool'),
      clubChannel('Arsenal'),
      clubChannel('Manchester City'),
      clubChannel('Inter'),
      clubChannel('Bayern Munich'),
      clubChannel('Borussia Dortmund'),
      clubChannel('Atletico Madrid'),
      clubChannel('Juventus'),
      clubChannel('Chelsea'),
      clubChannel('Paris Saint-Germain'),
      clubChannel('Benfica'),
      clubChannel('Ajax'),
      clubChannel('Sporting CP'),
      clubChannel('PSV Eindhoven'),
      clubChannel('Club Brugge'),
      // Aggregator channels verified in the 2026-09-17 round-2 curation
      // (proper-highlight coverage on 10-game tests): CHEFON FF 9/10,
      // Al Faris Production 7/10, FranSports 6/10, Franq Media 6/10.
      // Handles unconfirmed; use the verified channel IDs.
      { channelId: 'UCxctJ_xwwuwK386DVEnVFqw', label: 'CHEFON FF' },
      { channelId: 'UChgMnlNqz-SVd_9tp--Ls8A', label: 'Al Faris Production' },
      { channelId: 'UCmFG2HW29cDZIeM9auPgOag', label: 'FranSports' },
      { channelId: 'UC6_c5Pv9Y4kkingkVQ9xRvA', label: 'Franq Media' },
      // TODO(verify): Tottenham (handle unconfirmed), UEFA (matchday
      // roundups only — rejected by per-game matching anyway).
    ],
    fallbackLangs: ['en'],
  },
  'premier-league': {
    contradictions: [
      'fa cup', 'גביע אנגלי', 'גביע האנגלי', 'carabao', 'efl cup',
      'champions league', 'ליגת האלופות', 'europa league', 'הליגה האירופית',
      'community shield',
    ],
    competitionTerms: [
      'premier league', 'פרמייר ליג', 'פרמיירליג',
    ],
    preferred: [],
    bulk: [
      // User-verified 2026-09-17: @skysportspremierleague is the active
      // channel (the old 'SkySportsPL' handle resolves to a near-dead one).
      { handle: 'skysportspremierleague', label: 'Sky Sports Premier League' },
      clubChannel('Manchester City'),
      clubChannel('Manchester United'),
      clubChannel('Arsenal'),
      clubChannel('Liverpool'),
      clubChannel('Chelsea'),
      clubChannel('Tottenham Hotspur'),
      clubChannel('Sunderland'),
      clubChannel('Nottingham Forest'),
      clubChannel('Aston Villa'),
      clubChannel('Leeds United'),
      clubChannel('Bournemouth'),
      clubChannel('Hull City'),
      clubChannel('Everton'),
    ],
    fallbackLangs: ['en'],
  },

  // ---- National teams (2026-09-25) -------------------------------------
  // Channel research: ~/workspace/nations-channel-research.md (zero quota
  // spent). Only channels with public evidence are listed; unresolved
  // identifiers are marked TODO(verify) and skipped silently when the
  // handle doesn't resolve. Geo-blocking in Israel for official
  // competition channels (@fifa/@UEFA) was NOT verified — search-index
  // presence is not proof of playability.
  'world-cup': {
    contradictions: [
      'nations league', 'ליגת האומות',
      'יורו', 'european championship', 'euro 2028', 'euro 2024',
      'copa américa', 'copa america', 'קופה אמריקה',
      'afcon', 'africa cup', 'גביע אפריקה',
      'gold cup', 'גביע הזהב', 'concacaf nations league',
      'premier league', 'פרמייר ליג', 'la liga', 'לה ליגה',
      'champions league', 'ליגת האלופות', 'europa league',
    ],
    preferred: [
      // כאן 11 — Israel's World Cup broadcaster; proven Hebrew per-match
      // "תקציר" uploads for WC 2026. Modern @handle unresolved; the
      // classic youtube.com/KAN11 URL is verified via Kan's own app
      // listing. TODO(verify): confirm the handle/channel ID.
      { handle: 'KAN11', lang: 'he' },
      // IFA official channel: Hebrew recaps of Israel's qualifiers
      // (e.g. Moldova–Israel, Israel–Moldova, Norway–Israel).
      // Team-scoped: only scanned for Israel's games.
      { channelId: 'UC-5AVLhL2v04-lfbVzejRZQ', lang: 'he', teams: ['Israel'] },
    ],
    bulk: [
      { handle: 'fifa', label: 'FIFA' },
      { channelId: 'UCNT2e7Og56vm5_V-yJWvglA', label: 'England', teams: ['England'] },
      { handle: 'sportsextra', label: 'SPORTS EXTRA' },
      { handle: 'foxsports', label: 'FOX Sports' },
    ],
    fallbackLangs: ['he', 'en'],
  },
  euros: {
    contradictions: [
      'world cup', 'מונדיאל', 'מוקדמות המונדיאל',
      'nations league', 'ליגת האומות',
      'copa américa', 'copa america', 'קופה אמריקה',
      'afcon', 'africa cup', 'גביע אפריקה',
      'gold cup', 'גביע הזהב', 'concacaf nations league',
      'premier league', 'פרמייר ליג', 'champions league', 'ליגת האלופות',
    ],
    // No Hebrew priority channel could be verified for the Euros.
    preferred: [],
    bulk: [
      { handle: 'UEFA', label: 'UEFA' },
      // DFB: proven per-match Nations League output; Euro tournament
      // cadence still needs direct confirmation.
      { channelId: 'UC7am34-1rGU_ky1vWYnoOJQ', label: 'Germany / DFB', teams: ['Germany'] },
      { channelId: 'UCNT2e7Og56vm5_V-yJWvglA', label: 'England', teams: ['England'] },
      { handle: 'OnsOranje', label: 'Netherlands / OnsOranje', teams: ['Netherlands'] },
      { handle: 'sportsextra', label: 'SPORTS EXTRA' },
      { handle: 'foxsports', label: 'FOX Sports' },
      // TODO(verify): Belgium RBFA (subscribe link bit.ly/rbfayoutube,
      // handle unresolved; proven per-match output incl. UNL playoffs).
    ],
    fallbackLangs: ['en'],
  },
  'copa-america': {
    contradictions: [
      'world cup', 'מונדיאל', 'מוקדמות המונדיאל',
      'nations league', 'ליגת האומות',
      'יורו', 'european championship', 'euro 2028', 'euro 2024',
      'afcon', 'africa cup', 'גביע אפריקה',
      'gold cup', 'גביע הזהב', 'concacaf nations league',
      'premier league', 'פרמייר ליג', 'champions league', 'ליגת האלופות',
    ],
    // No Hebrew priority channel could be verified for Copa América.
    preferred: [],
    bulk: [
      // Official Copa América channel identifier unresolved (legacy path
      // /copaamerica; official site links per-match 2024 highlight
      // videos). TODO(verify): resolve handle/channel ID.
      // Aggregators below post international highlights; Copa-specific
      // coverage cadence unverified.
      { handle: 'sportsextra', label: 'SPORTS EXTRA' },
      { handle: 'foxsports', label: 'FOX Sports' },
    ],
    fallbackLangs: ['en'],
  },
  'nations-league': {
    contradictions: [
      'world cup', 'מונדיאל', 'מוקדמות המונדיאל',
      'יורו', 'european championship', 'euro 2028', 'euro 2024',
      'copa américa', 'copa america', 'קופה אמריקה',
      'afcon', 'africa cup', 'גביע אפריקה',
      'gold cup', 'גביע הזהב', 'concacaf nations league',
      'premier league', 'פרמייר ליג', 'la liga', 'לה ליגה', 'serie a',
      'bundesliga', 'בונדסליגה', 'ligue 1', 'champions league', 'ליגת האלופות',
      'europa league', 'fa cup', 'copa del rey', 'ליגת העל',
    ],
    // Sport1 (ספורט 1 web) is the priority source: official Hebrew
    // broadcaster recaps, checked before any YouTube tier (user decision
    // 2026-10-02). No Hebrew priority YouTube channel could be verified
    // for the Nations League (the Austria 3-1 Israel recap's uploader is
    // unknown), so preferred stays empty.
    sport1: true,
    preferred: [],
    bulk: [
      { handle: 'UEFA', label: 'UEFA' },
      { channelId: 'UC7am34-1rGU_ky1vWYnoOJQ', label: 'Germany / DFB', teams: ['Germany'] },
      { channelId: 'UCNT2e7Og56vm5_V-yJWvglA', label: 'England', teams: ['England'] },
      { handle: 'OnsOranje', label: 'Netherlands / OnsOranje', teams: ['Netherlands'] },
      // IFA covers all Israeli national teams; no Nations League upload
      // tied to the channel yet, so bulk (not preferred) for Israel games.
      { channelId: 'UC-5AVLhL2v04-lfbVzejRZQ', label: 'ההתאחדות לכדורגל / IFA', teams: ['Israel'] },
      { handle: 'sportsextra', label: 'SPORTS EXTRA' },
      { handle: 'foxsports', label: 'FOX Sports' },
      // TODO(verify): Belgium RBFA (handle unresolved).
    ],
    fallbackLangs: ['he', 'en'],
  },
  afcon: {
    contradictions: [
      'world cup', 'מונדיאל', 'מוקדמות המונדיאל',
      'nations league', 'ליגת האומות',
      'יורו', 'european championship', 'euro 2028', 'euro 2024',
      'copa américa', 'copa america', 'קופה אמריקה',
      'gold cup', 'גביע הזהב', 'concacaf nations league',
      'premier league', 'פרמייר ליג', 'la liga', 'לה ליגה',
      'champions league', 'ליגת האלופות', 'europa league',
    ],
    // No Hebrew priority channel could be verified for AFCON.
    preferred: [],
    bulk: [
      // CAF TV: classic youtube.com/user/MyAfricanFootball URL is verified
      // via CAF's own video descriptions (AFCON 2025 highlights); the
      // modern @handle is unresolved — skipped silently until it resolves.
      // TODO(verify): confirm the handle/channel ID and per-match output.
      { handle: 'MyAfricanFootball', label: 'CAF TV' },
      { handle: 'sportsextra', label: 'SPORTS EXTRA' },
      { handle: 'foxsports', label: 'FOX Sports' },
    ],
    fallbackLangs: ['en'],
  },
  'gold-cup': {
    contradictions: [
      'world cup', 'מונדיאל', 'מוקדמות המונדיאל',
      'nations league', 'ליגת האומות',
      'יורו', 'european championship', 'euro 2028', 'euro 2024',
      'copa américa', 'copa america', 'קופה אמריקה',
      'afcon', 'africa cup', 'גביע אפריקה',
      'concacaf nations league',
      'premier league', 'פרמייר ליג',
      'champions league', 'ליגת האלופות',
    ],
    // CONCACAF official channel (@concacaf) is the priority source: its
    // per-game upload is the right recap even when the title carries no
    // highlight wording (the highlight branding is on the thumbnail), so
    // any kept result stops the cascade and is exclusive (user decision
    // 2026-10-03; handle verified live — channel UCqn7r-so0mBLaJTtTms9dAQ).
    preferred: [{ handle: 'concacaf', lang: 'en' }],
    preferredStopRule: 'any',
    bulk: [
      { handle: 'sportsextra', label: 'SPORTS EXTRA' },
      { handle: 'foxsports', label: 'FOX Sports' },
    ],
    fallbackLangs: ['en'],
  },
  'concacaf-nations-league': {
    contradictions: [
      'world cup', 'מונדיאל', 'מוקדמות המונדיאל',
      // NB: bare 'nations league' is NOT used — it matches inside this,
      // competition's own name ("Concacaf Nations League").,
      'uefa nations league', 'ליגת האומות',
      'יורו', 'european championship', 'euro 2028', 'euro 2024',
      'copa américa', 'copa america', 'קופה אמריקה',
      'afcon', 'africa cup', 'גביע אפריקה',
      'gold cup', 'גביע הזהב',
      'premier league', 'פרמייר ליג',
      'champions league', 'ליגת האלופות',
    ],
    // CONCACAF official channel (@concacaf) is the priority source: its
    // per-game upload is the right recap even when the title carries no
    // highlight wording (the highlight branding is on the thumbnail), so
    // any kept result stops the cascade and is exclusive (user decision
    // 2026-10-03; handle verified live — channel UCqn7r-so0mBLaJTtTms9dAQ).
    preferred: [{ handle: 'concacaf', lang: 'en' }],
    preferredStopRule: 'any',
    bulk: [
      { handle: 'sportsextra', label: 'SPORTS EXTRA' },
      { handle: 'foxsports', label: 'FOX Sports' },
    ],
    fallbackLangs: ['en'],
  },
  'national-friendlies': {
    contradictions: [
      'world cup', 'מונדיאל', 'מוקדמות המונדיאל', 'qualifier', 'qualifiers',
      'nations league', 'ליגת האומות', 'concacaf nations league',
      'יורו', 'european championship', 'euro 2028', 'euro 2024',
      'copa américa', 'copa america', 'קופה אמריקה',
      'afcon', 'africa cup', 'גביע אפריקה',
      'gold cup', 'גביע הזהב',
      'premier league', 'פרמייר ליג', 'la liga', 'לה ליגה', 'serie a',
      'bundesliga', 'בונדסליגה', 'ligue 1', 'champions league', 'ליגת האלופות',
      'europa league', 'fa cup', 'copa del rey', 'ליגת העל',
    ],
    // 'friendly'/'ידידות' appear in every legitimate friendly title, so
    // the global excluded-category veto on them is waived for this
    // league (all other exclusions still apply).
    excludedWaivers: ['friendly', 'ידידות'],
    // General search Hebrew -> English. No Sport1 priority: Sport1 only
    // covers Israel friendlies and Israel plays very few of them (user,
    // 2026-10-02), so it is not worth stopping the cascade for. No curated
    // YouTube channels either: friendlies are too scattered across FA
    // channels to justify bulk scanning, and the narrow nation list keeps
    // volume low.
    preferred: [],
    bulk: [],
    fallbackLangs: ['he', 'en'],
  },
};

/** Unknown league slugs get English general search only. */
export function searchPlanFor(league: string): LeagueSearchPlan {
  return LEAGUE_SEARCH_PLANS[league] ?? { preferred: [], bulk: [], fallbackLangs: ['en'] };
}
