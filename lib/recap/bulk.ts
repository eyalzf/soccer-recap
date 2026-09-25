/**
 * Tier 2: curated bulk channel scan.
 *
 * For every channel in the league's bulk pool, fetch the recent-uploads
 * playlist (playlistItems.list = 1 quota unit per 50 videos, vs 100 units
 * for search.list) and match titles app-side with our own filter/rank
 * logic. The playlist cache is game-independent and shared across all
 * games in the league (1h TTL per channel ID, persisted in Blob).
 *
 * Team-scoped channels (club channels tagged with `teams`) are only
 * scanned for their own club's games; league-wide channels (aggregators,
 * broadcasters, league officials) are scanned for every game.
 *
 * Pagination stops early: playlists are reverse-chronological, so we stop
 * once videos are older than (game date - 2d), capped at maxPages.
 */
import { channelIdForHandle, ytApiGet, ytVideoMeta } from './sources';
import { pget, pset } from './persist';
import { lookupClubEn } from '../teamIndex';
import { searchPlanFor } from './leaguePlans';
import type { LeagueSearchPlan } from './leaguePlans';
import type { GameInput, RawCandidate } from './types';

const DAY = 86400000;
const PLAYLIST_TTL = 3600 * 1000;
const MAX_PAGES = 10;
const PAGE_SIZE = 50;

export interface PlaylistVideo {
  id: string;
  title: string;
  publishedAt: string;
  /** snippet.thumbnails from playlistItems (no extra quota); absent on old cache entries. */
  thumbnail?: string;
}

interface PlaylistCacheVal {
  videos: PlaylistVideo[];
  nextPageToken?: string;
}

function uploadsPlaylistId(channelId: string): string {
  // Convention: channel UCxxxx -> uploads playlist UUxxxx. Saves a
  // channels.list call (1 unit) per channel.
  return channelId.startsWith('UC') ? 'UU' + channelId.slice(2) : channelId;
}

interface PlaylistPage {
  items?: Array<{
    snippet?: {
      title?: string;
      publishedAt?: string;
      resourceId?: { videoId?: string };
      thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
    };
  }>;
  nextPageToken?: string;
}

async function fetchPage(playlistId: string, pageToken?: string): Promise<PlaylistPage> {
  const params: Record<string, string> = {
    part: 'snippet',
    playlistId,
    maxResults: String(PAGE_SIZE),
  };
  if (pageToken) params.pageToken = pageToken;
  return (await ytApiGet('playlistItems', params)) as PlaylistPage;
}

export interface ChannelVideos {
  videos: PlaylistVideo[];
  /** Served entirely from the playlist cache: no YouTube API call. */
  cached: boolean;
}

/**
 * Recent uploads for a channel (newest first). Served from the shared Blob
 * cache when fresh and deep enough; otherwise extended/refreshed from the
 * API. Throws `HTTP 429` on rate limit (caller stops the whole pipeline).
 *
 * Concurrent requests for the same channel share one in-flight fetch.
 */
export async function getChannelVideos(
  channelId: string,
  olderThanISO: string,
  maxPages: number = MAX_PAGES
): Promise<ChannelVideos> {
  const inflightKey = `pl/v2/${channelId}/${maxPages}`;
  let p = inflightPlaylists.get(inflightKey);
  if (!p) {
    p = getChannelVideosInner(channelId, olderThanISO, maxPages).finally(() =>
      inflightPlaylists.delete(inflightKey)
    );
    inflightPlaylists.set(inflightKey, p);
  }
  return p;
}

const inflightPlaylists = new Map<string, Promise<ChannelVideos>>();

