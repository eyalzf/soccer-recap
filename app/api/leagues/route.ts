import { NextResponse } from 'next/server';
import { cacheGet, cacheSet } from '@/lib/cache';
import { LEAGUES } from '@/lib/leagues';

export const dynamic = 'force-dynamic';

const API = 'https://www.thesportsdb.com/api/v1/json';
const KEY = process.env.THESPORTSDB_KEY || '3';

/** League tabs metadata (Hebrew names + logos). */
export async function GET() {
  const cached = cacheGet('league-meta');
  if (cached) return NextResponse.json(cached);

  const out = await Promise.all(
    LEAGUES.map(async (l) => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 12000);
        const r = await fetch(`${API}/${KEY}/lookupleague.php?id=${l.sportsdbId}`, {
          signal: ctrl.signal,
        });
        clearTimeout(t);
        const j = (await r.json()) as { leagues?: Array<{ strBadge?: string }> };
        return { slug: l.slug, hebrewName: l.hebrewName, badge: j.leagues?.[0]?.strBadge ?? null };
      } catch {
        return { slug: l.slug, hebrewName: l.hebrewName, badge: null };
      }
    })
  );

  cacheSet('league-meta', out, 24 * 3600 * 1000);
  return NextResponse.json(out);
}
