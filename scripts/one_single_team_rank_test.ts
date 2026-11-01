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
import { extractScore, filterCandidate } from '../lib/recap/match';
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
