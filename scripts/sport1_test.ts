/**
 * Sport1 (ספורט 1 web) priority-source tests.
 *
 * Part 1 — matcher units: synthetic Sport1 candidates through the shared
 * filterCandidate (zero network, zero quota). Part 2 — live retrieval:
 * sport1Search for the Denmark–Portugal UNL game (2026-10-01) must produce
 * the official תקציר with the Walla media embed; touches only
 * sport1.maariv.co.il + dal.walla.co.il, never the YouTube API.
 *
 *   npx -y tsx scripts/sport1_test.ts
 *
 * Exit code 0 = all assertions pass, 1 = failures (listed on stdout).
 */
import { filterCandidate, hasHighlightIntent } from '../lib/recap/match';
import { sport1Search } from '../lib/recap/sources';
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

const GAME: GameInput = {
  home: 'Denmark',
  away: 'Portugal',
  dateISO: '2026-10-01',
  league: 'nations-league',
  homeScore: 4,
  awayScore: 2,
};

function s1(title: string, extra: Partial<RawCandidate> = {}): RawCandidate {
  return {
    id: 'sport1:test',
    title,
    url: 'https://sport1.maariv.co.il/world-soccer/video/1/',
    source: 'sport1',
    embedUrl:
      'https://player.maariv.co.il/public/player.html?player=sport1-desktop&media=1',
    publishedAt: '2026-10-01T21:11:45Z',
    lang: 'he',
    ...extra,
  };
}

