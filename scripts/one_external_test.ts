/**
 * ONE website (one.co.il) external source tests.
 *
 * Covers the pure parts of lib/recap/one.ts: fixture mapping
 * (Israel day + Hebrew names either order + exact score), the
 * summary-video parser, duration parsing, the HTTPS upgrade, the
 * candidate builder, and the full oneSearch flow with stubbed
 * fixtures/summary — plus the ingest-layer check that a ONE
 * candidate survives filterCandidate (single-team exception for
 * external candidates, game-day publish date). All offline: no
 * network, no storage (fixtures and summaries are injected).
 *
 *   npx -y tsx scripts/one_external_test.ts
 */
import { filterCandidate } from '../lib/recap/match';
import { applyExternalExclusivity } from '../lib/recap/external';
import {
  externalRunsFirstFor,
  scopeMatches,
  searchPlanFor,
} from '../lib/recap/leaguePlans';
import {
  buildOneCandidate,
  fixturesKeyForLeague,
  httpsUrl,
  jerusalemDate,
  mapOneMatch,
  oneLeagueUrl,
  oneSearch,
  parseDurationSec,
  parseSummary,
  registryHebrewVariants,
  type HebrewVariants,
  type OneFixture,
  type OneSummary,
} from '../lib/recap/one';
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

// ---------- Fixture sample (real ONE names/scores/dates, MD11) ----------

const FIXTURES: OneFixture[] = [
  {
    id: 483410,
    round: 'מחזור 11',
    date: '2026-10-31T15:00:00',
    homeTeam: { name: 'לבאנטה', shortName: 'לבאנטה', score: 0 },
    awayTeam: { name: 'אתלטיקו מדריד', shortName: 'אתלטיקו', score: 2 },
  },
  {
    id: 483408,
    round: 'מחזור 11',
    date: '2026-10-31T22:00:00',
    homeTeam: { name: 'ברצלונה', shortName: 'ברצלונה', score: 6 },
    awayTeam: { name: 'אלאבס', shortName: 'אלאבס', score: 1 },
  },
  {
    id: 483419,
    round: 'מחזור 12',
    date: '2026-11-06T22:00:00',
    homeTeam: { name: 'סביליה', shortName: 'סביליה', score: null },
    awayTeam: { name: 'אלאבס', shortName: 'אלאבס', score: null },
  },
];

// Registry-attested Hebrew variants for the clubs above.
const VARIANTS: Record<string, string[]> = {
  Levante: ['לבאנטה'],
  'Atlético Madrid': ['אתלטיקו מדריד'],
  Barcelona: ['ברצלונה'],
  'Deportivo Alavés': ['אלאבס'],
  Sevilla: ['סביליה'],
};
const variants: HebrewVariants = (en) => VARIANTS[en] ?? [];

function game(
  home: string,
  away: string,
  dateISO: string,
  hs: number | null,
  as: number | null
): GameInput {
  return { home, away, dateISO, league: 'la-liga', homeScore: hs, awayScore: as };
}

// ---------- jerusalemDate ----------

eq('jerusalemDate: 13:00Z Oct 31 -> Oct 31', jerusalemDate('2026-10-31T13:00:00.000Z'), '2026-10-31');
eq('jerusalemDate: 23:30Z Oct 31 -> Nov 1 (IST +2)', jerusalemDate('2026-10-31T23:30:00.000Z'), '2026-11-01');
eq('jerusalemDate: invalid -> empty', jerusalemDate('not-a-date'), '');

// ---------- mapOneMatch ----------

