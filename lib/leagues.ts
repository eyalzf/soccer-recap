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
