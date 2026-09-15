import { cacheGet, cacheSet } from '../cache';
import { hebrewVariants } from '../teamIndex';
import type { GameInput, RawCandidate, SourceKind } from './types';

const YT_KEY = process.env.YOUTUBE_API_KEY || '';
const DAY = 86400000;

async function fetchJson(url: string, timeoutMs = 12000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(t);
  }
}

// ---------- YouTube ----------

interface YtSearchItem {
  id: { videoId?: string };
  snippet: {
    title: string;
    publishedAt: string;
    channelTitle: string;
    thumbnails?: { medium?: { url: string }; default?: { url: string } };
  };
}

async function ytSearch(
  q: string,
  opts: { channelId?: string; after: string; before: string }
): Promise<YtSearchItem[]> {
  const p = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    order: 'relevance',
    maxResults: '10',
    q,
    publishedAfter: opts.after,
    publishedBefore: opts.before,
    key: YT_KEY,
  });
  if (opts.channelId) p.set('channelId', opts.channelId);
  // NOTE: no automatic retry here. During a rate-limit event retries become a
  // retry storm that prolongs the block; the caller reports HTTP 429 so the
  // UI can ask the user to try again later.
  const data = (await fetchJson(
    'https://www.googleapis.com/youtube/v3/search?' + p.toString()
  )) as { items?: YtSearchItem[] };
  return data.items ?? [];
}

async function channelIdForHandle(handle: string): Promise<string | null> {
  const key = 'ytchan:' + handle;
  const cached = cacheGet<string | null>(key);
  if (cached !== undefined) return cached;
  try {
    const data = (await fetchJson(
      'https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=' +
        encodeURIComponent(handle) +
        '&key=' +
        YT_KEY
    )) as { items?: Array<{ id?: string }> };
    const id = data.items?.[0]?.id ?? null;
    // Only cache successful resolutions: caching a null after a transient
    // failure would silently disable the trusted-channel search for days.
    if (id) cacheSet(key, id, 7 * DAY);
    return id;
  } catch {
    return null;
  }
}

function parseDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (
    parseInt(m[1] || '0', 10) * 3600 +
    parseInt(m[2] || '0', 10) * 60 +
    parseInt(m[3] || '0', 10)
  );
}

async function ytDurations(ids: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const ck = 'ytdur:' + chunk.join(',');
    const cached = cacheGet<Record<string, number>>(ck);
    if (cached) {
      for (const [k, v] of Object.entries(cached)) map.set(k, v);
      continue;
    }
    try {
      const data = (await fetchJson(
        'https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=' +
          chunk.join(',') +
          '&key=' +
          YT_KEY
      )) as { items?: Array<{ id: string; contentDetails?: { duration?: string } }> };
      const rec: Record<string, number> = {};
      for (const it of data.items ?? []) {
        const d = parseDuration(it.contentDetails?.duration || '');
        map.set(it.id, d);
        rec[it.id] = d;
      }
      cacheSet(ck, rec, 24 * DAY);
    } catch {
      /* ignore */
    }
  }
  return map;
}

const TRUSTED_HANDLES = ['Ipflofficial', 'one-1004'];

/**
 * YouTube search group. If YOUTUBE_API_KEY is missing, returns [] gracefully.
 * group 'he' / 'en': general queries; 'trusted': scoped to official Hebrew channels.
 */
