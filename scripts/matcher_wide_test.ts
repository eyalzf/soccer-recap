/**
 * Wide matcher regression suite: ~100 games x candidate matrix + targeted units.
 *
 * Zero YouTube quota: exercises filterCandidate / scoreCandidate /
 * rankCandidates (lib/recap/match.ts, lib/recap/rank.ts) against synthetic
 * but realistic titles. Run after any matcher change:
 *
 *   npx tsc scripts/matcher_wide_test.ts --outDir /tmp/mt --module commonjs \
 *     --target es2020 --moduleResolution node --esModuleInterop --skipLibCheck
 *   node /tmp/mt/scripts/matcher_wide_test.js
 *
 * Exit code 0 = all assertions pass, 1 = failures (listed on stdout).
 */
import { CLUBS } from '../lib/teams';
import { lookupClubEn, toHebrew } from '../lib/teamIndex';
import {
  competitionContradiction,
  dateProximity,
  excludedCategory,
  extractScore,
  filterCandidate,
  hasHighlightIntent,
  highlightTier,
  isTrusted,
  nonRecapFormat,
  teamMentioned,
} from '../lib/recap/match';
import { rankCandidates, scoreCandidate, videoLang } from '../lib/recap/rank';
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

// ---------------------------------------------------------------- games ---
interface LeagueSlice {
  league: string;
  clubs: string[];
  bulkHandle: string;
  contraKw: string;
}

const PL = CLUBS.slice(0, 23).map((c) => c.en);
const LALIGA = CLUBS.slice(23, 47).map((c) => c.en);
const IL = CLUBS.slice(47, 63).map((c) => c.en);
const UCL = CLUBS.slice(63).map((c) => c.en);

const SLICES: LeagueSlice[] = [
  { league: 'premier-league', clubs: PL, bulkHandle: 'mancity', contraKw: 'FA Cup' },
  { league: 'la-liga', clubs: LALIGA, bulkHandle: 'realmadrid', contraKw: 'Copa del Rey' },
  { league: 'israeli-league', clubs: IL, bulkHandle: 'mhfootballclub', contraKw: 'גביע המדינה' },
  { league: 'champions-league', clubs: UCL, bulkHandle: 'realmadrid', contraKw: 'Premier League' },
];

const pad2 = (n: number): string => String(n).padStart(2, '0');
const isoPlusDays = (iso: string, days: number): string =>
  new Date(Date.parse(iso) + days * 86400000).toISOString();

interface CaseDef {
  label: string;
  c: RawCandidate;
  keep: boolean;
  reason: string;
}

let gameCount = 0;

