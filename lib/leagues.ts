export type LeagueSlug =
  | 'premier-league'
  | 'la-liga'
  | 'israeli-league'
  | 'champions-league';

export interface LeagueDef {
  slug: LeagueSlug;
  hebrewName: string;
  sportsdbId: string;
}

export const LEAGUES: LeagueDef[] = [
  { slug: 'premier-league', hebrewName: 'פרמייר ליג', sportsdbId: '4328' },
  { slug: 'la-liga', hebrewName: 'לה ליגה', sportsdbId: '4335' },
  { slug: 'israeli-league', hebrewName: 'ליגת העל', sportsdbId: '4644' },
  { slug: 'champions-league', hebrewName: 'ליגת האלופות', sportsdbId: '4480' },
];

export function getLeague(slug: string): LeagueDef | undefined {
  return LEAGUES.find((l) => l.slug === slug);
}
