export type LeagueSlug =
  | 'premier-league'
  | 'la-liga'
  | 'israeli-league'
  | 'champions-league';

export interface LeagueDef {
  slug: LeagueSlug;
  hebrewName: string;
  /** Sofascore unique-tournament id */
  sofascoreUtid: number;
  /** Last-known current season id; used only if the live season lookup fails */
  sofascoreSeasonId: number;
}

export const LEAGUES: LeagueDef[] = [
  { slug: 'premier-league', hebrewName: 'פרמייר ליג', sofascoreUtid: 17, sofascoreSeasonId: 96668 },
  { slug: 'la-liga', hebrewName: 'לה ליגה', sofascoreUtid: 8, sofascoreSeasonId: 97268 },
  { slug: 'israeli-league', hebrewName: 'ליגת העל', sofascoreUtid: 266, sofascoreSeasonId: 96740 },
  { slug: 'champions-league', hebrewName: 'ליגת האלופות', sofascoreUtid: 7, sofascoreSeasonId: 96518 },
];

export function getLeague(slug: string): LeagueDef | undefined {
  return LEAGUES.find((l) => l.slug === slug);
}
