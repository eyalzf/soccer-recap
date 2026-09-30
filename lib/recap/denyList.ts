/**
 * Channel deny list ("known offenders"): channels whose videos repeatedly
 * turn out unplayable (deleted/private, embedding disabled, region-blocked).
 *
 * Source of truth is Blob (`channel-ops/deny-list.json`), read at search
 * time and cached in memory for 10 minutes. Enforcement is two-fold:
 *  - filterCandidate() rejects videos from deny-listed channels
 *    (reason 'deny-listed'), so they never surface in any tier;
 *  - bulkScan() / the preferred-tier loop skip deny-listed plan entries
 *    entirely, so no quota is spent scanning them.
 *
 * Keeping the curated bulk plans in code (lib/recap/leaguePlans.ts) is
 * deliberate: plan changes go through the preview → approve → production
 * gate. Denying a channel suspends it at runtime with immediate effect and
 * no deploy; removing it from the deny list reinstates it (the plan entry
 * is untouched).
 */
import { pget, pset } from './persist';
import { cacheGet, cacheSet } from '@/lib/cache';

export interface DenyEntry {
  /** Display title of the channel. */
  channel: string;
  /** YouTube channel ID (UC…); preferred match key. */
  channelId?: string;
  /** Handle without leading @, lowercased. */
  handle?: string;
  /** Why it was denied, e.g. "sweep: 4 dead videos in 90d". */
  reason: string;
  /** Dead videos attributed to the channel when it was denied. */
  deadCount: number;
  addedAt: number;
}

/** In-memory match structure, built once per search. */
export interface DenySet {
  ids: Set<string>;
  handles: Set<string>;
}

const BLOB_KEY = 'channel-ops/deny-list.json';
const MEM_KEY = 'denylist:v1';
const MEM_TTL_MS = 10 * 60 * 1000;

export function normHandle(h: string): string {
  return h.trim().replace(/^@/, '').toLowerCase();
}

async function readDenyList(): Promise<DenyEntry[]> {
  const rec = await pget<DenyEntry[]>(BLOB_KEY);
  const list = rec?.val;
  return Array.isArray(list) ? list : [];
}

export async function getDenyList(): Promise<DenyEntry[]> {
  const mem = cacheGet<DenyEntry[]>(MEM_KEY);
  if (mem) return mem;
  const list = await readDenyList();
  cacheSet(MEM_KEY, list, MEM_TTL_MS);
  return list;
}

export async function getDenySet(): Promise<DenySet> {
  const list = await getDenyList();
  const ids = new Set<string>();
  const handles = new Set<string>();
  for (const e of list) {
    if (e.channelId) ids.add(e.channelId);
    if (e.handle) handles.add(normHandle(e.handle));
  }
  return { ids, handles };
}

export async function addToDenyList(
  entry: Omit<DenyEntry, 'addedAt'>
): Promise<DenyEntry[]> {
  const list = await readDenyList();
  const norm = entry.handle ? normHandle(entry.handle) : undefined;
  const exists = list.some(
    (e) =>
      (entry.channelId && e.channelId === entry.channelId) ||
      (norm && e.handle && normHandle(e.handle) === norm)
  );
  if (!exists) {
    list.push({
      ...entry,
      handle: norm,
      addedAt: Date.now(),
    });
    await pset(BLOB_KEY, list);
    // Bust the in-memory copy so the next search sees the change.
    cacheSet(MEM_KEY, list, MEM_TTL_MS);
  }
  return list;
}

/** True when the candidate's channel is deny-listed (by ID or handle). */
export function isDeniedChannel(
  c: { channelId?: string | null; channelHandle?: string | null },
  deny: DenySet
): boolean {
  if (c.channelId && deny.ids.has(c.channelId)) return true;
  if (c.channelHandle && deny.handles.has(normHandle(c.channelHandle)))
    return true;
  return false;
}

/** True when a plan entry (preferred/bulk) belongs to a denied channel. */
export function isDeniedPlanEntry(
  e: { channelId?: string; handle?: string },
  deny: DenySet
): boolean {
  return isDeniedChannel(
    { channelId: e.channelId ?? null, channelHandle: e.handle ?? null },
    deny
  );
}
