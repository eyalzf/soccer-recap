'use client';

import { useCallback, useEffect, useState } from 'react';
import GameCard, { type GameItem } from '@/components/GameCard';
import RecapPanel from '@/components/RecapPanel';
import { LEAGUES, type LeagueSlug } from '@/lib/leagues';

interface GamesResponse {
  leagueHe: string;
  leagueBadge: string | null;
  page: number;
  total: number;
  hasMore: boolean;
  items: GameItem[];
}

interface LeagueMeta {
  slug: string;
  hebrewName: string;
  badge: string | null;
}

export default function Home() {
  const [league, setLeague] = useState<LeagueSlug>('premier-league');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<GamesResponse | null>(null);
  const [leagues, setLeagues] = useState<LeagueMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<GameItem | null>(null);

  useEffect(() => {
    fetch('/api/leagues')
      .then((r) => r.json())
      .then((j: LeagueMeta[]) => setLeagues(j))
      .catch(() => {});
  }, []);

  const load = useCallback(
    async (lg: LeagueSlug, pg: number, force = false) => {
      if (force) setRefreshing(true);
      else setLoading(true);
      try {
        const res = await fetch(
          `/api/games?league=${lg}&page=${pg}${force ? '&nocache=1' : ''}`,
          { cache: 'no-store' }
        );
        const j = (await res.json()) as GamesResponse;
        setData(j);
      } catch {
        setData(null);
      }
      setLoading(false);
      setRefreshing(false);
    },
    []
  );

  useEffect(() => {
    load(league, page);
  }, [league, page, load]);

  const switchLeague = (lg: LeagueSlug) => {
    setLeague(lg);
    setPage(0);
    setSelected(null);
  };

  const badgeFor = (slug: string): string | null =>
    leagues.find((l) => l.slug === slug)?.badge ?? null;

  return (
    <div className="app">
      <div className="topbar">
        <h1>תקצירים</h1>
        <button
          className="refresh-btn"
          disabled={refreshing}
          onClick={() => load(league, page, true)}
        >
          {refreshing ? 'מרענן…' : 'רענן'}
        </button>
      </div>

      <nav className="tabs">
        {LEAGUES.map((l) => (
          <button
            key={l.slug}
            className={'tab' + (league === l.slug ? ' active' : '')}
            onClick={() => switchLeague(l.slug)}
          >
            {badgeFor(l.slug) && <img src={badgeFor(l.slug) as string} alt="" />}
            {leagues.find((x) => x.slug === l.slug)?.hebrewName ?? l.hebrewName}
          </button>
        ))}
      </nav>

      {loading ? (
        <div className="status">טוען משחקים…</div>
      ) : !data || data.items.length === 0 ? (
        <div className="status">אין משחקים להצגה</div>
      ) : (
        <>
          <div className="games">
            {data.items.map((g) => (
              <GameCard key={g.id} game={g} onSelect={setSelected} />
            ))}
          </div>
          <div className="pager">
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>
              הקודם
            </button>
            <span>
              עמוד {page + 1} מתוך {Math.max(1, Math.ceil(data.total / 10))}
            </span>
            <button disabled={!data.hasMore} onClick={() => setPage(page + 1)}>
              הבא
            </button>
          </div>
        </>
      )}

      {selected && (
        <RecapPanel game={selected} league={league} onClose={() => setSelected(null)} />
      )}

      <footer className="attribution">
        <span>מקור נתוני המשחקים: </span>
        <a href="https://www.fotmob.com" target="_blank" rel="noopener noreferrer">
          FotMob
        </a>
      </footer>
    </div>
  );
}
