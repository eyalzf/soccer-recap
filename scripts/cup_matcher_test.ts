/**
 * Cup-game matcher tests (user decision 2026-10-26): cup ties live in
 * their parent league's listing with a `cup` slug on the game. The
 * matcher must flip its competition logic for them: the game's own
 * cup terms are expected, the parent league and sibling cups are
 * contradictions — and the reverse for league games, so a league
 * fixture and a cup tie between the same pair in the same week
 * never cross-match.
 *
 * Run: npx -y tsx scripts/cup_matcher_test.ts
 */
import { filterCandidate, competitionContradiction } from '../lib/recap/match';
import type { GameInput } from '../lib/recap/types';
import type { RawCandidate } from '../lib/recap/types';
import { competitionConfigFor } from '../lib/recap/leaguePlans';
import { CUPS } from '../lib/cups';

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra?: string) {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL ${label}${extra ? ` — ${extra}` : ''}`); }
}

const cand = (title: string, publishedAt = '2026-10-25T18:00:00Z'): RawCandidate => ({
  id: 'yt:test',
  title,
  url: 'https://www.youtube.com/watch?v=test',
  source: 'youtube',
  publishedAt,
  durationSec: 300,
  lang: 'en',
});

const faCup: GameInput = {
  home: 'Arsenal', away: 'Chelsea', dateISO: '2026-10-25T15:00:00.000Z',
  league: 'premier-league', homeScore: 2, awayScore: 1, cup: 'fa-cup',
};
const leagueGame: GameInput = {
  home: 'Arsenal', away: 'Chelsea', dateISO: '2026-10-25T15:00:00.000Z',
  league: 'premier-league', homeScore: 2, awayScore: 1,
};
const eflCup: GameInput = {
  home: 'Liverpool', away: 'Everton', dateISO: '2026-10-27T19:45:00.000Z',
  league: 'premier-league', homeScore: 3, awayScore: 0, cup: 'efl-cup',
};
const copaGame: GameInput = {
  home: 'Real Madrid', away: 'Barcelona', dateISO: '2026-10-28T20:00:00.000Z',
  league: 'la-liga', homeScore: 1, awayScore: 1, cup: 'copa-del-rey',
};
const stateCup: GameInput = {
  home: 'Maccabi Haifa', away: 'Maccabi Tel Aviv', dateISO: '2026-12-20T18:00:00.000Z',
  league: 'israeli-league', homeScore: 2, awayScore: 0, cup: 'state-cup',
};

// FA Cup game: own cup OK, league + sibling cup rejected.
check('fa cup title kept', filterCandidate(cand('Arsenal vs Chelsea | FA Cup Highlights'), faCup).keep);
check('fa cup he title kept', filterCandidate(cand('תקציר: ארסנל – צ\'לסי | גביע אנגלי'), faCup).keep);
const plForFa = filterCandidate(cand('Arsenal vs Chelsea | Premier League Highlights'), faCup);
check('fa cup game rejects league title', !plForFa.keep && plForFa.reason === 'competition');
const carabaoForFa = filterCandidate(cand('Arsenal vs Chelsea | Carabao Cup Highlights'), faCup);
check('fa cup game rejects sibling cup title', !carabaoForFa.keep && carabaoForFa.reason === 'competition');
// League game: the mirror image (already true via plan, pinned so the
// flip can never break the league side).
const faForLeague = filterCandidate(cand('Arsenal vs Chelsea | FA Cup Highlights'), leagueGame);
check('league game still rejects fa cup title', !faForLeague.keep && faForLeague.reason === 'competition');
check('league game keeps league title', filterCandidate(cand('Arsenal vs Chelsea | Premier League Highlights'), leagueGame).keep);
// EFL Cup: carabao OK, fa cup rejected.
check('efl cup title kept', filterCandidate(cand('Liverpool vs Everton | Carabao Cup Highlights'), eflCup).keep);
const faForEfl = filterCandidate(cand('Liverpool vs Everton | FA Cup Highlights'), eflCup);
check('efl cup game rejects fa cup title', !faForEfl.keep && faForEfl.reason === 'competition');
// Copa del Rey: own cup OK, la liga + supercopa rejected.
check('copa title kept', filterCandidate(cand('Real Madrid vs Barcelona | Copa del Rey Highlights'), copaGame).keep);
const ligaForCopa = filterCandidate(cand('Real Madrid vs Barcelona | La Liga Highlights'), copaGame);
check('copa game rejects la liga title', !ligaForCopa.keep && ligaForCopa.reason === 'competition');
const superForCopa = filterCandidate(cand('Real Madrid vs Barcelona | Supercopa Highlights'), copaGame);
check('copa game rejects supercopa title', !superForCopa.keep && superForCopa.reason === 'competition');
// State Cup (Hebrew): own cup OK, league + toto rejected.
check('state cup title kept', filterCandidate(cand('תקציר: מכבי חיפה – מכבי תל אביב | גביע המדינה', '2026-12-20T20:30:00Z'), stateCup).keep);
const ligaForState = filterCandidate(cand('תקציר: מכבי חיפה – מכבי תל אביב | ליגת העל', '2026-12-20T20:30:00Z'), stateCup);
check('state cup game rejects league title', !ligaForState.keep && ligaForState.reason === 'competition');
const totoForState = filterCandidate(cand('תקציר: מכבי חיפה – מכבי תל אביב | גביע הטוטו', '2026-12-20T20:30:00Z'), stateCup);
check('state cup game rejects toto title', !totoForState.keep && totoForState.reason === 'competition');

// Registry sanity: every cup's parent league exists in the plans,
// its terms never contradict themselves, and the parent plan's
// contradictions already contain at least one of its terms (so
// league games keep rejecting cup titles).
for (const cup of Object.values(CUPS)) {
  check(`cup ${cup.slug} parent plan exists`, competitionConfigFor({ league: cup.parentLeague }).competitionTerms.length > 0);
  const selfContra = cup.competitionTerms.some((t) => cup.contradictions.includes(t));
  check(`cup ${cup.slug} terms do not self-contradict`, !selfContra);
  const parentContra = competitionConfigFor({ league: cup.parentLeague }).contradictions;
  check(`cup ${cup.slug} terms rejected by parent league plan`, cup.competitionTerms.some((t) => parentContra.includes(t)));
}
// Unknown cup slug falls back to the parent league's config (never
// crashes the matcher on a typo in data).
check('unknown cup falls back to league config', competitionConfigFor({ league: 'premier-league', cup: 'no-such-cup' }).contradictions.includes('fa cup'));
check('legacy string caller still works', competitionContradiction('Arsenal vs Chelsea | FA Cup Highlights', 'premier-league') === 'fa cup');
check('cup-aware caller works', competitionContradiction('Arsenal vs Chelsea | FA Cup Highlights', faCup) === null);

console.log(`cup_matcher_test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
