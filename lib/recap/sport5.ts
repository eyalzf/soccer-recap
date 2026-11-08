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
 * Second discovery source (2026-11-01): the mobile Ligue 1 league page
 * (m.sport5.co.il/liga.aspx?FolderId=495). Its items are ARTICLE links
 * (articles.aspx?FolderID=496&docID=<n>), not VOD links — the article
 * videos are minute-ly embeds, not Sport5 VOD catalog items, so no VOD
 * id exists to resolve (verified in the raw article HTML, 2026-11-01).
 * League-page results therefore link to the article itself (player
 * inside). The league page retains items for ~2 weeks (vs ~1-2 days on
 * the rail) and carries a real per-item date, which the matcher uses
 * for the date window instead of firstSeen. Only video items are
 * harvested: list items carrying the btn-play marker (verified against
 * the real page — the two text articles lack it). v1 scope is Ligue 1
 * only; other competitions' league folders are not yet mapped.
 *
 * Matching is conservative by design (see matchSport5Index): both
 * teams in the headline (or one team + the exact scoreline) + score
 * cross-check + date proximity, and ANY ambiguity yields no result —
 * a wrong link is worse than none.
 * Every failure mode (fetch error, empty index, no match) degrades to
 * "no external result" silently; this module never throws into the
 * recap pipeline.
 */
import { pget, pset } from './persist';
import { extractScore, teamMentioned, titleHasScore } from './match';
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
  /**
   * Sport5 VOD category id as linked from the homepage rail. Until
   * 2026-10-14 this was the video's own category (12363 = Champions
   * League); since 2026-10-15 the rail links every item under a single
   * rail-level category (893), so `vc` no longer identifies the
   * competition and matching must not gate on it (see matchSport5Index).
   * It is still used verbatim in the link-out URL — it is the URL
   * Sport5's own rail points at. 0 for league-page article items,
   * which carry no VOD category (see docId/articleUrl).
   */
  vc: number;
  /** Sport5 video id. 0 for league-page article items. */
  vi: number;
  /** Hebrew headline, as shown on the rail / league page. */
  title: string;
  /** Rail thumbnail URL (www.sport5.co.il storage). */
  thumb?: string;
  /** First harvest that saw this item (ms epoch). */
  firstSeen: number;
  /** Most recent harvest that saw this item (ms epoch). */
  lastSeen: number;
  /**
   * League-page article items only: the article's docID, its full
   * article URL (the link-out target — the article page holds the
   * minute-ly player), and the article's own publication date (ms
   * epoch, noon UTC of the listing date), which the matcher uses for
   * the date window instead of firstSeen.
   */
  docId?: number;
  articleUrl?: string;
  publishedMs?: number;
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

const LEAGUE_LIGUE1_URL = 'https://m.sport5.co.il/liga.aspx?FolderId=495';

export interface Sport5LeagueItem {
  docId: number;
  articleUrl: string;
  title: string;
  thumb?: string;
  /** Article publication date, noon UTC of the listing date. */
  publishedMs: number;
}

/**
 * Parse the m.sport5.co.il Ligue 1 league page's article list: one
 * `<a id="ancItem" class="item">` per list item, each wrapping an <img>
 * whose alt is the headline and whose data-src is the thumbnail, plus
 * a DD.MM.YY date string. Only items carrying the btn-play marker are
 * kept — in the captured 2026-11-01 fixture that marker is present on
 * exactly the 7 video items and absent on the 2 text articles, so it
 * is the video signal (a text article matching teams+score would be a
 * wrong result). Pure — unit-tested against the captured real pages
 * (fixtures/sport5/league-ligue1-2026-11-01.html and -2026-11-08.html).
 * Duplicate anchors dedupe by docId.
 *
 * The featured main article is parsed too (2026-11-08): it lives in a
 * `main-article-holder` block with different markup (`btn-play-main`
 * instead of `btn-play`) and is NOT duplicated as a list item — the
 * Nov 1 assumption that main stories also appear as list items failed
 * for PSG–Troyes (Nov 7), whose highlight was main-article-only and
 * went unharvested, leaving the card without its Sport5 source. Its
 * date comes from the `<em class="date">DD.MM.YY - HH:MM</em>` stamp
 * (same noon-UTC convention as list items); it is kept only when the
 * block carries the btn-play-main video marker.
 */
