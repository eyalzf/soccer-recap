'use client';

import { useEffect, useState } from 'react';
import type { GameItem } from './GameCard';

interface Candidate {
  id: string;
  title: string;
  url: string;
  source: string;
  videoId?: string;
  thumbnail?: string;
  publishedAt?: string;
  channelName?: string;
  lang: string;
  score: number;
}

const SOURCE_HE: Record<string, string> = {
  youtube: 'יוטיוב',
  sport1: 'ספורט1',
  sport5: 'ספורט5',
  one: 'ONE',
};

export default function RecapPanel({
  game,
  league,
  onClose,
}: {
  game: GameItem;
  league: string;
  onClose: () => void;
}) {
  const [results, setResults] = useState<Candidate[]>([]);
  const [pending, setPending] = useState(0);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<Candidate | null>(null);

  useEffect(() => {
    setResults([]);
    setSelected(null);
    setStarted(false);
    setFailed(false);
    const q = new URLSearchParams({
      home: game.home,
      away: game.away,
      date: game.dateISO,
      league,
      hs: game.homeScore == null ? '' : String(game.homeScore),
      as: game.awayScore == null ? '' : String(game.awayScore),
    });
    const es = new EventSource(`/api/recap?${q.toString()}`);
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as {
          type: string;
          results?: Candidate[];
          pending?: number;
        };
        if (data.type === 'start') {
          setStarted(true);
          setPending(data.pending ?? 0);
        } else if (data.type === 'batch') {
          setResults(data.results ?? []);
          setPending(data.pending ?? 0);
        } else if (data.type === 'done') {
          setResults(data.results ?? []);
          setPending(0);
          es.close();
        }
      } catch {
        /* ignore malformed chunk */
      }
    };
    es.onerror = () => {
      es.close();
      setPending(0);
      setFailed(true);
    };
    return () => es.close();
  }, [game, league]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>
            {game.homeHe} {game.homeScore} - {game.awayScore} {game.awayHe}
          </h2>
          <button className="close-btn" onClick={onClose}>
            סגור
          </button>
        </div>

        {selected?.videoId ? (
          <div className="player-wrap">
            <iframe
              src={`https://www.youtube.com/embed/${selected.videoId}?rel=0&playsinline=1&fs=1&enablejsapi=1`}
              title={selected.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : selected ? (
          <a
            className="source-link"
            href={selected.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            פתח במקור ({SOURCE_HE[selected.source] ?? selected.source})
          </a>
        ) : null}

        {pending > 0 && (
          <div className="loading-row" aria-live="polite">
            <span className="spinner" />
            מחפש תקצירים…
          </div>
        )}

        <div className="recap-list">
          {results.map((c) => (
            <button
              key={c.id}
              className={'recap-item' + (selected?.id === c.id ? ' selected' : '')}
              onClick={() => setSelected(c)}
            >
              {c.thumbnail && <img src={c.thumbnail} alt="" loading="lazy" />}
              <span>
                <span className="recap-title">{c.title}</span>
                <br />
                <span className="recap-src">
                  {SOURCE_HE[c.source] ?? c.source}
                  {c.channelName ? ` · ${c.channelName}` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>

        {failed && results.length === 0 && (
          <div className="empty">החיפוש נכשל — נסו שוב מאוחר יותר</div>
        )}
        {started && pending === 0 && !failed && results.length === 0 && (
          <div className="empty">לא נמצאו תקצירים למשחק זה</div>
        )}
      </div>
    </div>
  );
}