for (const slice of SLICES) {
  const n = slice.clubs.length;
  for (let i = 0; i < 25; i++) {
    gameCount++;
    const home = slice.clubs[(i * 2) % n];
    const away = slice.clubs[(i * 2 + 3) % n];
    if (home === away) throw new Error(`self-pairing in ${slice.league} #${i}`);
    if (!lookupClubEn(home) || !lookupClubEn(away))
      throw new Error(`unknown team: ${home} / ${away}`);

    // Every 7th game is a draw (i%7==6) to probe the reversed-digits veto.
    const draw = i % 7 === 6;
    const hs = draw ? i % 3 : (i * 3 + 1) % 4;
    const as = draw ? i % 3 : (i * 5 + 2) % 4;
    const dateISO = `2026-09-${pad2(14 - (i % 9))}T19:00:00Z`;
    const game: GameInput = { home, away, dateISO, league: slice.league, homeScore: hs, awayScore: as };
    const gid = `${slice.league}#${i} ${home} ${hs}-${as} ${away}`;

    const heH = toHebrew(home);
    const heA = toHebrew(away);
    const near = isoPlusDays(dateISO, 1);
    const old = isoPlusDays(dateISO, -30);
    const sc = `${hs}-${as}`;

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
      id: `${gid} :: ${id}`,
      videoId: `${gid} :: ${id}`, // unique: rankCandidates dedupes on videoId
      title,
    });

    const heTitle = `${heH} ${sc} ${heA} | תקציר המשחק`;
    const enTitle = `${home} ${sc} ${away} | Extended Highlights`;

    // Inter games get the clean "winter" boundary title (no standalone Inter).
    const interGame = home === 'Inter' || away === 'Inter';
    const other = home === 'Inter' ? away : home;
    const winterTitle = interGame
      ? `${other} winter transfer news and rumours`
      : `${home} transfer news: latest rumours`;

    const revScore = `${as}-${hs}`;
    const revTitle = `${home} ${revScore} ${away} | Highlights`;

    const cases: CaseDef[] = [
      { label: 'he-ok', c: mk('he', heTitle, { lang: 'he', channelHandle: slice.bulkHandle, bulk: true, publishedAt: near, durationSec: 600 }), keep: true, reason: 'ok' },
      { label: 'en-ok', c: mk('en', enTitle, { channelHandle: 'GenericFootball', publishedAt: near, durationSec: 750 }), keep: true, reason: 'ok' },
      { label: 'bad-score', c: mk('score', `${home} ${hs + 1}-${as} ${away} | Highlights`, { publishedAt: near }), keep: false, reason: 'score' },
      { label: 'classic', c: mk('classic', `${home} vs ${away} | Classic Encounters`, { publishedAt: near }), keep: false, reason: 'excluded' },
      { label: 'winter', c: mk('winter', winterTitle, { publishedAt: near }), keep: false, reason: 'teams' },
      { label: 'comp', c: mk('comp', `${home} ${sc} ${away} | ${slice.contraKw} Highlights`, { publishedAt: near }), keep: false, reason: 'competition' },
      { label: 'blocked', c: mk('blocked', heTitle, { lang: 'he', publishedAt: near, blockedInIL: true }), keep: false, reason: 'region-blocked' },
      { label: 'noembed', c: mk('noembed', heTitle, { lang: 'he', publishedAt: near, embeddable: false }), keep: false, reason: 'not-embeddable' },
      { label: 'old', c: mk('old', enTitle, { publishedAt: old }), keep: false, reason: 'date' },
      // Reversed digits: untrusted + undated. For draws the score is
      // identical either way, so it must be KEPT (no reversal exists).
      { label: 'rev', c: mk('rev', revTitle, { channelHandle: 'RandomFan' }), keep: draw, reason: draw ? 'ok' : 'score-reversed' },
      { label: 'es-lang', c: mk('es', enTitle, { publishedAt: near, audioLang: 'es' }), keep: false, reason: 'language' },
    ];

    const kept: RawCandidate[] = [];
    for (const k of cases) {
      const r = filterCandidate(k.c, game);
      eq(`${k.c.id} [${k.label}] keep`, r.keep, k.keep);
      if (r.keep === k.keep) eq(`${k.c.id} [${k.label}] reason`, r.reason, k.reason);
      if (r.keep) kept.push(k.c);
    }

    // Ranking: relevance tier first — the English "Extended Highlights"
    // candidate outranks the standard Hebrew one, longest first within a tier.
    const ranked = rankCandidates(kept, game);
    const heId = `${gid} :: he`;
    const enId = `${gid} :: en`;
    check(`${gid} [rank] extended-first`, ranked.length > 0 && ranked[0].id === enId,
      `top was ${ranked[0]?.id ?? 'none'} (kept: ${kept.length})`);
    const heScore = ranked.find((r) => r.id === heId)?.score ?? -1;
    const enScore = ranked.find((r) => r.id === `${gid} :: en`)?.score ?? -1;
    check(`${gid} [rank] he> en score`, heScore > enScore, `he=${heScore} en=${enScore}`);
  }
}

// ------------------------------------------------------------- targeted ---
// Year digit-runs must not veto as scores.
eq('extractScore year prefix', extractScore('UCL 2026-27: Real Madrid 2-1 Inter | Highlights'), [2, 1]);
eq('extractScore season range', extractScore('Season 2026-27 review: Barcelona 3-1 Sevilla'), [3, 1]);
eq('extractScore none', extractScore('No score here'), null);
eq('extractScore en-dash', extractScore('Arsenal 2–0 Chelsea | Highlights'), [2, 0]);

// Highlight intent vocabulary.
check('intent all-goals', hasHighlightIntent('Real Madrid vs Inter | All Goals'));
check('intent hebrew', hasHighlightIntent('כל השערים של המשחק'));
check('intent resumen', hasHighlightIntent('Real Madrid vs Barcelona | Resumen'));
check('intent tiktsir', hasHighlightIntent('מכבי חיפה נגד מכבי תל אביב | תקציר'));
check('intent negative', !hasHighlightIntent('Real Madrid winter transfer news'));

