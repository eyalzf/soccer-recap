/**
 * Plan-configuration consolidation tests (2026-10-02): league-specific
 * behavior must come from lib/recap/leaguePlans.ts, not from hardcoded
 * league branches in the matcher / ranker. These tests pin the moved
 * configuration (contradictions, excluded-category waivers, competition
 * ranking terms, preferred stop rule) so a future edit can't silently
 * drop a league's rules.
 */
import { CLUB_CHANNELS, LEAGUE_SEARCH_PLANS, clubChannel, searchPlanFor } from '../lib/recap/leaguePlans';
import { competitionContradiction, excludedCategory } from '../lib/recap/match';
import { channelsForGame } from '../lib/recap/bulk';
import type { GameInput } from '../lib/recap/types';

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass += 1;
  } else {
    fail += 1;
    console.log(`FAIL ${name}: got ${g}, want ${w}`);
  }
}
function ok(name: string, cond: boolean) {
  eq(name, cond, true);
}

// 1. Every configured league carries its matcher rule sets in the plan.
for (const [slug, plan] of Object.entries(LEAGUE_SEARCH_PLANS)) {
  ok(`${slug}: contradictions configured`, (plan.contradictions ?? []).length > 0);
}

// 2. Contradiction behavior survives the move (one probe per league).
eq('pl fa cup', competitionContradiction('Arsenal vs Chelsea | FA Cup Highlights', 'premier-league'), 'fa cup');
eq('pl own name ok', competitionContradiction('Arsenal vs Chelsea | Premier League Highlights', 'premier-league'), null);
eq('laliga copa del rey', competitionContradiction('Real Madrid vs Girona | Copa del Rey', 'la-liga'), 'copa del rey');
eq('israeli state cup', competitionContradiction('מכבי חיפה נגד הפועל באר שבע | גביע המדינה', 'israeli-league'), 'גביע המדינה');
eq('ucl domestic league', competitionContradiction('Real Madrid vs Barcelona | Premier League', 'champions-league'), 'premier league');
eq('unl world cup', competitionContradiction('Denmark vs Portugal | World Cup', 'nations-league'), 'world cup');
eq('wc nations league', competitionContradiction('Brazil vs France | Nations League', 'world-cup'), 'nations league');
eq('euros world cup', competitionContradiction('Spain vs Italy | World Cup', 'euros'), 'world cup');
eq('copa world cup', competitionContradiction('Argentina vs Chile | World Cup', 'copa-america'), 'world cup');
eq('afcon world cup', competitionContradiction('Morocco vs Senegal | World Cup', 'afcon'), 'world cup');
eq('goldcup nations league', competitionContradiction('USA vs Mexico | Nations League', 'gold-cup'), 'nations league');
eq(
  'concacaf-nl uefa nl',
  competitionContradiction('USA vs Mexico | UEFA Nations League', 'concacaf-nations-league'),
  'uefa nations league'
);
// The CONCACAF list must not veto its own competition's name.
eq(
  'concacaf-nl own name ok',
  competitionContradiction('USA vs Mexico | Concacaf Nations League Highlights', 'concacaf-nations-league'),
  null
);
eq('friendlies wcq', competitionContradiction('Albania vs Israel | World Cup Qualifier Highlights', 'national-friendlies'), 'world cup');
eq('friendlies own ok', competitionContradiction('Albania vs Israel | Friendly Highlights', 'national-friendlies'), null);
eq('unknown league', competitionContradiction('Arsenal vs Chelsea | FA Cup', 'no-such-league'), null);

// 3. Excluded-category waivers are plan-driven (friendlies only).
eq('friendlies waive friendly', excludedCategory('USA vs Mexico | International Friendly Highlights', 'national-friendlies'), null);
eq('friendlies waive ידידות', excludedCategory('אלבניה נגד ישראל | תקציר משחק הידידות', 'national-friendlies'), null);
eq('pl keeps friendly veto', excludedCategory('Arsenal vs Chelsea | Pre-Season Friendly Highlights', 'premier-league'), 'friendly');
eq('no league keeps veto', excludedCategory('USA vs Mexico | International Friendly Highlights'), 'friendly');
eq('friendlies waiver does not leak', excludedCategory('USA vs Mexico - Friendly Match Simulation', 'national-friendlies'), 'simulat');
eq('friendlies waiver is narrow', excludedCategory('USA Women vs Mexico Friendly', 'national-friendlies'), 'women');
eq(
  'other leagues have no waivers',
  Object.entries(LEAGUE_SEARCH_PLANS)
    .filter(([slug]) => slug !== 'national-friendlies')
    .every(([, p]) => (p.excludedWaivers ?? []).length === 0),
  true
);

