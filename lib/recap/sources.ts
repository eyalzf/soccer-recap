import { cacheGet, cacheSet } from '../cache';
import { hebrewVariants, lookupClubEn } from '../teamIndex';
import { teamMentioned } from './match';
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
    channelId: string;
    channelTitle: string;
    thumbnails?: { medium?: { url: string }; default?: { url: string } };
  };
}

async function ytSearch(
  q: string,
  opts: { channelId?: string; after: string; before: string; regionCode?: string }
): Promise<YtSearchItem[]> {
  const p = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    order: 'relevance',
    // Over-fetch on purpose: search.list costs a flat 100 quota units
    // regardless of page size (up to 50), and deny-listed/dead candidates
    // filtered downstream must not crowd usable results out of the page.
    maxResults: '25',
    q,
    publishedAfter: opts.after,
    publishedBefore: opts.before,
    key: YT_KEY,
  });
  if (opts.channelId) p.set('channelId', opts.channelId);
  // Bias results toward videos viewable in the user's country: geo-blocked
  // videos (e.g. US/UK rights holders' highlights) otherwise consume result
  // slots and get picked only to fail at playback.
  if (opts.regionCode) p.set('regionCode', opts.regionCode);
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

interface YtVideoMeta {
  duration: number;
  /** null when the videos.list item was missing (deleted/private) or the call failed. */
  embeddable: boolean | null;
  /** Uploader-declared audio language; null when untagged. */
  audioLang: string | null;
  /** Whether the uploader geo-blocked the video in Israel. */
  blockedInIL: boolean;
}

/** Batched videos.list metadata (duration, embeddable, region, audio lang),
 * cached 24h. Exported for the bulk uploads tier. */
export async function ytVideoMeta(ids: string[]): Promise<Map<string, YtVideoMeta>> {
  const map = new Map<string, YtVideoMeta>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    // Key version bump: v3 adds blockedInIL to the cached shape.
    const ck = 'ytmeta3:' + chunk.join(',');
    const cached = cacheGet<Record<string, YtVideoMeta>>(ck);
    if (cached) {
      for (const [k, v] of Object.entries(cached)) map.set(k, v);
      continue;
    }
    try {
      // status.embeddable tells whether the uploader allows embedding;
      // snippet.defaultAudioLanguage tags the video's language;
      // contentDetails.regionRestriction tells whether it's geo-blocked in
      // Israel. Same call as the duration lookup: no extra quota.
      const data = (await fetchJson(
        'https://www.googleapis.com/youtube/v3/videos?part=contentDetails,status,snippet&id=' +
          chunk.join(',') +
          '&key=' +
          YT_KEY
      )) as {
        items?: Array<{
          id: string;
          contentDetails?: {
            duration?: string;
            regionRestriction?: { allowed?: string[]; blocked?: string[] };
          };
          status?: { embeddable?: boolean };
          snippet?: { defaultAudioLanguage?: string; defaultLanguage?: string };
        }>;
      };
      const rec: Record<string, YtVideoMeta> = {};
      for (const it of data.items ?? []) {
        const rr = it.contentDetails?.regionRestriction;
        // Absent regionRestriction = no geo-blocking (playable in Israel).
        const blockedInIL = rr
          ? (rr.blocked ?? []).includes('IL') ||
            (rr.allowed != null && !rr.allowed.includes('IL'))
          : false;
        const meta = {
          duration: parseDuration(it.contentDetails?.duration || ''),
          embeddable: it.status?.embeddable ?? null,
          audioLang:
            it.snippet?.defaultAudioLanguage ?? it.snippet?.defaultLanguage ?? null,
          blockedInIL,
        };
        map.set(it.id, meta);
        rec[it.id] = meta;
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
    regionCode: 'IL',
  });

  const uniq = new Map<string, YtSearchItem>();
  for (const it of r) {
    const vid = it.id?.videoId;
    if (!vid || uniq.has(vid)) continue;
    uniq.set(vid, it);
  }

  const durs = await ytVideoMeta([...uniq.keys()]);

  return [...uniq.entries()].map(([vid, it]) => {
    const sn = it.snippet;
    const meta = durs.get(vid);
    return {
      id: 'yt:' + vid,
      title: decodeHtml(sn.title),
      url: 'https://www.youtube.com/watch?v=' + vid,
      source: 'youtube' as SourceKind,
      videoId: vid,
      thumbnail: sn.thumbnails?.medium?.url ?? sn.thumbnails?.default?.url,
      publishedAt: sn.publishedAt,
      durationSec: meta?.duration,
      // Only set when positively known; unknown fails open (kept).
      ...(meta?.embeddable != null ? { embeddable: meta.embeddable } : {}),
      ...(meta?.audioLang ? { audioLang: meta.audioLang } : {}),
      // Set only when the videos.list item was returned; a missing item
      // (deleted/private/failed lookup) fails open and keeps the candidate.
      ...(meta ? { blockedInIL: meta.blockedInIL } : {}),
      channelName: sn.channelTitle,
      channelHandle: job.handle,
      channelId: sn.channelId,
      lang: job.lang,
    } satisfies RawCandidate;
  });
}

// ---------- Sport1 (Maariv/Walla WordPress REST) ----------

interface WpSearchHit {
  id: number;
  title: string;
  url: string;
  subtype?: string;
}

interface WpVodPost {
  id: number;
  date?: string;
  date_gmt?: string;
}

