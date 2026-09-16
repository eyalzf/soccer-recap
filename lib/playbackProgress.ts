// Playback-position persistence for recap videos.
// Stored in localStorage (per device/browser): videoId -> { position, duration, timestamp, watched }.
// No backend, no accounts, no YouTube Data API quota involved.

export interface ProgressEntry {
  t: number; // last position, seconds
  d: number; // video duration when last seen, seconds (0 if unknown)
  ts: number; // last update, epoch ms
  watched: boolean;
}

const KEY = 'recap-progress-v1';
const MAX_ENTRIES = 100;
const RESUME_MIN = 15; // only resume when at least 15s in
const END_MARGIN = 20; // within 20s of the end counts as watched

function read(): Record<string, ProgressEntry> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as unknown;
    return obj && typeof obj === 'object' ? (obj as Record<string, ProgressEntry>) : {};
  } catch {
    return {};
  }
}

function write(map: Record<string, ProgressEntry>): void {
  try {
    const keys = Object.keys(map)
      .sort((a, b) => map[b].ts - map[a].ts)
      .slice(0, MAX_ENTRIES);
    const trimmed: Record<string, ProgressEntry> = {};
    for (const k of keys) trimmed[k] = map[k];
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // private mode / quota: resume just won't persist
  }
}

export function saveProgress(videoId: string, t: number, d: number): void {
  if (!videoId || !isFinite(t) || t < 0) return;
  const map = read();
  const prev = map[videoId];
  if (t <= 5 && !prev) return; // opened but never meaningfully started; don't create noise
  if (t <= 5 && prev && prev.t >= RESUME_MIN) return; // teardown race: never clobber a real position with ~0
  const dur = isFinite(d) && d > 0 ? Math.floor(d) : 0;
  if (dur > 0 && t >= dur - END_MARGIN) {
    markWatched(videoId, dur);
    return;
  }
  map[videoId] = { t: Math.floor(t), d: dur, ts: Date.now(), watched: false };
  write(map);
}

export function markWatched(videoId: string, d: number): void {
  if (!videoId) return;
  const map = read();
  const dur = isFinite(d) && d > 0 ? Math.floor(d) : 0;
  map[videoId] = { t: dur, d: dur, ts: Date.now(), watched: true };
  write(map);
}

/** Seconds to resume from, or null when there's nothing worth resuming. */
export function getResumeSeconds(videoId: string): number | null {
  const e = read()[videoId];
  if (!e || e.watched || e.t < RESUME_MIN) return null;
  if (e.d > 0 && e.t >= e.d - END_MARGIN) return null;
  return e.t;
}

export function isWatched(videoId: string): boolean {
  return read()[videoId]?.watched === true;
}

/** 0..1 progress fraction for in-progress videos, null when not applicable. */
export function progressFraction(videoId: string): number | null {
  const e = read()[videoId];
  if (!e || e.watched || e.d <= 0 || e.t < RESUME_MIN) return null;
  if (e.t >= e.d - END_MARGIN) return null;
  return Math.min(1, e.t / e.d);
}
