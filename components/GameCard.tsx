'use client';

import CompositeThumb from './CompositeThumb';
import { cupLabelHe } from '../lib/cups';
import { competitionLabelHe } from '../lib/competitions';

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
  /** Competition stage/round label, e.g. "שלב הבתים" or "מחזור 5". */
  stage?: string | null;
  /** Domestic-cup slug (lib/cups.ts) for cup ties inside a league listing. */
  cup?: string | null;
  /** Competition slug (lib/competitions.ts) for leading-teams games. */
  competition?: string | null;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' });
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
  const hasScore = game.homeScore != null && game.awayScore != null;
  return (
    <article
      className={`game-card${hasScore ? ' has-score' : ''}`}
      onClick={() => onSelect(game)}
    >
      <div className="thumb-wrap">
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
        {hasScore && (
          <span className="score-pill">
            {game.awayScore} - {game.homeScore}
          </span>
        )}
      </div>
      <div className="game-body">
        <div className="game-teams">
          {game.homeHe} נגד {game.awayHe}
          {watched && <span className="game-watched">נצפה</span>}
        </div>
        <div className="game-meta">
          <span className="game-date">{formatDate(game.dateISO)}</span>
          {game.cup && cupLabelHe(game.cup) ? (
            <span className="game-stage game-cup">
              🏆 {cupLabelHe(game.cup)}
              {game.stage ? ` · ${game.stage}` : ''}
            </span>
          ) : game.competition && competitionLabelHe(game.competition) ? (
            <span className="game-stage game-cup">
              ⭐ {competitionLabelHe(game.competition)}
              {game.stage ? ` · ${game.stage}` : ''}
            </span>
          ) : (
            game.stage && <span className="game-stage">{game.stage}</span>
          )}
          {game.leagueBadge && <img className="league-logo" src={game.leagueBadge} alt="" />}
        </div>
      </div>
    </article>
  );
}
