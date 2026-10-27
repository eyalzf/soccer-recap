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

// --- Roma (added 2026-10-27): Serie A in this view, UCL stays in its pill -
const romaLeague: GameInput = {
  home: 'Napoli', away: 'Roma', dateISO: '2026-10-24T16:00:00.000Z',
  league: 'leading-teams', homeScore: 3, awayScore: 3, competition: 'serie-a',
};
check(
  'roma: real serie a highlights title kept',
  filterCandidate(cand('NAPOLI 3-3 ROMA | SERIE A HIGHLIGHTS 2026-27', '2026-10-25T18:00:00Z'), romaLeague).keep
);
const uclForRoma = filterCandidate(cand('NAPOLI 3-3 ROMA | Champions League Highlights', '2026-10-25T18:00:00Z'), romaLeague);
check(
  'roma serie a game rejects champions league title',
  !uclForRoma.keep && uclForRoma.reason === 'competition'
);
const coppaForRoma = filterCandidate(cand('NAPOLI 3-3 ROMA | Coppa Italia Highlights', '2026-10-25T18:00:00Z'), romaLeague);
check(
  'roma serie a game rejects coppa italia title',
  !coppaForRoma.keep && coppaForRoma.reason === 'competition'
);

// --- Inter Miami (added 2026-10-27): MLS + the CONCACAF cup set -----------
const miamiMls: GameInput = {
  home: 'Atlanta United', away: 'Inter Miami CF', dateISO: '2026-10-17T23:30:00.000Z',
  league: 'leading-teams', homeScore: 1, awayScore: 3, competition: 'mls',
};
check(
  'miami mls: club channel title kept',
  filterCandidate(cand('HIGHLIGHTS | Atlanta United FC vs Inter Miami CF', '2026-10-18T18:00:00Z'), miamiMls).keep
);
const leaguesCupForMls = filterCandidate(cand('HIGHLIGHTS | Atlanta United FC vs Inter Miami CF | Leagues Cup', '2026-10-18T18:00:00Z'), miamiMls);
check(
  'miami mls game rejects leagues cup title',
  !leaguesCupForMls.keep && leaguesCupForMls.reason === 'competition'
);
const campeonesForMls = filterCandidate(cand('Atlanta United FC vs Inter Miami CF | Campeones Cup Highlights', '2026-10-18T18:00:00Z'), miamiMls);
check(
  'miami mls game rejects campeones cup title',
  !campeonesForMls.keep && campeonesForMls.reason === 'competition'
);

const miamiRbny: GameInput = {
  home: 'New York Red Bulls', away: 'Inter Miami CF', dateISO: '2026-10-24T21:30:00.000Z',
  league: 'leading-teams', homeScore: 2, awayScore: 0, competition: 'mls',
};
check(
  'miami mls: @MLS league-channel title kept',
  filterCandidate(cand('New York Red Bulls vs. Inter Miami CF | Full Match Highlights | Messi in New York!', '2026-10-25T18:00:00Z'), miamiRbny).keep
);

const miamiChampionsCup: GameInput = {
  home: 'Inter Miami CF', away: 'Monterrey', dateISO: '2027-02-17T01:00:00.000Z',
  league: 'leading-teams', homeScore: null, awayScore: null, competition: 'concacaf-champions-cup',
};
check(
  'miami champions cup: concacaf title kept',
  filterCandidate(cand('Inter Miami vs Monterrey | Concacaf Champions Cup Highlights', '2027-02-18T18:00:00Z'), miamiChampionsCup).keep
);
const uclForChampionsCup = filterCandidate(cand('Inter Miami vs Monterrey | Champions League Highlights', '2027-02-18T18:00:00Z'), miamiChampionsCup);
check(
  'champions cup game rejects champions league title',
  !uclForChampionsCup.keep && uclForChampionsCup.reason === 'competition'
);
const mlsForChampionsCup = filterCandidate(cand('Inter Miami vs Monterrey | MLS Highlights', '2027-02-18T18:00:00Z'), miamiChampionsCup);
check(
  'champions cup game rejects mls title',
  !mlsForChampionsCup.keep && mlsForChampionsCup.reason === 'competition'
);

const miamiCampeones: GameInput = {
  home: 'Inter Miami CF', away: 'Cruz Azul', dateISO: '2026-09-17T00:00:00.000Z',
  league: 'leading-teams', homeScore: 2, awayScore: 0, competition: 'campeones-cup',
};
check(
  'miami campeones: real club-channel title kept',
  filterCandidate(cand('HIGHLIGHTS | Inter Miami CF vs Cruz Azul (Campeones Cup)', '2026-09-18T18:00:00Z'), miamiCampeones).keep
);
const leaguesCupForCampeones = filterCandidate(cand('HIGHLIGHTS | Inter Miami CF vs Cruz Azul (Leagues Cup)', '2026-09-18T18:00:00Z'), miamiCampeones);
check(
  'campeones game rejects leagues cup title',
  !leaguesCupForCampeones.keep && leaguesCupForCampeones.reason === 'competition'
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
check('Inter Miami club channel registered', !!CLUB_CHANNELS['Inter Miami CF']);
check(
  'leading-teams bulk includes the Roma club channel',
  plan.bulk.some((b) => b.handle === 'ASRoma')
);
check(
  'leading-teams bulk includes the MLS league channel for Miami',
  plan.bulk.some((b) => b.handle === 'MLS' && (b.teams ?? []).includes('Inter Miami CF'))
);
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
  mls: [
    'Inter Miami CF', 'Atlanta United', 'Austin FC', 'Charlotte FC',
    'Chicago Fire FC', 'Colorado Rapids', 'Columbus Crew', 'D.C. United',
    'FC Cincinnati', 'FC Dallas', 'Houston Dynamo FC', 'LA Galaxy',
    'Los Angeles FC', 'Minnesota United', 'CF Montréal', 'Nashville SC',
    'New England Revolution', 'New York City FC', 'New York Red Bulls',
    'Orlando City', 'Philadelphia Union', 'Portland Timbers',
    'Real Salt Lake', 'San Jose Earthquakes', 'Seattle Sounders FC',
    'Sporting Kansas City', 'St. Louis CITY SC', 'Toronto FC',
    'Vancouver Whitecaps FC', 'San Diego FC',
  ],
  'liga-mx': [
    'Club América', 'Atlas', 'Atlético San Luis', 'Cruz Azul',
    'Guadalajara', 'FC Juárez', 'León', 'Mazatlán', 'Monterrey',
    'Necaxa', 'Pachuca', 'Puebla', 'Pumas UNAM', 'Querétaro',
    'Santos Laguna', 'Tigres UANL', 'Tijuana', 'Toluca',
  ],
  'concacaf-others': [
    'Alajuelense', 'Saprissa', 'Herediano', 'Olimpia', 'Motagua',
    'Real España', 'Comunicaciones', 'Municipal', 'Forge FC',
    'Cavalry FC', 'Atlético Ottawa', 'Alianza', 'Independiente',
    'Tauro', 'Mount Pleasant', 'Cavalier', 'Defence Force',
  ],
};
for (const [league, clubs] of Object.entries(ROSTERS)) {
  for (const club of clubs) {
    check(`roster ${league}: '${club}' resolves`, !!lookupClubEn(club), 'add it to lib/teams.ts');
  }
}

console.log(`\nleading_teams_test: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
