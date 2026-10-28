/**
 * Registry additions tests (2026-10-28): runtime club registrations
 * from data/club-additions.json + the matcher name fallback.
 *
 * The failure these pin: the six lower-division clubs from the
 * 2026-10-27 cup ties (Fleetwood Town, CD Manacor, Sporting de
 * Alcázar, UD Pinatar, Sestao River, Recreativo Huelva) existed in
 * the data files but not in the compiled registry, so the matcher
 * hard-rejected EVERY recap candidate for their games as
 * 'unknown-team' — including the official highlights (Arsenal's own
 * Fleetwood video, the RFEF Copa del Rey resúmenes).
 *
 * Run: npx -y tsx scripts/registry_additions_test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLUBS } from '../lib/teams';
import {
  lookupClubEn,
  lookupClubHe,
  registerClubAdditions,
  toHebrew,
} from '../lib/teamIndex';
import { parseClubAdditions, parseClubAddition } from '../lib/clubAdditions';
import { filterCandidate } from '../lib/recap/match';
import type { GameInput, RawCandidate } from '../lib/recap/types';

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra?: string) {
  if (cond) pass++;
  else {
    fail++;
    console.log(`FAIL ${label}${extra ? ` — ${extra}` : ''}`);
  }
}

// ---------- parse validation ----------
check('parse: valid entry', parseClubAddition({ en: 'X FC', he: 'איקס', enAliases: ['X'], heAliases: [] }) !== null);
check('parse: missing he rejected', parseClubAddition({ en: 'X FC', enAliases: [], heAliases: [] }) === null);
check('parse: missing en rejected', parseClubAddition({ he: 'איקס' }) === null);
check('parse: non-array aliases rejected', parseClubAddition({ en: 'X FC', he: 'איקס', enAliases: 'X' }) === null);
check('parse: aliases default to []', parseClubAddition({ en: 'X FC', he: 'איקס' })?.enAliases.length === 0);
check('parse: non-object rejected', parseClubAddition('nope') === null);
check('parse: file without clubs -> []', parseClubAdditions({}).length === 0);
check('parse: junk file -> []', parseClubAdditions(null).length === 0);

// ---------- the shipped additions file ----------
const raw = JSON.parse(
  readFileSync(join(process.cwd(), 'data', 'club-additions.json'), 'utf8')
);
const additions = parseClubAdditions(raw);
check('file: all entries parse', additions.length === (raw.clubs as unknown[]).length, `${additions.length}/${(raw.clubs as unknown[]).length}`);

// No addition may collide with the compiled registry (additions fill
// gaps only; a collision means the club belongs in code review, and
// the code entry would silently win anyway).
const codeEns = new Set(CLUBS.map((c) => c.en));
for (const a of additions) {
  check(`file: ${a.en} is not a code club`, !codeEns.has(a.en));
  check(`file: ${a.en} unresolved before registration`, lookupClubEn(a.en) === undefined, lookupClubEn(a.en)?.en);
}

// No duplicate registrations inside the file itself.
const seen = new Set<string>();
for (const a of additions) {
  check(`file: ${a.en} registered once`, !seen.has(a.en));
  seen.add(a.en);
}

// ---------- registration semantics ----------
registerClubAdditions(additions);
for (const a of additions) {
  check(`overlay: ${a.en} resolves`, lookupClubEn(a.en)?.en === a.en);
  check(`overlay: ${a.en} Hebrew resolves`, lookupClubHe(a.he)?.en === a.en);
  check(`overlay: toHebrew(${a.en})`, toHebrew(a.en) === a.he);
}
check('overlay: alias resolves (Manacor)', lookupClubEn('Manacor')?.en === 'CD Manacor');
check('overlay: unaccented alias resolves (Sporting Alcazar)', lookupClubEn('Sporting Alcazar')?.en === 'Sporting de Alcázar');
check('overlay: alias resolves (Fleetwood)', lookupClubEn('Fleetwood')?.en === 'Fleetwood Town');

// Code always wins: a hostile/sloppy addition claiming a code club's
// name or alias must not shadow the curated entry.
registerClubAdditions([
  { en: 'Fake Arsenal', he: 'מזויף', enAliases: ['Arsenal'], heAliases: [] },
  ...additions,
]);
check('overlay: code entry not shadowed (Arsenal)', lookupClubEn('Arsenal')?.he === 'ארסנל');
// Re-register the real additions (wholesale replace drops the fake).
registerClubAdditions(additions);
check('overlay: re-register replaces (Fake Arsenal gone)', lookupClubEn('Fake Arsenal') === undefined);
check('overlay: additions intact after re-register', lookupClubEn('CD Manacor')?.he === 'מנאקור');

// ---------- every cup tie in the data files resolves ----------
for (const slug of ['premier-league', 'la-liga', 'israeli-league']) {
  const file = JSON.parse(readFileSync(join(process.cwd(), 'data', `${slug}.json`), 'utf8'));
  for (const g of file.games ?? []) {
    if (!g.cup) continue;
    check(`cup resolves: ${g.home} (${slug})`, lookupClubEn(g.home) !== undefined);
    check(`cup resolves: ${g.away} (${slug})`, lookupClubEn(g.away) !== undefined);
  }
}

// ---------- matcher: the real dropped candidates now keep ----------
const cand = (title: string, extra?: Partial<RawCandidate>): RawCandidate => ({
  id: 'yt:test',
  title,
  url: 'https://www.youtube.com/watch?v=test',
  source: 'youtube',
  publishedAt: '2026-10-28T10:00:00Z',
  durationSec: 420,
  embeddable: true,
  lang: 'en',
  bulk: true,
  ...extra,
});

const fleetwoodGame: GameInput = {
  home: 'Fleetwood Town', away: 'Arsenal', dateISO: '2026-10-27T20:00:00.000Z',
  league: 'premier-league', homeScore: 1, awayScore: 1, cup: 'efl-cup',
};
const arsenalHL = filterCandidate(
  cand('HIGHLIGHTS | Fleetwood Town vs Arsenal (1-1, Fleetwood win 5-3 on penalties)', { channelName: 'Arsenal' }),
  fleetwoodGame
);
check('matcher: Arsenal Fleetwood highlights keep', arsenalHL.keep, arsenalHL.reason);

const eflGame = filterCandidate(
  cand('BIGGEST UPSET EVER?! | Fleetwood Town v Arsenal Extended Highlights', { channelName: 'EFL' }),
  fleetwoodGame
);
check('matcher: EFL extended highlights keep', eflGame.keep, eflGame.reason);

const manacorGame: GameInput = {
  home: 'CD Manacor', away: 'Villarreal', dateISO: '2026-10-27T20:00:00.000Z',
  league: 'la-liga', homeScore: 0, awayScore: 5, cup: 'copa-del-rey',
};
const rfef = filterCandidate(
  cand('Resumen #CopaDelReyMapfre | CD Manacor 0-5 Villarreal CF | Primera eliminatoria | Temp. 2026/27', { channelName: 'Real Federación Española Fútbol' }),
  manacorGame
);
check('matcher: RFEF Manacor resumen keeps', rfef.keep, rfef.reason);

// ---------- name fallback (club still unregistered) ----------
// A cup opponent nobody has registered yet must degrade to name
// matching instead of a total blackout. 'FC Fictional' is in no
// registry; the game resolves it from the fixture name alone.
const fictionalGame: GameInput = {
  home: 'FC Fictional', away: 'Arsenal', dateISO: '2026-10-27T20:00:00.000Z',
  league: 'premier-league', homeScore: 0, awayScore: 2, cup: 'efl-cup',
};
const fictional = filterCandidate(
  cand('FC Fictional vs Arsenal | Extended Highlights'),
  fictionalGame
);
check('fallback: unregistered club matches by fixture name', fictional.keep, fictional.reason);
const fictionalWrong = filterCandidate(
  cand('Arsenal vs Chelsea | Extended Highlights'),
  fictionalGame
);
check('fallback: wrong teams still rejected', !fictionalWrong.keep && fictionalWrong.reason === 'teams', fictionalWrong.reason);

// National games keep the hard reject for unresolvable names.
const natGame: GameInput = {
  home: 'Narnia', away: 'Israel', dateISO: '2026-10-27T20:00:00.000Z',
  league: 'nations-league', homeScore: 0, awayScore: 2,
};
const nat = filterCandidate(cand('Narnia vs Israel Highlights'), natGame);
check('fallback: national unknown still unknown-team', !nat.keep && nat.reason === 'unknown-team', nat.reason);

console.log(`registry_additions_test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
