import { NextResponse } from 'next/server';
import {
  pdel,
  pget,
  pset,
  storageBackend,
  storageConfigured,
} from '@/lib/recap/persist';

export const dynamic = 'force-dynamic';

/**
 * Storage health check (path kept from its Blob-era origin): reproduces
 * logSearch's exact write pattern (create then overwrite the same key)
 * on a scratch key through the active persist backend, reporting each
 * step. Never exposes any credential. The real daily log is untouched.
 */
export async function GET() {
  const out: Record<string, unknown> = {
    backend: storageBackend(),
    hasStorage: storageConfigured(),
  };
  const key = 'searchlog/_diag-overwrite.json';

  try {
    await pset(key, { n: 1 });
    out.create = 'ok';
  } catch (e) {
    out.create = 'fail: ' + (e as Error).message;
  }

  try {
    await pset(key, { n: 2 });
    out.overwrite = 'ok';
  } catch (e) {
    out.overwrite = 'fail: ' + (e as Error).message;
  }

  try {
    const rec = await pget<{ n: number }>(key);
    out.readBack = rec ? 'ok body=' + JSON.stringify(rec.val) : 'no-record';
  } catch (e) {
    out.readBack = 'fail: ' + (e as Error).message;
  }

  try {
    await pdel([key]);
    out.cleanup = 'ok';
  } catch (e) {
    out.cleanup = 'fail: ' + (e as Error).message;
  }
  return NextResponse.json(out);
}
