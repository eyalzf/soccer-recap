import Link from 'next/link';
import { readSearchLog } from '@/lib/recap/searchLog';
import type { SearchLogEntry, SearchWinner } from '@/lib/recap/searchLog';
import { toHebrew } from '@/lib/teamIndex';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'יומן חיפושי תקצירים' };

const LEAGUE_HE: Record<string, string> = {
  'israeli-league': 'ליגת העל',
  'premier-league': 'פרמייר ליג',
  'la-liga': 'לה ליגה',
  'champions-league': 'ליגת האלופות',
};

const WINNER_HE: Record<SearchWinner, string> = {
  preferred: 'ערוץ מועדף',
  bulk: 'מאגר ערוצים',
  general: 'חיפוש כללי',
  none: 'ללא תקציר ראוי',
  cache: 'מטמון',
};

interface Agg {
  n: number;
  preferred: number;
  bulk: number;
  general: number;
  none: number;
  fallback: number;
}

const emptyAgg = (): Agg => ({ n: 0, preferred: 0, bulk: 0, general: 0, none: 0, fallback: 0 });

function bump(a: Agg, e: SearchLogEntry): void {
  a.n += 1;
  const w = e.winner ?? 'none';
  if (w === 'preferred') a.preferred += 1;
  else if (w === 'bulk') a.bulk += 1;
  else if (w === 'general') a.general += 1;
  else a.none += 1;
  if (e.general.ran > 0) a.fallback += 1;
}

const pct = (a: number, b: number): string => (b ? `${Math.round((a / b) * 100)}%` : '—');

function fmtTime(t: number): string {
  return new Date(t).toLocaleString('he-IL', {
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function SearchLogPage() {
  const days = await readSearchLog(7);
  const entries = days
    .flatMap((d) => d.entries)
    .sort((a, b) => b.t - a.t);
  const searched = entries.filter((e) => !e.cached);
  const cached = entries.length - searched.length;

  const total = emptyAgg();
  const byLeague = new Map<string, Agg>();
  for (const e of searched) {
    bump(total, e);
    const a = byLeague.get(e.league) ?? emptyAgg();
    bump(a, e);
    byLeague.set(e.league, a);
  }

  const recent = entries.slice(0, 40);

  return (
    <div className="app">
      <div className="topbar">
        <h1>יומן חיפושי תקצירים</h1>
        <Link href="/" className="refresh-btn">
          חזרה
        </Link>
      </div>

      <div className="log-summary">
        <div className="log-card">
          <div className="log-num">{searched.length}</div>
          <div className="log-label">חיפושים (7 ימים)</div>
        </div>
        <div className="log-card">
          <div className="log-num">{cached}</div>
          <div className="log-label">נשלפו ממטמון</div>
        </div>
        <div className="log-card warn">
          <div className="log-num">
            {total.fallback} <span className="log-pct">({pct(total.fallback, total.n)})</span>
          </div>
          <div className="log-label">נפלו לחיפוש כללי</div>
        </div>
      </div>

      <h2 className="log-h2">לפי ליגה</h2>
      <table className="log-table">
        <thead>
          <tr>
            <th>ליגה</th>
            <th>חיפושים</th>
            <th>מועדף</th>
            <th>מאגר</th>
            <th>חיפוש כללי</th>
            <th>ללא תקציר</th>
            <th>שיעור נפילה</th>
          </tr>
        </thead>
        <tbody>
          {[...byLeague.entries()].map(([league, a]) => (
            <tr key={league}>
              <td>{LEAGUE_HE[league] ?? league}</td>
              <td>{a.n}</td>
              <td>{a.preferred}</td>
              <td>{a.bulk}</td>
              <td>{a.general}</td>
              <td>{a.none}</td>
              <td>{pct(a.fallback, a.n)}</td>
            </tr>
          ))}
          {byLeague.size === 0 && (
            <tr>
              <td colSpan={7} className="empty">
                אין חיפושים מתועדים עדיין — היומן מתמלא החל מהחיפוש הבא
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2 className="log-h2">חיפושים אחרונים</h2>
      <table className="log-table">
        <thead>
          <tr>
            <th>שעה</th>
            <th>משחק</th>
            <th>ליגה</th>
            <th>מקור מנצח</th>
            <th>תוצאות</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((e, i) => (
            <tr key={`${e.t}-${i}`}>
              <td>{fmtTime(e.t)}</td>
              <td>
                {toHebrew(e.home)} נגד {toHebrew(e.away)}
                {e.rateLimited ? ' ⚠️' : ''}
              </td>
              <td>{LEAGUE_HE[e.league] ?? e.league}</td>
              <td>{WINNER_HE[e.winner ?? 'none'] ?? e.winner}</td>
              <td>{e.results}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer className="attribution">
        היומן נשמר ב־Blob בלבד (searchlog/YYYY-MM-DD.json), עד 500 רשומות ליום.
      </footer>
    </div>
  );
}
