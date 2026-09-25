'use client';

import CompositeThumb from './CompositeThumb';

export interface GameItem {
  id: string;
  league: string;
  leagueHe: string;
  home: string;
  away: string;
  homeHe: string;
  awayHe: string;
  dateISO: string;
  homeScore: number | null;
  awayScore: number | null;
  thumb: string | null;
  homeBadge: string | null;
  awayBadge: string | null;
  leagueBadge: string | null;
  /** Competition stage label (national competitions), e.g. "שלב הבתים". */
  stage?: string | null;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  );
}

export default function GameCard({
  game,
  watched,
  onSelect,
}: {
  game: GameItem;
  /** The user has opened a recap for this game (view, not necessarily finished). */
  watched?: boolean;
  onSelect: (g: GameItem) => void;
}) {
  return (
    <article className="game-card" onClick={() => onSelect(game)}>
      <div className="thumb">
        {game.thumb ? (
          <img className="thumb" src={game.thumb} alt="" loading="lazy" />
        ) : (
          <CompositeThumb
            homeBadge={game.homeBadge}
            awayBadge={game.awayBadge}
            homeHe={game.homeHe}
            awayHe={game.awayHe}
          />
        )}
      </div>
      <div className="game-body">
        <div className="game-teams">
          {game.homeHe} נגד {game.awayHe}
          {watched && <span className="game-watched">נצפה</span>}
        </div>
        <div className="game-meta">
          <span>{formatDate(game.dateISO)}</span>
          <span className="game-score">
            {game.awayScore} - {game.homeScore}
          </span>
          {game.stage && <span className="game-stage">{game.stage}</span>}
          {game.leagueBadge && <img className="league-logo" src={game.leagueBadge} alt="" />}
        </div>
      </div>
    </article>
  );
}