// Word boundaries: short names must not match inside other words.
const inter = lookupClubEn('Inter')!;
const real = lookupClubEn('Real Madrid')!;
check('winter: inter absent', !teamMentioned('Real Madrid winter transfer news and rumours', inter));
check('winter: real present', teamMentioned('Real Madrid winter transfer news and rumours', real));
const betis = lookupClubEn('Real Betis')!;
check('betis: no substring match', !teamMentioned('Sevilla vs alphabetis FC | Highlights', betis));

// Generic aliases must not match inside other clubs' names ("United" in
// "Leeds United" is Leeds, not Man Utd) — but must still work standalone.
const manu = lookupClubEn('Manchester United')!;
const leeds = lookupClubEn('Leeds United')!;
check('united: leeds title not manu', !teamMentioned('Leeds United 2-0 Arsenal | Highlights', manu));
check('united: leeds title is leeds', teamMentioned('Leeds United 2-0 Arsenal | Highlights', leeds));
check('united: standalone still matches', teamMentioned('United 2-0 City | Highlights', manu));
const mancity = lookupClubEn('Manchester City')!;
check('city: standalone still matches', teamMentioned('United 2-0 City | Highlights', mancity));
const sociedad = lookupClubEn('Real Sociedad')!;
check('real: sociedad title not madrid', !teamMentioned('Real Sociedad 1-0 Barcelona | Highlights', real));
check('real: sociedad title is sociedad', teamMentioned('Real Sociedad 1-0 Barcelona | Highlights', sociedad));

// Full-pipeline: a Leeds-Arsenal video must not pass as Man Utd-Arsenal.
const manuArs: GameInput = {
  home: 'Manchester United', away: 'Arsenal',
  dateISO: '2026-09-14T19:00:00Z', league: 'premier-league', homeScore: 0, awayScore: 2,
};
const leedsVid: RawCandidate = {
  id: 'leeds-fp', title: 'Leeds United 0-2 Arsenal | Highlights',
  url: 'https://www.youtube.com/watch?v=L', source: 'youtube', videoId: 'L',
  lang: 'en', embeddable: true, publishedAt: '2026-09-15T10:00:00Z',
};
eq('leeds video not manu recap', filterCandidate(leedsVid, manuArs).reason, 'teams');
// ...but genuine "United vs City" shorthand still matches.
const manuCity: GameInput = {
  home: 'Manchester United', away: 'Manchester City',
  dateISO: '2026-09-14T19:00:00Z', league: 'premier-league', homeScore: 2, awayScore: 0,
};
const derby: RawCandidate = {
  id: 'derby', title: 'United 2-0 City | Extended Highlights',
  url: 'https://www.youtube.com/watch?v=D', source: 'youtube', videoId: 'D',
  lang: 'en', embeddable: true, publishedAt: '2026-09-15T10:00:00Z',
};
eq('united-city shorthand kept', filterCandidate(derby, manuCity).keep, true);
const mtaGame: GameInput = {
  home: 'Maccabi Tel Aviv', away: 'Hapoel Tel Aviv',
  dateISO: '2026-09-13T18:00:00Z', league: 'israeli-league', homeScore: 2, awayScore: 0,
};
const gersh: RawCandidate = {
  id: 'gershayim', title: 'מכבי ת״א 2-0 הפועל ת״א | תקציר המשחק',
  url: 'https://www.youtube.com/watch?v=G', source: 'youtube', videoId: 'G',
  lang: 'he', embeddable: true, publishedAt: '2026-09-14T10:00:00Z',
};
const gr = filterCandidate(gersh, mtaGame);
eq('gershayim keep', gr.keep, true);

// Trusted-channel detection and boost.
const trusted: RawCandidate = {
  ...gersh, id: 'trusted', channelHandle: 'Ipflofficial', bulk: false,
};
check('isTrusted ipflofficial', isTrusted(trusted));
check('trusted outranks bulk',
  scoreCandidate(trusted, mtaGame) > scoreCandidate({ ...gersh, id: 'bulk', bulk: true, channelHandle: 'x' }, mtaGame));

// Date proximity bands.
eq('prox ok', dateProximity('2026-09-15T10:00:00Z', '2026-09-14T19:00:00Z'), 'ok');
eq('prox near', dateProximity('2026-09-20T10:00:00Z', '2026-09-14T19:00:00Z'), 'near');
eq('prox bad', dateProximity('2026-09-25T10:00:00Z', '2026-09-14T19:00:00Z'), 'bad');
eq('prox undated', dateProximity(undefined, '2026-09-14T19:00:00Z'), 'undated');