{
  const g = game('Levante', 'Atlético Madrid', '2026-10-31T13:00:00.000Z', 0, 2);
  const r = mapOneMatch(FIXTURES, g, variants);
  eq('map: Levante-Atletico maps to 483410', r.match?.id, 483410);
  check('map: not ambiguous', r.ambiguous === false);
}
{
  // Either team order in OUR game must map (fixture is Levante home).
  const g = game('Atlético Madrid', 'Levante', '2026-10-31T13:00:00.000Z', 2, 0);
  eq('map: swapped order maps to 483410', mapOneMatch(FIXTURES, g, variants).match?.id, 483410);
}
{
  const g = game('Barcelona', 'Deportivo Alavés', '2026-10-31T20:00:00.000Z', 6, 1);
  eq('map: Barca-Alaves maps to 483408', mapOneMatch(FIXTURES, g, variants).match?.id, 483408);
}
{
  // Score mismatch must NOT map (prevents a same-pair wrong-fixture hit).
  const g = game('Levante', 'Atlético Madrid', '2026-10-31T13:00:00.000Z', 1, 2);
  eq('map: score mismatch -> no match', mapOneMatch(FIXTURES, g, variants).match, null);
}
{
  // Wrong day must NOT map.
  const g = game('Levante', 'Atlético Madrid', '2026-11-01T13:00:00.000Z', 0, 2);
  eq('map: wrong day -> no match', mapOneMatch(FIXTURES, g, variants).match, null);
}
{
  // Unplayed game (null scores) must NOT map.
  const g = game('Sevilla', 'Deportivo Alavés', '2026-11-06T20:00:00.000Z', null, null);
  eq('map: unplayed game -> no match', mapOneMatch(FIXTURES, g, variants).match, null);
}
{
  // Unplayed fixture (-1/-1, normalized to null) must NOT map even
  // when a played-score game is requested on its day.
  const g = game('Sevilla', 'Deportivo Alavés', '2026-11-06T20:00:00.000Z', 0, 0);
  eq('map: unplayed fixture -> no match', mapOneMatch(FIXTURES, g, variants).match, null);
}
{
  // Two fixtures with same teams+day+score -> ambiguous, suppressed.
  const dup: OneFixture[] = [
    ...FIXTURES,
    {
      id: 483999,
      round: 'מחזור 11',
      date: '2026-10-31T15:00:00',
      homeTeam: { name: 'לבאנטה', score: 0 },
      awayTeam: { name: 'אתלטיקו מדריד', score: 2 },
    },
  ];
  const g = game('Levante', 'Atlético Madrid', '2026-10-31T13:00:00.000Z', 0, 2);
  const r = mapOneMatch(dup, g, variants);
  eq('map: duplicate fixtures -> ambiguous, no match', r, { match: null, ambiguous: true });
}
{
  // Unknown club (no Hebrew variants) -> no match, not a crash.
  const g = game('No Such Club', 'Levante', '2026-10-31T13:00:00.000Z', 0, 2);
  eq('map: unknown club -> no match', mapOneMatch(FIXTURES, g, variants).match, null);
}

// ---------- registry resolver: ONE spellings for promoted clubs ----------
// Racing de Santander and Deportivo de A Coruna already live in the
// compiled registry (under their "de" spellings); only ONE's Hebrew
// spellings were missing, added as heAliases in lib/teams.ts. The
// provider must map through the real registry resolver for them.
check(
  'registry: Racing Santander variants include ONE spelling',
  registryHebrewVariants('Racing Santander').includes('ראסינג סנטאנדר')
);
check(
  'registry: Deportivo A Coruna variants include ONE spelling',
  registryHebrewVariants('Deportivo A Coruña').includes('דפורטיבו אה קורוניה')
);
{
  const racingFixture: OneFixture = {
    id: 484000,
    round: 'מחזור 5',
    date: '2026-09-20T18:00:00',
    homeTeam: { name: 'ראסינג סנטאנדר', score: 1 },
    awayTeam: { name: 'ברצלונה', score: 1 },
  };
  const g = game('Racing Santander', 'Barcelona', '2026-09-20T15:00:00.000Z', 1, 1);
  eq(
    'registry: Racing game maps via ONE spelling',
    mapOneMatch([racingFixture], g, registryHebrewVariants).match?.id,
    484000
  );
}
{
  const depoFixture: OneFixture = {
    id: 484001,
    round: 'מחזור 5',
    date: '2026-09-21T20:00:00',
    homeTeam: { name: 'דפורטיבו אה קורוניה', score: 0 },
    awayTeam: { name: 'סביליה', score: 2 },
  };
  const g = game('Deportivo A Coruña', 'Sevilla', '2026-09-21T17:00:00.000Z', 0, 2);
  eq(
    'registry: Deportivo game maps via ONE spelling',
    mapOneMatch([depoFixture], g, registryHebrewVariants).match?.id,
    484001
  );
}

// ---------- league plumbing (Serie A = ONE league 8) ----------

eq('fixtures key: league 10 keeps legacy key', fixturesKeyForLeague(10), 'external/one-fixtures.json');
eq('fixtures key: league 8 gets suffixed key', fixturesKeyForLeague(8), 'external/one-fixtures-8.json');
eq('league url: 8', oneLeagueUrl(8), 'https://www.one.co.il/api/league/8?quick=1');
eq('league url: 10', oneLeagueUrl(10), 'https://www.one.co.il/api/league/10?quick=1');

