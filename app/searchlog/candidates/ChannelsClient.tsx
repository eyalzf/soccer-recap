'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChannelStat } from '@/lib/recap/channelStats';
import type { DenyEntry } from '@/lib/recap/denyList';

interface Props {
  leagueHe: Record<string, string>;
}

interface StatsData {
  channels: ChannelStat[];
  denied: DenyEntry[];
  searchesSeen: number;
}

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

function tierSummary(c: ChannelStat): string {
  const parts: string[] = [];
  if (c.tiers.sport1) parts.push(`S1:${c.tiers.sport1}`);
  if (c.tiers.preferred) parts.push(`P:${c.tiers.preferred}`);
  if (c.tiers.bulk) parts.push(`B:${c.tiers.bulk}`);
  if (c.tiers.general) parts.push(`G:${c.tiers.general}`);
  return parts.join(' · ');
}

const normName = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9\u0590-\u05ff]/g, '');

/**
 * Does a deny entry correspond to a (blocked) stats row? channelId
 * first, then normalized handle vs the row's display name (roster rows
 * are named by handle when no label exists), then normalized title.
 * Used to avoid listing the same block twice: the deny list stays
 * authoritative, the stats row carries the activity context.
 */
function rowMatchesDenyEntry(c: ChannelStat, e: DenyEntry): boolean {
  if (e.channelId && c.channelId && e.channelId === c.channelId) return true;
  const n = normName(c.channel);
  if (normName(e.channel) === n) return true;
  if (e.handle && normName(e.handle) === n) return true;
  return false;
}

