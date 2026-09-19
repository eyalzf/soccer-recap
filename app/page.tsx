'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import GameCard, { type GameItem } from '@/components/GameCard';
import RecapPanel from '@/components/RecapPanel';
import FilterBar, { type LeagueFilter } from '@/components/FilterBar';
import {
  buildTeamRegistry,
  entryFor,
  quickTeams,
} from '@/lib/teamRegistry';
import { getTeamViews, getWatchedGameIds, teamKey } from '@/lib/watch';

interface GamesResponse {
  league: string;
  total: number;
  items: GameItem[];
}

interface LeagueMeta {
  slug: string;
  hebrewName: string;
  badge: string | null;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((dayStart(now) - dayStart(d)) / 86400000);
  if (diffDays === 0) return 'היום';
  if (diffDays === 1) return 'אתמול';
  return d.toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'numeric',
  });
}

export default function Home() {
  const [games, setGames] = useState<GameItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [leagues, setLeagues] = useState<LeagueMeta[]>([]);
  const [league, setLeague] = useState<LeagueFilter>('all');
  const [team, setTeam] = useState<string | null>(null);
  const [hideWatched, setHideWatched] = useState(false);
  const [selected, setSelected] = useState<GameItem | null>(null);
  /** Bumped when the recap modal closes so watch-derived state refreshes. */
  const [watchTick, setWatchTick] = useState(0);

  useEffect(() => {
    fetch('/api/leagues')
      .then((r) => r.json())
      .then((j: LeagueMeta[]) => setLeagues(j))
      .catch(() => {});
  }, []);

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch(`/api/games?league=all${force ? '&nocache=1' : ''}`, {
        cache: 'no-store',
      });
      const j = (await res.json()) as GamesResponse;
      setGames(j.items ?? []);
    } catch {
      setGames([]);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const views = useMemo(() => getTeamViews(), [watchTick]);
  const watchedIds = useMemo(() => getWatchedGameIds(), [watchTick]);
  const registry = useMemo(() => buildTeamRegistry(games), [games]);
  const quick = useMemo(() => quickTeams(registry, views, 10), [registry, views]);

  const filtered = useMemo(
    () =>
      games.filter(
        (g) =>
          (league === 'all' || g.league === league) &&
          (!team || teamKey(g.home) === team || teamKey(g.away) === team) &&
          (!hideWatched || !watchedIds.has(g.id))
      ),
    [games, league, team, hideWatched, watchedIds]
  );

  // Group by calendar day, preserving the API's newest-first order.
  const groups = useMemo(() => {
    const map = new Map<string, GameItem[]>();
    for (const g of filtered) {
      const k = g.dateISO.slice(0, 10);
      const arr = map.get(k);
      if (arr) arr.push(g);
      else map.set(k, [g]);
    }
    return [...map.entries()];
  }, [filtered]);

  const badgeFor = (slug: string): string | null =>
    leagues.find((l) => l.slug === slug)?.badge ?? null;

  const closeModal = () => {
    setSelected(null);
    setWatchTick((t) => t + 1);
  };

  const teamHe = team ? entryFor(team, registry).he : '';

  return (
    <div className="app">
      <div className="topbar">
        <h1>תקצירים</h1>
        <button
          className="refresh-btn"
          disabled={refreshing}
          onClick={() => load(true)}
        >
          {refreshing ? 'מרענן…' : 'רענן'}
        </button>
      </div>

      <FilterBar
        league={league}
        onLeague={(l) => {
          setLeague(l);
          window.scrollTo(0, 0);
        }}
        teams={quick}
        teamKey={team}
        onTeamKey={(k) => {
          setTeam(k);
          window.scrollTo(0, 0);
        }}
        registry={registry}
        hideWatched={hideWatched}
        onHideWatched={setHideWatched}
        leagueBadgeFor={badgeFor}
      />

      {team && (
        <div className="active-team">
          מציג משחקים של <strong>{teamHe}</strong>
          <button onClick={() => setTeam(null)} aria-label="נקה סינון קבוצה">
            ✕
          </button>
        </div>
      )}

      {loading ? (
        <div className="status">טוען משחקים…</div>
      ) : filtered.length === 0 ? (
        <div className="status">
          אין משחקים להצגה
          <br />
          <button className="clear-btn" onClick={() => { setLeague('all'); setTeam(null); setHideWatched(false); }}>
            נקה את כל הסינונים
          </button>
        </div>
      ) : (
        <div className="games-unified">
          {groups.map(([day, dayGames]) => (
            <section key={day}>
              <h2 className="day-header">{dayLabel(dayGames[0].dateISO)}</h2>
              <div className="games">
                {dayGames.map((g) => (
                  <GameCard
                    key={g.id}
                    game={g}
                    watched={watchedIds.has(g.id)}
                    onSelect={setSelected}
                  />
                ))}
              </div>
            </section>
          ))}
          <div className="status slim">
            הוצגו {filtered.length} מתוך {games.length} משחקים
          </div>
        </div>
      )}

      {selected && (
        <RecapPanel game={selected} league={selected.league} onClose={closeModal} />
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
