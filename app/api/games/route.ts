import { NextRequest, NextResponse } from 'next/server';
import { cacheDel } from '@/lib/cache';
import { getLeague, LEAGUES, type LeagueSlug } from '@/lib/leagues';
import { getLeagueGames } from '@/lib/sofascore';
import { toHebrew } from '@/lib/teamIndex';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 10;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const league = (sp.get('league') || 'premier-league') as LeagueSlug;
  const page = Math.max(0, parseInt(sp.get('page') || '0', 10) || 0);
  const nocache = sp.get('nocache') === '1';
  const def = getLeague(league) ?? LEAGUES[0];

  // Bypass the server cache when the user hits refresh.
  if (nocache) cacheDel(`games:${def.slug}`);

  const games = await getLeagueGames(def.slug);
  const total = games.games.length;
  const items = games.games
    .slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
    .map((g) => ({
      ...g,
      homeHe: toHebrew(g.home),
      awayHe: toHebrew(g.away),
    }));

  return NextResponse.json({
    league: def.slug,
    leagueHe: def.hebrewName,
    leagueBadge: `https://api.sofascore.com/api/v1/unique-tournament/${def.sofascoreUtid}/image`,
    page,
    pageSize: PAGE_SIZE,
    total,
    hasMore: (page + 1) * PAGE_SIZE < total,
    items,
    // Additive debug aid: present only when the listings fetch failed.
    ...(games.error ? { _error: games.error } : {}),
  });
}
