import { CLUBS, type ClubEntry } from '../teams';
import { NATIONS } from '../nations';
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
 * Multi-word English variants of every club, used to disambiguate short
 * aliases: "United" is a fine alias for Manchester United, but inside
 * "Leeds United" it refers to Leeds. A short-alias match that falls inside
 * another club's multi-word name is attributed to that club, not ours.
 */
const MULTIWORD_VARIANTS: Array<{ club: ClubEntry; text: string }> = [];
for (const club of [...CLUBS, ...NATIONS]) {
  for (const v of [club.en, ...club.enAliases]) {
    const vv = v.toLowerCase().trim();
    if (vv.includes(' ')) MULTIWORD_VARIANTS.push({ club, text: vv });
  }
}

/** Spans in the title covered by multi-word names of clubs other than `club`. */
function otherClubSpans(t: string, club: ClubEntry): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const { club: other, text } of MULTIWORD_VARIANTS) {
    if (other === club) continue;
    let from = 0;
    for (;;) {
      const i = t.indexOf(text, from);
      if (i < 0) break;
      spans.push([i, i + text.length]);
      from = i + 1;
    }
  }
  return spans;
}

function insideSpans(idx: number, len: number, spans: Array<[number, number]>): boolean {
  return spans.some(([s, e]) => idx >= s && idx + len <= e);
}

/**
 * Index of an English name/alias variant in a lowercased title. Short
 * variants (<=6 chars) match on word boundaries only: "inter" must not
 * match inside "winter", "betis" inside "alphabetis", etc. Longer names are
 * distinctive enough for substring matching. A match covered by another
 * club's multi-word name ("united" inside "leeds united") is skipped.
 * -1 when absent.
 */
function enVariantIndex(t: string, vv: string, spans: Array<[number, number]>): number {
  if (vv.length <= 6) {
    for (const m of t.matchAll(new RegExp(`\\b${esc(vv)}\\b`, 'g'))) {
      const i = m.index ?? -1;
      if (i >= 0 && !insideSpans(i, vv.length, spans)) return i;
    }
    return -1;
  }
  const i = t.indexOf(vv);
  return i >= 0 && !insideSpans(i, vv.length, spans) ? i : -1;
}

