/**
 * Zero-quota unit test for the noise-channel proposal aggregation
 * (lib/recap/channelStats.ts aggregateNoiseProposals) over the search
 * log's per-entry rejection tallies (searchLog.ts RejectedChannel).
 * Run: npx tsx scripts/noise_proposals_test.ts
 */
import {
  aggregateNoiseProposals,
  NOISE_MIN_FILTERED,
  NOISE_MIN_GAMES,
} from '../lib/recap/channelStats';
import type { DenySet } from '../lib/recap/denyList';
import type {
  KeptChannel,
  RejectedChannel,
  SearchLogDay,
  SearchLogEntry,
} from '../lib/recap/searchLog';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log(`ok   ${name}`);
  else {
    failures += 1;
    console.log(`FAIL ${name}`, extra ?? '');
  }
};

const kc = (
  v: string,
  chName: string,
  chId: string | undefined,
  tier: KeptChannel['tier'],
  t: string
): KeptChannel => ({ v, ch: chName, chId, tier, t });

const rj = (
  chName: string,
  chId: string | undefined,
  reasons: Record<string, number>,
  samples: string[] = []
): RejectedChannel => ({
  ch: chName,
  chId,
  n: Object.values(reasons).reduce((a, b) => a + b, 0),
  reasons,
  samples,
});

let seq = 0;
const entry = (
  league: string,
  home: string,
  away: string,
  date: string,
  opts: {
    channels?: KeptChannel[];
    rejected?: RejectedChannel[];
    t?: number;
    cached?: boolean;
  } = {}
): SearchLogEntry => ({
  t: opts.t ?? 1_700_000_000_000 + seq++ * 1000,
  home,
  away,
  league,
  date,
  cached: opts.cached,
  winner: 'general',
  preferred: { ran: 0, kept: 0 },
  bulk: { ran: 1, kept: opts.channels?.length ?? 0 },
  general: { ran: 1, kept: 0 },
  channels: opts.channels,
  rejected: opts.rejected,
  results: opts.channels?.length ?? 0,
  rateLimited: false,
});

const day = (entries: SearchLogEntry[]): SearchLogDay => ({
  day: '2026-10-12',
  entries,
});

const G = (i: number) => `2026-10-${String(10 + (i % 3)).padStart(2, '0')}T1${i}:00:00.000Z`;
const TEAMS: Array<[string, string]> = [
  ['Arsenal', 'Chelsea'],
  ['Liverpool', 'Everton'],
  ['Real Madrid', 'Sevilla'],
  ['Barcelona', 'Valencia'],
  ['Arsenal', 'Liverpool'],
  ['Chelsea', 'Everton'],
];

/** Entries spreading one channel's rejections over `games` distinct games. */
const spread = (
  chName: string,
  chId: string | undefined,
  games: number,
  reasons: Record<string, number>,
  samples: string[] = []
): SearchLogEntry[] =>
  Array.from({ length: games }, (_, i) =>
    entry('premier-league', TEAMS[i][0], TEAMS[i][1], G(i), {
      rejected: [rj(chName, chId, reasons, samples)],
      t: 1_700_000_000_000 + i * 10_000,
    })
  );

// 0. Exported thresholds are the user-approved conservative values.
check('NOISE_MIN_FILTERED is 10', NOISE_MIN_FILTERED === 10);
check('NOISE_MIN_GAMES is 4', NOISE_MIN_GAMES === 4);

