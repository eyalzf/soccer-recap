import { NextResponse } from 'next/server';
import { cacheGet, cacheSet } from '@/lib/cache';
import { LEAGUES } from '@/lib/leagues';

export const dynamic = 'force-dynamic';

/** League tabs metadata (Hebrew names + logos). Logos come from FotMob's image CDN. */
export async function GET() {
  const cached = cacheGet('league-meta');
  if (cached) return NextResponse.json(cached);

  const out = LEAGUES.map((l) => ({
    slug: l.slug,
    hebrewName: l.hebrewName,
    badge: l.badge,
  }));

  cacheSet('league-meta', out, 24 * 3600 * 1000);
  return NextResponse.json(out);
}
