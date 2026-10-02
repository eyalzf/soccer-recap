import { NextRequest } from 'next/server';
import { list } from '@vercel/blob';
import { pget, pset } from '@/lib/recap/persist';
import { channelIdForHandle, ytApiGet } from '@/lib/recap/sources';
import {
  addToDenyList,
  getDenyList,
  getDenySet,
  isDeniedChannel,
  normHandle,
} from '@/lib/recap/denyList';
import { excludedCategory } from '@/lib/recap/match';
import { searchPlanFor } from '@/lib/recap/leaguePlans';
import { LEAGUES, NATIONAL_COMPETITIONS } from '@/lib/leagues';
import {
  denyCriterion,
  emptyReport,
  mergeProposals,
  proposalKey,
  type ChannelDeathStats,
  type DeadReason,
  type SweepReport,
} from '@/lib/recap/sweep';
import type { RankedCandidate } from '@/lib/recap/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Weekly playability sweep (Vercel cron, see vercel.json — runs right after
 * the prune job so it never scans blobs about to be deleted).
 *
 * Scans every cached game result, re-checks each YouTube video ID with a
 * FRESH videos.list lookup (deliberately bypassing the 24-day ytmeta
 * cache — the point is to find what changed since it was cached), removes
 * the unplayable ones (deleted/private, embedding disabled, region-blocked
 * in Israel) from the game blobs, and proposes "known offender" channels
 * for the deny list.
 *
 * - GET with the cron Authorization header → runs the sweep (scan + apply).
 * - GET without it → public status summary (for the agent watchdog).
 * - GET ?mode=report → full report (for the /searchlog/candidates UI).
 * - POST {action:'deny'|'discard', ...} → user-initiated deny-list or
 *   discard actions from the UI (same trust level as the existing
 *   channel-candidates actions).
 */

// Must match gameCacheKey() in app/api/recap/route.ts.
const GAME_PREFIX = 'game/v8/';
const REPORT_KEY = 'channel-ops/sweep-report.json';
const TIME_BUDGET_MS = 45_000;

async function readReport(): Promise<SweepReport> {
  const rec = await pget<SweepReport>(REPORT_KEY);
  return rec?.val ?? emptyReport();
}

/** Fresh per-video liveness check. Never uses the ytmeta cache. */
async function checkVideosFresh(
  ids: string[]
): Promise<Map<string, { dead: boolean; reason?: DeadReason }>> {
  const out = new Map<string, { dead: boolean; reason?: DeadReason }>();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
  const settled = await Promise.allSettled(
    chunks.map((c) =>
      ytApiGet('videos', { part: 'status,contentDetails', id: c.join(',') })
    )
  );
  for (let i = 0; i < settled.length; i++) {
    const chunk = chunks[i];
    const r = settled[i];
    if (r.status === 'rejected') {
      const msg = String(r.reason);
      if (msg.includes('429')) throw new Error('HTTP 429');
      // Transient failure: fail OPEN — never delete a video we couldn't
      // verify. It simply won't be marked dead this run.
      for (const id of chunk) out.set(id, { dead: false });
      continue;
    }
    const items = ((r.value as { items?: unknown[] }).items ?? []) as Array<{
      id: string;
      status?: { embeddable?: boolean };
      contentDetails?: {
        regionRestriction?: { allowed?: string[]; blocked?: string[] };
      };
    }>;
    const seen = new Set(items.map((it) => it.id));
    for (const it of items) {
      let dead = false;
      let reason: DeadReason | undefined;
      if (it.status?.embeddable === false) {
        dead = true;
        reason = 'not-embeddable';
      } else {
        const rr = it.contentDetails?.regionRestriction;
        const blockedInIL = rr
          ? (rr.blocked ?? []).includes('IL') ||
            (rr.allowed != null && !rr.allowed.includes('IL'))
          : false;
        if (blockedInIL) {
          dead = true;
          reason = 'region-blocked';
        }
      }
      out.set(it.id, { dead, reason });
    }
    // IDs absent from the response: deleted or private.
    for (const id of chunk) {
      if (!seen.has(id)) out.set(id, { dead: true, reason: 'deleted' });
    }
  }
  return out;
}

function gameLabelFromKey(key: string): string {
  // game/v8/<league>/<home>-<away>-<date>
  const rest = key.slice(GAME_PREFIX.length);
  const [league, slug = ''] = rest.split('/');
  return `${league}: ${slug}`;
}

/** Which league plans (preferred/bulk) include this channel? */
function plansContaining(c: {
  channelId?: string;
  handle?: string;
}): string[] {
  const slugs: string[] = [];
  const all = [...LEAGUES, ...NATIONAL_COMPETITIONS].map((l) => l.slug);
  for (const slug of all) {
    try {
      const plan = searchPlanFor(slug);
      const entries = [...plan.preferred, ...plan.bulk];
      const hit = entries.some(
        (e) =>
          (c.channelId && e.channelId === c.channelId) ||
          (c.handle &&
            e.handle &&
            normHandle(e.handle) === normHandle(c.handle))
      );
      if (hit) slugs.push(slug);
    } catch {
      // Unknown slug: skip.
    }
  }
  return slugs;
}

