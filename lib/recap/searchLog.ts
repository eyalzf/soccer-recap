/**
 * Append-only log of recap searches, persisted in Blob (Blob-only, no
 * external services). One JSON array per day: `searchlog/YYYY-MM-DD.json`.
 *
 * Each entry records which tiers ran and which tier produced the results,
 * so fallback-to-general-search frequency can be reviewed per league.
 * Logging never throws and never blocks a search: callers fire-and-forget.
 */
import { pget, pset } from './persist';

export interface TierStats {
  /** how many searches/listings ran in this tier */
  ran: number;
  /** how many candidates survived filtering in this tier */
  kept: number;
}

export type SearchWinner = 'preferred' | 'bulk' | 'general' | 'none' | 'cache';

export interface SearchLogEntry {
  t: number;
  home: string;
  away: string;
  league: string;
  date: string;
  /** served from the game-results cache: no tier ran */
  cached?: boolean;
  /** which tier produced a proper highlight (or 'none' / 'cache') */
  winner?: SearchWinner;
  preferred: TierStats;
  bulk: TierStats;
  general: TierStats;
  results: number;
  rateLimited: boolean;
}

const MAX_ENTRIES_PER_DAY = 500;

function dayKey(t: number): { key: string; day: string } {
  const d = new Date(t);
  const day =
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
    `${String(d.getDate()).padStart(2, '0')}`;
  return { key: `searchlog/${day}.json`, day };
}

export function emptyTierStats(): TierStats {
  return { ran: 0, kept: 0 };
}

export async function logSearch(entry: SearchLogEntry): Promise<void> {
  try {
    const { key } = dayKey(entry.t);
    const rec = await pget<SearchLogEntry[]>(key);
    const arr = rec ? rec.val : [];
    arr.push(entry);
    await pset(key, arr.slice(-MAX_ENTRIES_PER_DAY));
  } catch {
    /* logging must never break a search */
  }
}

export interface SearchLogDay {
  day: string;
  entries: SearchLogEntry[];
}

/** Most recent `days` days of log entries, newest day first. */
export async function readSearchLog(days = 7): Promise<SearchLogDay[]> {
  const out: SearchLogDay[] = [];
  const now = Date.now();
  for (let i = 0; i < days; i++) {
    const t = now - i * 86400000;
    const { key, day } = dayKey(t);
    try {
      const rec = await pget<SearchLogEntry[]>(key);
      if (rec && rec.val.length) out.push({ day, entries: rec.val });
    } catch {
      /* skip unreadable days */
    }
  }
  return out;
}
