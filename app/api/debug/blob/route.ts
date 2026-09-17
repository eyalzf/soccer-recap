import { NextResponse } from 'next/server';
import { del, list, put } from '@vercel/blob';

export const dynamic = 'force-dynamic';

/**
 * Blob connectivity probe. Reports only whether the configured
 * BLOB_READ_WRITE_TOKEN works for list/put — never the token value.
 */
export async function GET() {
  const out: Record<string, unknown> = {
    hasToken: !!process.env.BLOB_READ_WRITE_TOKEN,
  };
  try {
    await list({ limit: 1 });
    out.list = 'ok';
  } catch (e) {
    out.list = 'fail: ' + (e as Error).message;
  }
  const key = 'searchlog/_diag.json';
  try {
    await put(key, JSON.stringify({ t: Date.now() }), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json',
    });
    out.put = 'ok';
    try {
      await del(key);
    } catch {
      /* cleanup is best-effort */
    }
  } catch (e) {
    out.put = 'fail: ' + (e as Error).message;
  }
  return NextResponse.json(out);
}