// 1. Qualifier: 12 content-filtered over 4 games, 0 kept -> proposal with
//    reason breakdown summing to `filtered`, samples capped at 3,
//    lastSeen = latest entry time. A cached entry carrying tallies is
//    ignored (cache hits run no tier).
{
  const entries = spread('Noise Channel', 'UCNOISE', 4, { teams: 2, 'too-long': 1 }, [
    'Arsenal vs Chelsea prediction',
    'Arsenal vs Chelsea betting tips',
  ]);
  entries.push(
    entry('premier-league', 'Arsenal', 'Chelsea', G(0), {
      cached: true,
      rejected: [rj('Noise Channel', 'UCNOISE', { teams: 99 })],
    })
  );
  const props = aggregateNoiseProposals([day(entries)]);
  check('qualifier: exactly one proposal', props.length === 1, props);
  const p = props[0];
  check('qualifier: channel + id', p.channel === 'Noise Channel' && p.channelId === 'UCNOISE');
  check('qualifier: filtered = 12 (cached entry ignored)', p.filtered === 12, p.filtered);
  check('qualifier: games = 4', p.games === 4, p.games);
  check(
    'qualifier: reason breakdown sums to filtered',
    p.reasons.reduce((a, r) => a + r.count, 0) === p.filtered,
    p.reasons
  );
  check(
    'qualifier: reasons sorted desc (teams 8, too-long 4)',
    p.reasons.length === 2 && p.reasons[0].reason === 'teams' && p.reasons[0].count === 8 &&
      p.reasons[1].reason === 'too-long' && p.reasons[1].count === 4,
    p.reasons
  );
  check('qualifier: samples capped at 3', p.sampleTitles.length === 3, p.sampleTitles);
  check('qualifier: key is channelId', p.key === 'UCNOISE');
  check(
    'qualifier: lastSeen is the latest contributing entry',
    p.lastSeen === 1_700_000_000_000 + 3 * 10_000,
    p.lastSeen
  );
}

// 2. Threshold edge: 9 filtered over 5 games -> excluded.
//    (Four games contribute 2 each, the fifth contributes 1.)
{
  const fixtures = spread('Nine Lives', 'UCNINE', 5, { teams: 1, excluded: 1 });
  fixtures[0] = entry('premier-league', TEAMS[0][0], TEAMS[0][1], G(0), {
    rejected: [rj('Nine Lives', 'UCNINE', { teams: 1 })],
  });
  const nine = aggregateNoiseProposals([day(fixtures)]);
  check('edge: 9 filtered over 5 games excluded', nine.length === 0, nine);
}

// 3. Threshold edge: 12 filtered but only 3 games -> excluded.
{
  const props = aggregateNoiseProposals([
    day(spread('Few Games', 'UCFEW', 3, { teams: 4 })),
  ]);
  check('edge: 12 filtered / 3 games excluded', props.length === 0, props);
}

// 4. Zero-kept rule: 50 filtered over 6 games but ONE kept result (any
//    tier) anywhere in the window -> excluded outright.
{
  const entries = spread('Busy Channel', 'UCBUSY', 6, { teams: 5, competition: 4 });
  entries.push(
    entry('la-liga', 'Real Madrid', 'Sevilla', G(1), {
      channels: [kc('v1', 'Busy Channel', 'UCBUSY', 'bulk', 'Real Madrid vs Sevilla highlights')],
    })
  );
  const props = aggregateNoiseProposals([day(entries)]);
  check('zero-kept: 1 kept result excludes despite 54 filtered', props.length === 0, props);
}

// 5. Playability reasons are not content: 30 playability rejections +
//    3 content over 5 games -> excluded (content total is what counts).
{
  const props = aggregateNoiseProposals([
    day(
      spread('Embed Farms', 'UCEMBED', 5, {
        'not-embeddable': 4,
        'region-blocked': 2,
        teams: 1,
      }).map((e, i) =>
        i < 2
          ? entry('premier-league', TEAMS[i][0], TEAMS[i][1], G(i), {
              rejected: [
                rj('Embed Farms', 'UCEMBED', { 'not-embeddable': 4, 'region-blocked': 2 }),
              ],
            })
          : e
      )
    ),
  ]);
  check('playability: only-teams-in-3-of-5 -> content 3, excluded', props.length === 0, props);
  const pure = aggregateNoiseProposals([
    day(spread('Dead Air', 'UCDEAD', 6, { 'not-embeddable': 3, 'region-blocked': 3 })),
  ]);
  check('playability: pure playability rejections never qualify', pure.length === 0, pure);
}

// 6. 'deny-listed' and 'unknown-team' are not counted either.
{
  const dl = aggregateNoiseProposals([
    day(spread('Already Gone', 'UCGONE', 5, { 'deny-listed': 4 })),
  ]);
  check('deny-listed rejections do not count', dl.length === 0, dl);
  const ut = aggregateNoiseProposals([
    day(spread('Mystery', 'UCMYST', 4, { 'unknown-team': 4 })),
  ]);
  check('unknown-team rejections do not count', ut.length === 0, ut);
}