// Competition contradictions and excluded categories.
eq('contra fa-cup', competitionContradiction('Arsenal vs Chelsea | FA Cup Highlights', 'premier-league'), 'fa cup');
eq('contra none', competitionContradiction('Arsenal vs Chelsea | Premier League Highlights', 'premier-league'), null);
eq('excluded season-review', excludedCategory('Manchester City 2025/26 Season Review'), 'season review');
eq('excluded livestream', excludedCategory('Real Madrid vs Barcelona | שידור חי'), 'שידור חי');

// Relevance tiers: extended (0) > standard (1) > rest (2).
check('tier extended en', highlightTier('Real Madrid 2-1 Inter | Extended Highlights') === 0);
check('tier extended he', highlightTier('מכבי חיפה 2-0 מכבי תל אביב | תקציר מורחב') === 0);
check('tier all-goals', highlightTier('Barcelona vs Sevilla | All Goals') === 0);
check('tier every-goal', highlightTier('Arsenal 3-1 Tottenham | Every Goal') === 0);
check('tier standard en', highlightTier('Arsenal 2-0 Chelsea | Highlights') === 1);
check('tier standard he', highlightTier('בית״ר ירושלים נגד הפועל ת״א | תקציר המשחק') === 1);
check('tier rest', highlightTier('Real Madrid winter transfer news') === 2);

// Tier beats duration: a 5-minute extended video outranks a 12-minute
// standard one; within a tier the longer video still wins.
const tierGame: GameInput = {
  home: 'Arsenal', away: 'Chelsea', dateISO: '2026-09-14T19:00:00Z',
  league: 'premier-league', homeScore: 2, awayScore: 0,
};
const mkTier = (id: string, title: string, durationSec: number): RawCandidate => ({
  id, title, url: `https://www.youtube.com/watch?v=${id}`, source: 'youtube',
  videoId: id, lang: 'en', embeddable: true, durationSec,
});
const tierRanked = rankCandidates(
  [
    mkTier('std-long', 'Arsenal 2-0 Chelsea | Highlights', 720),
    mkTier('std-short', 'Arsenal 2-0 Chelsea | Highlights', 240),
    mkTier('ext-short', 'Arsenal 2-0 Chelsea | Extended Highlights', 300),
    mkTier('news', 'Arsenal 2-0 Chelsea | Post-match reactions', 900),
  ],
  tierGame
);
check(
  'tier sort order',
  tierRanked.map((r) => r.id).join(',') === 'ext-short,std-long,std-short,news',
  tierRanked.map((r) => r.id).join(',')
);

// --------------------------------- v5: language veto lift + exclusions ---
// Curated tiers (preferred/bulk/candidate): language is a ranking preference,
// not a veto. General search keeps the hard veto.
const esGame: GameInput = {
  home: 'Athletic Bilbao', away: 'Elche',
  dateISO: '2026-09-12T19:00:00Z', league: 'la-liga', homeScore: 1, awayScore: 1,
};
const esTitle = 'Highlights | Athletic Club 1-1 Elche CF | LaLiga 2026/27 J5';
const mkEs = (over: Partial<RawCandidate>): RawCandidate => ({
  id: 'es-v5', title: esTitle, url: 'https://www.youtube.com/watch?v=ESV5',
  source: 'youtube', videoId: 'ESV5', lang: 'en', embeddable: true,
  publishedAt: '2026-09-13T10:00:00Z', audioLang: 'es', ...over,
});
eq('v5 es bulk kept (veto lifted)', filterCandidate(mkEs({ bulk: true, channelHandle: 'AthleticClubTV' }), esGame).keep, true);
eq('v5 es candidate kept (veto lifted)', filterCandidate(mkEs({ bulk: true, channelHandle: 'x' }), esGame).keep, true);
eq('v5 es preferred kept (veto lifted)', filterCandidate(mkEs({ channelHandle: 'one-1004' }), esGame).keep, true);
const esGen = filterCandidate(mkEs({}), esGame);
eq('v5 es general still rejected', esGen.keep, false);
eq('v5 es general reason', esGen.reason, 'language');
// Proper-highlight intent is detected on the Spanish title.
check('v5 es properHighlight', hasHighlightIntent(esTitle));