async function runSweep(): Promise<SweepReport> {
  const started = Date.now();
  const prev = await readReport();
  const report = emptyReport();
  report.lastRun = Date.now();

  // 1. List game blobs.
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: GAME_PREFIX, cursor, limit: 1000 });
    keys.push(...page.blobs.map((b) => b.pathname));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && Date.now() - started < TIME_BUDGET_MS);

  // 2. Read game blobs (concurrent batches).
  const games: Array<{ key: string; results: RankedCandidate[] }> = [];
  const BATCH = 20;
  for (let i = 0; i < keys.length; i += BATCH) {
    const settled = await Promise.allSettled(
      keys.slice(i, i + BATCH).map(async (key) => {
        const rec = await pget<{ results?: RankedCandidate[] }>(key);
        return { key, results: rec?.val?.results ?? [] };
      })
    );
    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value.results.length > 0)
        games.push(s.value);
    }
    if (Date.now() - started > TIME_BUDGET_MS) break;
  }
  report.gamesScanned = games.length;
  if (Date.now() - started > TIME_BUDGET_MS) {
    report.partial = true;
    report.error = 'time budget exceeded during scan';
  }

  // 3. Collect unique YouTube video IDs.
  interface SeenInfo {
    title: string;
    channel: string;
    channelId?: string;
    handle?: string;
    game: string;
  }
  const seen = new Map<string, SeenInfo>();
  for (const g of games) {
    for (const r of g.results) {
      const vid = r.videoId;
      if (!vid || seen.has(vid)) continue;
      seen.set(vid, {
        title: r.title,
        channel: r.channelName ?? 'unknown',
        channelId: r.channelId,
        handle: r.channelHandle,
        game: gameLabelFromKey(g.key),
      });
    }
  }
  const ids = [...seen.keys()];
  report.videosChecked = ids.length;

  // 4. Fresh liveness checks.
  const checks = await checkVideosFresh(ids);
  const deadByGame = new Map<string, Set<string>>();
  const purgeByGame = new Map<string, Set<string>>();
  // Policy purges (no YouTube quota): videos from deny-listed channels and
  // titles matching the current EXCLUDED policy (e.g. simulation footage)
  // must also leave the caches — otherwise the append-only game cache keeps
  // serving them long after the deny/policy decision was made.
  const denySet = await getDenySet();
  const markPurge = (vid: string) => {
    for (const g of games) {
      if (g.results.some((r) => r.videoId === vid)) {
        let set = purgeByGame.get(g.key);
        if (!set) {
          set = new Set();
          purgeByGame.set(g.key, set);
        }
        set.add(vid);
      }
    }
  };
  const stats = new Map<string, ChannelDeathStats & { _key: string }>();
  const statFor = (info: SeenInfo) => {
    const key = info.channelId ?? (info.handle ? `h:${info.handle}` : `t:${info.channel}`);
    let s = stats.get(key);
    if (!s) {
      s = {
        _key: key,
        channel: info.channel,
        channelId: info.channelId,
        handle: info.handle,
        dead: 0,
        total: 0,
        sampleTitles: [],
        games: [],
        inPlans: [],
      };
      stats.set(key, s);
    }
    return s;
  };
  let deadCount = 0;
  for (const [id, info] of seen) {
    // Purged videos (deny-listed channel or vetoed title) leave the cache
    // without feeding the death-stats population — the channel is either
    // already dealt with or the video was never a real recap.
    const denied = isDeniedChannel(
      { channelId: info.channelId ?? null, channelHandle: info.handle ?? null },
      denySet
    );
    const vetoKw = denied ? null : excludedCategory(info.title);
    if (denied || vetoKw) {
      report.removed.push({
        videoId: id,
        title: info.title,
        channel: info.channel,
        channelId: info.channelId,
        game: info.game,
        reason: denied ? 'deny-listed' : `veto:${vetoKw}`,
      });
      if (denied) report.deniedRemoved += 1;
      else report.vetoedRemoved += 1;
      markPurge(id);
      continue;
    }
    const s = statFor(info);
    s.total += 1;
    const chk = checks.get(id);
    if (chk?.dead) {
      deadCount += 1;
      s.dead += 1;
      if (s.sampleTitles.length < 3) s.sampleTitles.push(info.title);
      if (!s.games.includes(info.game)) s.games.push(info.game);
      report.removed.push({
        videoId: id,
        title: info.title,
        channel: info.channel,
        channelId: info.channelId,
        game: info.game,
      });
      for (const g of games) {
        if (g.results.some((r) => r.videoId === id)) {
          let set = deadByGame.get(g.key);
          if (!set) {
            set = new Set();
            deadByGame.set(g.key, set);
          }
          set.add(id);
        }
      }
    }
  }

  // 5. Rewrite affected game blobs minus dead and policy-purged videos.
  const rewriteKeys = new Set([...deadByGame.keys(), ...purgeByGame.keys()]);
  for (const key of rewriteKeys) {
    const drop = new Set([
      ...(deadByGame.get(key) ?? []),
      ...(purgeByGame.get(key) ?? []),
    ]);
    const rec = await pget<{ results?: RankedCandidate[] }>(key);
    if (!rec?.val?.results) continue;
    const kept = rec.val.results.filter((r) => !drop.has(r.videoId ?? ''));
    if (kept.length !== rec.val.results.length) {
      await pset(key, { ...rec.val, results: kept });
    }
  }
  report.deadRemoved = deadCount;

  // 6. Deny-list proposals.
  const qualifiers: ChannelDeathStats[] = [];
  for (const s of stats.values()) {
    if (!denyCriterion(s)) continue;
    const { _key, ...rest } = s;
    qualifiers.push({ ...rest, inPlans: plansContaining(s) });
  }
  report.proposals = mergeProposals(prev.proposals, qualifiers);
  return report;
}

