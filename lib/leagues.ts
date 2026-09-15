export type LeagueSlug =
  | 'premier-league'
  | 'la-liga'
  | 'israeli-league'
  | 'champions-league';

export interface LeagueDef {
  slug: LeagueSlug;
  hebrewName: string;
  /** SportScore competition slug (verified live) */
  sportscoreSlug: string;
  /** Static competition logo URL (SportScore CDN) */
  badge: string;
}

export const LEAGUES: LeagueDef[] = [
  { slug: 'premier-league', hebrewName: 'פרמייר ליג', sportscoreSlug: 'english-premier-league', badge: 'https://img.thesports.com/football/competition/3549f192c75cbc737a05fd51ecad383e.png' },
  { slug: 'la-liga', hebrewName: 'לה ליגה', sportscoreSlug: 'spanish-la-liga', badge: 'https://img.thesports.com/football/competition/1fbbb4be3b47d9465c5badecc3122e07.png' },
  { slug: 'israeli-league', hebrewName: 'ליגת העל', sportscoreSlug: 'israel-premier-league', badge: 'https://img.thesports.com/football/competition/acaae7840e78337f1fcdffd3430e4205.png' },
  { slug: 'champions-league', hebrewName: 'ליגת האלופות', sportscoreSlug: 'uefa-champions-league', badge: 'https://img.thesports.com/football/competition/ac05535bde17129cb598311242b3afba.png' },
];

export function getLeague(slug: string): LeagueDef | undefined {
  return LEAGUES.find((l) => l.slug === slug);
}
