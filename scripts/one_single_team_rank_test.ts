/**
 * Pinned regressions for the 2026-11-01 Barcelona–Alavés report:
 *
 * 1. ONE's per-game headline names only one team
 *    ('עסקים כרגיל: בארסה מתפוצצת עם 1:6 אדיר!') yet is the game's
 *    highlight — the preferred-tier single-team exception (exact
 *    scoreline + near publish date) must keep it, while the same shape
 *    from bulk/general, with a wrong score, or undated must still reject.
 * 2. Club channels write scores as "6 vs 1" — extractScore must parse it
 *    (without breaking the season-range guard or parsing "1vs1").
 * 3. Ranking: the official team-channel video must outrank a league-wide
 *    channel's video (score-first within a tier + team-channel bonus),
 *    while tier-0 'All Goals' re-uploads keep the top spots by tier.
 *
 * Run: npx -y tsx scripts/one_single_team_rank_test.ts
 * Exit code 0 = all assertions pass, 1 = failures (listed on stdout).
 */
import { extractScore, extractScores, filterCandidate } from '../lib/recap/match';
import { isTeamChannel, rankCandidates, scoreCandidate } from '../lib/recap/rank';
import type { GameInput, RawCandidate } from '../lib/recap/types';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) pass++;
  else {
    fail++;
    failures.push(`${name} :: ${detail}`);
  }
}

function eq<T>(name: string, actual: T, expected: T): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `expected ${e}, got ${a}`);
}

const game: GameInput = {
  home: 'Barcelona',
  away: 'Deportivo Alavés',
  dateISO: '2026-10-31T20:00:00.000Z',
  league: 'la-liga',
  homeScore: 6,
  awayScore: 1,
};

const base: RawCandidate = {
  id: '',
  title: '',
  url: 'https://www.youtube.com/watch?v=TEST',
  source: 'youtube',
  videoId: 'TEST',
  lang: 'en',
  embeddable: true,
};
const mk = (id: string, title: string, over: Partial<RawCandidate> = {}): RawCandidate => ({
  ...base,
  ...over,
  id,
  videoId: id,
  title,
});

// ------------------------------------------------------- score parsing ---
eq('vs score', extractScore('FC BARCELONA 6 vs 1 ALAVÉS | LALIGA 2026/27 MD11'), [6, 1]);
eq('vs-dot score', extractScore('FC BARCELONA 6 vs. 1 ALAVÉS'), [6, 1]);
eq('vs no-boundary', extractScore('Team 1vs1 Team | Highlights'), null);
eq('year guard intact', extractScore('UCL 2026-27: Real Madrid 2-1 Inter | Highlights'), [2, 1]);
eq('season range intact', extractScore('Season 2026-27 review: Barcelona 3-1 Sevilla'), [3, 1]);
eq('multi-score title lists all scores', extractScores('יונייטד חזרה מ-2:0 ל-2:3 דרמטי'), [[2, 0], [2, 3]]);
eq('first-score semantics unchanged', extractScore('יונייטד חזרה מ-2:0 ל-2:3 דרמטי'), [2, 0]);

// ------------------------------------------- ONE single-team exception ---
const oneTitle = 'עסקים כרגיל: בארסה מתפוצצת עם 1:6 אדיר!';
const one = mk('one', oneTitle, {
  channelHandle: 'one-1004',
  lang: 'he',
  publishedAt: '2026-10-31T22:15:00.000Z',
  durationSec: 500,
});
eq('ONE single-team kept', filterCandidate(one, game), { keep: true, reason: 'ok' });

const oneWrongScore = mk('one-wrong', 'עסקים כרגיל: בארסה מתפוצצת עם 1:5 אדיר!', {
  channelHandle: 'one-1004',
  lang: 'he',
  publishedAt: '2026-10-31T22:15:00.000Z',
  durationSec: 500,
});
eq('ONE single-team wrong score rejected', filterCandidate(oneWrongScore, game), {
  keep: false,
  reason: 'teams',
});

const oneUndated = mk('one-undated', oneTitle, {
  channelHandle: 'one-1004',
  lang: 'he',
  durationSec: 500,
});
eq('ONE single-team undated rejected', filterCandidate(oneUndated, game), {
  keep: false,
  reason: 'teams',
});

const bulkSingle = mk('bulk-single', 'FC BARCELONA 6 vs 1 | LALIGA 2026/27 MD11', {
  channelHandle: 'FCBarcelona',
  bulk: true,
  publishedAt: '2026-11-01T10:00:00.000Z',
  durationSec: 192,
});
eq('bulk single-team still rejected', filterCandidate(bulkSingle, game), {
  keep: false,
  reason: 'teams',
});