async function getChannelVideosInner(
  channelId: string,
  olderThanISO: string,
  maxPages: number
): Promise<ChannelVideos> {
  const key = `pl/v2/${channelId}`;
  const rec = await pget<PlaylistCacheVal>(key);
  const fresh = rec && Date.now() - rec.fetchedAt < PLAYLIST_TTL ? rec.val : null;
  const oldestCached =
    fresh && fresh.videos.length ? fresh.videos[fresh.videos.length - 1].publishedAt : null;
  if (fresh && (!oldestCached || oldestCached < olderThanISO || !fresh.nextPageToken)) {
    return { videos: fresh.videos, cached: true };
  }
  // Extend a fresh-but-shallow cache from its page token, or refresh a
  // stale cache from scratch. Only successful fetches are persisted, so a
  // 429 mid-refresh keeps the previous cache intact.
  const videos: PlaylistVideo[] = fresh ? [...fresh.videos] : [];
  let pageToken = fresh ? fresh.nextPageToken : undefined;
  const seen = new Set(videos.map((v) => v.id));
  let pages = 0;
  const playlistId = uploadsPlaylistId(channelId);
  while (pages < maxPages) {
    const page = await fetchPage(playlistId, pageToken);
    pages += 1;
    for (const it of page.items ?? []) {
      const vid = it.snippet?.resourceId?.videoId;
      if (!vid || seen.has(vid)) continue;
      seen.add(vid);
      videos.push({
        id: vid,
        title: it.snippet?.title ?? '',
        publishedAt: it.snippet?.publishedAt ?? '',
        thumbnail:
          it.snippet?.thumbnails?.medium?.url ?? it.snippet?.thumbnails?.default?.url,
      });
    }
    pageToken = page.nextPageToken;
    const oldest = videos.length ? videos[videos.length - 1].publishedAt : null;
    if (!pageToken || (oldest && oldest < olderThanISO)) break;
  }
  await pset(key, { videos, nextPageToken: pageToken } satisfies PlaylistCacheVal);
  return { videos, cached: false };
}

/**
 * Does a game team match a channel's team tag? Alias-aware via the club
 * index (e.g. 'Man City' tag matches 'Manchester City' listings), with a
 * normalized substring fallback (e.g. 'Celta' matches 'Celta Vigo').
 */
export function teamMatchesTag(team: string, tag: string): boolean {
  const t = lookupClubEn(team);
  const g = lookupClubEn(tag);
  if (t && g && t.en === g.en) return true;
  const nt = team.toLowerCase().trim();
  const ng = tag.toLowerCase().trim();
  return !!nt && !!ng && (nt.includes(ng) || ng.includes(nt));
}

/**
 * Channels relevant to a game: league-wide entries (no `teams`) plus
 * team-scoped entries whose tag matches one of the game's teams. Pure:
 * unit-tested in scripts/matcher_wide_test.ts.
 */
export function channelsForGame<T extends { teams?: string[] }>(
  entries: T[],
  game: GameInput
): T[] {
  return entries.filter(
    (e) =>
      !e.teams ||
      e.teams.some((tag) => teamMatchesTag(game.home, tag) || teamMatchesTag(game.away, tag))
  );
}

export interface ChannelScan {
  /** Human label (plan entry label or handle). */
  label: string;
  /** Videos scanned (playlist window), before matching. */
  fetched: number;
  /** Served from the playlist cache: no YouTube API call for the listing. */
  cached: boolean;
}

export interface BulkScanResult {
  candidates: RawCandidate[];
  diag: Array<Record<string, unknown>>;
  ytRateLimited: boolean;
  /** Per-channel access stats, in scan order (for search logging). */
  perChannel: ChannelScan[];
}

export interface PriorityScanResult {
  candidates: RawCandidate[];
  /** Videos scanned (playlist window), before matching. */
  fetched: number;
  /** Served from the playlist cache: no YouTube API call for the listing. */
  cached: boolean;
  label: string;
  channelId?: string;
  /** Set when the channel couldn't be scanned (unresolved handle / 429). */
  error?: string;
}

interface ChannelEntry {
  handle?: string;
  channelId?: string;
  label: string;
}

/**
 * Scan one channel's uploads playlist and enrich every video with metadata
 * (duration, embeddable, language, region). Returns unfiltered candidates —
 * the caller applies filterCandidate + ranking.
 */
