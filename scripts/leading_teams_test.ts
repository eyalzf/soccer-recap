/**
 * Leading-teams matcher + registry tests (user feature 2026-10-26):
 * games of the fixed leading-clubs list carry a `competition` slug
 * (lib/competitions.ts); the matcher flips competition logic per game
 * (own competition expected, every other competition — including the
 * carried league pills — contradicts), and every club that can appear
 * in such a game must resolve in the team registry, or the matcher
 * hard-rejects the game as 'unknown-team'.
 *
 * Run: npx -y tsx scripts/leading_teams_test.ts
 */
import { filterCandidate, competitionContradiction } from '../lib/recap/match';
import type { GameInput, RawCandidate } from '../lib/recap/types';
import {
  competitionConfigFor,
  LEAGUE_SEARCH_PLANS,
  LEADING_TEAM_CLUBS,
  CLUB_CHANNELS,
} from '../lib/recap/leaguePlans';
import { COMPETITIONS, competitionDefFor, competitionContradictions } from '../lib/competitions';
import { lookupClubEn } from '../lib/teamIndex';

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra?: string) {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL ${label}${extra ? ` — ${extra}` : ''}`); }
}

const cand = (title: string, publishedAt = '2026-10-26T18:00:00Z'): RawCandidate => ({
  id: 'yt:test',
  title,
  url: 'https://www.youtube.com/watch?v=test',
  source: 'youtube',
  publishedAt,
  durationSec: 300,
  lang: 'en',
});

// --- Per-game competition flip -------------------------------------------
const bayernLeague: GameInput = {
  home: 'Bayern München', away: 'SC Freiburg', dateISO: '2026-10-25T16:30:00.000Z',
  league: 'leading-teams', homeScore: 3, awayScore: 1, competition: 'bundesliga',
};
check(
  'bundesliga title kept for bundesliga game',
  filterCandidate(cand('SC FREIBURG - FC BAYERN | Highlights | Bundesliga'), bayernLeague).keep
);
check(
  'untitled-competition title kept (club channel style)',
  filterCandidate(cand('Upamecano box-to-box STUNNER! | SC Freiburg – FC Bayern München | Highlights Bundesliga'), bayernLeague).keep
);
const serieAForBayern = filterCandidate(cand('Freiburg vs Bayern | Serie A Highlights'), bayernLeague);
check(
  'bundesliga game rejects serie a title',
  !serieAForBayern.keep && serieAForBayern.reason === 'competition'
);
const uclForBayern = filterCandidate(cand('Freiburg vs Bayern | Champions League Highlights'), bayernLeague);
check(
  'bundesliga game rejects champions league title',
  !uclForBayern.keep && uclForBayern.reason === 'competition'
);
const pokalForBayern = filterCandidate(cand('Freiburg vs Bayern | DFB Pokal Highlights'), bayernLeague);
check(
  'bundesliga game rejects dfb-pokal title',
  !pokalForBayern.keep && pokalForBayern.reason === 'competition'
);

const milanEurope: GameInput = {
  home: 'Bournemouth', away: 'AC Milan', dateISO: '2026-10-22T19:00:00.000Z',
  league: 'leading-teams', homeScore: 3, awayScore: 0, competition: 'europa-league',
};
check(
  'europa league title kept for europa game',
  filterCandidate(cand('Highlights Europa League | Bournemouth 3-0 Milan'), milanEurope).keep
);
const uclForMilan = filterCandidate(cand('Bournemouth vs Milan | Champions League Highlights'), milanEurope);
check(
  'europa game rejects champions league title',
  !uclForMilan.keep && uclForMilan.reason === 'competition'
);
const ueclForMilan = filterCandidate(cand('Bournemouth vs Milan | Conference League Highlights'), milanEurope);
check(
  'europa game rejects conference league title',
  !ueclForMilan.keep && ueclForMilan.reason === 'competition'
);

const celticLeague: GameInput = {
  home: 'Hibernian', away: 'Celtic', dateISO: '2026-10-25T15:00:00.000Z',
  league: 'leading-teams', homeScore: 1, awayScore: 2, competition: 'scottish-premiership',
};
check(
  'spfl premiership title kept',
  filterCandidate(cand('Hibernian 1-2 Celtic | HIGHLIGHTS | William Hill Premiership'), celticLeague).keep
);
const plForCeltic = filterCandidate(cand('Hibernian vs Celtic | Premier League Highlights'), celticLeague);
check(
  'scottish game rejects premier league title',
  !plForCeltic.keep && plForCeltic.reason === 'competition'
);

const sportingLeague: GameInput = {
  home: 'Sporting CP', away: 'Académico de Viseu', dateISO: '2026-10-25T20:30:00.000Z',
  league: 'leading-teams', homeScore: 1, awayScore: 2, competition: 'primeira-liga',
};
check(
  'liga portugal title kept',
  filterCandidate(cand('Highlights | Liga Portugal Betclic: Sporting CP 1-2 Académico de Viseu FC'), sportingLeague).keep
);

// Unknown competition slug falls back to the plan safety net: a game
// filed without a valid competition must not match ANY
// competition-named title, but untitled highlights are unaffected here.
const unknownComp: GameInput = { ...bayernLeague, competition: 'no-such-comp' };
check(
  'unknown competition slug: plan safety net vetoes named competitions',
  competitionContradiction('Freiburg vs Bayern | Serie A Highlights', unknownComp) === 'serie a'
);
check(
  'unknown competition slug: untitled title not vetoed',
  competitionContradiction('Freiburg vs Bayern | Highlights', unknownComp) === null
);
check(
  'competitionConfigFor: bundesliga terms present',
  competitionConfigFor(bayernLeague).competitionTerms.includes('bundesliga')
);

// --- Registry sanity ------------------------------------------------------
for (const def of COMPETITIONS) {
  check(`competition ${def.slug}: parent is leading-teams`, def.parent === 'leading-teams');
  const contra = competitionContradictions(def);
  for (const t of def.terms) {
    check(`competition ${def.slug}: own term '${t}' not self-contradicting`, !contra.includes(t));
  }
  check(`competition ${def.slug}: champions league contradicts`, contra.includes('champions league'));
}
check('competitionDefFor unknown slug', competitionDefFor('nope') === null);

// --- Featured clubs: registered + sourced --------------------------------
const plan = LEAGUE_SEARCH_PLANS['leading-teams'];
check('leading-teams plan exists', !!plan);
check('leading-teams fallback is English only', plan.fallbackLangs.length === 1 && plan.fallbackLangs[0] === 'en');
for (const club of LEADING_TEAM_CLUBS) {
  check(`featured club resolves in registry: ${club}`, !!lookupClubEn(club));
  const entry = lookupClubEn(club);
  const scoped = plan.bulk.some((b) =>
    (b.teams ?? []).some((t) => lookupClubEn(t) === entry)
  );
  check(`featured club has a team-scoped source: ${club}`, scoped);
}
check('AC Milan club channel registered', !!CLUB_CHANNELS['AC Milan']);
check(
  'PSG club channel NOT in the leading-teams bulk (magazine format only)',
  !plan.bulk.some((b) => b.handle === 'PSG')
);
check(
  'Bayern club channel NOT in the leading-teams bulk (embed-blocked)',
  !plan.bulk.some((b) => b.handle === 'FCBayern')
);
check(
  'Porto absent from the featured list',
  !LEADING_TEAM_CLUBS.some((c) => c.toLowerCase().includes('porto'))
);
check(
  'PSV absent from the featured list (user exclusion)',
  !LEADING_TEAM_CLUBS.some((c) => c.toLowerCase().includes('psv'))
);

// --- Full rosters resolve under the data spellings the cron writes -------
const ROSTERS: Record<string, string[]> = {
  bundesliga: [
    'Bayern München', 'Borussia Dortmund', 'RB Leipzig', 'Bayer Leverkusen',
    'VfB Stuttgart', 'Eintracht Frankfurt', 'Borussia Mönchengladbach',
    'SC Freiburg', 'TSG Hoffenheim', 'Union Berlin', 'Mainz 05',
    'Werder Bremen', 'FC Augsburg', '1. FC Köln', 'Hamburger SV',
    'Schalke 04', 'SC Paderborn 07', 'SV Elversberg',
  ],
  'serie-a': [
    'Inter', 'AC Milan', 'Juventus', 'Napoli', 'AS Roma', 'Atalanta',
    'Como', 'Fiorentina', 'Lazio', 'Bologna', 'Sassuolo', 'Torino',
    'Genoa', 'Udinese', 'Parma', 'Cagliari', 'Venezia', 'Frosinone',
    'Monza', 'Lecce',
  ],
  'ligue-1': [
    'Paris Saint-Germain', 'Marseille', 'Monaco', 'Lille',
    'Olympique Lyonnais', 'Rennes', 'Nice', 'Strasbourg', 'RC Lens',
    'Brest', 'Toulouse', 'Auxerre', 'Le Havre', 'Angers', 'Lorient',
    'Paris FC', 'Le Mans', 'Troyes',
  ],
  'primeira-liga': [
    'Sporting CP', 'FC Porto', 'Benfica', 'Braga', 'Vitória Guimarães',
    'Famalicão', 'Estoril Praia', 'Alverca', 'Rio Ave', 'Casa Pia',
    'Estrela da Amadora', 'Arouca', 'Gil Vicente', 'Moreirense',
    'Santa Clara', 'Nacional', 'Académico de Viseu', 'Marítimo',
  ],
  eredivisie: [
    'Ajax', 'PSV Eindhoven', 'Feyenoord', 'AZ Alkmaar', 'FC Twente',
    'FC Utrecht', 'NEC Nijmegen', 'SC Heerenveen', 'FC Groningen',
    'Go Ahead Eagles', 'Sparta Rotterdam', 'PEC Zwolle', 'Fortuna Sittard',
    'Excelsior', 'Willem II', 'ADO Den Haag', 'SC Cambuur', 'SC Telstar',
  ],
  'scottish-premiership': [
    'Celtic', 'Rangers', 'Heart of Midlothian', 'Hibernian', 'Aberdeen',
    'Dundee', 'Dundee United', 'Falkirk', 'Kilmarnock', 'Motherwell',
    'St Johnstone', 'St Mirren',
  ],
  'english-cup-opponents': ['Millwall', 'Lincoln City', 'Norwich City'],
};
for (const [league, clubs] of Object.entries(ROSTERS)) {
  for (const club of clubs) {
    check(`roster ${league}: '${club}' resolves`, !!lookupClubEn(club), 'add it to lib/teams.ts');
  }
}

console.log(`\nleading_teams_test: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
