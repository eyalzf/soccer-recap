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
  | 'nations-league'
  | 'afcon'
  | 'gold-cup'
  | 'concacaf-nations-league';

export interface NationalCompetitionDef {
  slug: NationalCompetitionSlug;
  hebrewName: string;
  /** Official competition logo (Wikimedia; verified HTTP 200). */
  badge: string | null;
}

export const NATIONAL_COMPETITIONS: NationalCompetitionDef[] = [
  {
    slug: 'world-cup',
    hebrewName: 'מונדיאל',
    badge:
      'https://commons.wikimedia.org/wiki/Special:FilePath/2026%20FIFA%20World%20Cup%20emblem.svg',
  },
  {
    slug: 'euros',
    hebrewName: 'יורו',
    badge:
      'https://en.wikipedia.org/wiki/Special:FilePath/UEFA_Euro_2028_Logo.svg',
  },
  {
    slug: 'copa-america',
    hebrewName: 'קופה אמריקה',
    badge:
      'https://commons.wikimedia.org/wiki/Special:FilePath/Conmebol%20Copa%20America%202024%20Logo.svg',
  },
  {
    slug: 'nations-league',
    hebrewName: 'ליגת האומות',
    badge:
      'https://en.wikipedia.org/wiki/Special:FilePath/UEFA_Nations_League.svg',
  },
  {
    slug: 'afcon',
    hebrewName: 'גביע אפריקה',
    badge:
      'https://en.wikipedia.org/wiki/Special:FilePath/2025_Africa_Cup_of_Nations_logo.svg',
  },
  {
    slug: 'gold-cup',
    hebrewName: 'גביע הזהב',
    badge:
      'https://commons.wikimedia.org/wiki/Special:FilePath/CONCACAF_-_Gold_Cup.svg',
  },
  {
    slug: 'concacaf-nations-league',
    hebrewName: 'ליגת האומות (צפון אמריקה)',
    badge:
      'https://en.wikipedia.org/wiki/Special:FilePath/CONCACAF_Nations_League_(2026).svg',
  },
];

export function getNationalCompetition(
  slug: string
): NationalCompetitionDef | undefined {
  return NATIONAL_COMPETITIONS.find((c) => c.slug === slug);
}

/** True for the national-competition slugs (vs the club league slugs). */
export function isNationalSlug(slug: string): boolean {
  return NATIONAL_COMPETITIONS.some((c) => c.slug === slug);
}
