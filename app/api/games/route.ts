import { NextRequest, NextResponse } from 'next/server';
import { cacheDel } from '@/lib/cache';
import { getLeague, LEAGUES, type LeagueSlug } from '@/lib/leagues';
import { getLeagueGames } from '@/lib/results';
import { toHebrew } from '@/lib/teamIndex';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 10;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const leagueParam = sp.get('league') || 'premier-league';
  const page = Math.max(0, parseInt(sp.get('page') || '0', 10) || 0);
  const nocache = sp.get('nocache') === '1';

  // Unified view: every game from every league, newest first, no pagination
  // (the total is ~150 games — small enough for one response; the client
  // filters by league/team locally for instant filtering).
  if (leagueParam === 'all') {
    if (nocache) for (const def of LEAGUES) cacheDel(`games:${def.slug}`);
    const items = [];
    for (const def of LEAGUES) {
      const games = await getLeagueGames(def.slug);
      for (const g of games.games) {
        items.push({
          ...g,
          league: def.slug,
          leagueHe: def.hebrewName,
          homeHe: toHebrew(g.home),
          awayHe: toHebrew(g.away),
        });
      }
    }
    items.sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1));
    return NextResponse.json({ league: 'all', total: items.length, items });
  }

  const league = leagueParam as LeagueSlug;
  const def = getLeague(league) ?? LEAGUES[0];

  // Bypass the server cache when the user hits refresh.
  if (nocache) cacheDel(`games:${def.slug}`);

  const games = await getLeagueGames(def.slug);
  const total = games.games.length;
  const items = games.games
    .slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
    .map((g) => ({
      ...g,
      league: def.slug,
      leagueHe: def.hebrewName,
      homeHe: toHebrew(g.home),
      awayHe: toHebrew(g.away),
    }));

  return NextResponse.json({
    league: def.slug,
    leagueHe: def.hebrewName,
    leagueBadge: games.games[0]?.leagueBadge ?? null,
    page,
    pageSize: PAGE_SIZE,
    total,
    hasMore: (page + 1) * PAGE_SIZE < total,
    items,
    // Additive debug aid: present only when the listings fetch failed.
    ...(games.error ? { _error: games.error } : {}),
  });
}
