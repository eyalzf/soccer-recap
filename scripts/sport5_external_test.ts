/**
 * Sport5 external (link-out) source tests.
 *
 * Part 1 — rail parser: run against a fixture captured from the REAL
 * m.sport5.co.il homepage (fixtures/sport5/rail-homepage-2026-10-14.html;
 * the live rail of Tuesday 2026-10-13's Champions League matchday).
 * Part 2 — headline matcher: the eight real MD2 headlines against their
 * real fixtures (names/scores as in data/champions-league.json), plus
 * score-veto, ambiguity, rail-category (2026-10-15) and date-window
 * cases. All
 * parts are pure/offline — no network, no Blob (index items are built
 * in memory from the parsed fixture).
 *
 *   npx -y tsx scripts/sport5_external_test.ts
 */
import { readFileSync } from 'fs';
import path from 'path';
import {
  matchSport5Index,
  mergeSport5Index,
  parseSport5Rail,
  type Sport5IndexItem,
} from '../lib/recap/sport5';
import { applyExternalExclusivity } from '../lib/recap/external';
import { gameCacheKeyMatchesDate } from '../lib/recap/sweep';
import { searchPlanFor } from '../lib/recap/leaguePlans';
import type { GameInput, RawCandidate } from '../lib/recap/types';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    pass += 1;
    console.log(`PASS ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`);
  }
}
function eq(name: string, got: unknown, want: unknown) {
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const CATEGORY = 12363;
const FIRST_SEEN = Date.parse('2026-10-14T08:00:00Z');

// ---------- Part 1: rail parser on the real captured homepage ----------

const html = readFileSync(
  path.join(__dirname, '..', 'fixtures', 'sport5', 'rail-homepage-2026-10-14.html'),
  'utf8'
);
const rail = parseSport5Rail(html);
eq('parser: 12 rail items', rail.length, 12);

const ucl = rail.filter((i) => i.vc === CATEGORY);
eq('parser: 8 UCL items', ucl.length, 8);
eq(
  'parser: UCL vis',
  ucl.map((i) => i.vi).sort((a, b) => a - b),
  [563567, 563568, 563569, 563570, 563571, 563572, 563573, 563574]
);
const byVi = new Map(rail.map((i) => [i.vi, i]));
eq('parser: barca title', byVi.get(563574)?.title, 'ממשיכה להפציץ: 1:4 ענק לבארסה על גלאטסראיי');
eq('parser: atletico title (backtick)', byVi.get(563573)?.title, 'עם שער בדקה הראשונה: 0:2 לאתלטיקו על מנצ`סטר יונייטד');
eq('parser: sabah title', byVi.get(563567)?.title, 'ניצחון בכורה באלופות: סבאח גברה על סלביה פראג');
check(
  'parser: thumbnails are sport5 storage urls',
  rail.every((i) => (i.thumb ?? '').startsWith('https://www.sport5.co.il/Sip_Storage/'))
);
eq('parser: basketball category kept separate', rail.filter((i) => i.vc === 12369).length, 3);
eq('parser: empty html parses empty', parseSport5Rail('<html></html>').length, 0);

// ---------- Part 2: headline matcher on the real fixtures ----------

const index: Sport5IndexItem[] = rail.map((i) => ({
  ...i,
  firstSeen: FIRST_SEEN,
  lastSeen: FIRST_SEEN,
}));

const GAMES: Array<{ game: GameInput; vi: number }> = [
  { game: { home: 'Sabah FK', away: 'Slavia Prague', homeScore: 2, awayScore: 0, dateISO: '2026-10-13T16:45:00.000Z', league: 'champions-league' }, vi: 563567 },
  { game: { home: 'Lens', away: 'Sporting CP', homeScore: 0, awayScore: 2, dateISO: '2026-10-13T16:45:00.000Z', league: 'champions-league' }, vi: 563568 },
  { game: { home: 'Inter', away: 'Club Brugge', homeScore: 3, awayScore: 4, dateISO: '2026-10-13T19:00:00.000Z', league: 'champions-league' }, vi: 563569 },
  { game: { home: 'Villarreal', away: 'Napoli', homeScore: 3, awayScore: 1, dateISO: '2026-10-13T19:00:00.000Z', league: 'champions-league' }, vi: 563570 },
  { game: { home: 'Arsenal', away: 'Lille', homeScore: 3, awayScore: 0, dateISO: '2026-10-13T19:00:00.000Z', league: 'champions-league' }, vi: 563571 },
  { game: { home: 'Viking', away: 'Bayern München', homeScore: 3, awayScore: 3, dateISO: '2026-10-13T19:00:00.000Z', league: 'champions-league' }, vi: 563572 },
  { game: { home: 'Atlético Madrid', away: 'Manchester United', homeScore: 2, awayScore: 0, dateISO: '2026-10-13T19:00:00.000Z', league: 'champions-league' }, vi: 563573 },
  { game: { home: 'Galatasaray', away: 'Barcelona', homeScore: 1, awayScore: 4, dateISO: '2026-10-13T19:00:00.000Z', league: 'champions-league' }, vi: 563574 },
];

for (const { game, vi } of GAMES) {
  const label = `${game.home} vs ${game.away}`;
  const r = matchSport5Index(index, game, CATEGORY);
  eq(`${label}: matched vi`, r.candidate?.id, `sport5:${vi}`);
  eq(`${label}: url`, r.candidate?.url, `https://vod.sport5.co.il/?Vc=12363&Vi=${vi}`);
  check(`${label}: external flag`, r.candidate?.external === true);
  check(`${label}: source/lang/channel`, r.candidate?.source === 'sport5' && r.candidate?.lang === 'he' && r.candidate?.channelName === 'Sport5');
  check(`${label}: thumbnail present`, !!r.candidate?.thumbnail);
  check(`${label}: not ambiguous`, !r.ambiguous);
  // No other game may claim this item, and this game claims exactly one:
  // across the whole index exactly one item is kept for this game.
  eq(`${label}: exactly one kept item`, r.considered.filter((c) => c.keep).length, 1);
}

// ---------- Score veto: right teams, wrong score ----------
{
  const game: GameInput = {
    home: 'Galatasaray', away: 'Barcelona', homeScore: 2, awayScore: 4,
    dateISO: '2026-10-13T19:00:00.000Z', league: 'champions-league',
  };
  const r = matchSport5Index(index, game, CATEGORY);
  eq('score veto: no candidate', r.candidate, null);
  eq('score veto: reason', r.considered.find((c) => c.vi === 563574)?.reason, 'score');
}

// ---------- Teams: a pairing that is not on the rail ----------
{
  const game: GameInput = {
    home: 'Real Madrid', away: 'Barcelona', homeScore: 2, awayScore: 1,
    dateISO: '2026-10-13T19:00:00.000Z', league: 'champions-league',
  };
  const r = matchSport5Index(index, game, CATEGORY);
  eq('absent pairing: no candidate', r.candidate, null);
  eq('absent pairing: barca item rejected on teams', r.considered.find((c) => c.vi === 563574)?.reason, 'teams');
}

// ---------- Ambiguity: two items match the same game → no result ----------
{
  const dupe: Sport5IndexItem = {
    vc: CATEGORY, vi: 999001,
    title: 'ממשיכה להפציץ: 1:4 ענק לבארסה על גלאטסראיי',
    firstSeen: FIRST_SEEN, lastSeen: FIRST_SEEN,
  };
  const r = matchSport5Index([...index, dupe], GAMES[7].game, CATEGORY);
  eq('ambiguity: no candidate', r.candidate, null);
  check('ambiguity: flagged', r.ambiguous);
  eq('ambiguity: both items individually match', r.considered.filter((c) => c.keep).length, 2);
}

// ---------- Rail category change (2026-10-15): vc no longer gates ----------
// Sport5's homepage rail now links EVERY item under one rail-level
// category (893) instead of each video's own category. Simulating that
// rail by rewriting every indexed item's vc to 893 must not change any
// match — competition safety comes from teams + score + date +
// exactly-one, not from vc.
{
  const rail893: Sport5IndexItem[] = index.map((i) => ({ ...i, vc: 893 }));
  for (const { game, vi } of GAMES) {
    const label = `rail-893 ${game.home} vs ${game.away}`;
    const r = matchSport5Index(rail893, game, CATEGORY);
    eq(`${label}: matched vi`, r.candidate?.id, `sport5:${vi}`);
    eq(
      `${label}: url uses the item's own rail vc`,
      r.candidate?.url,
      `https://vod.sport5.co.il/?Vc=893&Vi=${vi}`
    );
    eq(`${label}: exactly one kept item`, r.considered.filter((c) => c.keep).length, 1);
  }
  // A non-football item still cannot leak into a football match: the
  // basketball headline names neither UCL team of any fixture, and the
  // NBA item names no football club at all — both die on 'teams'.
  const gala = matchSport5Index(rail893, GAMES[7].game, CATEGORY);
  eq(
    'rail-893: basketball item rejected on teams for a football game',
    gala.considered.find((c) => c.vi === 563583)?.reason,
    'teams'
  );
  eq(
    'rail-893: NBA item rejected on teams for a football game',
    gala.considered.find((c) => c.vi === 563730)?.reason,
    'teams'
  );
}

// ---------- Live rail of 2026-10-15: all nine MD2 (Oct 14) games match ----------
// The REAL headlines Sport5 published for the Oct 14 UCL games, as they
// appeared on the post-change rail (every item vc=893), plus the three
// non-UCL items that shared that rail (basketball ×2, youth football)
// as leak controls. These headlines are also what pinned down the short
// Hebrew alias additions of 2026-10-15 (סיטי, וילה, שחטאר, א.א.ק,
// בודה/גלימט, ברטיסלבה, דורטמונד, שטוטגארט) in lib/teams.ts.
{
  const seen = Date.parse('2026-10-15T05:00:00Z');
  const item = (vi: number, title: string): Sport5IndexItem => ({
    vc: 893, vi, title, firstSeen: seen, lastSeen: seen,
  });
  const liveIndex: Sport5IndexItem[] = [
    item(563751, 'אלופה אמיתית: 2:4 לפריז סן-ז\'רמן על סיטי'),
    item(563750, 'בלתי שבירים: ריאל השלימה מהפך מטורף מול רומא'),
    item(563749, 'חזרה לנצח: הפועל ת"א הביסה את בשיקטאש'),
    item(563748, 'חגיגת שערים: 3:6 לליברפול על לאסק לינץ'),
    item(563747, 'המבצר שלה: בודה/גלימט ניצחה את דורטמונד 0-1'),
    item(563746, 'באפס מאמץ: וילה רמסה 0:6 את פנרבחצ\'ה'),
    item(563745, 'מהפכים ושערים מטורפים: בטיס גברה על פורטו 2:3'),
    item(563744, 'קומו על הרגליים: 2:3 לפיינורד על קומו'),
    item(563743, 'בדקה ה-80: שחטאר השלימה מהפך וניצחה את א.א.ק'),
    item(563742, 'בקלות: שטוטגארט ניצחה 0:3 את ברטיסלבה'),
    item(563741, 'בתום מותחן: חולון גברה על ספרטק סוביטוצה'),
    item(563740, 'צפו: 0:3 למכבי חיפה על הפועל ת"א בנוער'),
  ];
  const liveGames: Array<{ game: GameInput; vi: number }> = [
    { game: { home: 'Manchester City', away: 'Paris Saint-Germain', homeScore: 2, awayScore: 4, dateISO: '2026-10-14T19:00:00.000Z', league: 'champions-league' }, vi: 563751 },
    { game: { home: 'Roma', away: 'Real Madrid', homeScore: 3, awayScore: 4, dateISO: '2026-10-14T19:00:00.000Z', league: 'champions-league' }, vi: 563750 },
    { game: { home: 'LASK', away: 'Liverpool', homeScore: 3, awayScore: 6, dateISO: '2026-10-14T19:00:00.000Z', league: 'champions-league' }, vi: 563748 },
    { game: { home: 'Bodø/Glimt', away: 'Borussia Dortmund', homeScore: 1, awayScore: 0, dateISO: '2026-10-14T19:00:00.000Z', league: 'champions-league' }, vi: 563747 },
    { game: { home: 'Aston Villa', away: 'Fenerbahçe', homeScore: 6, awayScore: 0, dateISO: '2026-10-14T19:00:00.000Z', league: 'champions-league' }, vi: 563746 },
    { game: { home: 'Real Betis', away: 'FC Porto', homeScore: 3, awayScore: 2, dateISO: '2026-10-14T19:00:00.000Z', league: 'champions-league' }, vi: 563745 },
    { game: { home: 'Feyenoord', away: 'Como', homeScore: 3, awayScore: 2, dateISO: '2026-10-14T16:45:00.000Z', league: 'champions-league' }, vi: 563744 },
    { game: { home: 'Shakhtar Donetsk', away: 'AEK Athens', homeScore: 3, awayScore: 1, dateISO: '2026-10-14T19:00:00.000Z', league: 'champions-league' }, vi: 563743 },
    { game: { home: 'Slovan Bratislava', away: 'VfB Stuttgart', homeScore: 0, awayScore: 3, dateISO: '2026-10-14T19:00:00.000Z', league: 'champions-league' }, vi: 563742 },
  ];
  for (const { game, vi } of liveGames) {
    const label = `live-rail ${game.home} vs ${game.away}`;
    const r = matchSport5Index(liveIndex, game, CATEGORY);
    eq(`${label}: matched vi`, r.candidate?.id, `sport5:${vi}`);
    eq(`${label}: exactly one kept item`, r.considered.filter((c) => c.keep).length, 1);
  }
}

// ---------- Date window: first seen too late ----------
{
  const late: Sport5IndexItem[] = index.map((i) =>
    i.vi === 563574
      ? { ...i, firstSeen: Date.parse('2026-10-20T08:00:00Z'), lastSeen: Date.parse('2026-10-20T08:00:00Z') }
      : i
  );
  const r = matchSport5Index(late, GAMES[7].game, CATEGORY);
  eq('date window: no candidate', r.candidate, null);
  eq('date window: reason', r.considered.find((c) => c.vi === 563574)?.reason, 'date');
}

// ---------- Index merge: dedupe, firstSeen preserved, prune ----------
{
  const t0 = Date.parse('2026-10-13T21:00:00Z');
  const t1 = Date.parse('2026-10-14T08:00:00Z');
  let idx = mergeSport5Index([], rail, t0);
  eq('merge: all items indexed', idx.length, 12);
  idx = mergeSport5Index(idx, rail, t1);
  eq('merge: dedupe by vi', idx.length, 12);
  eq('merge: firstSeen preserved', idx.find((i) => i.vi === 563574)?.firstSeen, t0);
  eq('merge: lastSeen updated', idx.find((i) => i.vi === 563574)?.lastSeen, t1);
  const ancient: Sport5IndexItem = {
    vc: CATEGORY, vi: 1, title: 'old', firstSeen: t1 - 121 * 86400000, lastSeen: t1 - 121 * 86400000,
  };
  idx = mergeSport5Index([ancient, ...idx], [], t1);
  check('merge: >120d pruned', !idx.some((i) => i.vi === 1));
  check('merge: sorted newest first', idx.every((v, i, a) => i === 0 || a[i - 1].vi >= v.vi));
}

// ---------- Part 3: above-bulk exclusivity (read-path filter) ----------
// The recap route runs every result list (fresh compute, merge, cache
// read) through applyExternalExclusivity: for an above-bulk plan, an
// external result suppresses every non-external result — including
// bulk results cached before the external result existed.
{
  const mk = (id: string, external: boolean): RawCandidate => ({
    id,
    title: id,
    url: 'https://example.com/' + id,
    source: external ? 'sport5' : 'youtube',
    ...(external ? { external: true } : {}),
    lang: 'en',
  });
  const ucl = searchPlanFor('champions-league');
  const pl = searchPlanFor('premier-league');
  const mixed = [mk('bulk-a', false), mk('sport5:563574', true), mk('bulk-b', false)];

  eq(
    'exclusivity: above-bulk keeps only the external result',
    applyExternalExclusivity(ucl, mixed).map((c) => c.id),
    ['sport5:563574']
  );
  eq(
    'exclusivity: above-bulk without an external result is unchanged',
    applyExternalExclusivity(ucl, [mk('bulk-a', false), mk('bulk-b', false)]).map((c) => c.id),
    ['bulk-a', 'bulk-b']
  );
  eq(
    'exclusivity: above-bulk empty list stays empty',
    applyExternalExclusivity(ucl, []).length,
    0
  );
  eq(
    'exclusivity: below-bulk plan (default) is unchanged',
    applyExternalExclusivity(pl, mixed).map((c) => c.id),
    ['bulk-a', 'sport5:563574', 'bulk-b']
  );
}

// ---------- Part 3: targeted game-cache clear key filter ----------
// The 'clear-game-cache' sweep action deletes game blobs by league+date
// via gameCacheKeyMatchesDate. Real keys carry the seg-encoded full ISO
// timestamp the frontend passes (dateISO), so both the full-timestamp
// and date-only key shapes must match — and nothing else may.
{
  const L = 'champions-league';
  const D = '2026-10-13';
  const sabahFull =
    'game/v10/champions-league/Sabah_20FK-Slavia_20Prague-2026-10-13T16_3A45_3A00_000Z';
  const galaFull =
    'game/v10/champions-league/Galatasaray-Barcelona-2026-10-13T19_3A00_3A00_000Z';
  const dateOnly = 'game/v10/champions-league/Inter-Club_20Brugge-2026-10-13';

  check('cache-clear: full-ISO key matches', gameCacheKeyMatchesDate(sabahFull, L, D));
  check('cache-clear: second full-ISO key matches', gameCacheKeyMatchesDate(galaFull, L, D));
  check('cache-clear: date-only key matches', gameCacheKeyMatchesDate(dateOnly, L, D));
  check(
    'cache-clear: next-day key does not match',
    !gameCacheKeyMatchesDate(
      'game/v10/champions-league/Liverpool-LASK-2026-10-14T19_3A00_3A00_000Z',
      L,
      D
    )
  );
  check(
    'cache-clear: same day/month other year does not match',
    !gameCacheKeyMatchesDate(
      'game/v10/champions-league/Inter-Club_20Brugge-2025-10-13',
      L,
      D
    )
  );
  check(
    'cache-clear: other league does not match',
    !gameCacheKeyMatchesDate(
      'game/v10/premier-league/Arsenal-Chelsea-2026-10-13',
      L,
      D
    )
  );
  check(
    'cache-clear: v9 key never matches',
    !gameCacheKeyMatchesDate(
      'game/v9/champions-league/Inter-Club_20Brugge-2026-10-13',
      L,
      D
    )
  );
  check(
    'cache-clear: date as a team-name suffix does not match',
    !gameCacheKeyMatchesDate(
      'game/v10/champions-league/Real_202026-10-13-FC_20Porto-2026-10-14',
      L,
      D
    )
  );
}

console.log(`\nsport5_external_test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