// Real Serie A fixtures (ONE league 8): Inter 4-1 Monza (MD1,
// 2026-08-22) and Roma 4-0 Fiorentina (MD1, 2026-08-24).
{
  const interMonza: OneFixture = {
    id: 479198,
    round: 'מחזור 1',
    date: '2026-08-22T19:30:00',
    homeTeam: { name: 'אינטר', score: 4 },
    awayTeam: { name: 'מונצה', score: 1 },
  };
  const g = game('Inter', 'Monza', '2026-08-22T16:30:00.000Z', 4, 1);
  eq(
    'serie-a: Inter-Monza maps via registry',
    mapOneMatch([interMonza], g, registryHebrewVariants).match?.id,
    479198
  );
  const romaFio: OneFixture = {
    id: 479204,
    round: 'מחזור 1',
    date: '2026-08-24T21:45:00',
    homeTeam: { name: 'רומא', score: 4 },
    awayTeam: { name: 'פיורנטינה', score: 0 },
  };
  const g2 = game('Roma', 'Fiorentina', '2026-08-24T18:45:00.000Z', 4, 0);
  eq(
    'serie-a: Roma-Fiorentina maps via registry (data spelling Roma)',
    mapOneMatch([romaFio], g2, registryHebrewVariants).match?.id,
    479204
  );
}

// ---------- per-provider above-bulk scope (leading-teams) ----------

const lt = searchPlanFor('leading-teams');
const sport5Cfg = (lt.external ?? []).find((c) => c.provider === 'sport5');
const oneCfg = (lt.external ?? []).find((c) => c.provider === 'one');
check('leading-teams has both external providers', !!sport5Cfg && !!oneCfg);
eq('leading-teams ONE cfg leagueId', oneCfg?.leagueId, 8);
eq('leading-teams ONE firstScope teams', oneCfg?.firstScope?.teams, ['Inter', 'AC Milan', 'Juventus', 'Roma']);
if (sport5Cfg && oneCfg) {
  const interGame = { home: 'Inter', away: 'Monza' };
  const interNoComp = { home: 'Inter', away: 'Monza', competition: null };
  const psgGame = { home: 'Le Havre', away: 'Paris Saint-Germain', competition: 'ligue-1' };
  const bayernGame = { home: 'Bayern München', away: 'Borussia Dortmund' };
  check('scope: ONE first for Inter game', externalRunsFirstFor(oneCfg, lt, interGame));
  check('scope: ONE first for Inter game without competition slug', externalRunsFirstFor(oneCfg, lt, interNoComp));
  check('scope: Sport5 NOT first for Inter game', !externalRunsFirstFor(sport5Cfg, lt, interGame));
  check('scope: Sport5 first for PSG Ligue 1 game', externalRunsFirstFor(sport5Cfg, lt, psgGame));
  check('scope: ONE NOT first for PSG game', !externalRunsFirstFor(oneCfg, lt, psgGame));
  check('scope: neither first for Bayern game', !externalRunsFirstFor(sport5Cfg, lt, bayernGame) && !externalRunsFirstFor(oneCfg, lt, bayernGame));
  check('scopeMatches: teams-only scope ignores competition', scopeMatches({ teams: ['Inter'] }, { home: 'Inter', away: 'Monza', competition: 'serie-a' }));
  check('scopeMatches: competitions list needs slug', !scopeMatches({ teams: ['Inter'], competitions: ['serie-a'] }, { home: 'Inter', away: 'Monza', competition: null }));
}

// ---------- exclusivity with per-provider scopes ----------

{
  const oneExt: RawCandidate = { id: 'one:1', title: 'ONE', url: 'https://www.one.co.il/match/1', source: 'one', external: true, lang: 'he' };
  const sport5Ext: RawCandidate = { id: 'sport5:1', title: 'S5', url: 'https://example.com', source: 'sport5', external: true, lang: 'he' };
  const bulkYt: RawCandidate = { id: 'yt:1', title: 'YT', url: 'https://youtube.com/watch?v=1', source: 'youtube', lang: 'en' };
  eq(
    'exclusivity: ONE result exclusive on Inter game',
    applyExternalExclusivity(lt, [oneExt, bulkYt], { home: 'Inter', away: 'Monza' }).map((c) => c.id),
    ['one:1']
  );
  eq(
    'exclusivity: ONE result NOT exclusive on Bayern game',
    applyExternalExclusivity(lt, [oneExt, bulkYt], { home: 'Bayern München', away: 'Borussia Dortmund' }).map((c) => c.id),
    ['one:1', 'yt:1']
  );
  eq(
    'exclusivity: Sport5 result exclusive on PSG Ligue 1 game',
    applyExternalExclusivity(lt, [sport5Ext, bulkYt], { home: 'Le Havre', away: 'Paris Saint-Germain', competition: 'ligue-1' }).map((c) => c.id),
    ['sport5:1']
  );
  eq(
    'exclusivity: ONE result NOT exclusive on PSG game',
    applyExternalExclusivity(lt, [oneExt, bulkYt], { home: 'Le Havre', away: 'Paris Saint-Germain', competition: 'ligue-1' }).map((c) => c.id),
    ['one:1', 'yt:1']
  );
  eq(
    'exclusivity: no-game callers keep plan-level behavior',
    applyExternalExclusivity(lt, [oneExt, bulkYt]).map((c) => c.id),
    ['one:1']
  );
}