async function main(): Promise<void> {
  // ---- Part 1: matcher units ----
  const proper = s1('תקציר: דנמרק – פורטוגל 4:2', { durationSec: 158 });
  check('proper תקציר kept', filterCandidate(proper, GAME).keep);
  check('proper תקציר has highlight intent (stops cascade)', hasHighlightIntent(proper.title));

  const goalsOnly = s1('צפו בשערים: דנמרק – פורטוגל');
  check('goals-only clip kept as candidate', filterCandidate(goalsOnly, GAME).keep);
  check('goals-only clip has no highlight intent', !hasHighlightIntent(goalsOnly.title));

  const wrongScore = filterCandidate(s1('תקציר: דנמרק – פורטוגל 3:1'), GAME);
  check('wrong score vetoed', !wrongScore.keep && wrongScore.reason === 'score', wrongScore.reason);

  const wrongTeams = filterCandidate(s1('תקציר: גרמניה – סרביה 2:1'), GAME);
  check('other teams rejected', !wrongTeams.keep && wrongTeams.reason === 'teams', wrongTeams.reason);

  const tooLong = filterCandidate(
    s1('תקציר: דנמרק – פורטוגל 4:2', { durationSec: 3000 }),
    GAME
  );
  check('full-length (>30min) rejected', !tooLong.keep && tooLong.reason === 'too-long', tooLong.reason);

  const unlPhrased = s1('תקציר ליגת האומות: דנמרק – פורטוגל 4:2', { durationSec: 200 });
  check('title naming ליגת האומות kept (no false contradiction)', filterCandidate(unlPhrased, GAME).keep);

  const wcQualifier = filterCandidate(
    s1('תקציר מוקדמות המונדיאל: דנמרק – פורטוגל 4:2'),
    GAME
  );
  check('WC-qualifier title rejected as wrong competition', !wcQualifier.keep && wcQualifier.reason === 'competition', wcQualifier.reason);

  const oldMeeting = filterCandidate(
    s1('תקציר: דנמרק – פורטוגל 4:2', { publishedAt: '2024-09-08T21:50:16Z', durationSec: 180 }),
    GAME
  );
  check('old meeting rejected by date', !oldMeeting.keep && oldMeeting.reason === 'date', oldMeeting.reason);

  // Sport1 spells Wales ווילס and Norway נורבגיה; both must match so the
  // ווילס–נורבגיה תקציר is found and kept (user report 2026-10-02).
  const WALES: GameInput = {
    home: 'Wales',
    away: 'Norway',
    dateISO: '2026-10-01',
    league: 'nations-league',
    homeScore: 2,
    awayScore: 1,
  };
  const walesRecap = s1('תקציר: ווילס – נורבגיה 1:2', { durationSec: 170 });
  check('Sport1-spelled ווילס–נורבגיה recap kept', filterCandidate(walesRecap, WALES).keep);

  // Israeli-league rescue (sport1Fallback, user decision 2026-10-18):
  // Bnei Sakhnin – Hapoel Petah Tikva (2026-10-17, 2-0) had NO YouTube
  // source at all; Sport1's real recap post (id 1974298, title below,
  // 155s) must pass the shared matcher for the Israeli game, and the
  // previous meeting's post (2026-08-15, 0:1) must die on date.
  const SAKHNIN: GameInput = {
    home: 'Bnei Sakhnin',
    away: 'Hapoel Petah Tikva',
    dateISO: '2026-10-17',
    league: 'israeli-league',
    homeScore: 2,
    awayScore: 0,
  };
  const sakhninRecap: RawCandidate = {
    id: 'sport1:1974298',
    title: 'תקציר: בני סכנין – הפועל פתח תקוה 0:2',
    url: 'https://sport1.maariv.co.il/israeli-soccer/video/1974298/',
    source: 'sport1',
    embedUrl:
      'https://player.maariv.co.il/public/player.html?player=sport1-desktop&media=1',
    publishedAt: '2026-10-17T19:24:55Z',
    durationSec: 155,
    lang: 'he',
  };
  check('israeli rescue: Sakhnin recap kept', filterCandidate(sakhninRecap, SAKHNIN).keep);
  check('israeli rescue: Sakhnin recap has highlight intent (wins over general)', hasHighlightIntent(sakhninRecap.title));
  const sakhninOld = filterCandidate(
    { ...sakhninRecap, id: 'sport1:1925259', title: 'תקציר: בני סכנין – הפועל פתח תקוה 0:1', publishedAt: '2026-08-15T20:44:13Z', durationSec: 116 },
    SAKHNIN
  );
  check('israeli rescue: previous meeting rejected', !sakhninOld.keep, sakhninOld.reason);

  // Premier League rescue (sport1Fallback, user decision 2026-10-21):
  // Sport1 posts proper recaps for most PL games. The four REAL posts
  // below (ids/titles/durations/publication as retrieved live on
  // 2026-10-21) were initially dropped by the shared matcher on Hebrew
  // short forms — bare לידס, קובנטרי, איפסוויץ, טוטנהאם (canonical:
  // לידס יונייטד, קובנטרי סיטי, איפסוויץ' טאון, טוטנהאם הוטספר) and
  // Bournemouth's geresh-less spelling (בורנמות vs canonical
  // בורנמות') — until the 2026-10-21 heAliases were added.
  const plCases: Array<{ game: GameInput; cand: RawCandidate }> = [
    {
      game: { home: 'Tottenham Hotspur', away: 'Coventry City', dateISO: '2026-10-19', league: 'premier-league', homeScore: 3, awayScore: 1 },
      cand: { id: 'sport1:1976388', title: 'תקציר: טוטנהאם – קובנטרי 1:3', url: 'https://sport1.maariv.co.il/english-soccer/video/1976388/', source: 'sport1', embedUrl: 'https://player.maariv.co.il/public/player.html?player=sport1-desktop&media=1', publishedAt: '2026-10-19T21:24:57Z', durationSec: 143, lang: 'he' },
    },
    {
      game: { home: 'Leeds United', away: 'Manchester United', dateISO: '2026-10-18', league: 'premier-league', homeScore: 1, awayScore: 1 },
      cand: { id: 'sport1:1975184', title: 'תקציר: לידס – מנצ\'סטר יונייטד 1:1', url: 'https://sport1.maariv.co.il/english-soccer/video/1975184/', source: 'sport1', embedUrl: 'https://player.maariv.co.il/public/player.html?player=sport1-desktop&media=1', publishedAt: '2026-10-18T16:09:03Z', durationSec: 84, lang: 'he' },
    },
    {
      game: { home: 'AFC Bournemouth', away: 'Sunderland', dateISO: '2026-10-18', league: 'premier-league', homeScore: 2, awayScore: 0 },
      cand: { id: 'sport1:1975196', title: 'תקציר: בורנמות – סנדרלנד 0:2', url: 'https://sport1.maariv.co.il/english-soccer/video/1975196/', source: 'sport1', embedUrl: 'https://player.maariv.co.il/public/player.html?player=sport1-desktop&media=1', publishedAt: '2026-10-18T16:22:29Z', durationSec: 116, lang: 'he' },
    },
    {
      game: { home: 'Manchester City', away: 'Ipswich Town', dateISO: '2026-10-17', league: 'premier-league', homeScore: 3, awayScore: 2 },
      cand: { id: 'sport1:1974051', title: 'תקציר: מנצ\'סטר סיטי – איפסוויץ 2:3', url: 'https://sport1.maariv.co.il/english-soccer/video/1974051/', source: 'sport1', embedUrl: 'https://player.maariv.co.il/public/player.html?player=sport1-desktop&media=1', publishedAt: '2026-10-17T16:26:41Z', durationSec: 134, lang: 'he' },
    },
  ];
  for (const { game, cand } of plCases) {
    const label = `pl rescue ${game.home} vs ${game.away}`;
    check(`${label}: kept`, filterCandidate(cand, game).keep);
    check(`${label}: highlight intent (wins over general)`, hasHighlightIntent(cand.title));
  }

  // Pre-emptive PL short forms (2026-10-24, ahead of the Sun Oct 25
  // fixtures): Sport1's own PL page (article 1979612, live that day)
  // lists the fixtures in bare forms — 'קריסטל פאלאס – ניוקאסל' and
  // 'האל – ברנטפורד' — while the registry canonicals are ניוקאסל
  // יונייטד and האל סיטי with no bare alias, so a Sport1 recap title
  // in the same style would fail the teams check and the PL rescue
  // would drop it. heAliases ניוקאסל / האל added 2026-10-24 (bare
  // יונייטד deliberately NOT added — ambiguous across United clubs).
  // Collision check: each bare form appears only in its own team's
  // registry entry. Scores below are illustrative (fixtures unplayed
  // when pinned); team-name forms are Sport1's attested ones.
  const plPreemptive: Array<{ game: GameInput; cand: RawCandidate }> = [
    {
      game: { home: 'Crystal Palace', away: 'Newcastle United', dateISO: '2026-10-25', league: 'premier-league', homeScore: 2, awayScore: 1 },
      cand: { id: 'sport1:pre-palace-newcastle', title: 'תקציר: קריסטל פאלאס – ניוקאסל 1:2', url: 'https://sport1.maariv.co.il/', source: 'sport1', embedUrl: 'https://player.maariv.co.il/public/player.html?player=sport1-desktop&media=1', publishedAt: '2026-10-25T15:30:00Z', durationSec: 150, lang: 'he' },
    },
    {
      game: { home: 'Hull City', away: 'Brentford', dateISO: '2026-10-25', league: 'premier-league', homeScore: 1, awayScore: 1 },
      cand: { id: 'sport1:pre-hull-brentford', title: 'תקציר: האל – ברנטפורד 1:1', url: 'https://sport1.maariv.co.il/', source: 'sport1', embedUrl: 'https://player.maariv.co.il/public/player.html?player=sport1-desktop&media=1', publishedAt: '2026-10-25T15:30:00Z', durationSec: 150, lang: 'he' },
    },
  ];
  for (const { game, cand } of plPreemptive) {
    const label = `pl pre-emptive ${game.home} vs ${game.away}`;
    check(`${label}: kept`, filterCandidate(cand, game).keep);
    check(`${label}: highlight intent (wins over general)`, hasHighlightIntent(cand.title));
  }

  // ---- Part 2: live retrieval ----
  const cands = await sport1Search(GAME);
  console.log(`live retrieval returned ${cands.length} candidate(s)`);
  for (const c of cands) console.log('  ·', c.title, '|', c.embedUrl, '|', c.durationSec + 's');
  check('live: at least one candidate', cands.length >= 1);
  const den = cands.find((c) => c.embedUrl?.includes('media=4106162'));
  check('live: Denmark–Portugal תקציר (media 4106162) found', !!den);
  if (den) {
    check('live: candidate survives the shared matcher', filterCandidate(den, GAME).keep);
    check('live: highlight intent (would win the cascade)', hasHighlightIntent(den.title));
    check('live: duration ~158s', den.durationSec != null && Math.abs(den.durationSec - 158) <= 5, String(den.durationSec));
  }

  // Wales–Norway: missed at first because Sport1 writes ווילס (not our
  // canonical וויילס) — the variant-query retrieval must now find it.
  const walesCands = await sport1Search(WALES);
  console.log(`live Wales retrieval returned ${walesCands.length} candidate(s)`);
  for (const c of walesCands) console.log('  ·', c.title, '|', c.durationSec + 's');
  const walesKept = walesCands.filter((c) => filterCandidate(c, WALES).keep);
  check('live: Wales–Norway recap found and kept', walesKept.length >= 1);

  // Israeli-league rescue, live: the Sakhnin game above had no YouTube
  // source; sport1Search must surface its recap and the matcher keep it.
  const sakhCands = await sport1Search(SAKHNIN);
  console.log(`live Sakhnin retrieval returned ${sakhCands.length} candidate(s)`);
  for (const c of sakhCands) console.log('  ·', c.title, '|', c.durationSec + 's');
  const sakhKept = sakhCands.filter((c) => filterCandidate(c, SAKHNIN).keep);
  check('live: Sakhnin–Hapoel PT recap found and kept', sakhKept.length >= 1);

  console.log(`\nsport1 tests: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});
