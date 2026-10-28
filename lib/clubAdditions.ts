import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cacheGet, cacheSet } from './cache';
import { registerClubAdditions } from './teamIndex';
import type { ClubEntry } from './teams';

/**
 * Runtime club registry additions: `data/club-additions.json` in the
 * repo, read exactly like the league data files (GitHub raw, branch-
 * aware, 10-minute in-memory cache, bundled copy as fallback).
 *
 * Why this exists (2026-10-28): the compiled registry in lib/teams.ts
 * only grows through a code release, so a lower-division cup opponent
 * the daily fixtures update populates (Fleetwood Town, CD Manacor, …)
 * left its game with zero recaps — the matcher hard-rejected every
 * candidate as 'unknown-team' until a release registered the club.
 * Additions live in data instead: the fixtures update (or any data
 * commit) can register a club with no deploy, effective within the
 * cache TTL. The code registry always wins on a name clash (see
 * lib/teamIndex.ts) — additions only fill gaps.
 *
 * File shape: { "clubs": ClubEntry[] } — same entry shape as
 * lib/teams.ts. Malformed entries are skipped, never fatal.
 */

const DATA_BRANCH =
  process.env.GITHUB_DATA_BRANCH || process.env.VERCEL_GIT_COMMIT_REF || 'main';
const DATA_BASE = `https://raw.githubusercontent.com/eyalzf/soccer-recap/${DATA_BRANCH}/data`;
const MEM_KEY = 'clubadditions:v1';
const TTL_MS = 10 * 60 * 1000;
const NEG_TTL_MS = 60 * 1000;

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

/** Validate + normalize one raw entry; null when unusable. */
export function parseClubAddition(raw: unknown): ClubEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.en !== 'string' || !e.en.trim()) return null;
  if (typeof e.he !== 'string' || !e.he.trim()) return null;
  const enAliases = e.enAliases === undefined ? [] : e.enAliases;
  const heAliases = e.heAliases === undefined ? [] : e.heAliases;
  if (!isStringArray(enAliases) || !isStringArray(heAliases)) return null;
  return {
    en: e.en.trim(),
    he: e.he.trim(),
    enAliases: enAliases.map((s) => s.trim()).filter(Boolean),
    heAliases: heAliases.map((s) => s.trim()).filter(Boolean),
  };
}

/** All valid entries from a parsed additions file; [] for anything else. */
export function parseClubAdditions(raw: unknown): ClubEntry[] {
  const list = (raw as { clubs?: unknown } | null)?.clubs;
  if (!Array.isArray(list)) return [];
  const out: ClubEntry[] = [];
  for (const e of list) {
    const parsed = parseClubAddition(e);
    if (parsed) out.push(parsed);
  }
  return out;
}

async function fetchJson(url: string, timeoutMs = 10000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(t);
  }
}

async function loadClubAdditions(): Promise<void> {
  // Primary: the committed file on GitHub (fresh within minutes of a
  // data commit, exactly like the league listings).
  try {
    const raw = await fetchJson(`${DATA_BASE}/club-additions.json`);
    registerClubAdditions(parseClubAdditions(raw));
    cacheSet(MEM_KEY, Date.now(), TTL_MS);
    return;
  } catch {
    // Fall through to the bundled copy.
  }
  try {
    const raw = await readFile(
      join(process.cwd(), 'data', 'club-additions.json'),
      'utf8'
    );
    registerClubAdditions(parseClubAdditions(JSON.parse(raw)));
    cacheSet(MEM_KEY, Date.now(), TTL_MS);
    return;
  } catch {
    // No additions available: the code registry alone applies. Retry
    // soon rather than caching the failure for the full TTL.
    cacheSet(MEM_KEY, Date.now(), NEG_TTL_MS);
  }
}

let inFlight: Promise<void> | null = null;

/**
 * Make sure the runtime club additions are loaded (and periodically
 * refreshed) before team resolution happens. Cheap after the first
 * call: a cache probe per request, a refetch at most every 10 minutes
 * per instance. Never throws.
 */
export async function ensureClubAdditions(): Promise<void> {
  if (cacheGet<number>(MEM_KEY)) return;
  if (!inFlight) {
    inFlight = loadClubAdditions().finally(() => {
      inFlight = null;
    });
  }
  await inFlight;
}
