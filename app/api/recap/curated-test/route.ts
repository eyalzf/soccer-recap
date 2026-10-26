import { NextRequest, NextResponse } from 'next/server';
import { searchPlanFor } from '@/lib/recap/leaguePlans';
import { getChannelVideos } from '@/lib/recap/bulk';
import { channelIdForHandle, ytVideoMeta } from '@/lib/recap/sources';
import { filterCandidate, hasHighlightIntent } from '@/lib/recap/match';
import { getDenySet } from '@/lib/recap/denyList';
import { runExternalSource } from '@/lib/recap/external';
import type { GameInput, RawCandidate } from '@/lib/recap/types';

export const dynamic = 'force-dynamic';

const DAY = 86400000;

const numOrNull = (v: string | null): number | null => {
  if (v == null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
};

interface ChannelReport {
  label: string;
  channelId?: string;
  skipped?: string;
  videos?: number;
  kept?: number;
  properHighlight?: boolean;
  rejectReasons?: Record<string, number>;
  rejectedExamples?: Array<{ title: string; reason: string }>;
  keptTitles?: string[];
  /** External tier only: the matched link-out URL(s). */
  keptUrls?: string[];
  /** External tier only: ≥2 index items matched; result suppressed. */
  ambiguous?: boolean;
}

/**
 * GET /api/recap/curated-test?league=&home=&away=&date=&hs=&as=[&extra=@h1,@h2]
 *
 * Diagnostic: run ONLY the curated tiers (preferred + bulk) for one game,
 * scanning each channel's uploads playlist and applying the real matcher.
 * No general-search fallback, no search-log write, no game-cache read/write.
 *
 * &extra= takes candidate channel handles (or raw UC ids) for curation
 * research: they are scanned as a separate "candidate" tier with the same
 * matcher, without touching the league plan.
 *
 * &only=candidate skips the plan tiers and runs just the candidate tier
 * (quota-cheap triage of new channels).
 *
 * When the league plan configures external sources (Sport5 for the
 * UCL), an "external" tier report is included: the provider's harvested
 * index is matched against the game and every considered item's verdict
 * is tallied (rejectReasons / rejectedExamples), with the matched
 * link-out URL in keptUrls. The tier is reported in the plan's
 * execution position (above bulk for plans with
 * externalPosition 'above-bulk', otherwise after bulk).
 * &only=external runs just that tier (it costs no YouTube quota).
 *
 * NOTE: like production's preferred tier, this test scans the channel's
 * uploads playlist (1 unit/page, Blob-cached) and matches app-side — the
 * matcher and fail reasons are identical to live.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const game: GameInput = {
    league: sp.get('league') ?? '',
    home: sp.get('home') ?? '',
    away: sp.get('away') ?? '',
    dateISO: sp.get('date') ?? '',
    homeScore: numOrNull(sp.get('hs')),
    awayScore: numOrNull(sp.get('as')),
    cup: sp.get('cup') || null,
    competition: sp.get('competition') || null,
  };
  if (!game.league || !game.home || !game.away || !game.dateISO) {
    return NextResponse.json(
      { error: 'league, home, away, date required (hs/as optional)' },
      { status: 400 }
    );
  }

  const plan = searchPlanFor(game.league);
  const denySet = await getDenySet();
  const olderThanISO = new Date(Date.parse(game.dateISO) - 2 * DAY).toISOString();
  let ytRateLimited = false;
  const tiers: Array<{ tier: string; channels: ChannelReport[] }> = [];

  const scanChannel = async (
    entry: { handle?: string; channelId?: string },
    label: string,
    tierName: string
  ): Promise<ChannelReport> => {
    if (ytRateLimited) return { label, skipped: 'rate-limited' };
    const handle = entry.handle;
    let channelId: string | null = null;
    try {
      channelId = entry.channelId ?? (handle ? await channelIdForHandle(handle) : null);
    } catch {
      channelId = null;
    }
    if (!channelId) return { label, skipped: 'unresolved handle' };
    let videos;
    try {
      ({ videos } = await getChannelVideos(channelId, olderThanISO));
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      if (msg === 'HTTP 429') ytRateLimited = true;
      return { label, channelId, skipped: msg };
    }
    let metas: Awaited<ReturnType<typeof ytVideoMeta>>;
    try {
      metas = await ytVideoMeta(videos.map((v) => v.id));
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      if (msg === 'HTTP 429') ytRateLimited = true;
      return { label, channelId, skipped: 'meta: ' + msg };
    }
    const rejectReasons: Record<string, number> = {};
    const rejectedExamples: Array<{ title: string; reason: string }> = [];
    const keptTitles: string[] = [];
    let keptCount = 0;
    let properHighlight = false;
    for (const v of videos) {
      const m = metas.get(v.id);
      const c: RawCandidate = {
        id: `yt:${v.id}`,
        title: v.title,
        url: `https://www.youtube.com/watch?v=${v.id}`,
        source: 'youtube',
        videoId: v.id,
        publishedAt: v.publishedAt,
        thumbnail: v.thumbnail,
        durationSec: m?.duration,
        embeddable: m?.embeddable ?? undefined,
        audioLang: m?.audioLang ?? undefined,
        blockedInIL: m?.blockedInIL,
        channelName: label,
        channelHandle: handle,
        bulk: tierName === 'bulk' || tierName === 'candidate',
        lang: /[֐-׿]/.test(v.title) ? 'he' : 'en',
      };
      const f = filterCandidate(c, game, denySet);
      if (f.keep) {
        keptCount += 1;
        if (keptTitles.length < 5) keptTitles.push(v.title);
        if (hasHighlightIntent(v.title)) properHighlight = true;
      } else {
        rejectReasons[f.reason] = (rejectReasons[f.reason] ?? 0) + 1;
        if (rejectedExamples.length < 8)
          rejectedExamples.push({ title: v.title.slice(0, 90), reason: f.reason });
      }
    }
    return {
      label,
      channelId,
      videos: videos.length,
      kept: keptCount,
      properHighlight,
      rejectReasons,
      rejectedExamples,
      keptTitles,
    };
  };

  // External link-out tier (plan-configured; Sport5 for the UCL):
  // report what the provider's index held and how each item fared.
  // Built lazily (it harvests/matches live) and inserted at the plan's
  // execution position below.
  const externalCfgs = plan.external ?? [];
  const buildExternalTier = async (): Promise<{
    tier: string;
    channels: ChannelReport[];
  } | null> => {
    if (externalCfgs.length === 0 || sp.get('only') === 'candidate') return null;
    const channels: ChannelReport[] = [];
    for (const cfg of externalCfgs) {
      const r = await runExternalSource(cfg, game);
      const rejectReasons: Record<string, number> = {};
      const rejectedExamples: Array<{ title: string; reason: string }> = [];
      for (const c of r.considered) {
        if (c.keep) continue;
        rejectReasons[c.reason] = (rejectReasons[c.reason] ?? 0) + 1;
        if (rejectedExamples.length < 8)
          rejectedExamples.push({ title: c.title.slice(0, 90), reason: c.reason });
      }
      channels.push({
        label: cfg.provider,
        videos: r.considered.length,
        kept: r.candidates.length,
        properHighlight: false,
        rejectReasons,
        rejectedExamples,
        keptTitles: r.candidates.map((c) => c.title),
        keptUrls: r.candidates.map((c) => c.url),
        ...(r.ambiguous ? { ambiguous: true } : {}),
      });
    }
    return { tier: 'external', channels };
  };
  const externalAboveBulk = plan.externalPosition === 'above-bulk';
  const planTierReports: Array<{ tier: string; channels: ChannelReport[] }> = [];
  for (const tierName of ['preferred', 'bulk'] as const) {
    if (sp.get('only') === 'candidate' || sp.get('only') === 'external') break;
    const channels: ChannelReport[] = [];
    for (const entry of plan[tierName]) {
      const label =
        tierName === 'preferred'
          ? `preferred:@${entry.handle}`
          : (entry as { label: string }).label;
      channels.push(await scanChannel(entry, label, tierName));
      if (ytRateLimited) break;
    }
    planTierReports.push({ tier: tierName, channels });
  }

  // Candidate channels for curation research: &extra=@handle1,@handle2 (or
  // raw channel IDs). Scanned as a separate "candidate" tier with the same
  // matcher; never touches the plan or the search log.
  let candidateTier: { tier: string; channels: ChannelReport[] } | null = null;
  const extraParam = sp.get('extra');
  if (extraParam && !ytRateLimited) {
    const channels: ChannelReport[] = [];
    for (const raw of extraParam.split(',')) {
      const tok = raw.trim().replace(/^@/, '');
      if (!tok) continue;
      const entry = tok.startsWith('UC')
        ? { channelId: tok }
        : { handle: tok };
      channels.push(await scanChannel(entry, `candidate:@${tok}`, 'candidate'));
      if (ytRateLimited) break;
    }
    candidateTier = { tier: 'candidate', channels };
  }

  // Assemble the report in the plan's execution order: preferred →
  // external (above-bulk plans only) → bulk → candidate → external
  // (default below-bulk position).
  const externalTier = await buildExternalTier();
  const preferredReport = planTierReports.find((t) => t.tier === 'preferred');
  const bulkReport = planTierReports.find((t) => t.tier === 'bulk');
  if (preferredReport) tiers.push(preferredReport);
  if (externalAboveBulk && externalTier) tiers.push(externalTier);
  if (bulkReport) tiers.push(bulkReport);
  if (candidateTier) tiers.push(candidateTier);
  if (!externalAboveBulk && externalTier) tiers.push(externalTier);

  return NextResponse.json({ game, tiers, ytRateLimited });
}