export function parseSport5LeaguePage(html: string): Sport5LeagueItem[] {
  const out: Sport5LeagueItem[] = [];
  const seen = new Set<number>();
  const anchorRe =
    /<a\s[^>]*href="((?:https?:\/\/m\.sport5\.co\.il)?\/articles\.aspx\?FolderID=\d+&(?:amp;)?docID=(\d+))"[^>]*id="ancItem"[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html))) {
    const docId = parseInt(m[2], 10);
    if (!Number.isFinite(docId) || seen.has(docId)) continue;
    // Block = this item up to the NEXT item's anchor. Search past the
    // current tag's end: the current anchor's own id="ancItem" sits
    // inside its tag, so searching from m.index + 1 would find itself
    // and yield an empty block.
    const tagEnd = html.indexOf('>', m.index);
    const nextAnchor = html.indexOf('id="ancItem"', tagEnd + 1);
    const block = html.slice(m.index, nextAnchor === -1 ? m.index + 3000 : nextAnchor);
    if (!block.includes('btn-play')) continue;
    const alt = block.match(/<img[^>]*\salt="([^"]*)"/);
    const rawTitle = alt?.[1] ?? '';
    const title = decodeEntities(rawTitle);
    if (!title) continue;
    const date = block.match(/(\d{1,2})\.(\d{1,2})\.(\d{2})/);
    if (!date) continue;
    const publishedMs = Date.UTC(
      2000 + parseInt(date[3], 10),
      parseInt(date[2], 10) - 1,
      parseInt(date[1], 10),
      12
    );
    const ds = block.match(/data-src="([^"]+)"/);
    const articleUrl = m[1].startsWith('http')
      ? m[1]
      : `https://m.sport5.co.il${m[1]}`;
    seen.add(docId);
    out.push({
      docId,
      articleUrl,
      title,
      ...(ds ? { thumb: ds[1] } : {}),
      publishedMs,
    });
  }
  // Featured main article (see the doc comment): same shape as a list
  // item, taken from the main-article-holder block. Dedupe by docId —
  // when the main story also appears as a list item, the list copy
  // (parsed above) wins.
  // Anchor on the div's class attribute: the literal 'main-article-holder'
  // also appears inside a <script> (a querySelector string) earlier in
  // the page, and a slice from there misses the real block.
  const holderIdx = html.indexOf('class="main-article-holder');
  if (holderIdx !== -1) {
    const block = html.slice(holderIdx, holderIdx + 6000);
    if (block.includes('btn-play-main')) {
      const link = block.match(
        /href="((?:https?:\/\/m\.sport5\.co\.il)?\/articles\.aspx\?FolderID=\d+&(?:amp;)?docID=(\d+))"/
      );
      const docId = link ? parseInt(link[2], 10) : NaN;
      if (link && Number.isFinite(docId) && !seen.has(docId)) {
        const alt = block.match(/<img[^>]*\salt="([^"]*)"/);
        const mainTitle = block.match(/<span class="main-title">([^<]*)</);
        const title = decodeEntities((alt?.[1] ?? mainTitle?.[1] ?? '').trim());
        const date = block.match(/<em class="date">(\d{1,2})\.(\d{1,2})\.(\d{2})/);
        if (title && date) {
          const publishedMs = Date.UTC(
            2000 + parseInt(date[3], 10),
            parseInt(date[2], 10) - 1,
            parseInt(date[1], 10),
            12
          );
          // The mask img's own src is the main article's thumbnail. A
          // data-src in this block belongs to a later list item (the
          // 6000-char window reaches past the main article), so it is
          // only a fallback when the mask img is lazy-loaded.
          const src = block.match(/<img[^>]*\ssrc="(https:\/\/[^"]+)"/);
          const ds = block.match(/data-src="([^"]+)"/);
          const articleUrl = link[1].startsWith('http')
            ? link[1]
            : `https://m.sport5.co.il${link[1]}`;
          seen.add(docId);
          out.push({
            docId,
            articleUrl,
            title,
            ...(src ? { thumb: src[1] } : ds ? { thumb: ds[1] } : {}),
            publishedMs,
          });
        }
      }
    }
  }
  return out;
}

