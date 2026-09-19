'use client';

import { useEffect, useState } from 'react';
import RecapPanel from '@/components/RecapPanel';
import type { GameItem } from '@/components/GameCard';

interface FixtureMeta {
  slug: string;
  label: string;
  matcherVersion: number;
  recordedAt: string;
  stale: boolean;
}

interface FixtureFull extends FixtureMeta {
  request: {
    home: string;
    away: string;
    date: string;
    league: string;
    hs: string;
    as: string;
    homeHe?: string;
    awayHe?: string;
  };
}

const num = (v: string): number | null => (v === '' ? null : parseInt(v, 10));

/**
 * Quota-free validation: browse recorded recap searches and open them in
 * the real recap dialog. The dialog replays the fixture instead of calling
 * YouTube, so every validation run costs zero API quota.
 */
export default function FixturesPage() {
  const [fixtures, setFixtures] = useState<FixtureMeta[] | null>(null);
  const [open, setOpen] = useState<{ game: GameItem; league: string; slug: string } | null>(
    null
  );

  useEffect(() => {
    fetch('/api/recap/fixtures')
      .then((r) => r.json())
      .then((d) => setFixtures(d.fixtures ?? []))
      .catch(() => setFixtures([]));
  }, []);

  const openFixture = async (slug: string) => {
    const d = (await (
      await fetch(`/api/recap/fixtures?slug=${encodeURIComponent(slug)}`)
    ).json()) as FixtureFull;
    if (!d.request) return;
    const req = d.request;
    const game: GameItem = {
      id: `fixture:${slug}`,
      league: req.league,
      leagueHe: req.league,
      home: req.home,
      away: req.away,
      homeHe: req.homeHe || req.home,
      awayHe: req.awayHe || req.away,
      dateISO: req.date,
      homeScore: num(req.hs),
      awayScore: num(req.as),
      thumb: null,
      homeBadge: null,
      awayBadge: null,
      leagueBadge: null,
    };
    setOpen({ game, league: req.league, slug });
  };

  return (
    <main className="page-narrow">
      <div className="topbar">
        <h1>פיקסטורות בדיקה</h1>
      </div>
      <p className="muted-line">
        חיפושי תקצירים מוקלטים — פתיחת תקציר מפה לא צורכת quota של יוטיוב.
      </p>

      {fixtures === null && <div className="status">טוען…</div>}
      {fixtures !== null && fixtures.length === 0 && (
        <div className="status">
          אין פיקסטורות עדיין. הקליטו עם scripts/record_fixture.py אחרי איפוס ה-quota.
        </div>
      )}
      <div className="fixture-list">
        {(fixtures ?? []).map((f) => (
          <button key={f.slug} className="fixture-btn" onClick={() => openFixture(f.slug)}>
            <span className="fixture-label">{f.label}</span>
            <span className="fixture-meta">
              {new Date(f.recordedAt).toLocaleDateString('he-IL')}
              {f.stale ? ' · לא מעודכן' : ''}
            </span>
            {f.stale && <span className="stale-badge">stale</span>}
          </button>
        ))}
      </div>

      {open && (
        <RecapPanel
          game={open.game}
          league={open.league}
          fixture={open.slug}
          onClose={() => setOpen(null)}
        />
      )}
    </main>
  );
}