const generalSingle = mk('general-single', 'Barcelona celebrate a 6-1 win over their rivals', {
  channelHandle: 'RandomFan',
  publishedAt: '2026-11-01T10:00:00.000Z',
  durationSec: 400,
});
eq('general single-team still rejected', filterCandidate(generalSingle, game), {
  keep: false,
  reason: 'teams',
});

// --------------------------- external single-team exception (2026-11-01) ---
// External candidates pass through filterCandidate on ingest, so the
// single-team exception must cover them too: the Le Havre Sport5
// article matched in matchSport5Index and was then vetoed HERE on
// 'teams' until this clause existed. Same guards as preferred.
const leHavreGame: GameInput = {
  home: 'Le Havre',
  away: 'Paris Saint-Germain',
  dateISO: '2026-10-30T18:00:00.000Z',
  league: 'leading-teams',
  homeScore: 1,
  awayScore: 5,
};
const extBase: RawCandidate = {
  id: '',
  title: '',
  url: 'https://m.sport5.co.il/articles.aspx?FolderID=496&docID=565835',
  source: 'sport5',
  external: true,
  channelName: 'Sport5',
  lang: 'he',
};
const ext = (id: string, title: string, over: Partial<RawCandidate> = {}): RawCandidate => ({
  ...extBase,
  ...over,
  id,
  title,
});
const extSingle = ext('sport5:article:565835', 'שלושער מטורף לחאכימי, 1:5 גדול לפ.ס.ז`', {
  publishedAt: '2026-10-30T12:00:00.000Z',
});
eq('external single-team kept', filterCandidate(extSingle, leHavreGame), {
  keep: true,
  reason: 'ok',
});
const extWrongScore = ext('sport5:article:wrong', 'שלושער מטורף לחאכימי, 1:4 גדול לפ.ס.ז`', {
  publishedAt: '2026-10-30T12:00:00.000Z',
});
eq('external single-team wrong score rejected', filterCandidate(extWrongScore, leHavreGame), {
  keep: false,
  reason: 'teams',
});
const extUndated = ext('sport5:article:undated', 'שלושער מטורף לחאכימי, 1:5 גדול לפ.ס.ז`', {});
eq('external single-team undated rejected', filterCandidate(extUndated, leHavreGame), {
  keep: false,
  reason: 'teams',
});
const extStale = ext('sport5:article:stale', 'שלושער מטורף לחאכימי, 1:5 גדול לפ.ס.ז`', {
  publishedAt: '2026-11-15T12:00:00.000Z',
});
eq('external single-team stale date rejected', filterCandidate(extStale, leHavreGame), {
  keep: false,
  reason: 'teams',
});

// ------------------ comeback headlines carry two scores (2026-11-04) --------
// Sport5's real Man Utd 3-2 Roma headline: only Roma named ('יונייטד'
// is not a registry alias) and the intermediate 2:0 precedes the final
// 2:3. The ingest filter must apply the same any-score rule as
// matchSport5Index, or the item dies here after matching there — and
// the both-teams variant must not be vetoed on the intermediate score.
const utdRomaGame: GameInput = {
  home: 'Manchester United',
  away: 'Roma',
  dateISO: '2026-11-03T20:00:00.000Z',
  league: 'champions-league',
  homeScore: 3,
  awayScore: 2,
};
const extComeback = ext('sport5:article:comeback', 'מטורף! יונייטד חזרה מ-2:0 ל-2:3 דרמטי מול רומא', {
  publishedAt: '2026-11-04T06:00:00.000Z',
});
eq('external comeback single-team kept', filterCandidate(extComeback, utdRomaGame), {
  keep: true,
  reason: 'ok',
});
const extComebackWrong = ext('sport5:article:comeback-wrong', 'מטורף! יונייטד חזרה מ-2:0 ל-2:1 דרמטי מול רומא', {
  publishedAt: '2026-11-04T06:00:00.000Z',
});
eq('external comeback wrong final score rejected', filterCandidate(extComebackWrong, utdRomaGame), {
  keep: false,
  reason: 'teams',
});
const extComebackBoth = ext('sport5:article:comeback-both', 'מנצ`סטר יונייטד חזרה מ-2:0 ל-2:3 דרמטי מול רומא', {
  publishedAt: '2026-11-04T06:00:00.000Z',
});
eq('external comeback both-teams kept (veto must not fire on intermediate score)', filterCandidate(extComebackBoth, utdRomaGame), {
  keep: true,
  reason: 'ok',
});

