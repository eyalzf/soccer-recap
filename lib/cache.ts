// Tiny in-memory TTL cache. Per server instance; enough to respect free API quotas.

interface Entry {
  exp: number;
  val: unknown;
}

const store = new Map<string, Entry>();

export function cacheGet<T>(key: string): T | undefined {
  const e = store.get(key);
  if (!e) return undefined;
  if (Date.now() > e.exp) {
    store.delete(key);
    return undefined;
  }
  return e.val as T;
}

export function cacheSet(key: string, val: unknown, ttlMs: number): void {
  store.set(key, { exp: Date.now() + ttlMs, val });
  // Prevent unbounded growth.
  if (store.size > 2000) {
    const first = store.keys().next();
    if (!first.done) store.delete(first.value);
  }
}

export function cacheDel(key: string): void {
  store.delete(key);
}
