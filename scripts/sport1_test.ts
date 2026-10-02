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

  console.log(`\nsport1 tests: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});
