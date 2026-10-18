/**
 * Persistent storage for recap caches and ops state.
 *
 * Primary backend (2026-10-14 migration): Cloudflare R2, reached through a
 * small dedicated Worker (`storage-worker/` in this repo) that holds the
 * bucket binding — so no S3 credentials exist in this app at all. The app
 * authenticates to the Worker with a shared secret:
 *
 *   STORAGE_API_URL     e.g. https://soccer-recap-storage.<sub>.workers.dev
 *   STORAGE_API_SECRET  shared secret (also set on the Worker)
 *   STORAGE_PREFIX      optional key namespace for this deployment
 *                       (previews use "preview" so validation traffic never
 *                       touches production data; production leaves it unset
 *                       so R2 keys mirror the historical Blob pathnames)
 *
 * Legacy backend: Vercel Blob. The free-tier Blob quota was exhausted in
 * Oct 2026 and the store was paused, which is why storage moved. While
 * BLOB_READ_WRITE_TOKEN is still present, Blob remains connected as a
 * READ-ONLY archive fallback: when the primary backend misses a key, the
 * old Blob copy is tried, so state written before the migration (the
 * channel deny list, candidate decisions, settled game caches) is picked
 * up again instead of being lost. Writes never go to Blob any more, and
 * deletes remove the Blob copy too, so a deleted key cannot resurrect
 * through the fallback.
 *
 * When neither backend is configured (local dev), everything falls back
 * to the in-memory cache: the app keeps working, just without
 * cross-instance persistence.
 *
 * Records have no storage-level TTL: each record stores its own
 * `fetchedAt` and callers enforce staleness. Keys are pathnames like
 * `pl/v2/<channelId>` or `game/v11/<league>/<home>-<away>-<date>`.
 */
import {
  del as blobDel,
  get as blobGet,
  list as blobList,
  put as blobPut,
} from '@vercel/blob';
import { cacheGet, cacheSet } from '@/lib/cache';

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';

/** The Blob store may be public or private; the app always uses private access. */
const BLOB_ACCESS = 'private' as const;

const R2_URL = (process.env.STORAGE_API_URL || '').replace(/\/+$/, '');
const R2_SECRET = process.env.STORAGE_API_SECRET || '';
const R2_CONFIGURED = !!R2_URL && !!R2_SECRET;
const KEY_PREFIX = (process.env.STORAGE_PREFIX || '').replace(/^\/+|\/+$/g, '');

export type StorageBackendName = 'r2' | 'blob' | 'memory';

/** Which backend receives writes ('memory' = in-memory fallback only). */
export function storageBackend(): StorageBackendName {
  if (R2_CONFIGURED) return 'r2';
  if (BLOB_TOKEN) return 'blob';
  return 'memory';
}

/** True when a durable backend (R2 or Blob) is configured. */
export function storageConfigured(): boolean {
  return storageBackend() !== 'memory';
}

function prefixed(key: string): string {
  return KEY_PREFIX ? `${KEY_PREFIX}/${key}` : key;
}

function unprefix(pathname: string): string {
  return KEY_PREFIX && pathname.startsWith(`${KEY_PREFIX}/`)
    ? pathname.slice(KEY_PREFIX.length + 1)
    : pathname;
}

export interface Persisted<T> {
  fetchedAt: number;
  val: T;
}

/* ---------------- R2 Worker backend ---------------- */

interface R2Response {
  ok?: boolean;
  exists?: boolean;
  body?: string;
  items?: Array<{ pathname: string; uploadedAt: number }>;
  cursor?: string;
  hasMore?: boolean;
  error?: string;
}

