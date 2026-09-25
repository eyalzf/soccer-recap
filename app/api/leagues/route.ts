import { NextResponse } from 'next/server';
import { cacheGet, cacheSet } from '@/lib/cache';
import { LEAGUES, NATIONAL_COMPETITIONS } from '@/lib/leagues';

export const dynamic = 'force-dynamic';

/**
 * League/competition tabs metadata (Hebrew names + logos). Club logos come
 * from FotMob's image CDN; national competition logos are official emblems
 * via Wikimedia.
 */
export async function GET() {
  const cached = cacheGet('league-meta');
  if (cached) return NextResponse.json(cached);

  const out = [
    ...LEAGUES.map((l) => ({
      slug: l.slug,
      hebrewName: l.hebrewName,
      badge: l.badge,
      kind: 'club' as const,
    })),
    ...NATIONAL_COMPETITIONS.map((c) => ({
      slug: c.slug,
      hebrewName: c.hebrewName,
      badge: c.badge,
      kind: 'national' as const,
    })),
  ];

  cacheSet('league-meta', out, 24 * 3600 * 1000);
  return NextResponse.json(out);
}