/** Fetch the mobile Ligue 1 league page and parse its list. Null on any failure. */
export async function harvestSport5LeaguePage(
  timeoutMs = 12000
): Promise<Sport5LeagueItem[] | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(LEAGUE_LIGUE1_URL, {
      signal: ctrl.signal,
      headers: { 'User-Agent': MOBILE_UA },
    });
    if (!res.ok) return null;
    return parseSport5LeaguePage(await res.text());
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
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

/**
 * Merge freshly harvested items into the stored index (pure). Fresh
 * items are rail items (VOD, keyed by vi) or league-page items
 * (articles, keyed by docId) — the two namespaces never collide.
 * Re-harvest preserves firstSeen and refreshes title/thumb/lastSeen;
 * items older than INDEX_MAX_AGE_MS by firstSeen are pruned. Sort is
 * newest-first by firstSeen, then by vi (so a single-harvest batch
 * keeps the rail's newest-first order).
 */
export function mergeSport5Index(
  prev: Sport5IndexItem[],
  fresh: Array<Sport5RailItem | Sport5LeagueItem>,
  now: number
): Sport5IndexItem[] {
  const keyOf = (it: Sport5IndexItem): string =>
    it.articleUrl ? `a:${it.docId}` : `v:${it.vi}`;
  const byKey = new Map<string, Sport5IndexItem>();
  for (const it of prev) byKey.set(keyOf(it), it);
  for (const f of fresh) {
    const shaped: Sport5IndexItem =
      'docId' in f
        ? {
            vc: 0,
            vi: 0,
            docId: f.docId,
            articleUrl: f.articleUrl,
            title: f.title,
            ...(f.thumb ? { thumb: f.thumb } : {}),
            publishedMs: f.publishedMs,
            firstSeen: now,
            lastSeen: now,
          }
        : {
            vc: f.vc,
            vi: f.vi,
            title: f.title,
            ...(f.thumb ? { thumb: f.thumb } : {}),
            firstSeen: now,
            lastSeen: now,
          };
    const key = keyOf(shaped);
    const old = byKey.get(key);
    if (old) {
      byKey.set(key, {
        ...old,
        vc: shaped.vc,
        title: shaped.title,
        ...(shaped.thumb ? { thumb: shaped.thumb } : {}),
        lastSeen: now,
      });
    } else {
      byKey.set(key, shaped);
    }
  }
  return [...byKey.values()]
    .filter((it) => now - it.firstSeen <= INDEX_MAX_AGE_MS)
    .sort((a, b) => b.firstSeen - a.firstSeen || b.vi - a.vi);
}