/** WordPress title (numeric entities like &#8211;, stray tags) -> plain text. */
function decodeWpTitle(s: string): string {
  return decodeHtml(
    s
      .replace(/&#(\d+);/g, (_m, n: string) =>
        String.fromCharCode(parseInt(n, 10))
      )
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sport1 (sport1.maariv.co.il) per-game recap lookup via the site's public
 * WordPress REST API — no key, no quota:
 *  1. `wp/v2/search` (every Hebrew spelling variant of each team +
 *     תקציר; spellings differ across sources) finds the video post
 *     ("תקציר: דנמרק – פורטוגל 4:2") among news/results noise.
 *  2. `wp/v2/vod/<id>` gives the post date (date-proximity filtering).
 *  3. The article page HTML carries the Walla player embed; the media ID
 *     extracted from it builds the iframe URL the app renders.
 *  4. `dal.walla.co.il/media/<id>` gives the clip duration.
 * Title matching itself stays with the shared matcher (filterCandidate in
 * the recap route); this only produces raw candidates. Best-effort: any
 * failure returns [] and the YouTube cascade proceeds as before.
 */
export async function sport1Search(game: GameInput): Promise<RawCandidate[]> {
  const home = lookupClubEn(game.home);
  const away = lookupClubEn(game.away);
  if (!home || !away) return [];
  // Sport1's Hebrew spellings don't always match our canonical names
  // (ווילס vs וויילס, נורבגיה vs נורווגיה), and WordPress search is
  // spelling-sensitive — so query every known Hebrew variant of each
  // team (name + תקציר) plus the both-names query, union the hits, and
  // let the shared matcher do the precision work app-side.
  const homeVariants = hebrewVariants(game.home);
  const awayVariants = hebrewVariants(game.away);
  const queries = [
    `${homeVariants[0]} ${awayVariants[0]} תקציר`,
    ...homeVariants.map((v) => `${v} תקציר`),
    ...awayVariants.map((v) => `${v} תקציר`),
  ];
  try {
    const hitLists = await Promise.all(
      [...new Set(queries)].map(async (q) => {
        const p = new URLSearchParams({ search: q, per_page: '15' });
        try {
          return (await fetchJson(
            'https://sport1.maariv.co.il/wp-json/wp/v2/search?' + p.toString()
          )) as WpSearchHit[];
        } catch {
          return [] as WpSearchHit[];
        }
      })
    );
    const byId = new Map<number, WpSearchHit>();
    for (const list of hitLists) {
      for (const h of Array.isArray(list) ? list : []) {
        if (h.subtype === 'video' && h.id && h.url && !byId.has(h.id))
          byId.set(h.id, h);
      }
    }
    const out: RawCandidate[] = [];
    for (const hit of byId.values()) {
      // Cap the per-post work (date + article + media fetches); matching
      // hits are rare, so 4 kept candidates is generous.
      if (out.length >= 4) break;
      // Pre-filter on the (already plain) search title before spending
      // fetches; the shared matcher re-checks everything downstream.
      if (!teamMentioned(hit.title, home) || !teamMentioned(hit.title, away))
        continue;
      let publishedAt: string | undefined;
      try {
        const post = (await fetchJson(
          `https://sport1.maariv.co.il/wp-json/wp/v2/vod/${hit.id}`
        )) as WpVodPost;
        if (post.date_gmt) publishedAt = post.date_gmt + 'Z';
        else if (post.date) publishedAt = post.date;
      } catch {
        /* undated: the matcher fails open on date */
      }
      const html = await fetchHtml(hit.url);
      const m = html?.match(
        /player\.maariv\.co\.il\/public\/player\.html\?[^"'\s]*?[?&]media=(\d+)/
      );
      if (!m) continue;
      const mediaId = m[1];
      // Duration from the media API (too-long veto + duration badge use
      // it). Unknown duration fails open downstream, so best-effort.
      let durationSec: number | undefined;
      try {
        const media = (await fetchJson(
          'https://dal.walla.co.il/media/' + mediaId
        )) as { data?: { video?: { duration?: string } } };
        const d = parseInt(media?.data?.video?.duration ?? '', 10);
        if (Number.isFinite(d) && d > 0) durationSec = d;
      } catch {
        /* best effort */
      }
      out.push({
        id: 'sport1:' + hit.id,
        title: decodeWpTitle(hit.title),
        url: hit.url,
        source: 'sport1' as SourceKind,
        embedUrl:
          'https://player.maariv.co.il/public/player.html?player=sport1-desktop&media=' +
          mediaId +
          '&url=' +
          hit.url,
        ...(publishedAt ? { publishedAt } : {}),
        ...(durationSec != null ? { durationSec } : {}),
        // The media API URL content-negotiates: an <img> gets the poster.
        thumbnail: 'https://dal.walla.co.il/media/' + mediaId,
        lang: 'he' as const,
      });
    }
    return out;
  } catch {
    return [];
  }
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

/**
 * Raw YouTube Data API GET for endpoints without a dedicated helper
 * (e.g. playlistItems). Throws `HTTP 429` on rate limit, like the other
 * helpers; callers decide how to handle it.
 */
export async function ytApiGet(
  path: string,
  params: Record<string, string>
): Promise<unknown> {
  const p = new URLSearchParams({ ...params, key: YT_KEY });
  return fetchJson(`https://www.googleapis.com/youtube/v3/${path}?` + p.toString());
}
