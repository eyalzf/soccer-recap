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
import { list as blobList, put as blobPut } from '@vercel/blob';
import { cacheGet, cacheSet } from '@/lib/cache';

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';

export interface Persisted<T> {
  fetchedAt: number;
  val: T;
}

// In-memory map of pathname -> public URL, populated on pset so pget can
// skip the blobList call within a warm instance.
const urlByPath = new Map<string, string>();

export async function pget<T>(key: string): Promise<Persisted<T> | null> {
  if (!TOKEN) {
    return cacheGet<Persisted<T>>(key) ?? null;
  }
  try {
    let url = urlByPath.get(key);
    if (!url) {
      const { blobs } = await blobList({ prefix: key, limit: 5 });
      const b = blobs.find((x) => x.pathname === key) ?? null;
      if (!b) return null;
      url = b.url;
      urlByPath.set(key, url);
    }
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      urlByPath.delete(key);
      return null;
    }
    return (await res.json()) as Persisted<T>;
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
    const blob = await blobPut(key, JSON.stringify(rec), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json',
    });
    urlByPath.set(key, blob.url);
  } catch {
    // Blob write failed (permissions, network): keep an in-memory copy.
    cacheSet(key, rec, 30 * 86400000);
  }
}
