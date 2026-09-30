'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SweepProposal, SweepReport } from '@/lib/recap/sweep';

function fmtDate(ts: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ProposalRow({
  p,
  leagueHe,
  onAction,
  busy,
}: {
  p: SweepProposal;
  leagueHe: Record<string, string>;
  onAction: (action: 'deny' | 'discard', p: SweepProposal) => void;
  busy: boolean;
}) {
  return (
    <tr>
      <td>
        <div style={{ fontWeight: 600 }}>{p.channel}</div>
        {p.channelId && (
          <div style={{ fontSize: 11, opacity: 0.6, direction: 'ltr', textAlign: 'right' }}>
            {p.channelId}
          </div>
        )}
        {p.inPlans.length > 0 && (
          <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>
            במאגר: {p.inPlans.map((s) => leagueHe[s] ?? s).join(', ')}
          </div>
        )}
      </td>
      <td>
        {p.dead} מתוך {p.total}
        <div style={{ fontSize: 11, opacity: 0.65 }}>
          {p.criterion === 'volume' ? 'קריטריון נפח' : 'קריטריון שיעור'}
        </div>
      </td>
      <td>
        <div style={{ fontSize: 12, opacity: 0.85, maxWidth: 320 }}>
          {p.sampleTitles.map((t, i) => (
            <div key={i} style={{ marginBottom: 2 }}>
              · {t}
            </div>
          ))}
        </div>
      </td>
      <td>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="refresh-btn"
            disabled={busy}
            onClick={() => onAction('deny', p)}
            title="מוסיף את הערוץ לרשימת החסימה — הסרטונים שלו לא יופיעו יותר"
          >
            הסר
          </button>
          <button
            className="refresh-btn"
            disabled={busy}
            onClick={() => onAction('discard', p)}
            title="מאפס את הספירה — יחזור להצעה רק אחרי סרטונים מתים חדשים"
          >
            דחה
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function SweepClient({ leagueHe }: { leagueHe: Record<string, string> }) {
  const [data, setData] = useState<SweepReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/recap/sweep?mode=report');
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
    async (action: 'deny' | 'discard', p: SweepProposal) => {
      setBusy(true);
      setError(null);
      try {
        const r = await fetch('/api/recap/sweep', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            channel: p.channel,
            channelId: p.channelId,
            handle: p.handle,
            dead: p.dead,
          }),
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

  if (error) return <p className="empty">שגיאה בטעינת הסריקה: {error}</p>;
  if (!data) return <p className="empty">טוען…</p>;

  const pending = data.proposals.filter((p) => p.status === 'pending');
  const denied = data.proposals.filter((p) => p.status === 'denied');
  const discarded = data.proposals.filter((p) => p.status === 'discarded');

  return (
    <div>
      <p className="empty" style={{ textAlign: 'right' }}>
        סריקה שבועית של תקינות הסרטונים במטמון. סריקה אחרונה: {fmtDate(data.lastRun)}
        {data.lastRun > 0 && (
          <>
            {' '}
            · נסרקו {data.gamesScanned} משחקים, נבדקו {data.videosChecked} סרטונים,
            הוסרו {data.deadRemoved} מתים.
          </>
        )}
        {data.error && <> · שגיאה בסריקה האחרונה: {data.error}</>}
        {data.lastRun === 0 && ' הסריקה השבועית טרם רצה.'}
      </p>

      <h2 className="log-h2">מועמדים לחסימה ({pending.length})</h2>
      {pending.length === 0 ? (
        <p className="empty">אין מועמדים כרגע.</p>
      ) : (
        <table className="log-table">
          <thead>
            <tr>
              <th>ערוץ</th>
              <th>סרטונים מתים</th>
              <th>דוגמאות</th>
              <th>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((p) => (
              <ProposalRow
                key={p.channelId ?? p.handle ?? p.channel}
                p={p}
                leagueHe={leagueHe}
                onAction={act}
                busy={busy}
              />
            ))}
          </tbody>
        </table>
      )}

      {denied.length > 0 && (
        <>
          <h2 className="log-h2">ברשימת החסימה ({denied.length})</h2>
          <table className="log-table">
            <thead>
              <tr>
                <th>ערוץ</th>
                <th>נחסם</th>
              </tr>
            </thead>
            <tbody>
              {denied.map((p) => (
                <tr
                  key={p.channelId ?? p.handle ?? p.channel}
                  style={{ opacity: 0.65 }}
                >
                  <td>{p.channel}</td>
                  <td>{fmtDate(p.deniedAt ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {discarded.length > 0 && (
        <>
          <h2 className="log-h2">נדחו ({discarded.length})</h2>
          <table className="log-table">
            <thead>
              <tr>
                <th>ערוץ</th>
                <th>יחזור להצעה אחרי</th>
              </tr>
            </thead>
            <tbody>
              {discarded.map((p) => (
                <tr
                  key={p.channelId ?? p.handle ?? p.channel}
                  style={{ opacity: 0.65 }}
                >
                  <td>{p.channel}</td>
                  <td>{(p.deadAtDiscard ?? 0) + 2} סרטונים מתים</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
