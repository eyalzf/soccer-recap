'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ResumePlayer from '@/components/ResumePlayer';
import { clearProgress } from '@/lib/playbackProgress';

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Quota-free player testing: render the resume-capable player directly for
 * any YouTube video ID, with no recap search involved.
 */
function Player() {
  const sp = useSearchParams();
  const initial = sp.get('videoId') ?? '';
  const [input, setInput] = useState(initial);
  const [videoId, setVideoId] = useState(initial);
  const valid = YT_ID_RE.test(videoId);

  const reload = () => {
    const id = input.trim();
    if (YT_ID_RE.test(id)) setVideoId(id);
  };

  return (
    <main className="page-narrow">
      <div className="topbar">
        <h1>בדיקת נגן</h1>
      </div>
      <p className="muted-line">
        ניגון ישיר ללא חיפוש — לא צורך quota. לבדיקת המשך ניגון: נגנו, סגרו, ופתחו שוב.
      </p>
      <div className="testplayer-row">
        <input
          className="testplayer-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="YouTube video ID (11 תווים)"
          dir="ltr"
        />
        <button className="close-btn" onClick={reload}>
          נגן
        </button>
        {valid && (
          <button
            className="close-btn"
            onClick={() => {
              clearProgress(videoId);
              setVideoId('');
              setTimeout(() => setVideoId(videoId), 50);
            }}
          >
            נקה התקדמות שמורה
          </button>
        )}
      </div>
      {videoId && !valid && <div className="status">מזהה וידאו לא תקין</div>}
      {valid && (
        <ResumePlayer key={videoId} videoId={videoId} title="בדיקת נגן" />
      )}
    </main>
  );
}

export default function TestPlayerPage() {
  return (
    <Suspense>
      <Player />
    </Suspense>
  );
}
