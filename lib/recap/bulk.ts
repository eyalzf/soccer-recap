/**
 * Tier 2: curated bulk channel scan.
 *
 * For every channel in the league's bulk pool, fetch the recent-uploads
 * playlist (playlistItems.list = 1 quota unit per 50 videos, vs 100 units
 * for search.list) and match titles app-side with our own filter/rank
 * logic. The playlist cache is game-independent and shared across all
 * games in the league (6h TTL, persisted in Blob).
 *
 * Pagination stops early: playlists are reverse-chronological, so we stop
 * once videos are older than (game date - 2d), capped at 10 pages (500
 * videos). Older games without a cached window get the deep fetch first;
 * search.list is only the last resort.
 */
import { channelIdForHandle, ytApiGet, ytVideoMeta } from './sources';
import { pget, pset } from './persist';
import { searchPlanFor } from './leaguePlans';
import type { GameInput, RawCandidate } from './types';

const DAY = 86400000;
const PLAYLIST_TTL = 6 * 3600 * 1000;
const MAX_PAGES = 10;
const PAGE_SIZE = 50;

export interface PlaylistVideo {
  id: string;
  title: string;
  publishedAt: string;
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

/**
 * Recent uploads for a channel (newest first). Served from the shared Blob
 * cache when fresh and deep enough; otherwise extended/refreshed from the
 * API. Throws `HTTP 429` on rate limit (caller stops the whole pipeline).
 *
 * Concurrent requests for the same channel share one in-flight fetch.
 */
export async function getChannelVideos(
  channelId: string,
  olderThanISO: string
): Promise<PlaylistVideo[]> {
  const inflightKey = `pl/v1/${channelId}`;
  let p = inflightPlaylists.get(inflightKey);
  if (!p) {
    p = getChannelVideosInner(channelId, olderThanISO).finally(() =>
      inflightPlaylists.delete(inflightKey)
    );
    inflightPlaylists.set(inflightKey, p);
  }
  return p;
}

const inflightPlaylists = new Map<string, Promise<PlaylistVideo[]>>();

async function getChannelVideosInner(
  channelId: string,
  olderThanISO: string
): Promise<PlaylistVideo[]> {
  const key = `pl/v1/${channelId}`;
  const rec = await pget<PlaylistCacheVal>(key);
  const fresh = rec && Date.now() - rec.fetchedAt < PLAYLIST_TTL ? rec.val : null;
  const oldestCached =
    fresh && fresh.videos.length ? fresh.videos[fresh.videos.length - 1].publishedAt : null;
  if (fresh && (!oldestCached || oldestCached < olderThanISO || !fresh.nextPageToken)) {
    return fresh.videos;
  }
  // Extend a fresh-but-shallow cache from its page token, or refresh a
  // stale cache from scratch. Only successful fetches are persisted, so a
  // 429 mid-refresh keeps the previous cache intact.
  const videos: PlaylistVideo[] = fresh ? [...fresh.videos] : [];
  let pageToken = fresh ? fresh.nextPageToken : undefined;
  const seen = new Set(videos.map((v) => v.id));
  let pages = 0;
  const playlistId = uploadsPlaylistId(channelId);
  while (pages < MAX_PAGES) {
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
      });
    }
    pageToken = page.nextPageToken;
    const oldest = videos.length ? videos[videos.length - 1].publishedAt : null;
    if (!pageToken || (oldest && oldest < olderThanISO)) break;
  }
  await pset(key, { videos, nextPageToken: pageToken } satisfies PlaylistCacheVal);
  return videos;
}

export interface BulkScanResult {
  candidates: RawCandidate[];
  diag: Array<Record<string, unknown>>;
  ytRateLimited: boolean;
}

/**
 * Scan every bulk channel's uploads for one game and return enriched
 * candidates (metadata attached, unfiltered — the route applies
 * filterCandidate + ranking). Channels are scanned in small parallel
 * groups; a 429 stops the scan immediately.
 */
export async function bulkScan(game: GameInput): Promise<BulkScanResult> {
  const plan = searchPlanFor(game.league);
  const olderThanISO = new Date(Date.parse(game.dateISO) - 2 * DAY).toISOString();
  const candidates: RawCandidate[] = [];
  const diag: Array<Record<string, unknown>> = [];
  let ytRateLimited = false;

  const scanOne = async (entry: {
    handle?: string;
    channelId?: string;
    label: string;
  }): Promise<{
    entry: { label: string };
    videos: PlaylistVideo[];
    channelId: string;
  }> => {
    const channelId =
      entry.channelId ?? (entry.handle ? await channelIdForHandle(entry.handle) : null);
    if (!channelId) {
      const err = new Error('unresolved handle') as Error & { skip?: boolean };
      err.skip = true;
      throw err;
    }
    const videos = await getChannelVideos(channelId, olderThanISO);
    return { entry, videos, channelId };
  };

  const CONCURRENCY = 4;
  for (let i = 0; i < plan.bulk.length && !ytRateLimited; i += CONCURRENCY) {
    const group = plan.bulk.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(group.map(scanOne));
    for (let g = 0; g < settled.length; g++) {
      const entry = group[g];
      const r = settled[g];
      if (r.status === 'rejected') {
        const err = r.reason as Error & { skip?: boolean };
        const msg = err?.skip ? 'unresolved handle' : err?.message ?? String(r.reason);
        if (msg === 'HTTP 429') ytRateLimited = true;
        diag.push({ bulk: entry.label, skipped: msg });
        continue;
      }
      const { videos, channelId } = r.value;
      try {
        const metas = await ytVideoMeta(videos.map((v) => v.id));
        for (const v of videos) {
          const m = metas.get(v.id);
          candidates.push({
            id: `yt:${v.id}`,
            title: v.title,
            url: `https://www.youtube.com/watch?v=${v.id}`,
            source: 'youtube',
            videoId: v.id,
            publishedAt: v.publishedAt,
            durationSec: m?.duration,
            embeddable: m?.embeddable ?? undefined,
            audioLang: m?.audioLang ?? undefined,
            blockedInIL: m?.blockedInIL,
            channelName: entry.label,
            channelHandle: entry.handle,
            bulk: true,
            lang: /[֐-׿]/.test(v.title) ? 'he' : 'en',
          });
        }
        diag.push({ bulk: entry.label, channelId, videos: videos.length });
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e);
        if (msg === 'HTTP 429') ytRateLimited = true;
        diag.push({ bulk: entry.label, error: msg });
      }
    }
  }
  return { candidates, diag, ytRateLimited };
}
