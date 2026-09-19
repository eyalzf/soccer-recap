'use client';

import { useState } from 'react';
import { LEAGUES, type LeagueSlug } from '@/lib/leagues';
import { matchTeams, type TeamEntry } from '@/lib/teamRegistry';

export type LeagueFilter = 'all' | LeagueSlug;

interface FilterBarProps {
  league: LeagueFilter;
  onLeague: (l: LeagueFilter) => void;
  /** Quick-pick teams (up to 10): most-viewed first, fallback list otherwise. */
  teams: TeamEntry[];
  /** Canonical key of the selected team, or null. */
  teamKey: string | null;
  onTeamKey: (k: string | null) => void;
  registry: Map<string, TeamEntry>;
  hideWatched: boolean;
  onHideWatched: (v: boolean) => void;
  leagueBadgeFor: (slug: string) => string | null;
}

function TeamLogo({ team }: { team: TeamEntry }) {
  if (team.badge) return <img className="tchip-logo" src={team.badge} alt="" loading="lazy" />;
  const initial = (team.he || team.key).trim().charAt(0);
  return <span className="tchip-logo tchip-initial">{initial}</span>;
}

export default function FilterBar({
  league,
  onLeague,
  teams,
  teamKey,
  onTeamKey,
  registry,
  hideWatched,
  onHideWatched,
  leagueBadgeFor,
}: FilterBarProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [query, setQuery] = useState('');
  const matches = matchTeams(query, registry);

  const hasActive = league !== 'all' || teamKey !== null || hideWatched;
  const clearAll = () => {
    onLeague('all');
    onTeamKey(null);
    onHideWatched(false);
    setQuery('');
  };
  const pickTeam = (key: string) => {
    onTeamKey(teamKey === key ? null : key);
    setQuery('');
  };

  return (
    <div className="filterbar">
      {/* League filter */}
      <div className="frow frow-scroll" role="group" aria-label="סינון לפי ליגה">
        <button
          className={'chip' + (league === 'all' ? ' active' : '')}
          onClick={() => onLeague('all')}
        >
          הכל
        </button>
        {LEAGUES.map((l) => (
          <button
            key={l.slug}
            className={'chip' + (league === l.slug ? ' active' : '')}
            onClick={() => onLeague(l.slug)}
          >
            {leagueBadgeFor(l.slug) && (
              <img src={leagueBadgeFor(l.slug) as string} alt="" loading="lazy" />
            )}
            {l.hebrewName}
          </button>
        ))}
      </div>

      {/* Quick team filter */}
      <div className="frow frow-scroll" role="group" aria-label="בחירת קבוצה מהירה">
        {teams.map((t) => (
          <button
            key={t.key}
            className={'tchip' + (teamKey === t.key ? ' active' : '')}
            onClick={() => pickTeam(t.key)}
            title={t.he}
          >
            <TeamLogo team={t} />
            <span className="tchip-name">{t.he}</span>
          </button>
        ))}
        <button
          className={'icon-btn' + (panelOpen ? ' active' : '')}
          onClick={() => setPanelOpen((v) => !v)}
          aria-expanded={panelOpen}
          aria-label="סינון נוסף"
          title="סינון נוסף"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
            <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" strokeWidth="2" />
            <line x1="8.5" y1="11" x2="13.5" y2="11" stroke="currentColor" strokeWidth="2" />
            <line x1="11" y1="8.5" x2="11" y2="13.5" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
      </div>

      {/* Collapsed by default: free-text team search + hide-watched */}
      {panelOpen && (
        <div className="fpanel">
          <input
            className="team-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש קבוצה…"
            aria-label="חיפוש קבוצה"
          />
          {query.trim() !== '' && (
            <div className="search-matches">
              {matches.length === 0 ? (
                <div className="search-empty">לא נמצאו קבוצות</div>
              ) : (
                matches.map((m) => (
                  <button
                    key={m.key}
                    className={'search-match' + (teamKey === m.key ? ' active' : '')}
                    onClick={() => pickTeam(m.key)}
                  >
                    <TeamLogo team={m} />
                    <span>{m.he}</span>
                  </button>
                ))
              )}
            </div>
          )}
          <label className="check-row">
            <input
              type="checkbox"
              checked={hideWatched}
              onChange={(e) => onHideWatched(e.target.checked)}
            />
            הסתר משחקים שנצפו
          </label>
          {hasActive && (
            <button className="clear-btn" onClick={clearAll}>
              נקה את כל הסינונים
            </button>
          )}
        </div>
      )}
    </div>
  );
}
