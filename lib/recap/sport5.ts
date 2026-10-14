/**
 * Sport5 external (link-out) source.
 *
 * Sport5 is the official Israeli Champions League broadcaster and posts
 * a Hebrew highlight for nearly every UCL game — but its player blocks
 * third-party framing on every surface (verified 2026-10-14: desktop
 * player, desktop page, mobile page, standalone player host), so its
 * results are LINKS opened at the source, never embedded players.
 *
 * Discovery is by harvest, not by query: the desktop catalog is
 * JS-rendered behind Akamai (403 from any datacenter), but the mobile
 * homepage (m.sport5.co.il) is server-rendered and fetchable — its
 * "newest VOD" rail carries ~20 items as plain HTML anchors
 * (/VOD/?Vc=<category>&Vi=<id>) with the Hebrew headline in the item's
 * <img alt> and the thumbnail in data-src (proven fetchable from
 * Vercel by an on-screen probe, 2026-10-14). Harvested items accumulate
 * in a Blob index (`external/sport5-index.json`) so a video stays
 * findable after it rolls off the homepage rail.
 *
 * Matching is conservative by design (see matchSport5Index): category
 * + both teams in the headline + score cross-check + date proximity,
 * and ANY ambiguity yields no result — a wrong link is worse than none.
 * Every failure mode (fetch error, empty index, no match) degrades to
 * "no external result" silently; this module never throws into the
 * recap pipeline.
 */
import { pget, pset } from './persist';
import { extractScore, teamMentioned } from './match';
import { lookupClubEn } from '../teamIndex';
import type { ExternalSourceConfig } from './leaguePlans';
import type { GameInput, RawCandidate } from './types';

const DAY = 86400000;
const INDEX_KEY = 'external/sport5-index.json';
/** Re-harvest at most this often; matching always uses the full index. */
const HARVEST_TTL_MS = 30 * 60 * 1000;
/** Index entries older than this (by firstSeen) are pruned. */
const INDEX_MAX_AGE_MS = 120 * DAY;
const HOME_URL = 'https://m.sport5.co.il/';
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export interface Sport5IndexItem {
  /** Sport5 VOD category id (12363 = Champions League highlights). */
  vc: number;
  /** Sport5 video id. */
  vi: number;
  /** Hebrew headline, as shown on the rail. */
  title: string;
  /** Rail thumbnail URL (www.sport5.co.il storage). */
  thumb?: string;
  /** First harvest that saw this item (ms epoch). */
  firstSeen: number;
  /** Most recent harvest that saw this item (ms epoch). */
  lastSeen: number;
}

interface Sport5Index {
  items: Sport5IndexItem[];
}

/** HTML entities Sport5 emits in alt/desc text (&#39; &quot; &amp; …). */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Sport5RailItem {
  vc: number;
  vi: number;
  title: string;
  thumb?: string;
}

/**
 * Parse the m.sport5.co.il homepage's VOD rail: one anchor per item,
 * `<a href="/VOD/?Vc=<n>&Vi=<n>">` wrapping an <img> whose alt is the
 * headline and whose data-src is the thumbnail (the visible <span
 * class="desc"> repeats the headline). Pure — unit-tested against a
 * captured real homepage fixture. Duplicate anchors dedupe by vi.
 */
export function parseSport5Rail(html: string): Sport5RailItem[] {
  const out: Sport5RailItem[] = [];
  const seen = new Set<number>();
  const re =
    /<a\s[^>]*href="(?:https?:\/\/m\.sport5\.co\.il)?\/VOD\/?\?Vc=(\d+)&(?:amp;)?Vi=(\d+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const vc = parseInt(m[1], 10);
    const vi = parseInt(m[2], 10);
    if (!Number.isFinite(vc) || !Number.isFinite(vi) || seen.has(vi)) continue;
    const inner = m[3];
    const alt = inner.match(/<img[^>]*\salt="([^"]*)"/);
    const desc = inner.match(/<span class="desc">([\s\S]*?)<\/span>/);
    const rawTitle = alt?.[1] ?? desc?.[1]?.replace(/<[^>]+>/g, ' ') ?? '';
    const title = decodeEntities(rawTitle);
    if (!title) continue;
    const ds = inner.match(/data-src="([^"]+)"/);
    seen.add(vi);
    out.push({ vc, vi, title, ...(ds ? { thumb: ds[1] } : {}) });
  }
  return out;
}

/** Fetch the mobile homepage and parse its rail. Null on any failure. */
export async function harvestSport5Rail(
  timeoutMs = 12000
): Promise<Sport5RailItem[] | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(HOME_URL, {
      signal: ctrl.signal,
      headers: { 'User-Agent': MOBILE_UA },
    });
    if (!res.ok) return null;
    return parseSport5Rail(await res.text());
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Merge freshly harvested rail items into the stored index (pure). */
export function mergeSport5Index(
  prev: Sport5IndexItem[],
  fresh: Sport5RailItem[],
  now: number
): Sport5IndexItem[] {
  const byVi = new Map<number, Sport5IndexItem>();
  for (const it of prev) byVi.set(it.vi, it);
  for (const f of fresh) {
    const old = byVi.get(f.vi);
    if (old) {
      byVi.set(f.vi, {
        ...old,
        vc: f.vc,
        title: f.title,
        ...(f.thumb ? { thumb: f.thumb } : {}),
        lastSeen: now,
      });
    } else {
      byVi.set(f.vi, { ...f, firstSeen: now, lastSeen: now });
    }
  }
  return [...byVi.values()]
    .filter((it) => now - it.firstSeen <= INDEX_MAX_AGE_MS)
    .sort((a, b) => b.vi - a.vi);
}