// 7. Curated (in-plan) channel excluded even with 0 kept and big counts:
//    SPORTS EXTRA sits in league plans (matched by title identity).
{
  const props = aggregateNoiseProposals([
    day(spread('SPORTS EXTRA', 'UCSPAM', 5, { teams: 3 })),
  ]);
  check('in-plan channel excluded', props.length === 0, props);
}

// 8. Already deny-listed channel excluded (matched by channelId).
{
  const deny: DenySet = { ids: new Set(['UCDENIED']), handles: new Set() };
  const props = aggregateNoiseProposals(
    [day(spread('Blocked Noise', 'UCDENIED', 4, { teams: 3 }))],
    deny
  );
  check('already-denied channel excluded', props.length === 0, props);
  // …and without the deny set the same fixture DOES qualify (control).
  const control = aggregateNoiseProposals([
    day(spread('Blocked Noise', 'UCDENIED', 4, { teams: 3 })),
  ]);
  check('control: same fixture qualifies without deny set', control.length === 1, control);
}

// 9. Title-keyed channel (no channelId): exactly at both thresholds ->
//    included, keyed by normalized title.
{
  const entries = [
    entry('premier-league', 'Arsenal', 'Chelsea', G(0), {
      rejected: [rj('Noise Tube', undefined, { teams: 3 })],
    }),
    entry('premier-league', 'Liverpool', 'Everton', G(1), {
      rejected: [rj('Noise Tube', undefined, { teams: 3 })],
    }),
    entry('premier-league', 'Real Madrid', 'Sevilla', G(2), {
      rejected: [rj('Noise Tube', undefined, { excluded: 2 })],
    }),
    entry('premier-league', 'Barcelona', 'Valencia', G(3), {
      rejected: [rj('Noise Tube', undefined, { excluded: 2 })],
    }),
  ];
  const props = aggregateNoiseProposals([day(entries)]);
  check('title-keyed: qualifies at exactly 10 filtered / 4 games', props.length === 1, props);
  check(
    'title-keyed: key + totals',
    props[0]?.key === 't:noisetube' && props[0]?.filtered === 10 && props[0]?.games === 4,
    props[0]
  );
}

// 10. Entries without `rejected` (old log days) and without `channels`
//     are tolerated; a fabricated entry's tallies survive a JSON
//     round-trip (as they do through Blob) into the aggregation.
{
  const bare = entry('premier-league', 'Arsenal', 'Chelsea', G(0), {});
  delete (bare as Partial<SearchLogEntry>).rejected;
  delete (bare as Partial<SearchLogEntry>).channels;
  const rich = entry('premier-league', 'Liverpool', 'Everton', G(1), {
    rejected: [rj('Round Trip', 'UCRT', { teams: 11, date: 2 }, ['x vs y full match'])],
  });
  const rt = JSON.parse(JSON.stringify(rich)) as SearchLogEntry;
  const props = aggregateNoiseProposals([day([bare, rt])]);
  check(
    'round-trip: old entries tolerated, tally survives JSON',
    props.length === 0, // only 1 game — below NOISE_MIN_GAMES
    props
  );
  const more = [rt];
  for (let i = 2; i < 5; i++) {
    more.push(
      entry('premier-league', TEAMS[i][0], TEAMS[i][1], G(i), {
        rejected: [rj('Round Trip', 'UCRT', { teams: 1 })],
      })
    );
  }
  const props2 = aggregateNoiseProposals([day(more)]);
  check(
    'round-trip: qualifies once spread over 4 games',
    props2.length === 1 && props2[0].filtered === 16 && props2[0].games === 4,
    props2
  );
}

// 11. Sort order: higher filtered first.
{
  const a = spread('Loud Noise', 'UCLOUD', 5, { teams: 4 }); // 20
  const b = spread('Quiet Noise', 'UCQUIET', 4, { teams: 3 }); // 12
  const props = aggregateNoiseProposals([day([...b, ...a])]);
  check(
    'sort: filtered desc',
    props.length === 2 && props[0].channel === 'Loud Noise' && props[1].channel === 'Quiet Noise',
    props.map((p) => p.channel)
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
