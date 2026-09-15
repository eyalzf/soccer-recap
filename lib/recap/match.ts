import type { ClubEntry } from '../teams';
import { lookupClubEn } from '../teamIndex';
import type { GameInput, RawCandidate } from './types';

export const hasHebrew = (s: string): boolean => /[\u0590-\u05FF]/.test(s);

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Does the title mention the club (any English/Hebrew spelling)? */
export function teamMentioned(title: string, club: ClubEntry): boolean {
  const t = title.toLowerCase();
  for (const v of [club.en, ...club.enAliases]) {
    const vv = v.toLowerCase().trim();
    if (!vv) continue;
    if (vv.length <= 4) {
      if (new RegExp(`\\b${esc(vv)}\\b`).test(t)) return true;
    } else if (t.includes(vv)) {
      return true;
    }
  }
  for (const v of [club.he, ...club.heAliases]) {
    if (v && title.includes(v)) return true;
  }
  return false;
}

/** Earliest character index where the club is mentioned; Infinity if absent. */
export function mentionIndex(title: string, club: ClubEntry): number {
  let best = Infinity;
  const t = title.toLowerCase();
  for (const v of [club.en, ...club.enAliases]) {
    const i = t.indexOf(v.toLowerCase());
    if (i >= 0 && i < best) best = i;
  }
  for (const v of [club.he, ...club.heAliases]) {
    if (!v) continue;
    const i = title.indexOf(v);
    if (i >= 0 && i < best) best = i;
  }
  return best;
}

// Competition keywords that CONTRADICT the game's league -> reject the result.
const CONTRADICTIONS: Record<string, string[]> = {
  'premier-league': [
    'fa cup', 'גביע אנגלי', 'גביע האנגלי', 'carabao', 'efl cup',
    'champions league', 'ליגת האלופות', 'europa league', 'הליגה האירופית',
    'community shield',
  ],
  'la-liga': [
    'copa del rey', 'גביע המלך', 'supercopa', 'סופר קאפ',
    'champions league', 'ליגת האלופות', 'europa league', 'הליגה האירופית',
  ],
  'israeli-league': [
    'גביע המדינה', 'גביע הטוטו', 'state cup', 'toto cup',
    'champions league', 'ליגת האלופות', 'conference league', 'קונפרנס ליג',
  ],
  'champions-league': [
    'premier league', 'פרמייר ליג', 'la liga', 'לה ליגה', 'ligue 1',
    'serie a', 'סרייה א', 'bundesliga', 'בונדסליגה', 'fa cup', 'גביע אנגלי',
    'copa del rey', 'גביע המלך', 'eredivisie', 'ליגת העל',
  ],
};

export function competitionContradiction(title: string, league: string): string | null {
  const t = title.toLowerCase();
  for (const kw of CONTRADICTIONS[league] ?? []) {
    if (kw && t.includes(kw.toLowerCase())) return kw;
  }
  return null;
}

const EXCLUDED = [
  'women', 'wsl', 'נשים', 'נשית',
  'u19', 'u21', 'u23', 'u-19', 'u-21', 'youth', 'נוער', 'נערים',
  'legends', 'אגדות',
  'preview', 'לקראת', 'press conference', 'מסיבת עיתונאים',
  'friendly', 'ידידות',
  // Compilations of older games, often published recently: the publish-date
  // filter cannot catch these, so reject them by title.
  'classic', 'classics', 'קלאסי', 'קלאסיקה',
  'best of', 'top 10', 'top10', 'מצעד',
  'history', 'היסטוריה', 'retro', 'רטרו', 'throwback',
];

export function excludedCategory(title: string): string | null {
  const t = title.toLowerCase();
  for (const kw of EXCLUDED) {
    if (t.includes(kw.toLowerCase())) return kw;
  }
  return null;
}

/** Extract a scoreline like "2-1" / "2:1" from a title. */
export function extractScore(title: string): [number, number] | null {
  const m = title.match(/(\d{1,2})\s*[-:–—]\s*(\d{1,2})/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10)];
}

export type Proximity = 'ok' | 'near' | 'bad' | 'undated';

export function dateProximity(publishedAt: string | undefined, gameISO: string): Proximity {
  if (!publishedAt) return 'undated';
  const p = Date.parse(publishedAt);
  const g = Date.parse(gameISO);
  if (Number.isNaN(p) || Number.isNaN(g)) return 'undated';
  const days = Math.abs(p - g) / 86400000;
  if (days <= 2.5) return 'ok';
  if (days <= 6) return 'near';
  return 'bad';
}

export const TRUSTED_YT_HANDLES = ['ipflofficial', 'one-1004'];

/** Trusted Hebrew sources: official IPFL / ONE YouTube channels, Sport1/Sport5/ONE sites. */
export function isTrusted(c: RawCandidate): boolean {
  if (c.source !== 'youtube') return true;
  const h = (c.channelHandle || '').toLowerCase().replace(/^@/, '');
  if (TRUSTED_YT_HANDLES.includes(h)) return true;
  const name = (c.channelName || '').toLowerCase();
  return name.includes('ipfl') || name === 'one';
}

/** Preferred YouTube channels only (IPFL / ONE): when these have results for
 *  a game, everything else is excluded as lower quality. */
export function isPreferredChannel(c: RawCandidate): boolean {
  return c.source === 'youtube' && isTrusted(c);
}

export interface FilterResult {
  keep: boolean;
  reason: string;
}

/**
 * Simplified matching: both teams + date are the primary identifiers.
 * Score is a signal with two vetoes; competition contradictions are rejected.
 */
export function filterCandidate(c: RawCandidate, game: GameInput): FilterResult {
  const home = lookupClubEn(game.home);
  const away = lookupClubEn(game.away);
  if (!home || !away) return { keep: false, reason: 'unknown-team' };

  if (!teamMentioned(c.title, home) || !teamMentioned(c.title, away)) {
    return { keep: false, reason: 'teams' };
  }

  const contra = competitionContradiction(c.title, game.league);
  if (contra) return { keep: false, reason: 'competition' };

  const excl = excludedCategory(c.title);
  if (excl) return { keep: false, reason: 'excluded' };

  const prox = dateProximity(c.publishedAt, game.dateISO);
  if (prox === 'bad') return { keep: false, reason: 'date' };

  const sc = extractScore(c.title);
  const hs = game.homeScore;
  const as = game.awayScore;
  if (sc && hs != null && as != null) {
    const [a, b] = sc;
    const matchesEither = (a === hs && b === as) || (a === as && b === hs);
    if (!matchesEither) return { keep: false, reason: 'score' }; // veto (a)
    // Veto (b): home listed first + reversed digits + untrusted + undated.
    const homeFirst = mentionIndex(c.title, home) <= mentionIndex(c.title, away);
    if (homeFirst && a === as && b === hs && !isTrusted(c) && prox === 'undated') {
      return { keep: false, reason: 'score-reversed' };
    }
  }

  return { keep: true, reason: 'ok' };
}
