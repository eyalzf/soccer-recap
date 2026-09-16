'use client';

import { useEffect, useRef, useState } from 'react';
import {
  getResumeSeconds,
  markWatched,
  saveProgress,
} from '../lib/playbackProgress';

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<void> | null = null;

function loadYouTubeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (!ytApiPromise) {
    ytApiPromise = new Promise<void>((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        try {
          prev?.();
        } finally {
          resolve();
        }
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      document.head.appendChild(s);
    });
  }
  return ytApiPromise;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * YouTube player that resumes from the last saved position and persists
 * playback state (position while watching, watched when finished).
 */
export default function ResumePlayer({
  videoId,
  title,
  onProgress,
}: {
  videoId: string;
  title: string;
  onProgress?: () => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [resumeLabel, setResumeLabel] = useState<string | null>(null);

  useEffect(() => {
    let player: any = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    let destroyed = false;
    let resumeApplied = false;

    const stopTracking = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    const saved = () => {
      onProgress?.();
    };

    const snapshot = () => {
      try {
        return {
          t: player.getCurrentTime() as number,
          d: (player.getDuration?.() as number) ?? 0,
          st: player.getPlayerState?.() as number | undefined,
        };
      } catch {
        return null;
      }
    };

    loadYouTubeApi().then(() => {
      if (destroyed || !mountRef.current || !window.YT?.Player) return;
      const YT = window.YT;
      player = new YT.Player(mountRef.current, {
        videoId,
        playerVars: { rel: 0, playsinline: 1, fs: 1 },
        events: {
          onReady: (e: any) => {
            const t = getResumeSeconds(videoId);
            if (t != null) {
              try {
                e.target.seekTo(t, true);
                resumeApplied = true;
                setResumeLabel(fmt(t));
              } catch {
                // seek failed; playback starts from 0
              }
            }
          },
          onStateChange: (e: any) => {
            const st = e.data as number;
            if (st === YT.PlayerState.PLAYING) {
              // Safety net: some embeds ignore an early seekTo, so re-apply once playing.
              if (!resumeApplied) {
                resumeApplied = true;
                const t = getResumeSeconds(videoId);
                if (t != null) {
                  try {
                    if (Math.abs(e.target.getCurrentTime() - t) > 3) {
                      e.target.seekTo(t, true);
                      setResumeLabel(fmt(t));
                    }
                  } catch {
                    // ignore
                  }
                }
              }
              stopTracking();
              interval = setInterval(() => {
                const snap = snapshot();
                if (snap && snap.st === YT.PlayerState.PLAYING) {
                  saveProgress(videoId, snap.t, snap.d);
                  saved();
                }
              }, 5000);
            } else if (st === YT.PlayerState.PAUSED) {
              stopTracking();
              const snap = snapshot();
              if (snap) {
                saveProgress(videoId, snap.t, snap.d);
                saved();
              }
            } else if (st === YT.PlayerState.ENDED) {
              stopTracking();
              const snap = snapshot();
              markWatched(videoId, snap?.d ?? 0);
              saved();
            }
          },
        },
      });
    });

    return () => {
      destroyed = true;
      stopTracking();
      try {
        const snap = snapshot();
        if (snap && snap.st === window.YT?.PlayerState?.ENDED) {
          markWatched(videoId, snap.d);
        } else if (snap) {
          saveProgress(videoId, snap.t, snap.d);
        }
        saved();
        player?.destroy?.();
      } catch {
        // ignore teardown errors
      }
    };
  }, [videoId]);

  // Fade the "resuming" chip after a few seconds.
  useEffect(() => {
    if (!resumeLabel) return;
    const id = setTimeout(() => setResumeLabel(null), 6000);
    return () => clearTimeout(id);
  }, [resumeLabel]);

  return (
    <div className="player-wrap player-wrap--api">
      <div ref={mountRef} className="player-mount" aria-label={title} />
      {resumeLabel && <div className="resume-chip">ממשיך מ־{resumeLabel}</div>}
    </div>
  );
}
