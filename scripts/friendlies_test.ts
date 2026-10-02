/**
 * Zero-quota unit tests for the national-friendlies competition
 * (lib/leagues.ts, lib/recap/match.ts, lib/recap/leaguePlans.ts,
 * data/national-friendlies.json). Run: npx tsx scripts/friendlies_test.ts
 */
import { readFileSync } from 'fs';
import path from 'path';
import { getNationalCompetition, isNationalSlug } from '../lib/leagues';
import {
  competitionContradiction,
  excludedCategory,
  filterCandidate,
} from '../lib/recap/match';
import { searchPlanFor } from '../lib/recap/leaguePlans';
import { NATIONS } from '../lib/nations';
import type { RawCandidate } from '../lib/recap/types';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log(`ok   ${name}`);
  else {
    failures += 1;
    console.log(`FAIL ${name}`, extra ?? '');
  }
};

// 1. Registry.
const def = getNationalCompetition('national-friendlies');
check('registry entry exists', !!def);
check('hebrew name', def?.hebrewName === 'משחקי ידידות', def?.hebrewName);
check('badge is the custom friendlies icon', def?.badge === '/friendlies-icon.svg', def?.badge);
check('isNationalSlug', isNationalSlug('national-friendlies'));

// 2. Search plan.
const plan = searchPlanFor('national-friendlies');
check('plan does NOT enable Sport1', plan.sport1 !== true);
check('plan fallback he->en', plan.fallbackLangs.join(',') === 'he,en', plan.fallbackLangs);

// 3. excludedCategory league waiver.
check(
  'friendly waived for friendlies league',
  excludedCategory('USA vs Mexico | International Friendly Highlights', 'national-friendlies') === null
);
check(
  'friendly still excluded elsewhere',
  excludedCategory('Arsenal vs Chelsea | Pre-Season Friendly Highlights', 'premier-league') === 'friendly'
);
check(
  'friendly excluded when no league given',
  excludedCategory('USA vs Mexico | International Friendly Highlights') === 'friendly'
);
check(
  'ידידות waived for friendlies league',
  excludedCategory('אלבניה נגד ישראל | תקציר משחק הידידות', 'national-friendlies') === null
);
check(
  'simulation still excluded for friendlies league',
  excludedCategory('USA vs Mexico - Friendly Match Simulation', 'national-friendlies') === 'simulat'
);
check(
  'women still excluded for friendlies league',
  excludedCategory('USA Women vs Mexico Friendly', 'national-friendlies') === 'women'
);

// 4. Contradictions for the friendlies league.
check(
  'world cup qualifier contradicts a friendly',
  competitionContradiction('Albania vs Israel | World Cup Qualifier Highlights', 'national-friendlies') === 'world cup'
);
check(
  'nations league contradicts a friendly',
  competitionContradiction('Albania vs Israel Highlights | UEFA Nations League', 'national-friendlies') === 'nations league'
);
check(
  'plain friendly title has no contradiction',
  competitionContradiction('Albania vs Israel | Friendly Highlights', 'national-friendlies') === null
);

// 5. filterCandidate end-to-end.
const friendlyGame = {
  home: 'Albania',
  away: 'Israel',
  dateISO: '2026-06-03T18:00:00Z',
  league: 'national-friendlies',
  homeScore: 0,
  awayScore: 1,
};
const unlGame = { ...friendlyGame, league: 'nations-league' };
const cand = (title: string): RawCandidate => ({
  id: 'yt:x',
  title,
  url: 'https://www.youtube.com/watch?v=x',
  source: 'youtube',
  videoId: 'x',
  channelName: 'Test',
  channelId: 'UCX',
  lang: 'en',
});

{
  const r = filterCandidate(cand('Albania vs Israel | Friendly Highlights'), friendlyGame);
  check('friendly-titled video kept for a friendly', r.keep, r.reason);
}
{
  const r = filterCandidate(cand('Albania vs Israel | Friendly Highlights'), unlGame);
  check('same title rejected for Nations League', !r.keep && r.reason === 'excluded', r.reason);
}
{
  const r = filterCandidate(cand('אלבניה נגד ישראל | תקציר משחק הידידות'), friendlyGame);
  check('hebrew friendly recap kept', r.keep, r.reason);
}
{
  const r = filterCandidate(cand('Albania vs Israel | World Cup Qualifier Highlights'), friendlyGame);
  check('qualifier video rejected for a friendly', !r.keep && r.reason === 'competition', r.reason);
}
{
  const r = filterCandidate(cand('Albania vs Israel 5-0 Highlights'), friendlyGame);
  check('wrong-score video rejected for a friendly', !r.keep && r.reason === 'score', r.reason);
}
{
  const r = filterCandidate(cand('Albania vs Israel - Friendly Simulation Highlights'), friendlyGame);
  check('simulation rejected for a friendly', !r.keep && r.reason === 'excluded', r.reason);
}

// 6. Seed data: every team resolves in the nations registry.
interface SeedGame {
  home: string;
  away: string;
}
const seed = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'data', 'national-friendlies.json'), 'utf8')
) as { league: string; games: SeedGame[] };
check('seed league slug', seed.league === 'national-friendlies');
check('seed has games', seed.games.length >= 8, seed.games.length);
const known = new Set<string>();
for (const n of NATIONS) {
  known.add(n.en.toLowerCase());
  for (const a of n.enAliases) known.add(a.toLowerCase());
}
for (const g of seed.games) {
  check(`seed team resolves: ${g.home}`, known.has(g.home.toLowerCase()));
  check(`seed team resolves: ${g.away}`, known.has(g.away.toLowerCase()));
}

if (failures > 0) {
  console.log(`\n${failures} FAILURES`);
  process.exit(1);
}
console.log('\nall friendlies tests passed');