async function handleAction(body: {
  action?: string;
  channel?: string;
  channelId?: string;
  handle?: string;
  dead?: number;
  reason?: string;
}): Promise<SweepReport> {
  const report = await readReport();
  if (body.action === 'deny') {
    let { channelId, handle } = body;
    const channel = body.channel ?? 'unknown channel';
    if (!channelId && handle) {
      try {
        channelId = (await channelIdForHandle(handle)) ?? undefined;
      } catch {
        channelId = undefined;
      }
    }
    const prev = report.proposals.find(
      (p) => proposalKey(p) === proposalKey({ channelId, handle, channel })
    );
    await addToDenyList({
      channel,
      channelId,
      handle,
      reason:
        body.reason ??
        `sweep: ${prev?.dead ?? body.dead ?? 0} dead videos (${prev?.criterion ?? 'volume'})`,
      deadCount: prev?.dead ?? body.dead ?? 0,
    });
    if (prev) {
      prev.status = 'denied';
      prev.deniedAt = Date.now();
    }
  } else if (body.action === 'discard') {
    const prev = report.proposals.find(
      (p) =>
        proposalKey(p) ===
        proposalKey({
          channelId: body.channelId,
          handle: body.handle,
          channel: body.channel ?? '',
        })
    );
    if (prev) {
      // Discard zeroes the counts: re-surfaces only on new dead videos.
      prev.status = 'discarded';
      prev.deadAtDiscard = prev.dead;
    }
  }
  await pset(REPORT_KEY, report);
  return report;
}

export async function GET(req: NextRequest) {
  // Cron run: Vercel injects `Authorization: Bearer <CRON_SECRET>`.
  const secret = process.env.CRON_SECRET;
  const authed =
    !!secret && req.headers.get('authorization') === `Bearer ${secret}`;
  if (authed) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return Response.json(
        { ok: false, error: 'blob not configured' },
        { status: 503 }
      );
    }
    try {
      const report = await runSweep();
      await pset(REPORT_KEY, report);
      const pending = report.proposals.filter(
        (p) => p.status === 'pending'
      ).length;
      return Response.json({
        ok: report.ok,
        error: report.error,
        partial: report.partial ?? false,
        gamesScanned: report.gamesScanned,
        videosChecked: report.videosChecked,
        deadRemoved: report.deadRemoved,
        deniedRemoved: report.deniedRemoved,
        vetoedRemoved: report.vetoedRemoved,
        pendingProposals: pending,
      });
    } catch (e) {
      const report = emptyReport();
      report.lastRun = Date.now();
      report.ok = false;
      report.error = e instanceof Error ? e.message : String(e);
      await pset(REPORT_KEY, report);
      return Response.json(
        { ok: false, error: report.error },
        { status: 500 }
      );
    }
  }
  // Public read: status summary or full report for the UI.
  const report = await readReport();
  if (req.nextUrl.searchParams.get('mode') === 'report') {
    return Response.json(report);
  }
  const deny = await getDenyList();
  return Response.json({
    ok: report.ok,
    lastRun: report.lastRun,
    gamesScanned: report.gamesScanned,
    videosChecked: report.videosChecked,
    deadRemoved: report.deadRemoved,
    deniedRemoved: report.deniedRemoved,
    vetoedRemoved: report.vetoedRemoved,
    pendingProposals: report.proposals.filter((p) => p.status === 'pending')
      .length,
    deniedChannels: deny.length,
    error: report.error,
  });
}

export async function POST(req: NextRequest) {
  let body: {
    action?: string;
    channel?: string;
    channelId?: string;
    handle?: string;
    dead?: number;
    reason?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (body.action !== 'deny' && body.action !== 'discard') {
    return Response.json({ error: 'unknown action' }, { status: 400 });
  }
  const report = await handleAction(body);
  return Response.json(report);
}