// --------------------------------- game-day-or-after filter (2026-11-02) ---
// A highlight cannot predate the game it recaps: IPFL's Oct 27
// Haifa–BS 5-2 extended highlight matched the Nov 1 Petah Tikva–BS
// 2-5 game through the single-team exception (same scoreline, BS
// named, date 'near' — proximity is absolute). Pre-game-day videos
// are rejected on 'date' before the teams check, whatever the tier.
const ptBsGame: GameInput = {
  home: 'Maccabi Petah Tikva',
  away: 'Hapoel Beer Sheva',
  dateISO: '2026-11-01T18:00:00.000Z',
  league: 'israeli-league',
  homeScore: 2,
  awayScore: 5,
};
const haifaTitle = 'מחזור 8 | תקציר מורחב: מכבי חיפה - הפועל ב"ש 5-2';
const ipflPreGame = mk('ipfl-pregame', haifaTitle, {
  channelHandle: 'Ipflofficial',
  lang: 'he',
  publishedAt: '2026-10-27T17:00:00Z',
  durationSec: 600,
});
eq('pre-game single-team preferred rejected', filterCandidate(ipflPreGame, ptBsGame), {
  keep: false,
  reason: 'date',
});
const ipflGameDay = mk('ipfl-gameday', haifaTitle, {
  channelHandle: 'Ipflofficial',
  lang: 'he',
  publishedAt: '2026-11-01T22:00:00Z',
  durationSec: 600,
});
eq('game-day single-team preferred kept', filterCandidate(ipflGameDay, ptBsGame), {
  keep: true,
  reason: 'ok',
});
const bothTeamsPreGame = mk('both-pregame', 'תקציר: מכבי פתח תקווה - הפועל באר שבע 5-2', {
  channelHandle: 'Ipflofficial',
  lang: 'he',
  publishedAt: '2026-10-30T20:00:00Z',
  durationSec: 600,
});
eq('pre-game both-teams rejected', filterCandidate(bothTeamsPreGame, ptBsGame), {
  keep: false,
  reason: 'date',
});
const ipflPostGame = mk('ipfl-postgame', haifaTitle, {
  channelHandle: 'Ipflofficial',
  lang: 'he',
  publishedAt: '2026-11-03T10:00:00Z',
  durationSec: 600,
});
eq('post-game single-team preferred kept', filterCandidate(ipflPostGame, ptBsGame), {
  keep: true,
  reason: 'ok',
});

// ------------------------------------------------------------ vs vetoes ---
const vsWrong = mk('vs-wrong', 'Barcelona 6 vs 2 Alavés | Highlights', {
  publishedAt: '2026-11-01T10:00:00.000Z',
});
eq('vs wrong score vetoed', filterCandidate(vsWrong, game), { keep: false, reason: 'score' });
const vsRight = mk('vs-right', 'Barcelona 6 vs 1 Alavés | Highlights', {
  publishedAt: '2026-11-01T10:00:00.000Z',
});
eq('vs right score kept', filterCandidate(vsRight, game), { keep: true, reason: 'ok' });

// --------------------------------------------------------------- ranking ---
const near = '2026-11-01T10:00:00.000Z';
const five = [
  mk('gen1', 'Barcelona vs Alaves 6-1 | All Goals & Highlights | 2026', {
    channelHandle: 'Generic1',
    publishedAt: near,
    durationSec: 655,
  }),
  mk('gen2', 'Barcelona vs Alaves 6-1 | All Goals & Highlights | 2026', {
    channelHandle: 'Generic2',
    publishedAt: near,
    durationSec: 646,
  }),
  mk('gen3', 'Barcelona vs Alaves 6-1 | All Goals & Highlights | 2026', {
    channelHandle: 'Generic3',
    publishedAt: near,
    durationSec: 620,
  }),
  mk('espn', "Lamine Yamal and Raphinha DOMINATE in Barcelona's 6-1 win over Alaves", {
    channelHandle: 'ESPNFC',
    bulk: true,
    publishedAt: near,
    durationSec: 422,
  }),
  mk('barca', 'FC BARCELONA 6 vs 1 ALAVÉS | LALIGA 2026/27 MD11', {
    channelHandle: 'FCBarcelona',
    bulk: true,
    publishedAt: near,
    durationSec: 192,
  }),
];
const barca = five[4];
const espn = five[3];
check('team channel detected', isTeamChannel(barca, game));
check('league-wide channel not a team channel', !isTeamChannel(espn, game));
check(
  'team video outscores league-wide video',
  scoreCandidate(barca, game) > scoreCandidate(espn, game),
  `barca=${scoreCandidate(barca, game)} espn=${scoreCandidate(espn, game)}`,
);
eq(
  'production five rank order',
  rankCandidates(five, game).map((r) => r.id),
  ['gen1', 'gen2', 'gen3', 'barca', 'espn'],
);

console.log(`one_single_team_rank: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  for (const f of failures) console.log(`  FAIL: ${f}`);
  process.exit(1);
}