// ---------- parseSummary / parseDurationSec / httpsUrl ----------

const ATLETICO_SUMMARY = {
  available: true,
  videoId: 111077,
  title: 'טוענת לכתר: אתלטיקו מביסה את לבאנטה',
  duration: '00:02:48',
  poster: 'https://photo.one.co.il/Image/Cover/abc/111077.webp?width=999',
  hd: 'https://wow4geo.one.co.il/2026_10_hd/111077.mp4',
  sd: 'https://wow4geo.one.co.il/2026_10/111077.mp4',
  mobile: 'https://wow4geo.one.co.il/2026_10_iphone/111077.m4v',
  failover: 'http://onevod.s3.amazonaws.com/2026_10/111077.mp4',
};
{
  const s = parseSummary(ATLETICO_SUMMARY);
  eq('parse: available + videoId', s?.available, true);
  eq('parse: videoId', s?.videoId, 111077);
  eq('parse: duration string kept', s?.duration, '00:02:48');
  eq('parse: available:false survives', parseSummary({ available: false })?.available, false);
  eq('parse: garbage -> null', parseSummary('nope'), null);
  eq('parse: missing available -> null', parseSummary({ videoId: 1 }), null);
}
eq('duration: 00:02:48 -> 168', parseDurationSec('00:02:48'), 168);
eq('duration: 00:04:41 -> 281', parseDurationSec('00:04:41'), 281);
eq('duration: bad -> undefined', parseDurationSec('bad'), undefined);
eq('duration: missing -> undefined', parseDurationSec(undefined), undefined);
eq('https: http upgraded', httpsUrl('http://onevod.s3.amazonaws.com/2026_10/111077.mp4'), 'https://onevod.s3.amazonaws.com/2026_10/111077.mp4');
eq('https: https unchanged', httpsUrl('https://example.com/a.mp4'), 'https://example.com/a.mp4');

// ---------- buildOneCandidate ----------

{
  const g = game('Levante', 'Atlético Madrid', '2026-10-31T13:00:00.000Z', 0, 2);
  const c = buildOneCandidate(g, FIXTURES[0], ATLETICO_SUMMARY as OneSummary);
  eq('build: id', c?.id, 'one:111077');
  eq('build: embedUrl is https S3 failover', c?.embedUrl, 'https://onevod.s3.amazonaws.com/2026_10/111077.mp4');
  eq('build: url is match page', c?.url, 'https://www.one.co.il/match/483410');
  eq('build: thumbnail is poster', c?.thumbnail, 'https://photo.one.co.il/Image/Cover/abc/111077.webp?width=999');
  eq('build: durationSec', c?.durationSec, 168);
  eq('build: publishedAt is game day', c?.publishedAt, '2026-10-31T13:00:00.000Z');
  eq('build: external true (exclusivity)', c?.external, true);
  eq('build: lang he', c?.lang, 'he');
  eq('build: source one', c?.source, 'one');
}
{
  const g = game('Levante', 'Atlético Madrid', '2026-10-31T13:00:00.000Z', 0, 2);
  // Failover missing -> HD fallback.
  const s = { ...ATLETICO_SUMMARY, failover: undefined } as unknown as OneSummary;
  eq('build: no failover -> hd', buildOneCandidate(g, FIXTURES[0], s)?.embedUrl, 'https://wow4geo.one.co.il/2026_10_hd/111077.mp4');
  // No playable file at all -> null.
  const s2 = { ...ATLETICO_SUMMARY, failover: undefined, hd: undefined, mobile: undefined } as unknown as OneSummary;
  eq('build: no file -> null', buildOneCandidate(g, FIXTURES[0], s2), null);
  // Unavailable -> null.
  eq('build: unavailable -> null', buildOneCandidate(g, FIXTURES[0], { available: false }), null);
}

