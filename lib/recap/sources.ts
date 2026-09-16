import { cacheGet, cacheSet } from '../cache';
import { hebrewVariants } from '../teamIndex';
import type { GameInput, RawCandidate, SourceKind } from './types';

const YT_KEY = process.env.YOUTUBE_API_KEY || '';
const DAY = 86400000;

/**
 * YouTube Data API returns snippet titles with HTML entities
 * (&quot; &#39; &amp; ...). Decode them at ingestion: the matcher compares
 * titles against our team aliases (a title containing the literal text
 * "&quot;" never matches 'בית"ר'), and the UI would otherwise show the
 * raw entities to users.
 */
function decodeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

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

/** Resolve a YouTube @handle to its channel ID (cached 7 days). Exported so
 * the recap route can resolve per-league preferred channels. Returns null
 * when the handle doesn't resolve; never throws. */
export async function channelIdForHandle(handle: string): Promise<string | null> {
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

/** Hebrew general query: "{homeHe} {awayHe} תקציר}". */
export function hebrewQuery(game: GameInput): string {
  const homeHe = hebrewVariants(game.home)[0];
  const awayHe = hebrewVariants(game.away)[0];
  return `${homeHe} ${awayHe} תקציר`;
}

/** English general query: "{home} vs {away} highlights". */
export function englishQuery(game: GameInput): string {
  return `${game.home} vs ${game.away} highlights`;
}

export interface YouTubeSearchJob {
  /** Full query text. */
  q: string;
  /** When set, the search is scoped to this channel (one search.list call). */
  channelId?: string;
  /** Channel handle, recorded on results for preferred-channel display. */
  handle?: string;
  /** Query language, used as a soft Hebrew ranking signal. */
  lang: 'he' | 'en';
}

/**
 * A single YouTube search.list call (100 quota units) plus durations.
 * If YOUTUBE_API_KEY is missing, returns [] gracefully.
 * NOTE: errors propagate to the caller (the recap route catches per-search
 * and records them in debug diagnostics). Do not swallow them here: a
 * silent [] is indistinguishable from "no videos found".
 */
export async function youtubeSearch(
  game: GameInput,
  job: YouTubeSearchJob
): Promise<RawCandidate[]> {
  if (!YT_KEY) return [];
  const g = new Date(game.dateISO).getTime();
  const after = new Date(g - 6 * DAY).toISOString();
  // Extended highlights ("תקציר מורחב") are often published 2-4 days after
  // the game; keep the window wide and let the date filter/ranking sort it.
  const before = new Date(g + 5 * DAY).toISOString();

  const r = await ytSearch(job.q, {
    channelId: job.channelId,
    after,
    before,
  });

  const uniq = new Map<string, YtSearchItem>();
  for (const it of r) {
    const vid = it.id?.videoId;
    if (!vid || uniq.has(vid)) continue;
    uniq.set(vid, it);
  }

  const durs = await ytDurations([...uniq.keys()]);

  return [...uniq.entries()].map(([vid, it]) => {
    const sn = it.snippet;
    return {
      id: 'yt:' + vid,
      title: decodeHtml(sn.title),
      url: 'https://www.youtube.com/watch?v=' + vid,
      source: 'youtube' as SourceKind,
      videoId: vid,
      thumbnail: sn.thumbnails?.medium?.url ?? sn.thumbnails?.default?.url,
      publishedAt: sn.publishedAt,
      durationSec: durs.get(vid),
      channelName: sn.channelTitle,
      channelHandle: job.handle,
      lang: job.lang,
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