/** Does the title mention the club (any English/Hebrew spelling)? */
export function teamMentioned(title: string, club: ClubEntry): boolean {
  const t = title.toLowerCase();
  const spans = otherClubSpans(t, club);
  for (const v of [club.en, ...club.enAliases]) {
    const vv = v.toLowerCase().trim();
    if (!vv) continue;
    if (enVariantIndex(t, vv, spans) >= 0) return true;
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
  const spans = otherClubSpans(t, club);
  for (const v of [club.en, ...club.enAliases]) {
    const i = enVariantIndex(t, v.toLowerCase(), spans);
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
  // National-team competitions: club competitions contradict, as do the
  // other national competitions. NB: bare 'euro' is NOT used — it matches
  // inside 'europe'/'european qualifiers' (e.g. "World Cup European
  // Qualifiers"). 'יורו' and 'european championship' are safe.
  'nations-league': [
    'world cup', 'מונדיאל', 'מוקדמות המונדיאל',
    'יורו', 'european championship', 'euro 2028', 'euro 2024',
    'copa américa', 'copa america', 'קופה אמריקה',
    'afcon', 'africa cup', 'גביע אפריקה',
    'gold cup', 'גביע הזהב', 'concacaf nations league',
    'premier league', 'פרמייר ליג', 'la liga', 'לה ליגה', 'serie a',
    'bundesliga', 'בונדסליגה', 'ligue 1', 'champions league', 'ליגת האלופות',
    'europa league', 'fa cup', 'copa del rey', 'ליגת העל',
  ],
  'world-cup': [
    'nations league', 'ליגת האומות',
    'יורו', 'european championship', 'euro 2028', 'euro 2024',
    'copa américa', 'copa america', 'קופה אמריקה',
    'afcon', 'africa cup', 'גביע אפריקה',
    'gold cup', 'גביע הזהב', 'concacaf nations league',
    'premier league', 'פרמייר ליג', 'la liga', 'לה ליגה',
    'champions league', 'ליגת האלופות', 'europa league',
  ],
  'euros': [
    'world cup', 'מונדיאל', 'מוקדמות המונדיאל',
    'nations league', 'ליגת האומות',
    'copa américa', 'copa america', 'קופה אמריקה',
    'afcon', 'africa cup', 'גביע אפריקה',
    'gold cup', 'גביע הזהב', 'concacaf nations league',
    'premier league', 'פרמייר ליג', 'champions league', 'ליגת האלופות',
  ],
  'copa-america': [
    'world cup', 'מונדיאל', 'מוקדמות המונדיאל',
    'nations league', 'ליגת האומות',
    'יורו', 'european championship', 'euro 2028', 'euro 2024',
    'afcon', 'africa cup', 'גביע אפריקה',
    'gold cup', 'גביע הזהב', 'concacaf nations league',
    'premier league', 'פרמייר ליג', 'champions league', 'ליגת האלופות',
  ],
  'afcon': [
    'world cup', 'מונדיאל', 'מוקדמות המונדיאל',
    'nations league', 'ליגת האומות',
    'יורו', 'european championship', 'euro 2028', 'euro 2024',
    'copa américa', 'copa america', 'קופה אמריקה',
    'gold cup', 'גביע הזהב', 'concacaf nations league',
    'premier league', 'פרמייר ליג', 'la liga', 'לה ליגה',
    'champions league', 'ליגת האלופות', 'europa league',
  ],
  'gold-cup': [
    'world cup', 'מונדיאל', 'מוקדמות המונדיאל',
    'nations league', 'ליגת האומות',
    'יורו', 'european championship', 'euro 2028', 'euro 2024',
    'copa américa', 'copa america', 'קופה אמריקה',
    'afcon', 'africa cup', 'גביע אפריקה',
    'concacaf nations league',
    'premier league', 'פרמייר ליג',
    'champions league', 'ליגת האלופות',
  ],
  'concacaf-nations-league': [
    'world cup', 'מונדיאל', 'מוקדמות המונדיאל',
    // NB: bare 'nations league' is NOT used — it matches inside this
    // competition's own name ("Concacaf Nations League").
    'uefa nations league', 'ליגת האומות',
    'יורו', 'european championship', 'euro 2028', 'euro 2024',
    'copa américa', 'copa america', 'קופה אמריקה',
    'afcon', 'africa cup', 'גביע אפריקה',
    'gold cup', 'גביע הזהב',
    'premier league', 'פרמייר ליג',
    'champions league', 'ליגת האלופות',
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

/**
 * Press conferences and prematch shows are never recaps — in any tier or
 * language. Official club channels (the curated bulk pool) publish a lot of
 * them, so the terms are multilingual. Kept separate from EXCLUDED so the
 * reject reason distinguishes them in diagnostics.
 */
const PRESS_CONFERENCE_TERMS = [
  'press conference',
  'rueda de prensa',
  'conferencia de prensa',
  'conferência de imprensa',
  'conferencia de imprensa',
  'coletiva de imprensa',
  'coletiva',
  'persconferentie',
  'pressekonferenz',
  'conférence de presse',
  'conferenza stampa',
  'מסיבת עיתונאים',
  'basın toplantısı',
];

const PREMATCH_TERMS = [
  'pre-match',
  'prematch',
  'previa',
  'antevisão',
  'antevisao',
  'avant-match',
];

/** 'press-conference' | 'prematch' when the title is a non-recap format, else null. */
export function nonRecapFormat(title: string): 'press-conference' | 'prematch' | null {
  const t = title.toLowerCase();
  for (const kw of PRESS_CONFERENCE_TERMS) {
    if (t.includes(kw.toLowerCase())) return 'press-conference';
  }
  for (const kw of PREMATCH_TERMS) {
    if (t.includes(kw.toLowerCase())) return 'prematch';
  }
  return null;
}

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
      .filter((h): h is string => !!h)
      .map((h) => h.toLowerCase().replace(/^@/, ''))
  ),
];

/** Preferred channels identified by raw channel ID (no @handle). */
export const TRUSTED_CHANNEL_IDS: string[] = [
  ...new Set(
    Object.values(LEAGUE_SEARCH_PLANS)
      .flatMap((p) => p.preferred.map((s) => s.channelId))
      .filter((id): id is string => !!id)
  ),
];

/** Preferred YouTube channels (see lib/recap/leaguePlans.ts). */

/** Trusted Hebrew sources: official IPFL / ONE YouTube channels, Sport1/Sport5/ONE sites. */
export function isTrusted(c: RawCandidate): boolean {
  if (c.source !== 'youtube') return true;
  if (c.channelId && TRUSTED_CHANNEL_IDS.includes(c.channelId)) return true;
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
  // 'highights' is a common uploader typo of 'highlights' (seen in the wild
  // on an official club channel); matching it is strict improvement.
  return /תקציר|highlights|highights|סיכום|all goals|כל השערים|resumen/i.test(title);
}

/**
 * Relevance tier for display sorting: 0 = extended highlights/recaps,
 * 1 = standard highlights/recaps, 2 = everything else (news, punditry…).
 */
export function highlightTier(title: string): number {
  if (/extended|מורחב|all goals|כל השערים|every goal|full highlights/i.test(title))
    return 0;
  if (hasHighlightIntent(title)) return 1;
  return 2;
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

  // Press conferences and prematch shows are never recaps, in any tier.
  // (Matters most for the curated club-channel pool, which is full of them.)
  const fmt = nonRecapFormat(c.title);
  if (fmt) return { keep: false, reason: fmt };

  // Overlong videos are not highlights: cap at 30 minutes, in every tier.
  // Videos with unknown duration fail open (kept).
  if (c.durationSec != null && c.durationSec > 1800)
    return { keep: false, reason: 'too-long' };

  // The uploader disabled embedding: it would fail in our player.
  if (c.embeddable === false) return { keep: false, reason: 'not-embeddable' };

  // The uploader geo-blocked the video in Israel: it would fail playback here.
  if (c.blockedInIL === true) return { keep: false, reason: 'region-blocked' };

  // Language: in curated tiers (preferred/bulk/candidate) language is a
  // ranking preference, not a veto — official club channels post recaps in
  // their own language (Spanish, Portuguese, Dutch...). General search keeps
  // the hard veto: an unscoped query can return any third-language video.
  // Untagged videos fail open.
  const curatedTier = c.bulk === true || isPreferredChannel(c);
  if (!curatedTier && c.audioLang) {
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
    // Skipped for draws: a reversed draw scoreline is identical, so there
    // is no reversal to veto (e.g. "Leeds 0-0 Man Utd" is correct either way).
    const homeFirst = mentionIndex(c.title, home) <= mentionIndex(c.title, away);
    if (homeFirst && hs !== as && a === as && b === hs && !isTrusted(c) && prox === 'undated') {
      return { keep: false, reason: 'score-reversed' };
    }
  }

  return { keep: true, reason: 'ok' };
}