/**
 * Load the accumulated index, re-harvesting first when the last
 * harvest is older than HARVEST_TTL_MS. A failed harvest falls back to
 * the stored index (possibly empty) — never throws.
 */
export async function loadSport5Index(): Promise<Sport5IndexItem[]> {
  let items: Sport5IndexItem[] = [];
  let lastHarvest = 0;
  try {
    const rec = await pget<Sport5Index>(INDEX_KEY);
    if (rec && Array.isArray(rec.val?.items)) {
      items = rec.val.items;
      lastHarvest = rec.fetchedAt;
    }
  } catch {
    /* unreadable index = empty index */
  }
  const now = Date.now();
  if (now - lastHarvest > HARVEST_TTL_MS) {
    const fresh = await harvestSport5Rail();
    if (fresh) {
      items = mergeSport5Index(items, fresh, now);
      try {
        await pset(INDEX_KEY, { items } satisfies Sport5Index);
      } catch {
        /* persistence is best-effort; the in-memory copy still serves */
      }
    }
  }
  return items;
}

export interface Sport5Considered {
  vi: number;
  vc: number;
  title: string;
  keep: boolean;
  /** 'ok' when kept; otherwise the rejection reason. */
  reason: string;
}

export interface Sport5MatchResult {
  candidate: RawCandidate | null;
  /** Set when ≥2 items matched: ambiguity suppresses the result. */
  ambiguous: boolean;
  /** Every index item, with its verdict (newest first). */
  considered: Sport5Considered[];
}

/**
 * Match the accumulated index against one game (pure). Rules:
 *  - item's category must equal the configured category ('category');
 *  - both teams identifiable in the Hebrew headline via the central
 *    team registry (canonical names + aliases) ('teams');
 *  - a score in the headline must match the fixture score in one of
 *    the two orders ('score' — mirrors the shared matcher's veto);
 *  - the item's date (firstSeen; the rail carries no per-item date)
 *    must fall within gameDate −1d .. gameDate +3d ('date');
 *  - exactly one surviving item → the result; zero → none; two or
 *    more → 'ambiguous': no result (a wrong link is worse than none).
 */
export function matchSport5Index(
  items: Sport5IndexItem[],
  game: GameInput,
  category: number
): Sport5MatchResult {
  const home = lookupClubEn(game.home);
  const away = lookupClubEn(game.away);
  const gameTime = Date.parse(game.dateISO);
  const considered: Sport5Considered[] = [];
  const matches: Sport5IndexItem[] = [];
  for (const it of items) {
    let reason = 'ok';
    if (it.vc !== category) {
      reason = 'category';
    } else if (!home || !away) {
      reason = 'unknown-team';
    } else if (!teamMentioned(it.title, home) || !teamMentioned(it.title, away)) {
      reason = 'teams';
    } else {
      const sc = extractScore(it.title);
      if (sc && game.homeScore != null && game.awayScore != null) {
        const [a, b] = sc;
        const either =
          (a === game.homeScore && b === game.awayScore) ||
          (a === game.awayScore && b === game.homeScore);
        if (!either) reason = 'score';
      }
      if (reason === 'ok') {
        const diff = (it.firstSeen - gameTime) / DAY;
        if (Number.isNaN(diff) || diff < -1 || diff > 3) reason = 'date';
      }
    }
    const keep = reason === 'ok';
    if (keep) matches.push(it);
    considered.push({ vi: it.vi, vc: it.vc, title: it.title, keep, reason });
  }
  if (matches.length > 1) {
    return { candidate: null, ambiguous: true, considered };
  }
  const it = matches[0];
  if (!it) return { candidate: null, ambiguous: false, considered };
  return {
    candidate: {
      id: `sport5:${it.vi}`,
      title: it.title,
      url: `https://vod.sport5.co.il/?Vc=${it.vc}&Vi=${it.vi}`,
      source: 'sport5',
      external: true,
      ...(it.thumb ? { thumbnail: it.thumb } : {}),
      publishedAt: new Date(it.firstSeen).toISOString(),
      channelName: 'Sport5',
      lang: 'he',
    },
    ambiguous: false,
    considered,
  };
}

/**
 * Full provider run for one game: refresh/load the index, then match.
 * Never throws — any failure yields an empty match with whatever
 * diagnostics were gathered.
 */
export async function sport5Search(
  game: GameInput,
  cfg: ExternalSourceConfig
): Promise<Sport5MatchResult> {
  try {
    const items = await loadSport5Index();
    return matchSport5Index(items, game, cfg.category);
  } catch {
    return { candidate: null, ambiguous: false, considered: [] };
  }
}