async function scanChannel(
  entry: ChannelEntry,
  game: GameInput,
  olderThanISO: string,
  maxPages: number,
  opts: { lang?: 'he' | 'en'; bulk?: boolean } = {}
): Promise<PriorityScanResult> {
  const label = entry.label;
  const channelId =
    entry.channelId ?? (entry.handle ? await channelIdForHandle(entry.handle) : null);
  if (!channelId) return { candidates: [], fetched: 0, cached: false, label, error: 'unresolved handle' };
  let listed: ChannelVideos;
  try {
    listed = await getChannelVideos(channelId, olderThanISO, maxPages);
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    return { candidates: [], fetched: 0, cached: false, label, channelId, error: msg };
  }
  const metas = await ytVideoMeta(listed.videos.map((v) => v.id));
  const candidates: RawCandidate[] = listed.videos.map((v) => {
    const m = metas.get(v.id);
    return {
      id: `yt:${v.id}`,
      title: v.title,
      url: `https://www.youtube.com/watch?v=${v.id}`,
      source: 'youtube' as const,
      videoId: v.id,
      publishedAt: v.publishedAt,
      thumbnail: v.thumbnail,
      durationSec: m?.duration,
      embeddable: m?.embeddable ?? undefined,
      audioLang: m?.audioLang ?? undefined,
      blockedInIL: m?.blockedInIL,
      channelName: label,
      channelHandle: entry.handle,
      channelId,
      bulk: opts.bulk ?? false,
      lang: opts.lang ?? (/[֐-׿]/.test(v.title) ? 'he' : 'en'),
    };
  });
  return {
    candidates,
    fetched: listed.videos.length,
    cached: listed.cached,
    label,
    channelId,
  };
}

/**
 * Tier 1: a preferred channel scanned via its uploads playlist (cheap)
 * instead of search.list (100 units). Matched app-side by the caller.
 */
export async function scanPriorityChannel(
  src: { handle?: string; channelId?: string; lang: 'he' | 'en'; pages?: number; teams?: string[] },
  game: GameInput
): Promise<PriorityScanResult> {
  const olderThanISO = new Date(Date.parse(game.dateISO) - 2 * DAY).toISOString();
  const label = src.handle ?? src.channelId ?? 'preferred';
  return scanChannel(
    { handle: src.handle, channelId: src.channelId, label },
    game,
    olderThanISO,
    src.pages ?? 3,
    { lang: src.lang, bulk: false }
  );
}

/**
 * Scan the league's bulk channels for one game and return enriched
 * candidates (unfiltered — the caller applies filterCandidate + ranking).
 * Team-scoped channels are only scanned for their own club's games.
 * Channels are scanned in small parallel groups; a 429 stops the scan
 * immediately.
 */
export async function bulkScan(game: GameInput): Promise<BulkScanResult> {
  const plan: LeagueSearchPlan = searchPlanFor(game.league);
  const entries = channelsForGame(plan.bulk, game);
  const maxPages = plan.bulkPages ?? MAX_PAGES;
  const olderThanISO = new Date(Date.parse(game.dateISO) - 2 * DAY).toISOString();
  const candidates: RawCandidate[] = [];
  const diag: Array<Record<string, unknown>> = [];
  const perChannel: ChannelScan[] = [];
  let ytRateLimited = false;

  const CONCURRENCY = 4;
  for (let i = 0; i < entries.length && !ytRateLimited; i += CONCURRENCY) {
    const group = entries.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      group.map((e) => scanChannel(e, game, olderThanISO, maxPages, { bulk: true }))
    );
    for (let g = 0; g < settled.length; g++) {
      const entry = group[g];
      const r = settled[g];
      if (r.status === 'rejected') {
        const msg = (r.reason as Error)?.message ?? String(r.reason);
        if (msg === 'HTTP 429') ytRateLimited = true;
        diag.push({ bulk: entry.label, error: msg });
        perChannel.push({ label: entry.label, fetched: 0, cached: false });
        continue;
      }
      const s = r.value;
      if (s.error) {
        if (s.error === 'HTTP 429') ytRateLimited = true;
        diag.push({ bulk: s.label, skipped: s.error });
        perChannel.push({ label: s.label, fetched: 0, cached: false });
        continue;
      }
      candidates.push(...s.candidates);
      perChannel.push({ label: s.label, fetched: s.fetched, cached: s.cached });
      diag.push({ bulk: s.label, channelId: s.channelId, videos: s.fetched, cached: s.cached });
    }
  }
  return { candidates, diag, ytRateLimited, perChannel };
}
