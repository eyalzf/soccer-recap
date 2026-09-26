/**
 * Per-league YouTube search plans.
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
      // Team-scoped: only scanned for their own club's games.
      { channelId: 'UC-oWQqnf8B8a_TsmVi0mTUg', label: 'Maccabi Tel Aviv FC', teams: ['Maccabi Tel Aviv'] },
      { handle: 'mhfootballclub', label: 'Maccabi Haifa', teams: ['Maccabi Haifa'] },
      { handle: 'HapoelTelAvivFC', label: 'Hapoel Tel Aviv', teams: ['Hapoel Tel Aviv'] },
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
    preferred: [{ handle: 'one-1004', lang: 'he' }],
    bulk: [
      { handle: 'laliga', label: 'LaLiga official' },
      { handle: 'FCBarcelona', label: 'FC Barcelona', teams: ['Barcelona'] },
      { handle: 'realmadrid', label: 'Real Madrid', teams: ['Real Madrid'] },
      { handle: 'atleticodemadrid', label: 'Atletico Madrid', teams: ['Atletico Madrid'] },
      { handle: 'villarrealcf', label: 'Villarreal CF', teams: ['Villarreal'] },
      // Real Betis: legacy user URL; handle unconfirmed.
      { channelId: 'UCeB7JZwcar2fVoK2w2f9OwA', label: 'Real Betis', teams: ['Real Betis'] },
      { handle: 'ESPNFC', label: 'ESPN FC' },
      // Club channels verified in the 2026-09-17 curation round (language
      // veto lifted for curated tiers; press-conference exclusion added).
      // Team-scoped: only scanned for their own club's games.
      { handle: 'AthleticClubTV', label: 'Athletic Club', teams: ['Athletic Club'] },
      { handle: 'GetafeCFmedia', label: 'Getafe CF', teams: ['Getafe'] },
      { handle: 'realsociedadtv', label: 'Real Sociedad', teams: ['Real Sociedad'] },
      // Celta: handle unconfirmed; use the verified channel ID.
      { channelId: 'UCCJLVZYqRb_85b2Flpg04cg', label: 'RC Celta', teams: ['Celta'] },
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
      { handle: 'realmadrid', label: 'Real Madrid', teams: ['Real Madrid'] },
      { handle: 'FCBarcelona', label: 'FC Barcelona', teams: ['Barcelona'] },
      { handle: 'LiverpoolFC', label: 'Liverpool', teams: ['Liverpool'] },
      { handle: 'Arsenal', label: 'Arsenal', teams: ['Arsenal'] },
      { handle: 'ManCity', label: 'Man City', teams: ['Manchester City'] },
      { handle: 'Inter', label: 'Inter', teams: ['Inter'] },
      { handle: 'FCBayern', label: 'Bayern', teams: ['Bayern Munich'] },
      { handle: 'BVB', label: 'Dortmund', teams: ['Borussia Dortmund'] },
      { handle: 'atleticodemadrid', label: 'Atletico Madrid', teams: ['Atletico Madrid'] },
      { handle: 'Juventus', label: 'Juventus', teams: ['Juventus'] },
      { handle: 'ChelseaFC', label: 'Chelsea', teams: ['Chelsea'] },
      { handle: 'PSG', label: 'PSG', teams: ['Paris Saint-Germain'] },
      { handle: 'SLBenfica', label: 'Benfica', teams: ['Benfica'] },
      { handle: 'AFCAjax', label: 'Ajax', teams: ['Ajax'] },
      // Club channels verified in the 2026-09-17 curation round (language
      // veto lifted for curated tiers; press-conference exclusion added).
      // Team-scoped: only scanned for their own club's games.
      { handle: 'SportingCP', label: 'Sporting CP', teams: ['Sporting CP'] },
      { handle: 'PSV', label: 'PSV Eindhoven', teams: ['PSV Eindhoven'] },
      { handle: 'clubbrugge', label: 'Club Brugge', teams: ['Club Brugge'] },
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
    preferred: [],
    bulk: [
      // User-verified 2026-09-17: @skysportspremierleague is the active
      // channel (the old 'SkySportsPL' handle resolves to a near-dead one).
      { handle: 'skysportspremierleague', label: 'Sky Sports Premier League' },
      { handle: 'mancity', label: 'Man City', teams: ['Manchester City'] },
      { handle: 'manutd', label: 'Man Utd', teams: ['Manchester United'] },
      { handle: 'Arsenal', label: 'Arsenal', teams: ['Arsenal'] },
      { handle: 'LiverpoolFC', label: 'Liverpool', teams: ['Liverpool'] },
      { handle: 'chelseafc', label: 'Chelsea', teams: ['Chelsea'] },
      // Club channels verified in the 2026-09-17 curation round.
      // Team-scoped: only scanned for their own club's games.
      { handle: 'tottenhamhotspur', label: 'Tottenham Hotspur', teams: ['Tottenham Hotspur'] },
      { handle: 'sunderlandafc', label: 'Sunderland AFC', teams: ['Sunderland'] },
      { handle: 'NottinghamForestFC', label: 'Nottingham Forest', teams: ['Nottingham Forest'] },
      { handle: 'avfcofficial', label: 'Aston Villa', teams: ['Aston Villa'] },
      // Leeds / Bournemouth: handles unconfirmed; use verified channel IDs.
      { channelId: 'UCRHkt-FUeYUG-ybo1Koh2WA', label: 'Leeds United', teams: ['Leeds United'] },
      { channelId: 'UCeOCuVSSweaEj6oVtJZEKQw', label: 'AFC Bournemouth', teams: ['Bournemouth'] },
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
    // No Hebrew priority channel could be verified for the Nations League
    // (the Austria 3-1 Israel recap's uploader is unknown).
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
    // No Hebrew priority channel could be verified for the Gold Cup.
    preferred: [],
    bulk: [
      // CONCACAF official channel: classic youtube.com/concacaf URL is
      // verified via official Gold Cup highlight video descriptions
      // (per-match "Extended Highlights"). Israel geo-blocking unverified.
      // TODO(verify): confirm the @handle resolves.
      { handle: 'concacaf', label: 'CONCACAF' },
      { handle: 'sportsextra', label: 'SPORTS EXTRA' },
      { handle: 'foxsports', label: 'FOX Sports' },
    ],
    fallbackLangs: ['en'],
  },
  'concacaf-nations-league': {
    // No Hebrew priority channel could be verified.
    preferred: [],
    bulk: [
      { handle: 'concacaf', label: 'CONCACAF' },
      { handle: 'sportsextra', label: 'SPORTS EXTRA' },
      { handle: 'foxsports', label: 'FOX Sports' },
    ],
    fallbackLangs: ['en'],
  },
};

/** Unknown league slugs get English general search only. */
export function searchPlanFor(league: string): LeagueSearchPlan {
  return LEAGUE_SEARCH_PLANS[league] ?? { preferred: [], bulk: [], fallbackLangs: ['en'] };
}
