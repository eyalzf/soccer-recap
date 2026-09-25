export type LeagueSlug =
  | 'premier-league'
  | 'la-liga'
  | 'israeli-league'
  | 'champions-league';

export interface LeagueDef {
  slug: LeagueSlug;
  hebrewName: string;
  /** FotMob league id used by the parse.bot listings pipeline (verified live) */
  parsebotId: number;
  /** Static competition logo URL (FotMob image CDN) */
  badge: string;
}

const LEAGUE_LOGO = (id: number) =>
  `https://images.fotmob.com/image_resources/logo/leaguelogo/${id}.png`;

export const LEAGUES: LeagueDef[] = [
  { slug: 'premier-league', hebrewName: 'פרמייר ליג', parsebotId: 47, badge: LEAGUE_LOGO(47) },
  { slug: 'la-liga', hebrewName: 'לה ליגה', parsebotId: 87, badge: LEAGUE_LOGO(87) },
  { slug: 'israeli-league', hebrewName: 'ליגת העל', parsebotId: 127, badge: LEAGUE_LOGO(127) },
  { slug: 'champions-league', hebrewName: 'ליגת האלופות', parsebotId: 42, badge: LEAGUE_LOGO(42) },
];

export function getLeague(slug: string): LeagueDef | undefined {
  return LEAGUES.find((l) => l.slug === slug);
}

// ---------------------------------------------------------------------------
// National teams (נבחרות)
// ---------------------------------------------------------------------------

export type NationalCompetitionSlug =
  | 'world-cup'
  | 'euros'
  | 'copa-america'
  | 'nations-league';

export interface NationalCompetitionDef {
  slug: NationalCompetitionSlug;
  hebrewName: string;
  /** No FotMob league-logo equivalent; chips render text-only for now. */
  badge: string | null;
}

export const NATIONAL_COMPETITIONS: NationalCompetitionDef[] = [
  { slug: 'world-cup', hebrewName: 'מונדיאל', badge: null },
  { slug: 'euros', hebrewName: 'יורו', badge: null },
  { slug: 'copa-america', hebrewName: 'קופה אמריקה', badge: null },
  { slug: 'nations-league', hebrewName: 'ליגת האומות', badge: null },
];

export function getNationalCompetition(
  slug: string
): NationalCompetitionDef | undefined {
  return NATIONAL_COMPETITIONS.find((c) => c.slug === slug);
}

/** True for the four national-competition slugs (vs the club league slugs). */
export function isNationalSlug(slug: string): boolean {
  return NATIONAL_COMPETITIONS.some((c) => c.slug === slug);
}
