'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import GameCard, { type GameItem } from '@/components/GameCard';
import RecapPanel from '@/components/RecapPanel';
import FilterBar, {
  type LeagueFilter,
  type Mode,
  type CompetitionChip,
} from '@/components/FilterBar';
import {
  buildTeamRegistry,
  buildNationRegistry,
  entryFor,
  quickTeams,
  FALLBACK_TOP_TEAMS,
  FALLBACK_TOP_NATIONS,
} from '@/lib/teamRegistry';
import {
  getTeamViews,
  getNationViews,
  getWatchedGameIds,
  teamKey,
  nationKey,
} from '@/lib/watch';
import { NATIONAL_COMPETITIONS, isNationalSlug } from '@/lib/leagues';

interface GamesResponse {
  league: string;
  total: number;
  items: GameItem[];
}

interface LeagueMeta {
  slug: string;
  hebrewName: string;
  badge: string | null;
  kind: 'club' | 'national';
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
  /** Clubs by default; the נבחרות toggle is collapsed in the filter bar. */
  const [mode, setMode] = useState<Mode>('clubs');
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

  const isNations = mode === 'nations';
  const clubGames = useMemo(() => games.filter((g) => !isNationalSlug(g.league)), [games]);
  const nationGames = useMemo(() => games.filter((g) => isNationalSlug(g.league)), [games]);
  const modeGames = isNations ? nationGames : clubGames;

  const views = useMemo(
    () => (isNations ? getNationViews() : getTeamViews()),
    [watchTick, isNations]
  );
  const watchedIds = useMemo(() => getWatchedGameIds(), [watchTick]);
  const registry = useMemo(
    () =>
      isNations ? buildNationRegistry(nationGames) : buildTeamRegistry(clubGames),
    [nationGames, clubGames, isNations]
  );
  const quick = useMemo(
    () =>
      quickTeams(
        registry,
        views,
        10,
        isNations ? FALLBACK_TOP_NATIONS : FALLBACK_TOP_TEAMS
      ),
    [registry, views, isNations]
  );

  /** Competition chips for the current mode. National competitions with no
   * games in the last 3 months are hidden from selection until they have
   * games again (the API already prunes them, so presence == visible). */
  const competitions: CompetitionChip[] = useMemo(() => {
    if (isNations) {
      const withGames = new Set(nationGames.map((g) => g.league));
      return NATIONAL_COMPETITIONS.filter((c) => withGames.has(c.slug)).map(
        (c) => ({ slug: c.slug, hebrewName: c.hebrewName })
      );
    }
    return leagues
      .filter((l) => l.kind !== 'national')
      .map((l) => ({ slug: l.slug, hebrewName: l.hebrewName }));
  }, [leagues, nationGames, isNations]);

  const keyFn = isNations ? nationKey : teamKey;
  const filtered = useMemo(
    () =>
      modeGames.filter(
        (g) =>
          (league === 'all' || g.league === league) &&
          (!team || keyFn(g.home) === team || keyFn(g.away) === team) &&
          (!hideWatched || !watchedIds.has(g.id))
      ),
    [modeGames, league, team, hideWatched, watchedIds, keyFn]
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

  const switchMode = (m: Mode) => {
    setMode(m);
    setLeague('all');
    setTeam(null);
    window.scrollTo(0, 0);
  };

  const closeModal = () => {
    setSelected(null);
    setWatchTick((t) => t + 1);
  };

  const teamHe = team ? entryFor(team, registry).he : '';
  const noGamesAtAll = !loading && modeGames.length === 0;

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
        mode={mode}
        onMode={switchMode}
        competitions={competitions}
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
          <button onClick={() => setTeam(null)} aria-label={isNations ? 'נקה סינון נבחרת' : 'נקה סינון קבוצה'}>
            ✕
          </button>
        </div>
      )}

      {loading ? (
        <div className="status">טוען משחקים…</div>
      ) : noGamesAtAll && isNations ? (
        <div className="status">
          אין כרגע משחקי נבחרות — התחרויות יופיעו כאן כשייפתחו
        </div>
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
            הוצגו {filtered.length} מתוך {modeGames.length} משחקים
          </div>
        </div>
      )}

      {selected && (
        <RecapPanel game={selected} league={selected.league} onClose={closeModal} />
      )}

      <footer className="attribution">
        <span>מקור נתוני המשחקים: </span>
        {isNations ? (
          <a href="https://www.uefa.com/uefanationsleague/" target="_blank" rel="noopener noreferrer">
            UEFA
          </a>
        ) : (
          <a href="https://www.fotmob.com" target="_blank" rel="noopener noreferrer">
            FotMob
          </a>
        )}
      </footer>
    </div>
  );
}
