import { lookupClubEn } from '../teamIndex';
import {
  dateProximity,
  extractScore,
  hasHebrew,
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

export function scoreCandidate(c: RawCandidate, game: GameInput): number {
  let s = 0;

  // Trusted Hebrew sources first.
  if (c.source === 'youtube') {
    if (isTrusted(c)) s += 50;
  } else {
    s += 40; // sport1 / sport5 / one
  }

  // Hebrew before English fallback.
  if (c.lang === 'he' || hasHebrew(c.title)) s += 25;

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
  out.sort((a, b) => b.score - a.score);
  return out;
}
