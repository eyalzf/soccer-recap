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
  // Uniform details pill (user pick 2026-10-28, option B): every card
  // names its competition in the pill's bold segment — the cup name
  // for cup ties, the competition name for leading-teams games, and
  // the league/competition name (leagueHe) for everything else — with
  // the stage in the second segment. The league logo is gone: it
  // meant something different on every view (league brand on league
  // cards, the PARENT league's brand on cup cards, a generic view
  // icon on leading-teams cards, a competition emblem on nationals).
  const cupHe = game.cup ? cupLabelHe(game.cup) : null;
  const compHe = game.competition ? competitionLabelHe(game.competition) : null;
  const pillName = cupHe ?? compHe ?? game.leagueHe;
  const pillStage = game.stage && game.stage !== pillName ? game.stage : null;
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
          <span className="details-pill">
            <span className="pill-name">{pillName}</span>
            {pillStage && <span className="pill-stage">{pillStage}</span>}
          </span>
        </div>
      </div>
    </article>
  );
}
