import { lookupClubEn } from '../teamIndex';
import {
  dateProximity,
  extractScore,
  hasHebrew,
  hasHighlightIntent,
  highlightTier,
  isBulkChannel,
  isTrusted,
  mentionIndex,
} from './match';
import type { GameInput, RankedCandidate, RawCandidate } from './types';

const COMPETITION_POSITIVE: Record<string, string[]> = {
  'premier-league': ['premier league', 'פרמייר ליג', 'פרמיירליג'],
  'la-liga': ['la liga', 'לה ליגה'],
  'israeli-league': ['ליגת העל', 'ligat haal'],
  'champions-league': ['champions league', 'ליגת האלופות', 'ucl'],
};

/**
 * The video's own language: title script first, uploader tag second, query
 * language only as a last resort for untagged videos. 'other' = neither
 * Hebrew nor English (e.g. a Spanish club-channel recap).
 */
export function videoLang(c: RawCandidate): 'he' | 'en' | 'other' {
  if (hasHebrew(c.title)) return 'he';
  const al = c.audioLang?.toLowerCase().split('-')[0];
  if (al === 'he' || al === 'iw') return 'he';
  if (al === 'en') return 'en';
  if (al) return 'other';
  return c.lang === 'he' ? 'he' : 'en';
}

export function scoreCandidate(c: RawCandidate, game: GameInput): number {
  let s = 0;

  // Trusted Hebrew sources first.
  if (c.source === 'youtube') {
    if (isTrusted(c)) s += 50;
    else if (isBulkChannel(c)) s += 25; // curated pool beats general search
  } else {
    s += 40; // sport1 / sport5 / one
  }

  // Language preference: Hebrew first, English fallback, other last.
  // Based on the video itself (title script, uploader tag), not the query.
  const vlang = videoLang(c);
  if (vlang === 'he') s += 25;
  else if (vlang === 'en') s += 10;

  // Actual highlights/recap, not punditry or news about the game.
  if (hasHighlightIntent(c.title)) s += 35;

  // Publication date near the game date.
  const prox = dateProximity(c.publishedAt, game.dateISO);
  if (prox === 'ok') s += 20;
  else if (prox === 'near') s += 10;
  // undated: neutral, no bonus.

  // Score signal: matching either order boosts; listed-order match boosts more.
  const sc = extractScore(c.title);
  if (sc && game.homeScore != null && game.awayScore != null) {
    const [a, b] = sc;
    const home = lookupClubEn(game.home);
    const away = lookupClubEn(game.away);
    const homeFirst =
      home && away ? mentionIndex(c.title, home) <= mentionIndex(c.title, away) : true;
    if (homeFirst && a === game.homeScore && b === game.awayScore) s += 30;
    else if (!homeFirst && a === game.awayScore && b === game.homeScore) s += 30;
    else s += 12;
  }

  // Prefer 5–15 minute videos (soft preference, not a filter).
  if (c.durationSec != null) {
    if (c.durationSec >= 300 && c.durationSec <= 900) s += 15;
    else if (c.durationSec < 90) s -= 5;
  }

  // Correct competition mentioned.
  const t = c.title.toLowerCase();
  for (const kw of COMPETITION_POSITIVE[game.league] ?? []) {
    if (t.includes(kw)) {
      s += 10;
      break;
    }
  }

  return s;
}

export function rankCandidates(list: RawCandidate[], game: GameInput): RankedCandidate[] {
  const seen = new Set<string>();
  const out: RankedCandidate[] = [];
  for (const c of list) {
    const key = c.videoId ? `v:${c.videoId}` : `u:${c.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...c, score: scoreCandidate(c, game) });
  }
  // Relevance tier first (extended > standard > rest), then longest
  // first within each tier; relevance score breaks remaining ties.
  // Videos with unknown duration sort last within their tier.
  out.sort(
    (a, b) =>
      highlightTier(a.title) - highlightTier(b.title) ||
      (b.durationSec ?? -1) - (a.durationSec ?? -1) ||
      b.score - a.score
  );
  return out;
}
