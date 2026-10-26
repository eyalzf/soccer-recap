/**
 * Domestic cup competitions (user decision 2026-10-26).
 *
 * Cup games live INSIDE their parent league's data file and listing —
 * no separate league pill — distinguished by a `cup` slug on the game
 * entry and a trophy chip in the UI. Only ties involving at least one
 * club from the parent league's top flight are ever added (the daily
 * fixtures update applies that filter), which keeps obscure
 * lower-division ties out and focuses the set on games with real
 * recap coverage.
 *
 * Matching: a cup game reuses its parent league's whole search plan
 * (channels, tiers, fallbacks) EXCEPT the competition logic, which
 * flips — the game's own cup terms become the expected competition
 * and everything else (the parent league itself, the sibling cups,
 * European competitions) becomes a contradiction. The parent plans
 * already list these cup terms as contradictions for league games,
 * so a league fixture and a cup tie between the same pair in the
 * same week can never cross-match each other's recaps.
 *
 * Pure data — imported by the matcher config (lib/recap/leaguePlans)
 * and by client components (chip labels). No imports of its own.
 */
export interface CupDef {
  /** Slug stored on the game entry's `cup` field. */
  slug: string;
  /** Parent league slug — the data file / listing the cup lives in. */
  parentLeague: string;
  /** Hebrew display label for the UI chip. */
  labelHe: string;
  /** Competition-name variants that mark a title as THIS cup. */
  competitionTerms: string[];
  /** Competition-name variants that must NOT appear in a recap title
   *  for a game in this cup (parent league, sibling cups, Europe). */
  contradictions: string[];
}

export const CUPS: Record<string, CupDef> = {
  'fa-cup': {
    slug: 'fa-cup',
    parentLeague: 'premier-league',
    labelHe: 'גביע אנגלי',
    competitionTerms: ['fa cup', 'גביע אנגלי', 'הגביע האנגלי', 'emirates fa cup'],
    contradictions: [
      'premier league', 'פרמייר ליג', 'פרמיירליג',
      'carabao', 'efl cup', 'league cup', 'גביע הליגה',
      'champions league', 'ליגת האלופות', 'europa league', 'הליגה האירופית',
      'conference league', 'community shield', 'מגן הקהילה',
    ],
  },
  'efl-cup': {
    slug: 'efl-cup',
    parentLeague: 'premier-league',
    labelHe: 'גביע הליגה האנגלי',
    competitionTerms: ['carabao', 'efl cup', 'league cup', 'גביע הליגה האנגלי', 'carabao cup'],
    contradictions: [
      'premier league', 'פרמייר ליג', 'פרמיירליג',
      'fa cup', 'גביע אנגלי', 'הגביע האנגלי',
      'champions league', 'ליגת האלופות', 'europa league', 'הליגה האירופית',
      'conference league', 'community shield', 'מגן הקהילה',
    ],
  },
  'copa-del-rey': {
    slug: 'copa-del-rey',
    parentLeague: 'la-liga',
    labelHe: 'גביע המלך',
    competitionTerms: ['copa del rey', 'גביע המלך', "king's cup", 'copa de su majestad'],
    contradictions: [
      'la liga', 'לה ליגה', 'הליגה הספרדית',
      'supercopa', 'סופר קאפ', 'סופרקופה',
      'champions league', 'ליגת האלופות', 'europa league', 'הליגה האירופית',
      'conference league',
    ],
  },
  'state-cup': {
    slug: 'state-cup',
    parentLeague: 'israeli-league',
    labelHe: 'גביע המדינה',
    competitionTerms: ['גביע המדינה', 'state cup', 'israel state cup'],
    contradictions: [
      'ליגת העל', 'ligat haal',
      'גביע הטוטו', 'toto cup',
      'champions league', 'ליגת האלופות', 'conference league', 'קונפרנס ליג',
      'europa league', 'הליגה האירופית',
    ],
  },
};

export function cupDefFor(slug: string | null | undefined): CupDef | null {
  if (!slug) return null;
  return CUPS[slug] ?? null;
}

/** Hebrew chip label for a cup slug (null for league games). */
export function cupLabelHe(slug: string | null | undefined): string | null {
  return cupDefFor(slug)?.labelHe ?? null;
}