function ChannelRow({
  c,
  leagueHe,
  onDeny,
  onUndeny,
  denyReason,
  busy,
}: {
  c: ChannelStat;
  leagueHe: Record<string, string>;
  onDeny: (c: ChannelStat) => void;
  onUndeny?: (c: ChannelStat) => void;
  denyReason?: string;
  busy: boolean;
}) {
  const inPlansHe = c.inPlans.map((s) => leagueHe[s] ?? s);
  const teams = [...new Set(c.scopeByLeague.flatMap((s) => s.teams ?? []))];
  return (
    <tr style={c.denied ? { opacity: 0.65 } : undefined}>
      <td>
        <div style={{ fontWeight: 600 }}>
          {c.channelId ? (
            <a
              href={`https://www.youtube.com/channel/${c.channelId}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'inherit' }}
            >
              {c.channel}
            </a>
          ) : (
            c.channel
          )}
        </div>
        {c.channelId && (
          <div style={{ fontSize: 11, opacity: 0.6, direction: 'ltr', textAlign: 'right' }}>
            {c.channelId}
          </div>
        )}
        {c.inPlans.length > 0 && (
          <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>
            במאגר: {inPlansHe.join(', ')}
          </div>
        )}
        {teams.length > 0 && (
          <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>
            קבוצות: {teams.join(', ')}
          </div>
        )}
        {c.denied && (
          <div style={{ fontSize: 11, marginTop: 2, fontWeight: 700 }}>חסום</div>
        )}
        {denyReason && (
          <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>
            סיבה: {denyReason}
          </div>
        )}
      </td>
      <td>{c.kept}</td>
      <td>{c.games}</td>
      <td title="S1=ספורט1 · P=מועדף · B=מאגר · G=חיפוש כללי">
        <span style={{ direction: 'ltr', display: 'inline-block' }}>
          {tierSummary(c)}
        </span>
      </td>
      <td>{c.leagues.map((s) => leagueHe[s] ?? s).join(', ')}</td>
      <td>
        <div style={{ fontSize: 12, opacity: 0.85, maxWidth: 320 }}>
          {c.sampleTitles.map((t, i) => (
            <div key={i} style={{ marginBottom: 2 }}>
              · {t}
            </div>
          ))}
        </div>
      </td>
      <td>{fmtDate(c.lastSeen)}</td>
      <td>
        {c.denied ? (
          onUndeny && (
            <button
              className="refresh-btn"
              disabled={busy}
              onClick={() => onUndeny(c)}
              title="מסיר את הערוץ מרשימת החסימה — הסרטונים שלו יחזרו להופיע"
            >
              הסר חסימה
            </button>
          )
        ) : (
          <button
            className="refresh-btn"
            disabled={busy}
            onClick={() => onDeny(c)}
            title="מוסיף את הערוץ לרשימת החסימה — הסרטונים שלו לא יופיעו יותר"
          >
            חסום
          </button>
        )}
      </td>
    </tr>
  );
}

function ChannelTable({
  rows,
  leagueHe,
  onDeny,
  onUndeny,
  denied,
  busy,
}: {
  rows: ChannelStat[];
  leagueHe: Record<string, string>;
  onDeny: (c: ChannelStat) => void;
  onUndeny?: (c: ChannelStat) => void;
  denied: DenyEntry[];
  busy: boolean;
}) {
  if (rows.length === 0) return <p className="empty">אין ערוצים.</p>;
  return (
    <table className="log-table">
      <thead>
        <tr>
          <th>ערוץ</th>
          <th>תוצאות</th>
          <th>משחקים</th>
          <th>שלבים</th>
          <th>ליגות</th>
          <th>דוגמאות</th>
          <th>נראה לאחרונה</th>
          <th>פעולות</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <ChannelRow
            key={c.key}
            c={c}
            leagueHe={leagueHe}
            onDeny={onDeny}
            onUndeny={onUndeny}
            denyReason={
              c.denied
                ? denied.find((e) => rowMatchesDenyEntry(c, e))?.reason
                : undefined
            }
            busy={busy}
          />
        ))}
      </tbody>
    </table>
  );
}

export default function ChannelsClient({ leagueHe }: Props) {
  const [data, setData] = useState<StatsData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [listTab, setListTab] = useState<
    'general' | 'curated' | 'per-team' | 'blocked'
  >('general');

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/recap/channel-stats');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const post = useCallback(
    async (body: Record<string, string | undefined>) => {
      setBusy(true);
      setError(null);
      try {
        const r = await fetch('/api/recap/channel-stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
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

  const deny = useCallback(
    (c: ChannelStat) => {
      const warn =
        c.inPlans.length > 0
          ? `\nשים לב: הערוץ נמצא במאגר הערוצים של ${c.inPlans
              .map((s) => leagueHe[s] ?? s)
              .join(', ')}.`
          : '';
      if (
        !window.confirm(
          `לחסום את "${c.channel}"? הסרטונים שלו לא יופיעו יותר בתוצאות.${warn}`
        )
      )
        return;
      void post({
        action: 'deny',
        channel: c.channel,
        channelId: c.channelId,
      });
    },
    [leagueHe, post]
  );

  const undenyRow = useCallback(
    (c: ChannelStat) => {
      if (!window.confirm(`להסיר את החסימה על "${c.channel}"?`)) return;
      void post({
        action: 'undeny',
        channel: c.channel,
        channelId: c.channelId,
      });
    },
    [post]
  );

  const undeny = useCallback(
    (e: DenyEntry) => {
      if (!window.confirm(`להסיר את החסימה על "${e.channel}"?`)) return;
      void post({
        action: 'undeny',
        channel: e.channel,
        channelId: e.channelId,
        handle: e.handle,
      });
    },
    [post]
  );

  const visible = useMemo(() => {
    if (!data) return [];
    const f = filter.trim().toLowerCase();
    if (!f) return data.channels;
    return data.channels.filter((c) => c.channel.toLowerCase().includes(f));
  }, [data, filter]);

  if (error && !data)
    return <p className="empty">שגיאה בטעינת סטטיסטיקת הערוצים: {error}</p>;
  if (!data) return <p className="empty">טוען…</p>;

  const { denied, searchesSeen } = data;

  const generalRows = visible.filter((c) => c.classification === 'general');
  const curatedRows = visible.filter((c) => c.classification === 'curated');
  const perTeamRows = visible.filter((c) => c.classification === 'per-team');
  const blockedRows = data.channels.filter(
    (c) => c.classification === 'blocked'
  );
  // Deny entries with no blocked stats row behind them — the deny list
  // remains authoritative, so these still get their own row.
  const denyOnly = denied.filter(
    (e) => !blockedRows.some((c) => rowMatchesDenyEntry(c, e))
  );

  return (
    <div>
      <p className="empty" style={{ textAlign: 'right' }}>
        סטטיסטיקת ערוצים מ־14 הימים האחרונים ({searchesSeen} חיפושים
        חדשים נסרקו), מחולקת לפי סוג הערוץ. ערוצי המאגר והערוצים לפי
        קבוצה כוללים את כל ערוצי התוכנית, גם אם לא סיפקו תוצאות בתקופה.
        חסימת ערוץ מוסיפה אותו לרשימת החסימה — בתוקף מיידי, בלי פריסה.
      </p>
      {error && (
        <p className="empty" style={{ textAlign: 'right' }}>
          שגיאה: {error}
        </p>
      )}

      <div style={{ marginBottom: 10 }}>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="סינון לפי שם ערוץ…"
          style={{ padding: '6px 10px', borderRadius: 6, minWidth: 240 }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          className="refresh-btn"
          onClick={() => setListTab('general')}
          style={listTab === 'general' ? { fontWeight: 700 } : { opacity: 0.6 }}
        >
          כללי ({generalRows.length})
        </button>
        <button
          className="refresh-btn"
          onClick={() => setListTab('curated')}
          style={listTab === 'curated' ? { fontWeight: 700 } : { opacity: 0.6 }}
        >
          ערוצי מאגר ({curatedRows.length})
        </button>
        <button
          className="refresh-btn"
          onClick={() => setListTab('per-team')}
          style={
            listTab === 'per-team' ? { fontWeight: 700 } : { opacity: 0.6 }
          }
        >
          לפי קבוצה ({perTeamRows.length})
        </button>
        <button
          className="refresh-btn"
          onClick={() => setListTab('blocked')}
          style={listTab === 'blocked' ? { fontWeight: 700 } : { opacity: 0.6 }}
        >
          חסומים ({blockedRows.length + denyOnly.length})
        </button>
      </div>

      {listTab === 'general' && (
        <ChannelTable
          rows={generalRows}
          leagueHe={leagueHe}
          onDeny={deny}
          denied={denied}
          busy={busy}
        />
      )}

      {listTab === 'curated' && (
        <ChannelTable
          rows={curatedRows}
          leagueHe={leagueHe}
          onDeny={deny}
          denied={denied}
          busy={busy}
        />
      )}

      {listTab === 'per-team' && (
        <ChannelTable
          rows={perTeamRows}
          leagueHe={leagueHe}
          onDeny={deny}
          denied={denied}
          busy={busy}
        />
      )}

      {listTab === 'blocked' &&
        (blockedRows.length === 0 && denyOnly.length === 0 ? (
          <p className="empty">אין ערוצים.</p>
        ) : (
          <>
            {blockedRows.length > 0 && (
              <ChannelTable
                rows={blockedRows}
                leagueHe={leagueHe}
                onDeny={deny}
                onUndeny={undenyRow}
                denied={denied}
                busy={busy}
              />
            )}
            {denyOnly.length > 0 && (
            <table className="log-table">
              <thead>
                <tr>
                  <th>ערוץ</th>
                  <th>סיבה</th>
                  <th>נחסם</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {denyOnly.map((e, i) => (
                  <tr
                    key={e.channelId ?? e.handle ?? `${e.channel}-${i}`}
                    style={{ opacity: 0.8 }}
                  >
                    <td>
                      <div style={{ fontWeight: 600 }}>{e.channel}</div>
                      {(e.channelId || e.handle) && (
                        <div
                          style={{
                            fontSize: 11,
                            opacity: 0.6,
                            direction: 'ltr',
                            textAlign: 'right',
                          }}
                        >
                          {e.channelId ?? `@${e.handle}`}
                        </div>
                      )}
                    </td>
                    <td>{e.reason}</td>
                    <td>{fmtDate(e.addedAt)}</td>
                    <td>
                      <button
                        className="refresh-btn"
                        disabled={busy}
                        onClick={() => undeny(e)}
                        title="מסיר את הערוץ מרשימת החסימה — הסרטונים שלו יחזרו להופיע"
                      >
                        הסר חסימה
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </>
        ))}

    </div>
  );
}