// ---------- oneSearch (stubbed fixtures + summary) ----------

async function main() {
  {
    const g = game('Levante', 'Atlético Madrid', '2026-10-31T13:00:00.000Z', 0, 2);
    const r = await oneSearch(g, {
      fixtures: FIXTURES,
      fetchSummary: async () => parseSummary(ATLETICO_SUMMARY),
    });
    eq('search: candidate id', r.candidate?.id, 'one:111077');
    eq('search: considered ok', r.considered, [{ title: 'טוענת לכתר: אתלטיקו מביסה את לבאנטה', keep: true, reason: 'ok', matchId: 483410 }]);
    check('search: not ambiguous', r.ambiguous === false);
  }
  {
    // Summary unavailable -> miss with a diagnostic, no candidate.
    const g = game('Sevilla', 'Deportivo Alavés', '2026-11-06T20:00:00.000Z', 1, 1);
    const r = await oneSearch(g, {
      fixtures: [
        {
          id: 483419,
          round: 'מחזור 12',
          date: '2026-11-06T22:00:00',
          homeTeam: { name: 'סביליה', score: 1 },
          awayTeam: { name: 'אלאבס', score: 1 },
        },
      ],
      fetchSummary: async () => ({ available: false }),
    });
    eq('search: unavailable -> no candidate', r.candidate, null);
    eq('search: unavailable considered', r.considered, [{ title: 'סביליה–אלאבס', keep: false, reason: 'unavailable', matchId: 483419 }]);
  }
  {
    // No fixture match -> empty, not an error.
    const g = game('Levante', 'Atlético Madrid', '2026-12-01T13:00:00.000Z', 0, 2);
    const r = await oneSearch(g, {
      fixtures: FIXTURES,
      fetchSummary: async () => parseSummary(ATLETICO_SUMMARY),
    });
    eq('search: no fixture -> no candidate', r.candidate, null);
    eq('search: no fixture -> empty considered', r.considered, []);
  }
  {
    // Serie A via cfg leagueId 8 (stubbed fixtures + summary).
    const g = game('Inter', 'Monza', '2026-08-22T16:30:00.000Z', 4, 1);
    const r = await oneSearch(g, {
      cfg: { leagueId: 8 },
      fixtures: [
        {
          id: 479198,
          round: 'מחזור 1',
          date: '2026-08-22T19:30:00',
          homeTeam: { name: 'אינטר', score: 4 },
          awayTeam: { name: 'מונצה', score: 1 },
        },
      ],
      fetchSummary: async () => ({
        available: true,
        videoId: 99001,
        title: 'אינטר מביסה את מונצה',
        duration: '00:03:00',
        poster: 'https://photo.one.co.il/Image/Cover/x/99001.webp',
        failover: 'http://onevod.s3.amazonaws.com/2026_08/99001.mp4',
      }),
    });
    eq('search: serie-a cfg -> candidate id', r.candidate?.id, 'one:99001');
    eq('search: serie-a cfg -> match page url', r.candidate?.url, 'https://www.one.co.il/match/479198');
  }

  // ---------- filterCandidate: ONE candidate survives ingest ----------
  {
    // Both-teams title (Atletico-Levante) on the game day.
    const g = game('Levante', 'Atlético Madrid', '2026-10-31T13:00:00.000Z', 0, 2);
    const c = buildOneCandidate(g, FIXTURES[0], ATLETICO_SUMMARY as OneSummary) as RawCandidate;
    const r = filterCandidate(c, g);
    check('filter: both-teams ONE candidate kept', r.keep === true, `reason=${r.reason}`);
  }
  {
    // Single-team title (the real ONE headline for Barca 6-1 Alaves):
    // kept via the external single-team exception (exact scoreline
    // either order + game-day publish date).
    const g = game('Barcelona', 'Deportivo Alavés', '2026-10-31T20:00:00.000Z', 6, 1);
    const barcaSummary = {
      available: true,
      videoId: 111088,
      title: 'עסקים כרגיל: בארסה מתפוצצת עם 1:6 אדיר!',
      duration: '00:04:41',
      poster: 'https://photo.one.co.il/Image/Cover/def/111088.webp?width=999',
      failover: 'http://onevod.s3.amazonaws.com/2026_10/111088.mp4',
    } as OneSummary;
    const c = buildOneCandidate(g, FIXTURES[1], barcaSummary) as RawCandidate;
    const r = filterCandidate(c, g);
    check('filter: single-team ONE candidate kept (exception)', r.keep === true, `reason=${r.reason}`);
  }

  console.log(`\none_external_test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

void main();
