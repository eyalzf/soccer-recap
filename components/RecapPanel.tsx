'use client';

import { useEffect, useState } from 'react';
import type { GameItem } from './GameCard';
import CompositeThumb from './CompositeThumb';
import ResumePlayer from './ResumePlayer';
import { isWatched, progressFraction } from '../lib/playbackProgress';
import { recordGameView, recordNationGameView } from '../lib/watch';
import { isNationalSlug } from '../lib/leagues';

interface Candidate {
  id: string;
  title: string;
  url: string;
  source: string;
  videoId?: string;
  thumbnail?: string;
  publishedAt?: string;
  durationSec?: number;
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

/** 83 -> "1:23", 3661 -> "1:01:01". */
function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? h + ':' : ''}${mm}:${String(r).padStart(2, '0')}`;
}

export default function RecapPanel({
  game,
  league,
  fixture,
  onClose,
}: {
  game: GameItem;
  league: string;
  /** When set, replay a recorded fixture instead of a live YouTube search (zero quota). */
  fixture?: string;
  onClose: () => void;
}) {
  const [results, setResults] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [, setProgressTick] = useState(0);

  /** A view counts when the user SELECTS a video — watching it fully is not required. */
  const selectCandidate = (c: Candidate) => {
    if (isNationalSlug(league)) recordNationGameView(game.id, game.home, game.away);
    else recordGameView(game.id, game.home, game.away);
    setSelected(c);
  };
  /** Candidate ids whose YouTube thumbnail failed to load (fall back to crests). */
  const [brokenThumb, setBrokenThumb] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setResults([]);
    setSelected(null);
    setLoading(true);
    setFailed(false);
    setRateLimited(false);
    setBrokenThumb({});
    const q = new URLSearchParams({
      home: game.home,
      away: game.away,
      date: game.dateISO,
      league,
      hs: game.homeScore == null ? '' : String(game.homeScore),
      as: game.awayScore == null ? '' : String(game.awayScore),
    });
    const es = new EventSource(
      `/api/recap?${q.toString()}${fixture ? `&fixture=${encodeURIComponent(fixture)}` : ''}`
    );
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as {
          type: string;
          results?: Candidate[];
          pending?: number;
          ytRateLimited?: boolean;
        };
        if (data.type === 'start') {
          setLoading(true);
        } else if (data.type === 'batch') {
          setResults(data.results ?? []);
          setLoading(false);
        } else if (data.type === 'done') {
          setResults(data.results ?? []);
          setLoading(false);
          if (data.ytRateLimited) setRateLimited(true);
          es.close();
        }
      } catch {
        /* ignore malformed chunk */
      }
    };
    es.onerror = () => {
      es.close();
      setLoading(false);
      setFailed(true);
    };
    return () => es.close();
  }, [game, league, fixture]);

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
          <ResumePlayer
            key={selected.videoId}
            videoId={selected.videoId}
            title={selected.title}
            onProgress={() => setProgressTick((n) => n + 1)}
          />
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

        {loading && (
          <div className="loading-row" aria-live="polite">
            <span className="spinner" />
            מחפש תקצירים…
          </div>
        )}

        <div className="recap-list">
          {results.map((c) => {
            const watched = c.videoId ? isWatched(c.videoId) : false;
            const frac = !watched && c.videoId ? progressFraction(c.videoId) : null;
            const showThumb = !!c.thumbnail && !brokenThumb[c.id];
            return (
              <button
                key={c.id}
                className={'recap-item' + (selected?.id === c.id ? ' selected' : '')}
                onClick={() => selectCandidate(c)}
              >
                <span className="recap-thumb">
                  {showThumb ? (
                    <img
                      src={c.thumbnail}
                      alt=""
                      loading="lazy"
                      onError={() =>
                        setBrokenThumb((b) => (b[c.id] ? b : { ...b, [c.id]: true }))
                      }
                    />
                  ) : (
                    <CompositeThumb
                      homeBadge={game.homeBadge}
                      awayBadge={game.awayBadge}
                      homeHe={game.homeHe}
                      awayHe={game.awayHe}
                    />
                  )}
                  {c.durationSec != null && c.durationSec > 0 && (
                    <span className="duration-badge">{formatDuration(c.durationSec)}</span>
                  )}
                </span>
                <span>
                  <span className="recap-title">{c.title}</span>
                  <br />
                  <span className="recap-src">
                    {SOURCE_HE[c.source] ?? c.source}
                    {c.channelName ? ` · ${c.channelName}` : ''}
                  </span>
                  {watched && <span className="watched-badge">נצפה ✓</span>}
                  {frac != null && (
                    <span className="progress-track" aria-hidden="true">
                      <span
                        className="progress-fill"
                        style={{ width: `${Math.round(frac * 100)}%` }}
                      />
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {failed && results.length === 0 && (
          <div className="empty">החיפוש נכשל — נסו שוב מאוחר יותר</div>
        )}
        {!failed && rateLimited && results.length === 0 && (
          <div className="empty">יוטיוב מגביל כרגע חיפושים — נסו שוב בעוד כמה דקות</div>
        )}
        {!loading && !failed && !rateLimited && results.length === 0 && (
          <div className="empty">לא נמצאו תקצירים למשחק זה</div>
        )}
      </div>
    </div>
  );
}
