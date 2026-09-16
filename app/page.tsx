'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [items, setItems] = useState<GameItem[]>([]);
  const [total, setTotal] = useState(0);
  /** Next page index to fetch. */
  const [nextPage, setNextPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [leagues, setLeagues] = useState<LeagueMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<GameItem | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Mutable snapshot so the intersection callback never reads stale state.
  const stateRef = useRef({ league, nextPage, hasMore, loading, loadingMore });
  stateRef.current = { league, nextPage, hasMore, loading, loadingMore };

  useEffect(() => {
    fetch('/api/leagues')
      .then((r) => r.json())
      .then((j: LeagueMeta[]) => setLeagues(j))
      .catch(() => {});
  }, []);

  const fetchPage = useCallback(async (lg: LeagueSlug, pg: number, force = false) => {
    const res = await fetch(
      `/api/games?league=${lg}&page=${pg}${force ? '&nocache=1' : ''}`,
      { cache: 'no-store' }
    );
    return (await res.json()) as GamesResponse;
  }, []);

  /** Load the first page, replacing the list (initial load, league switch, refresh). */
  const loadFirst = useCallback(
    async (lg: LeagueSlug, force = false) => {
      if (force) setRefreshing(true);
      else setLoading(true);
      try {
        const j = await fetchPage(lg, 0, force);
        setItems(j.items);
        setTotal(j.total);
        setHasMore(j.hasMore);
        setNextPage(1);
      } catch {
        setItems([]);
        setHasMore(false);
      }
      setLoading(false);
      setRefreshing(false);
    },
    [fetchPage]
  );

  /** Append the next page when the bottom sentinel scrolls into view. */
  const loadMore = useCallback(async () => {
    const s = stateRef.current;
    if (s.loading || s.loadingMore || !s.hasMore) return;
    setLoadingMore(true);
    try {
      const j = await fetchPage(s.league, s.nextPage);
      setItems((prev) => {
        const seen = new Set(prev.map((g) => g.id));
        return [...prev, ...j.items.filter((g) => !seen.has(g.id))];
      });
      setTotal(j.total);
      setHasMore(j.hasMore);
      setNextPage(s.nextPage + 1);
    } catch {
      /* keep the list as-is; the sentinel stays and can retry */
    }
    setLoadingMore(false);
  }, [fetchPage]);

  useEffect(() => {
    loadFirst(league);
  }, [league, loadFirst]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: '600px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore]);

  const switchLeague = (lg: LeagueSlug) => {
    if (lg === league) return;
    setLeague(lg);
    setSelected(null);
    window.scrollTo(0, 0);
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
          onClick={() => loadFirst(league, true)}
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
      ) : items.length === 0 ? (
        <div className="status">אין משחקים להצגה</div>
      ) : (
        <>
          <div className="games">
            {items.map((g) => (
              <GameCard key={g.id} game={g} onSelect={setSelected} />
            ))}
          </div>
          <div ref={sentinelRef} className="infinite-sentinel" aria-hidden="true" />
          {loadingMore && <div className="status slim">טוען עוד משחקים…</div>}
          {!hasMore && !loadingMore && items.length > 0 && (
            <div className="status slim">
              הוצגו {items.length} מתוך {total} משחקים
            </div>
          )}
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