/**
 * Load the accumulated index, re-harvesting first when the last
 * harvest is older than HARVEST_TTL_MS. Both sources are harvested
 * (rail + Ligue 1 league page) and each failure is isolated: one
 * source failing still merges the other. A fully failed harvest falls
 * back to the stored index (possibly empty) — never throws.
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
    const [freshRail, freshLeague] = await Promise.all([
      harvestSport5Rail(),
      harvestSport5LeaguePage(),
    ]);
    const fresh = [...(freshRail ?? []), ...(freshLeague ?? [])];
    if (freshRail || freshLeague) {
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
  /** League-page article items only (vi is 0 for them). */
  docId?: number;
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
 *  - both teams identifiable in the Hebrew headline via the central
 *    team registry (canonical names + aliases) — or, for a
 *    single-team narrative headline, exactly one team plus the exact
 *    scoreline in either order ('teams');
 *  - a score in the headline must match the fixture score in one of
 *    the two orders ('score' — mirrors the shared matcher's veto);
 *  - the item's date (the article's own date for league-page items;
 *    firstSeen for rail items, since the rail carries no per-item date)
 *    must fall within the game's UTC calendar day .. gameDate +3d
 *    ('date') — a highlight cannot predate the game it recaps (user
 *    decision 2026-11-02, same rule as the shared matcher);
 *  - exactly one surviving item → the result; zero → none; two or
 *    more → 'ambiguous': no result (a wrong link is worse than none).
 *
 * The item's rail category (`vc`) is deliberately NOT a gate: on
 * 2026-10-15 Sport5 changed the homepage rail to link every item
 * under one rail-level category (893), so vc stopped identifying the
 * competition overnight and every real highlight was rejected on
 * 'category' (verified on production via curated-test: 12 fetched,
 * 12 category-rejected). Competition safety now rests on the rules
 * above — the same combination the YouTube matcher relies on, which
 * has no category concept either. A same-pair clash across two
 * competitions inside the window can only produce 'ambiguous' (both
 * items kept → suppressed), never a wrong link. `category` (the
 * plan's canonical VOD category) is accepted for signature
 * compatibility and diagnostics, but no longer filters.
 */
export function matchSport5Index(
  items: Sport5IndexItem[],
  game: GameInput,
  category?: number
): Sport5MatchResult {
  void category;
  const home = lookupClubEn(game.home);
  const away = lookupClubEn(game.away);
  const gameTime = Date.parse(game.dateISO);
  const considered: Sport5Considered[] = [];
  const matches: Sport5IndexItem[] = [];
  for (const it of items) {
    let reason = 'ok';
    if (!home || !away) {
      reason = 'unknown-team';
    } else {
      const homeMentioned = teamMentioned(it.title, home);
      const awayMentioned = teamMentioned(it.title, away);
      const sc = extractScore(it.title);
      // Any-score matching (2026-11-04): comeback headlines carry the
      // intermediate score first ('חזרה מ-2:0 ל-2:3') — the fixture
      // score may be the second scoreline in the title, not the first.
      const scoreMatches = titleHasScore(it.title, game.homeScore, game.awayScore);
      if (!homeMentioned && !awayMentioned) {
        reason = 'teams';
      } else if ((!homeMentioned || !awayMentioned) && !scoreMatches) {
        // Single-team narrative headline (e.g. Sport5's Ligue 1
        // 'שלושער מטורף לחאכימי, 1:5 גדול לפ.ס.ז''): kept only when
        // the headline also carries the exact scoreline — the
        // preferred-tier exception's logic, applied to this trusted
        // broadcaster. The date window and exactly-one rules below
        // still apply, so a one-team clip cannot hijack a game alone.
        reason = 'teams';
      } else if (sc && !scoreMatches) {
        reason = 'score';
      }
      if (reason === 'ok') {
        // League-page article items carry their real publication date;
        // rail items only have firstSeen (the rail carries no per-item
        // date), so firstSeen is the fallback. Lower bound is the
        // game's UTC calendar day, not gameTime −1d: an item dated
        // before the game day is a previous fixture's item, however
        // close its headline is to this fixture.
        const itemMs = it.publishedMs ?? it.firstSeen;
        const gameDayStart = Date.parse(game.dateISO.slice(0, 10) + 'T00:00:00.000Z');
        const diff = (itemMs - gameTime) / DAY;
        if (Number.isNaN(diff) || itemMs < gameDayStart || diff > 3) reason = 'date';
      }
    }
    const keep = reason === 'ok';
    if (keep) matches.push(it);
    considered.push({
      vi: it.vi,
      vc: it.vc,
      ...(it.docId ? { docId: it.docId } : {}),
      title: it.title,
      keep,
      reason,
    });
  }
  if (matches.length > 1) {
    return { candidate: null, ambiguous: true, considered };
  }
  const it = matches[0];
  if (!it) return { candidate: null, ambiguous: false, considered };
  return {
    candidate: {
      // Article items link to the article page (which holds the
      // minute-ly player); VOD items link to the VOD player page.
      id: it.articleUrl ? `sport5:article:${it.docId}` : `sport5:${it.vi}`,
      title: it.title,
      url: it.articleUrl ?? `https://vod.sport5.co.il/?Vc=${it.vc}&Vi=${it.vi}`,
      source: 'sport5',
      external: true,
      ...(it.thumb ? { thumbnail: it.thumb } : {}),
      publishedAt: new Date(it.publishedMs ?? it.firstSeen).toISOString(),
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
