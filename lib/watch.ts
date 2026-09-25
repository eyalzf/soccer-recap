// Game-view tracking for personalization (quick team filter + hide-watched).
// Stored in localStorage (per device/browser). A "view" is recorded when the
// user SELECTS a recap video for a game — watching it to the end is NOT
// required. This is separate from playbackProgress.ts, which tracks per-video
// resume position and finished ("נצפה ✓") state.

import { lookupClubEn } from './teamIndex';
import { lookupNationEn } from './nationIndex';

const TEAM_VIEWS_KEY = 'sr-team-views-v1';
const WATCHED_GAMES_KEY = 'sr-watched-games-v1';
/** Nations quick filter has its own view counts, independent from clubs. */
const NATION_VIEWS_KEY = 'sr-nation-views-v1';
const MAX_ENTRIES = 1000;

/** Canonical team key: the curated English name when known, else the raw name. */
export function teamKey(enName: string): string {
  return lookupClubEn(enName)?.en ?? enName;
}

/** Canonical nation key: the curated English nation name when known, else raw. */
export function nationKey(enName: string): string {
  return lookupNationEn(enName)?.en ?? enName;
}

function readNumMap(key: string): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const obj = JSON.parse(raw) as unknown;
    return obj && typeof obj === 'object'
      ? (obj as Record<string, number>)
      : {};
  } catch {
    return {};
  }
}

function writeNumMap(key: string, map: Record<string, number>): void {
  try {
    const keys = Object.keys(map)
      .sort((a, b) => map[b] - map[a])
      .slice(0, MAX_ENTRIES);
    const trimmed: Record<string, number> = {};
    for (const k of keys) trimmed[k] = map[k];
    localStorage.setItem(key, JSON.stringify(trimmed));
  } catch {
    // private mode / quota: tracking just won't persist
  }
}

/** Record that the user selected a recap video for a game. Counts for both teams. */
export function recordGameView(
  gameId: string,
  homeEn: string,
  awayEn: string
): void {
  if (typeof window === 'undefined' || !gameId) return;
  try {
    const watched = readNumMap(WATCHED_GAMES_KEY);
    watched[gameId] = Date.now();
    writeNumMap(WATCHED_GAMES_KEY, watched);

    const views = readNumMap(TEAM_VIEWS_KEY);
    for (const name of [homeEn, awayEn]) {
      if (!name) continue;
      const k = teamKey(name);
      views[k] = (views[k] ?? 0) + 1;
    }
    writeNumMap(TEAM_VIEWS_KEY, views);
  } catch {
    // ignore
  }
}

/** Canonical team key -> view count. */
export function getTeamViews(): Record<string, number> {
  return readNumMap(TEAM_VIEWS_KEY);
}

/** Record that the user selected a recap video for a national-team game. */
export function recordNationGameView(
  gameId: string,
  homeEn: string,
  awayEn: string
): void {
  if (typeof window === 'undefined' || !gameId) return;
  try {
    const watched = readNumMap(WATCHED_GAMES_KEY);
    watched[gameId] = Date.now();
    writeNumMap(WATCHED_GAMES_KEY, watched);

    const views = readNumMap(NATION_VIEWS_KEY);
    for (const name of [homeEn, awayEn]) {
      if (!name) continue;
      const k = nationKey(name);
      views[k] = (views[k] ?? 0) + 1;
    }
    writeNumMap(NATION_VIEWS_KEY, views);
  } catch {
    // ignore
  }
}

/** Canonical nation key -> view count (independent from club counts). */
export function getNationViews(): Record<string, number> {
  return readNumMap(NATION_VIEWS_KEY);
}

/** Game ids the user has opened a recap for. */
export function getWatchedGameIds(): Set<string> {
  return new Set(Object.keys(readNumMap(WATCHED_GAMES_KEY)));
}

export function isGameWatched(gameId: string): boolean {
  return getWatchedGameIds().has(gameId);
}
