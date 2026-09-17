/**
 * Persistent cache backed by Vercel Blob (Blob-only, no external services).
 *
 * Blob has no TTL, so each record stores its own `fetchedAt` and callers
 * enforce staleness. Keys are pathnames like `pl/v1/<channelId>` or
 * `game/v2/<league>/<home>-<away>-<date>`.
 *
 * When BLOB_READ_WRITE_TOKEN is absent (local dev, or the Blob store hasn't
 * been created in the Vercel dashboard yet), everything falls back to the
 * existing in-memory cache: the app keeps working, just without
 * cross-instance persistence. Create the store via Vercel dashboard →
 * Storage → Create → Blob; the env var is auto-injected on next deploy.
 */
import { get as blobGet, put as blobPut } from '@vercel/blob';
import { cacheGet, cacheSet } from '@/lib/cache';

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';

/** The store may be public or private; the app always uses private access. */
const BLOB_ACCESS = 'private' as const;

export interface Persisted<T> {
  fetchedAt: number;
  val: T;
}

export async function pget<T>(key: string): Promise<Persisted<T> | null> {
  if (!TOKEN) {
    return cacheGet<Persisted<T>>(key) ?? null;
  }
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

export async function pset(key: string, val: unknown): Promise<void> {
  const rec: Persisted<unknown> = { fetchedAt: Date.now(), val };
  if (!TOKEN) {
    cacheSet(key, rec, 30 * 86400000);
    return;
  }
  try {
    await blobPut(key, JSON.stringify(rec), {
      access: BLOB_ACCESS,
      addRandomSuffix: false,
      contentType: 'application/json',
    });
  } catch {
    // Blob write failed (permissions, network): keep an in-memory copy.
    cacheSet(key, rec, 30 * 86400000);
  }
}
