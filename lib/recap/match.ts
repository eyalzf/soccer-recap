import type { ClubEntry } from '../teams';
import { lookupClubEn } from '../teamIndex';
import type { GameInput, RawCandidate } from './types';
import { LEAGUE_SEARCH_PLANS } from './leaguePlans';

export const hasHebrew = (s: string): boolean => /[\u0590-\u05FF]/.test(s);

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalize Hebrew quote/niqqud variants before comparing a title against
 * our alias lists. Uploaders type abbreviations inconsistently: gershayim
 * (״) vs straight quote ("), geresh (׳) vs apostrophe, and occasional
 * niqqud (שׁ vs ש). Without this, "מכבי ת״א" never matches our "מכבי ת\"א".
 */
function normHeCompare(s: string): string {
  return s
    .replace(/[״"]/g, '"')
    .replace(/[׳'’‘`]/g, "'")
    .replace(/[֑-ׇ]/g, '');
}

/**
 * Index of an English name/alias variant in a lowercased title. Short
 * variants (<=6 chars) match on word boundaries only: "inter" must not
 * match inside "winter", "betis" inside "alphabetis", etc. Longer names are
 * distinctive enough for substring matching. -1 when absent.
 */
function enVariantIndex(t: string, vv: string): number {
  if (vv.length <= 6) {
    const m = t.match(new RegExp(`\\b${esc(vv)}\\b`));
    return m?.index ?? -1;
  }
  return t.indexOf(vv);
}

/** Does the title mention the club (any English/Hebrew spelling)? */
export function teamMentioned(title: string, club: ClubEntry): boolean {
  const t = title.toLowerCase();
  for (const v of [club.en, ...club.enAliases]) {
    const vv = v.toLowerCase().trim();
    if (!vv) continue;
    if (enVariantIndex(t, vv) >= 0) return true;
  }
  const th = normHeCompare(title);
  for (const v of [club.he, ...club.heAliases]) {
    if (v && th.includes(normHeCompare(v))) return true;
  }
  return false;
}

/** Earliest character index where the club is mentioned; Infinity if absent. */
export function mentionIndex(title: string, club: ClubEntry): number {
  let best = Infinity;
  const t = title.toLowerCase();
  for (const v of [club.en, ...club.enAliases]) {
    const i = enVariantIndex(t, v.toLowerCase());
    if (i >= 0 && i < best) best = i;
  }
  const th = normHeCompare(title);
  for (const v of [club.he, ...club.heAliases]) {
    if (!v) continue;
    const i = th.indexOf(normHeCompare(v));
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
  // Transfer news is never a recap.
  'transfer', 'העברות',
  // Compilations of older games, often published recently: the publish-date
  // filter cannot catch these, so reject them by title.
  'classic', 'classics', 'קלאסי', 'קלאסיקה',
  'best of', 'top 10', 'top10', 'מצעד',
  'history', 'היסטוריה', 'retro', 'רטרו', 'throwback',
  'season review',
  // Live streams / live broadcasts are not recaps.
  'שידור חי', 'שידור ישיר', 'לייב', 'livestream',
];

export function excludedCategory(title: string): string | null {
  const t = title.toLowerCase();
  for (const kw of EXCLUDED) {
    if (t.includes(kw.toLowerCase())) return kw;
  }
  // Standalone "live" (word boundary): catches "LIVE:", "(Live)", "live
  // stream" without false-positiving on substrings like "delivered".
  if (/\blive\b/.test(t)) return 'live';
  return null;
}

/**
 * Extract a scoreline like "2-1" / "2:1" from a title. Matches embedded in
 * longer digit runs are skipped: a season range like "2026-27" would
 * otherwise veto as score 26-27. The first remaining match wins, so
 * "UCL 2026-27: Real Madrid 2-1 Highlights" still yields (2,1).
 */
const SCORE_RE = /(?<!\d)(\d{1,2})\s*[-:–—]\s*(\d{1,2})(?!\d)/g;
export function extractScore(title: string): [number, number] | null {
  for (const m of title.matchAll(SCORE_RE)) {
    return [parseInt(m[1], 10), parseInt(m[2], 10)];
  }
  return null;
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

export const TRUSTED_YT_HANDLES: string[] = [
  ...new Set(
    Object.values(LEAGUE_SEARCH_PLANS)
      .flatMap((p) => p.preferred.map((s) => s.handle))
      .map((h) => h.toLowerCase().replace(/^@/, ''))
  ),
];

/** Preferred YouTube channels (see lib/recap/leaguePlans.ts). */

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

/** Handles of the curated bulk tier (uploads playlists scanned + matched
 * app-side), derived from the per-league plans. */
export const BULK_YT_HANDLES: string[] = [
  ...new Set(
    Object.values(LEAGUE_SEARCH_PLANS)
      .flatMap((p) => p.bulk.map((b) => b.handle ?? ''))
      .filter(Boolean)
      .map((h) => h.toLowerCase().replace(/^@/, ''))
  ),
];

/** Candidate came from a curated bulk channel (flagged at ingestion time). */
export function isBulkChannel(c: RawCandidate): boolean {
  return c.source === 'youtube' && c.bulk === true;
}

/** Title signals an actual highlights/recap video (not punditry or news). */
export function hasHighlightIntent(title: string): boolean {
  return /תקציר|highlights|סיכום|all goals|כל השערים|resumen/i.test(title);
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

  // The uploader disabled embedding: it would fail in our player.
  if (c.embeddable === false) return { keep: false, reason: 'not-embeddable' };

  // The uploader geo-blocked the video in Israel: it would fail playback here.
  if (c.blockedInIL === true) return { keep: false, reason: 'region-blocked' };

  // Generic search can return third-language videos (the query language
  // doesn't constrain the results). Exclude videos the uploader tagged as
  // neither Hebrew nor English; untagged videos fail open.
  if (c.audioLang) {
    const lang = c.audioLang.toLowerCase().split('-')[0];
    if (lang !== 'he' && lang !== 'iw' && lang !== 'en')
      return { keep: false, reason: 'language' };
  }

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
