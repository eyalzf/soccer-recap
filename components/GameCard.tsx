'use client';

import CompositeThumb from './CompositeThumb';

export interface GameItem {
  id: string;
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
  onSelect,
}: {
  game: GameItem;
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
        </div>
        <div className="game-meta">
          <span>{formatDate(game.dateISO)}</span>
          <span className="game-score">
            {game.homeScore} - {game.awayScore}
          </span>
          {game.leagueBadge && <img className="league-logo" src={game.leagueBadge} alt="" />}
        </div>
      </div>
    </article>
  );
}
