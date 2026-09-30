'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  CandidatesResult,
  ChannelCandidate,
} from '@/lib/recap/channelCandidates';

interface Props {
  leagueHe: Record<string, string>;
}

type ScopeSel = { mode: 'league' } | { mode: 'team'; team: string };

function CandidateRow({
  c,
  leagueHe,
  onAction,
  busy,
}: {
  c: ChannelCandidate;
  leagueHe: Record<string, string>;
  onAction: (action: 'add' | 'discard', key: string, teams?: string[]) => void;
  busy: boolean;
}) {
  const [scope, setScope] = useState<ScopeSel>(
    c.scope.teams?.length === 1
      ? { mode: 'team', team: c.scope.teams[0] }
      : { mode: 'league' }
  );
  return (
    <tr>
      <td>
        <div style={{ fontWeight: 600 }}>{c.channel}</div>
        {c.channelId && (
          <div style={{ fontSize: 11, opacity: 0.6, direction: 'ltr', textAlign: 'right' }}>
            {c.channelId}
          </div>
        )}
      </td>
      <td>{leagueHe[c.league] ?? c.league}</td>
      <td>{c.hits}</td>
      <td>{c.games}</td>
      <td>
        <div style={{ fontSize: 12, opacity: 0.85, maxWidth: 320 }}>
          {c.sampleTitles.map((t, i) => (
            <div key={i} style={{ marginBottom: 2 }}>
              · {t}
            </div>
          ))}
        </div>
      </td>
      <td>
        <select
          value={scope.mode === 'team' ? `team:${scope.team}` : 'league'}
          onChange={(e) => {
            const v = e.target.value;
            setScope(v === 'league' ? { mode: 'league' } : { mode: 'team', team: v.slice(5) });
          }}
          style={{ maxWidth: 160 }}
          disabled={busy}
        >
          <option value="league">כל הליגה</option>
          {c.teams.map((t) => (
            <option key={t} value={`team:${t}`}>
              {t} בלבד
            </option>
          ))}
        </select>
      </td>
      <td>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="refresh-btn"
            disabled={busy}
            onClick={() =>
              onAction(
                'add',
                c.key,
                scope.mode === 'team' ? [scope.team] : undefined
              )
            }
          >
            הוסף
          </button>
          <button className="refresh-btn" disabled={busy} onClick={() => onAction('discard', c.key)}>
            דחה
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function CandidatesClient({ leagueHe }: Props) {
  const [data, setData] = useState<CandidatesResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/recap/channel-candidates');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = useCallback(
    async (action: 'add' | 'discard' | 'cancel-pending', key: string, teams?: string[]) => {
      setBusy(true);
      setError(null);
      try {
        const r = await fetch('/api/recap/channel-candidates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, key, teams }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setData(await r.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    []
  );

  if (error) return <p className="empty">שגיאה בטעינת המועמדים: {error}</p>;
  if (!data) return <p className="empty">טוען…</p>;

  const { candidates, ops, searchesSeen, hitThreshold } = data;

  return (
    <div>
      <p className="empty" style={{ textAlign: 'right' }}>
        ערוצים שניצחו {hitThreshold}+ תוצאות בחיפוש הכללי ב־14 הימים האחרונים (
        {searchesSeen} חיפושים חדשים נסרקו) ואינם במאגר הערוצים.
        {searchesSeen === 0 &&
          ' מעקב הערוצים החל מהפריסה הנוכחית — מועמדים יופיעו לאחר חיפושים חדשים.'}
      </p>

      <h2 className="log-h2">מועמדים ({candidates.length})</h2>
      {candidates.length === 0 ? (
        <p className="empty">אין מועמדים כרגע.</p>
      ) : (
        <table className="log-table">
          <thead>
            <tr>
              <th>ערוץ</th>
              <th>ליגה</th>
              <th>ניצחונות</th>
              <th>משחקים</th>
              <th>דוגמאות</th>
              <th>היקף</th>
              <th>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <CandidateRow key={c.key} c={c} leagueHe={leagueHe} onAction={act} busy={busy} />
            ))}
          </tbody>
        </table>
      )}

      {ops.pending.length > 0 && (
        <>
          <h2 className="log-h2">אושרו — ממתינים לפריסה ({ops.pending.length})</h2>
          <table className="log-table">
            <thead>
              <tr>
                <th>ערוץ</th>
                <th>היקף</th>
                <th>פעולות</th>
              </tr>
            </thead>
            <tbody>
              {ops.pending.map((p) => (
                <tr key={p.key}>
                  <td>{p.channel}</td>
                  <td>
                    {(leagueHe[p.league] ?? p.league) +
                      (p.teams?.length ? ` · ${p.teams.join(', ')}` : ' · כל הליגה')}
                  </td>
                  <td>
                    <button
                      className="refresh-btn"
                      disabled={busy}
                      onClick={() => act('cancel-pending', p.key)}
                    >
                      בטל
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="empty" style={{ textAlign: 'right' }}>
            הוספה למאגר דורשת שינוי קוד — אמור לי ואעלה לענף preview לאישורך לפני production.
          </p>
        </>
      )}

      {ops.discarded.length > 0 && (
        <>
          <h2 className="log-h2">נדחו ({ops.discarded.length})</h2>
          <table className="log-table">
            <thead>
              <tr>
                <th>ערוץ</th>
                <th>ליגה</th>
                <th>יחזור להצעה ב־</th>
              </tr>
            </thead>
            <tbody>
              {ops.discarded.map((d) => (
                <tr key={d.key} style={{ opacity: 0.65 }}>
                  <td>{d.channel}</td>
                  <td>{leagueHe[d.league] ?? d.league}</td>
                  <td>{(d.countAtDiscard ?? 0) + hitThreshold} ניצחונות</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