// 4. Preferred stop rule: LaLiga only ('any'), default everywhere else.
eq('la-liga stop rule', searchPlanFor('la-liga').preferredStopRule, 'any');
eq(
  'only la-liga opts in',
  Object.entries(LEAGUE_SEARCH_PLANS)
    .filter(([slug]) => slug !== 'la-liga')
    .every(([, p]) => (p.preferredStopRule ?? 'highlight') === 'highlight'),
  true
);
eq('unknown league stop rule default', searchPlanFor('no-such-league').preferredStopRule, undefined);

// 5. Competition ranking terms live in the plans now.
eq('pl competitionTerms', searchPlanFor('premier-league').competitionTerms, [
  'premier league',
  'פרמייר ליג',
  'פרמיירליג',
]);
eq('laliga competitionTerms', searchPlanFor('la-liga').competitionTerms, ['la liga', 'לה ליגה']);
eq('israeli competitionTerms', searchPlanFor('israeli-league').competitionTerms, ['ליגת העל', 'ligat haal']);
eq('ucl competitionTerms', searchPlanFor('champions-league').competitionTerms, [
  'champions league',
  'ליגת האלופות',
  'ucl',
]);

// 6. Bulk phase partition (route): team-scoped entries for the game's
// teams vs league-wide entries — disjoint, and together the applicable set.
const plGame: GameInput = {
  home: 'Arsenal',
  away: 'Chelsea',
  homeScore: 2,
  awayScore: 1,
  dateISO: '2026-09-26',
  league: 'premier-league',
};
const applicable = channelsForGame(searchPlanFor('premier-league').bulk, plGame);
const teamEntries = applicable.filter((e) => e.teams?.length);
const leagueEntries = applicable.filter((e) => !e.teams?.length);
eq('partition covers applicable', teamEntries.length + leagueEntries.length, applicable.length);
ok(
  'team phase has both clubs',
  teamEntries.some((e) => e.label === 'Arsenal') && teamEntries.some((e) => e.label === 'Chelsea')
);
ok(
  'league phase has sky',
  leagueEntries.some((e) => /sky/i.test(e.label))
);
ok('no foreign club channels', teamEntries.every((e) => ['Arsenal', 'Chelsea'].includes(e.label)));


// 7. Club channels: defined once in CLUB_CHANNELS, shared across leagues.
// In the club leagues every team-scoped bulk entry must resolve through
// the registry (national-team entries in the nations plans live outside
// it by design), and the same club must resolve identically everywhere.
for (const slug of ['israeli-league', 'la-liga', 'champions-league', 'premier-league']) {
  for (const entry of searchPlanFor(slug).bulk) {
    if (!entry.teams?.length) continue;
    eq(`${slug} ${entry.label}: single team`, entry.teams.length, 1);
    const def = CLUB_CHANNELS[entry.teams[0]];
    ok(`${slug} ${entry.label}: in registry`, !!def);
    if (def) {
      eq(`${slug} ${entry.label}: same handle`, entry.handle, def.handle);
      eq(`${slug} ${entry.label}: same channelId`, entry.channelId, def.channelId);
      eq(`${slug} ${entry.label}: same label`, entry.label, def.label);
    }
  }
}
eq(
  'real madrid identical across leagues',
  searchPlanFor('la-liga').bulk.find((e) => e.teams?.[0] === 'Real Madrid'),
  searchPlanFor('champions-league').bulk.find((e) => e.teams?.[0] === 'Real Madrid')
);
eq(
  'arsenal identical across leagues',
  searchPlanFor('premier-league').bulk.find((e) => e.teams?.[0] === 'Arsenal'),
  searchPlanFor('champions-league').bulk.find((e) => e.teams?.[0] === 'Arsenal')
);
// Every registry def carries a label and exactly one locator.
ok(
  'registry defs well-formed',
  Object.values(CLUB_CHANNELS).every((d) => !!d.label && !!d.handle !== !!d.channelId)
);
// Unknown club names fail loudly instead of silently dropping coverage.
let clubThrew = false;
try {
  clubChannel('No Such Club FC');
} catch {
  clubThrew = true;
}
ok('clubChannel unknown throws', clubThrew);
// Newly validated club channels (2026-10-02 curated-test, multiple games).
ok(
  'la-liga has sevilla + espanyol',
  ['Sevilla FC', 'RCD Espanyol'].every((label) =>
    searchPlanFor('la-liga').bulk.some((e) => e.label === label && e.teams?.length === 1)
  )
);
ok(
  'premier-league has everton',
  searchPlanFor('premier-league').bulk.some((e) => e.label === 'Everton' && e.teams?.[0] === 'Everton')
);

console.log(`\nplan_config_test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
