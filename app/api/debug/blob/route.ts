import { NextResponse } from 'next/server';
import { del, get as blobGet, put as blobPut } from '@vercel/blob';

export const dynamic = 'force-dynamic';

/**
 * Reproduces logSearch's exact write pattern (create then overwrite the
 * same pathname) on a scratch key, reporting each step. Never exposes
 * the token. The real daily log is untouched.
 */
export async function GET() {
  const out: Record<string, unknown> = { hasToken: !!process.env.BLOB_READ_WRITE_TOKEN };
  const key = 'searchlog/_diag-overwrite.json';
  const opts = {
    access: 'private' as const,
    addRandomSuffix: false,
    contentType: 'application/json',
  };

  try {
    await blobPut(key, JSON.stringify({ n: 1 }), opts);
    out.create = 'ok';
  } catch (e) {
    out.create = 'fail: ' + (e as Error).message;
  }

  try {
    await blobPut(key, JSON.stringify({ n: 2 }), opts);
    out.overwrite = 'ok';
  } catch (e) {
    out.overwrite = 'fail: ' + (e as Error).message;
  }

  try {
    const res = await blobGet(key, { access: 'private', useCache: false });
    if (!res || res.statusCode !== 200 || !res.stream) {
      out.readBack = 'no-stream';
    } else {
      out.readBack = 'ok body=' + (await new Response(res.stream).text());
    }
  } catch (e) {
    out.readBack = 'fail: ' + (e as Error).message;
  }

  try {
    await del(key);
    out.cleanup = 'ok';
  } catch (e) {
    out.cleanup = 'fail: ' + (e as Error).message;
  }
  return NextResponse.json(out);
}
