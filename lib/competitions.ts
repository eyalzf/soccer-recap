/**
 * Competitions of the "leading teams" view (קבוצות מובילות, user feature
 * 2026-10-26): a fixed list of leading clubs from leagues the app does
 * not carry as pills (Bayern, Dortmund, Inter, Milan, Juventus, PSG,
 * Sporting CP, Ajax, Celtic; Roma and Inter Miami added 2026-10-27). Their games live in
 * data/leading-teams.json under the synthetic league slug 'leading-teams'
 * and each game carries a `competition` slug from this registry; the UI
 * chip composes "<competition label> · <round>" from it.
 *
 * The matcher treats a competition game exactly like a cup game (see
 * lib/cups.ts): the game's own competition terms are expected, and the
 * titles naming any OTHER competition — another registry competition,
 * or one of the carried leagues/cups — are contradictions. Games are
 * added by the daily fixtures update only when they are not already
 * listed under another league pill (dedupe on date + teams), and the
 * Champions League is never assigned here: it belongs to its own pill.
 *
 * Contradictions are computed: every other competition's terms plus the
 * carried competitions' terms below. Pure data, no imports.
 */
export interface CompetitionDef {
  slug: string;
  /** The synthetic parent league slug these games are filed under. */
  parent: 'leading-teams';
  /** Hebrew label shown in the game-card chip. */
  labelHe: string;
  /** Title terms naming this competition (lowercase substrings). */
  terms: string[];
}

/** Terms of the competitions the app carries as their own pills/files.
 * A leading-teams title naming one of these belongs to that pill's game,
 * never to this view. */
export const CARRIED_COMPETITION_TERMS: string[] = [
  'premier league', 'פרמייר ליג',
  'la liga', 'לה ליגה',
  'champions league', 'ליגת האלופות',
  'ligat haal', 'ליגת העל',
  'fa cup', 'גביע אנגלי', 'הגביע האנגלי',
  'efl cup', 'carabao', 'גביע הליגה האנגלי',
  'copa del rey', 'גביע המלך',
  'state cup', 'גביע המדינה',
];

export const COMPETITIONS: CompetitionDef[] = [
  {
    slug: 'bundesliga',
    parent: 'leading-teams',
    labelHe: 'בונדסליגה',
    terms: ['bundesliga', 'בונדסליגה'],
  },
  {
    slug: 'dfb-pokal',
    parent: 'leading-teams',
    labelHe: 'גביע גרמני',
    terms: ['dfb-pokal', 'dfb pokal', 'dfb cup', 'גביע גרמני'],
  },
  {
    slug: 'serie-a',
    parent: 'leading-teams',
    labelHe: "סרייה א'",
    terms: ['serie a', "סרייה א'"],
  },
  {
    slug: 'coppa-italia',
    parent: 'leading-teams',
    labelHe: 'גביע איטלקי',
    terms: ['coppa italia', 'גביע איטלקי'],
  },
  {
    slug: 'ligue-1',
    parent: 'leading-teams',
    labelHe: 'ליג 1',
    terms: ['ligue 1', 'ליג 1'],
  },
  {
    slug: 'coupe-de-france',
    parent: 'leading-teams',
    labelHe: 'גביע צרפתי',
    terms: ['coupe de france', 'גביע צרפתי'],
  },
  {
    slug: 'primeira-liga',
    parent: 'leading-teams',
    labelHe: 'ליגה פורטוגלית',
    terms: ['primeira liga', 'liga portugal', 'ליגה פורטוגלית'],
  },
  {
    slug: 'taca-de-portugal',
    parent: 'leading-teams',
    labelHe: 'גביע פורטוגלי',
    terms: ['taça de portugal', 'taca de portugal', 'taça', 'גביע פורטוגלי'],
  },
  {
    slug: 'eredivisie',
    parent: 'leading-teams',
    labelHe: 'ליגה הולנדית',
    terms: ['eredivisie', 'ליגה הולנדית'],
  },
  {
    slug: 'knvb-cup',
    parent: 'leading-teams',
    labelHe: 'גביע הולנדי',
    terms: ['knvb', 'גביע הולנדי'],
  },
  {
    slug: 'scottish-premiership',
    parent: 'leading-teams',
    labelHe: 'ליגה סקוטית',
    terms: ['scottish premiership', 'william hill premiership', 'premiership', 'ליגה סקוטית'],
  },
  {
    slug: 'scottish-cup',
    parent: 'leading-teams',
    labelHe: 'גביע סקוטי',
    terms: ['scottish cup', 'גביע סקוטי'],
  },
  {
    slug: 'scottish-league-cup',
    parent: 'leading-teams',
    labelHe: 'גביע הליגה הסקוטי',
    terms: ['premier sports cup', 'scottish league cup', 'גביע הליגה הסקוטי'],
  },
  {
    slug: 'europa-league',
    parent: 'leading-teams',
    labelHe: 'ליגה אירופית',
    terms: ['europa league', 'ליגה אירופית'],
  },
  {
    slug: 'conference-league',
    parent: 'leading-teams',
    labelHe: 'קונפרנס ליג',
    terms: ['conference league', 'קונפרנס ליג'],
  },
  {
    // Inter Miami's competitions (added 2026-10-27). MLS playoffs are
    // filed under 'mls' too — the round lives in the game's stage label.
    slug: 'mls',
    parent: 'leading-teams',
    labelHe: 'MLS',
    terms: ['mls', 'major league soccer'],
  },
  {
    slug: 'leagues-cup',
    parent: 'leading-teams',
    labelHe: 'גביע הליגות',
    terms: ['leagues cup', 'גביע הליגות'],
  },
  {
    slug: 'concacaf-champions-cup',
    parent: 'leading-teams',
    labelHe: 'ליגת האלופות של CONCACAF',
    terms: ['concacaf champions cup', 'concacaf champions', 'champions cup', 'ליגת האלופות של CONCACAF'],
  },
  {
    slug: 'campeones-cup',
    parent: 'leading-teams',
    labelHe: 'גביע הקמפאונס',
    terms: ['campeones cup', 'campeones', 'גביע הקמפאונס'],
  },
];

const BY_SLUG = new Map(COMPETITIONS.map((c) => [c.slug, c]));

export function competitionDefFor(slug: string | null | undefined): CompetitionDef | null {
  if (!slug) return null;
  return BY_SLUG.get(slug) ?? null;
}

export function competitionLabelHe(slug: string | null | undefined): string | null {
  return competitionDefFor(slug)?.labelHe ?? null;
}

/**
 * Matcher config for one competition: the competition's own terms are
 * expected; every other registered competition's terms, plus the carried
 * competitions' terms, contradict. A competition's own terms are never
 * its own contradiction (overlaps like 'taça' are kept out of other
 * competitions' lists by construction).
 */
export function competitionContradictions(def: CompetitionDef): string[] {
  const own = new Set(def.terms);
  const out: string[] = [];
  for (const other of COMPETITIONS) {
    if (other.slug === def.slug) continue;
    for (const t of other.terms) if (!own.has(t)) out.push(t);
  }
  for (const t of CARRIED_COMPETITION_TERMS) if (!own.has(t)) out.push(t);
  return out;
}