async function r2Call(payload: Record<string, unknown>): Promise<R2Response> {
  const res = await fetch(R2_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${R2_SECRET}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  const data = (await res.json().catch(() => null)) as R2Response | null;
  if (!res.ok || !data) {
    throw new Error(`storage worker HTTP ${res.status}: ${data?.error ?? 'no body'}`);
  }
  return data;
}

/* ---------------- Blob backend (legacy) ---------------- */

async function blobRead<T>(key: string): Promise<Persisted<T> | null> {
  try {
    // Authenticated download; useCache:false bypasses the CDN so a
    // just-written value (e.g. the daily search log) reads back fresh.
    const res = await blobGet(key, { access: BLOB_ACCESS, useCache: false });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    const text = await new Response(res.stream).text();
    return JSON.parse(text) as Persisted<T>;
  } catch {
    return null;
  }
}

/* ---------------- Public API ---------------- */

export async function pget<T>(key: string): Promise<Persisted<T> | null> {
  if (R2_CONFIGURED) {
    try {
      const data = await r2Call({ op: 'get', key: prefixed(key) });
      if (data.exists && typeof data.body === 'string') {
        return JSON.parse(data.body) as Persisted<T>;
      }
    } catch {
      // Primary unreachable: fall through to the legacy archive / memory.
    }
    // Legacy archive fallback: state written to Blob before the migration
    // (deny list, candidate decisions, settled game caches) stays visible.
    if (BLOB_TOKEN) {
      const legacy = await blobRead<T>(key);
      if (legacy) return legacy;
    }
    return cacheGet<Persisted<T>>(key) ?? null;
  }
  if (BLOB_TOKEN) return blobRead<T>(key);
  return cacheGet<Persisted<T>>(key) ?? null;
}

export async function pset(key: string, val: unknown): Promise<void> {
  const rec: Persisted<unknown> = { fetchedAt: Date.now(), val };
  const body = JSON.stringify(rec);
  if (R2_CONFIGURED) {
    try {
      await r2Call({ op: 'put', key: prefixed(key), body });
      return;
    } catch {
      // Storage write failed (network, worker down): keep an in-memory copy.
      cacheSet(key, rec, 30 * 86400000);
      return;
    }
  }
  if (!BLOB_TOKEN) {
    cacheSet(key, rec, 30 * 86400000);
    return;
  }
  try {
    await blobPut(key, body, {
      access: BLOB_ACCESS,
      addRandomSuffix: false,
      // Required: without this, put() to an existing pathname throws
      // ("This blob already exists"), so cache refreshes and daily-log
      // appends after the first write of the day would silently fail.
      allowOverwrite: true,
      contentType: 'application/json',
    });
  } catch {
    // Blob write failed (permissions, network): keep an in-memory copy.
    cacheSet(key, rec, 30 * 86400000);
  }
}

export interface StoredObject {
  /** Logical key (storage prefix stripped). */
  pathname: string;
  /** Last write time, epoch ms. */
  uploadedAt: number;
}

export interface PListPage {
  items: StoredObject[];
  cursor?: string;
  hasMore: boolean;
}

/** List stored objects under a logical key prefix, one page at a time. */
export async function plist(
  prefix: string,
  cursor?: string,
  limit = 1000
): Promise<PListPage> {
  if (R2_CONFIGURED) {
    const data = await r2Call({
      op: 'list',
      prefix: prefixed(prefix),
      cursor,
      limit,
    });
    return {
      items: (data.items ?? []).map((it) => ({
        pathname: unprefix(it.pathname),
        uploadedAt: it.uploadedAt,
      })),
      cursor: data.cursor,
      hasMore: !!data.hasMore,
    };
  }
  if (BLOB_TOKEN) {
    const page = await blobList({ prefix, cursor, limit });
    return {
      items: page.blobs.map((b) => ({
        pathname: b.pathname,
        uploadedAt: new Date(b.uploadedAt).getTime(),
      })),
      cursor: page.cursor,
      hasMore: page.hasMore,
    };
  }
  return { items: [], hasMore: false };
}

/**
 * Delete logical keys from the write backend. When R2 is primary and the
 * legacy Blob token is still present, the Blob copy is deleted as well —
 * otherwise pget's archive fallback would resurrect the key.
 */
export async function pdel(keys: string[]): Promise<void> {
  if (!keys.length) return;
  if (R2_CONFIGURED) {
    await r2Call({ op: 'del', keys: keys.map(prefixed) });
    if (BLOB_TOKEN) {
      try {
        await blobDel(keys);
      } catch {
        // Legacy copy may not exist; the primary delete already succeeded.
      }
    }
    return;
  }
  if (BLOB_TOKEN) await blobDel(keys);
}