export async function fetchYouTube(
  game: GameInput,
  group: 'he' | 'en' | 'trusted'
): Promise<RawCandidate[]> {
  if (!YT_KEY) return [];
  // NOTE: errors propagate to the caller (the recap route catches per-group
  // and records them in debug diagnostics). Do not swallow them here: a
  // silent [] is indistinguishable from "no videos found".
  const g = new Date(game.dateISO).getTime();
  const after = new Date(g - 6 * DAY).toISOString();
  // Extended highlights ("תקציר מורחב") are often published 2-4 days after
  // the game; keep the window wide and let the date filter/ranking sort it.
  const before = new Date(g + 5 * DAY).toISOString();

  const homeHe = hebrewVariants(game.home)[0];
  const awayHe = hebrewVariants(game.away)[0];

  // (query, channelId, channelHandle)
  // Kept to one precise query per group: fewer parallel search.list calls
  // means fewer HTTP 429 rate-limit hits and less daily quota burn
  // (~400 units/game instead of ~800). YouTube's relevance matching covers
  // title variants (e.g. "נגד") without a second query.
  const jobs: Array<{ q: string; channelId?: string; handle?: string }> = [];
  if (group === 'he') {
    jobs.push({ q: `${homeHe} ${awayHe} תקציר` });
  } else if (group === 'en') {
    jobs.push({ q: `${game.home} vs ${game.away} highlights` });
  } else {
    const resolved = await Promise.all(
      TRUSTED_HANDLES.map(async (h) => ({ h, id: await channelIdForHandle(h) }))
    );
    for (const { h, id } of resolved) {
      if (!id) continue;
      jobs.push({ q: `${homeHe} ${awayHe} תקציר`, channelId: id, handle: h });
    }
    if (jobs.length === 0) return [];
  }

  const items: YtSearchItem[] = [];
  const handles = new Map<string, string>();
  // Run the searches sequentially with a small stagger instead of one
  // parallel burst: gentler on YouTube's rate limiter. (Groups themselves
  // still run in parallel so results stream progressively.)
  for (const j of jobs) {
    const r = await ytSearch(j.q, { channelId: j.channelId, after, before });
    for (const it of r) {
      const vid = it.id?.videoId;
      if (!vid) continue;
      items.push(it);
      if (j.handle) handles.set(vid, j.handle);
    }
    await new Promise((res) => setTimeout(res, 1000));
  }

  const uniq = new Map<string, YtSearchItem>();
  for (const it of items) {
    const vid = it.id.videoId as string;
    if (!uniq.has(vid)) uniq.set(vid, it);
  }

  const durs = await ytDurations([...uniq.keys()]);
  const lang = group === 'en' ? 'en' : 'he';

  return [...uniq.entries()].map(([vid, it]) => {
    const sn = it.snippet;
    return {
      id: 'yt:' + vid,
      title: sn.title,
      url: 'https://www.youtube.com/watch?v=' + vid,
      source: 'youtube' as SourceKind,
      videoId: vid,
      thumbnail: sn.thumbnails?.medium?.url ?? sn.thumbnails?.default?.url,
      publishedAt: sn.publishedAt,
      durationSec: durs.get(vid),
      channelName: sn.channelTitle,
      channelHandle: handles.get(vid),
      lang,
    } satisfies RawCandidate;
  });
}

// ---------- Sport1 / Sport5 / ONE (best-effort) ----------

async function fetchHtml(url: string, timeoutMs = 10000): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function extractLinks(html: string, base: string): Array<{ title: string; url: string }> {
  const out: Array<{ title: string; url: string }> = [];
  const re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]{0,220}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 80) {
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text || text.length < 8) continue;
    try {
      out.push({ title: text, url: new URL(m[1], base).toString() });
    } catch {
      /* ignore */
    }
  }
  return out;
}

/**
 * Best-effort on-site search for Hebrew sports sites.
 * These sites frequently block server-side fetching; failures return [] gracefully.
 */
export async function fetchWebSource(
  game: GameInput,
  source: 'sport1' | 'sport5' | 'one'
): Promise<RawCandidate[]> {
  const homeHe = hebrewVariants(game.home)[0];
  const awayHe = hebrewVariants(game.away)[0];
  const q = encodeURIComponent(`${homeHe} ${awayHe} תקציר`);
  const searchUrls: Record<string, string> = {
    sport1: `https://www.sport1.co.il/?s=${q}`,
    sport5: `https://www.sport5.co.il/search/?q=${q}`,
    one: `https://www.one.co.il/Search/?q=${q}`,
  };
  const searchUrl = searchUrls[source];
  const base = searchUrl.split('/').slice(0, 3).join('/');
  try {
    const html = await fetchHtml(searchUrl);
    if (!html) return [];
    return extractLinks(html, base)
      .filter((l) => /video|vod|watch|article|news|item/i.test(l.url))
      .slice(0, 10)
      .map((l, i) => ({
        id: `${source}:${i}:${l.url}`,
        title: l.title,
        url: l.url,
        source: source as SourceKind,
        lang: 'he' as const,
      }));
  } catch {
    return [];
  }
}