// Press conferences and prematch shows: rejected in every tier and language.
const pressGame: GameInput = {
  home: 'Elche', away: 'Real Sociedad',
  dateISO: '2026-09-07T19:00:00Z', league: 'la-liga', homeScore: 2, awayScore: 3,
};
const mkPress = (title: string, over: Partial<RawCandidate> = {}): RawCandidate => ({
  id: 'press-v5', title, url: 'https://www.youtube.com/watch?v=PV5',
  source: 'youtube', videoId: 'PV5', lang: 'en', embeddable: true,
  publishedAt: '2026-09-08T10:00:00Z', audioLang: 'es',
  bulk: true, channelHandle: 'realsociedadtv', ...over,
});
eq('v5 rueda de prensa rejected',
  filterCandidate(mkPress('RUEDA DE PRENSA | Pellegrino Matarazzo | Elche CF - Real Sociedad'), pressGame).reason,
  'press-conference');
eq('v5 conferencia de prensa rejected',
  filterCandidate(mkPress('Conferencia de prensa | Elche CF - Real Sociedad'), pressGame).reason,
  'press-conference');
eq('v5 dutch persconferentie rejected',
  filterCandidate(mkPress('Persconferentie | PSV - Shakhtar', { audioLang: 'nl', bulk: true }), pressGame).reason,
  'press-conference');
eq('v5 hebrew presser rejected',
  filterCandidate(mkPress('מסיבת עיתונאים | מאמן אלצ׳ה', { audioLang: 'he' }), pressGame).reason,
  'press-conference');
eq('v5 previa rejected',
  filterCandidate(mkPress('La previa | Elche - Real Sociedad'), pressGame).reason, 'prematch');
eq('v5 pre-match rejected',
  filterCandidate(mkPress('Elche vs Real Sociedad | Pre-match show'), pressGame).reason, 'prematch');
// ...but a genuine Spanish highlight from the same channel still passes.
eq('v5 spanish highlight kept',
  filterCandidate(mkPress('Resumen | Elche 2-3 Real Sociedad | LaLiga'), pressGame).keep, true);

// Hapoel Tel Aviv sponsor-inserted alias.
const htaGame: GameInput = {
  home: 'Hapoel Tel Aviv', away: 'Hapoel Ramat Gan',
  dateISO: '2026-09-07T17:00:00Z', league: 'israeli-league', homeScore: 4, awayScore: 0,
};
const ibi: RawCandidate = {
  id: 'ibi-v5', title: 'עונת 2026/2027, מחזור 3 | הפועל IBI ת"א 0:4 הפועל ר"ג',
  url: 'https://www.youtube.com/watch?v=IBIV5', source: 'youtube', videoId: 'IBIV5',
  lang: 'he', embeddable: true, publishedAt: '2026-09-08T10:00:00Z',
  bulk: true, channelHandle: 'HapoelTelAvivFC',
};
eq('v5 hapoel IBI alias kept', filterCandidate(ibi, htaGame).keep, true);

// Language ranking preference: Hebrew > English > other.
const rlGame: GameInput = {
  home: 'Athletic Bilbao', away: 'Elche',
  dateISO: '2026-09-12T19:00:00Z', league: 'la-liga', homeScore: 1, awayScore: 1,
};
const mkRl = (id: string, over: Partial<RawCandidate>): RawCandidate => ({
  id, title: 'Athletic Club 1-1 Elche CF | Highlights',
  url: `https://www.youtube.com/watch?v=${id}`, source: 'youtube', videoId: id,
  lang: 'en', embeddable: true, publishedAt: '2026-09-13T10:00:00Z',
  bulk: true, ...over,
});
const rlHe = mkRl('rl-he', { title: 'אתלטיק בילבאו 1-1 אלצ׳ה | תקציר' });
const rlEn = mkRl('rl-en', { audioLang: 'en' });
const rlEs = mkRl('rl-es', { audioLang: 'es' });
eq('v5 videoLang he', videoLang(rlHe), 'he');
eq('v5 videoLang en', videoLang(rlEn), 'en');
eq('v5 videoLang other', videoLang(rlEs), 'other');
check('v5 rank he > en > other',
  scoreCandidate(rlHe, rlGame) > scoreCandidate(rlEn, rlGame) &&
  scoreCandidate(rlEn, rlGame) > scoreCandidate(rlEs, rlGame),
  `he=${scoreCandidate(rlHe, rlGame)} en=${scoreCandidate(rlEn, rlGame)} es=${scoreCandidate(rlEs, rlGame)}`);

// ---------------------------------------------------------------- report ---
console.log(`\n${gameCount} games, ${pass + fail} assertions: ${pass} pass, ${fail} fail`);
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log('  -', f);
}
process.exit(fail ? 1 : 0);
