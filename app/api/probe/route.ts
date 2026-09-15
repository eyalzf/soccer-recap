import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * TEMPORARY diagnostic: checks whether a host is reachable from Vercel's
 * network (datacenter IPs get HTTP-403-blocked by some sports APIs).
 * Restricted to an allowlist of research-candidate hosts. DELETE THIS ROUTE
 * once the listings-source research is concluded.
 */
const ALLOWLIST = new Set([
  'developer.sportradar.com',
  'api.sportradar.com',
  'sports.bzzoiro.com',
  'www.football-data.org',
  'api.football-data.org',
  'worldfootball.net',
  'www.worldfootball.net',
  'www.uefa.com',
  'int.soccerway.com',
  'www.soccerway.com',
]);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams.get('u');
  if (!u) return NextResponse.json({ ok: false, error: 'missing ?u=' }, { status: 400 });
  let target: URL;
  try {
    target = new URL(u);
  } catch {
    return NextResponse.json({ ok: false, error: 'bad url' }, { status: 400 });
  }
  if (!ALLOWLIST.has(target.hostname)) {
    return NextResponse.json({ ok: false, error: 'host not allowlisted' }, { status: 403 });
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    let res: Response;
    try {
      res = await fetch(target.toString(), {
        signal: ctrl.signal,
        headers: { 'User-Agent': UA, Accept: '*/*' },
        redirect: 'follow',
      });
    } finally {
      clearTimeout(t);
    }
    const text = await res.text();
    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get('content-type'),
      bytes: text.length,
      finalUrl: res.url,
      sample: text.slice(0, 400),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
