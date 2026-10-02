/**
 * Zero-quota unit test for the channel-candidate aggregation
 * (lib/recap/channelCandidates.ts). Run: npx tsx scripts/channel_candidates_test.ts
 */
import {
  aggregateCandidates,
  CANDIDATE_HIT_THRESHOLD,
  type ChannelOpsState,
} from '../lib/recap/channelCandidates';
import type { SearchLogDay } from '../lib/recap/searchLog';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log(`ok   ${name}`);
  else {
    failures += 1;
    console.log(`FAIL ${name}`, extra ?? '');
  }
};

const ch = (v: string, chName: string, chId: string | undefined, t: string) => ({
  v,
  ch: chName,
  chId,
  tier: 'general' as const,
  t,
});

const entry = (
  league: string,
  home: string,
  away: string,
  channels: ReturnType<typeof ch>[]
): SearchLogDay => ({
  day: '2026-09-30',
  entries: [
    {
      t: Date.now(),
      home,
      away,
      league,
      date: '2026-09-29T18:45:00.000Z',
      winner: 'general' as const,
      preferred: { ran: 0, kept: 0 },
      bulk: { ran: 1, kept: 0 },
      general: { ran: 1, kept: channels.length },
      channels,
      results: channels.length,
      rateLimited: false,
    },
  ],
});

const emptyOps = (): ChannelOpsState => ({ discarded: [], pending: [], added: [] });

// 1. Threshold: 3+ hits surface, 2 do not.
{
  const days = [
    entry('nations-league', 'Austria', 'Israel', [ch('v1', 'Some Channel', 'UCAAA', 'Austria vs Israel highlights')]),
    entry('nations-league', 'Serbia', 'Greece', [ch('v2', 'Some Channel', 'UCAAA', 'Serbia vs Greece highlights')]),
    entry('nations-league', 'Spain', 'Italy', [ch('v3', 'Some Channel', 'UCAAA', 'Spain vs Italy highlights')]),
    entry('nations-league', 'France', 'Portugal', [ch('v4', 'Tiny Channel', 'UCBBB', 'x'), ch('v5', 'Tiny Channel', 'UCBBB', 'y')]),
  ];
  const res = aggregateCandidates(days, emptyOps());
  check('3-hit channel surfaces', res.candidates.some((c) => c.channelId === 'UCAAA'));
  check('2-hit channel hidden', !res.candidates.some((c) => c.channelId === 'UCBBB'));
}

// 2. Already-curated channels are excluded (Hull City was just added to PL bulk).
{
  const days = [
    entry('premier-league', 'Newcastle United', 'Hull City', [ch('v1', 'Hull City', undefined, 't1')]),
    entry('premier-league', 'Hull City', 'Chelsea', [ch('v2', 'Hull City', undefined, 't2')]),
    entry('premier-league', 'Arsenal', 'Hull City', [ch('v3', 'Hull City', undefined, 't3')]),
  ];
  const res = aggregateCandidates(days, emptyOps());
  check('curated Hull City excluded', !res.candidates.some((c) => c.channel === 'Hull City'));
}

// 3. Team-scope inference: all games involve Hull City -> team-scoped.
{
  const days = [
    entry('premier-league', 'Newcastle United', 'Hull City', [ch('v1', 'Tigers TV', 'UCCCC', 't1')]),
    entry('premier-league', 'Hull City', 'Chelsea', [ch('v2', 'Tigers TV', 'UCCCC', 't2')]),
    entry('premier-league', 'Arsenal', 'Hull City', [ch('v3', 'Tigers TV', 'UCCCC', 't3')]),
  ];
  const res = aggregateCandidates(days, emptyOps());
  const c = res.candidates.find((x) => x.channelId === 'UCCCC');
  check('team scope inferred', !!c && c.scope.teams?.length === 1 && c.scope.teams[0] === 'Hull City', c?.scope);
}

// 4. League-wide scope when games involve different teams.
{
  const days = [
    entry('nations-league', 'Austria', 'Israel', [ch('v1', 'Wide Channel', 'UCDDD', 't1')]),
    entry('nations-league', 'Serbia', 'Greece', [ch('v2', 'Wide Channel', 'UCDDD', 't2')]),
    entry('nations-league', 'Spain', 'Italy', [ch('v3', 'Wide Channel', 'UCDDD', 't3')]),
  ];
  const res = aggregateCandidates(days, emptyOps());
  const c = res.candidates.find((x) => x.channelId === 'UCDDD');
  check('league-wide scope inferred', !!c && !c.scope.teams, c?.scope);
}

// 5. Discard zeroes the count; re-surfaces after +3 new hits.
{
  const mk = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      entry('nations-league', `Home${i}`, `Away${i}`, [ch(`v${i}`, 'Spammy', 'UCEEE', `t${i}`)])
    );
  const key = 'nations-league::UCEEE';
  const discarded: ChannelOpsState = {
    ...emptyOps(),
    discarded: [{ key, channel: 'Spammy', channelId: 'UCEEE', league: 'nations-league', t: 1, countAtDiscard: 3 }],
  };
  check('discarded stays hidden below threshold', aggregateCandidates(mk(3), discarded).candidates.length === 0);
  check(
    'discarded re-surfaces at +3',
    aggregateCandidates(mk(6), discarded).candidates.some((c) => c.channelId === 'UCEEE')
  );
  check(
    'threshold constant is 3',
    CANDIDATE_HIT_THRESHOLD === 3
  );
}

// 6. Preferred/bulk tier wins never become candidates.
{
  const days: SearchLogDay[] = [
    {
      day: '2026-09-30',
      entries: [
        {
          t: Date.now(),
          home: 'A',
          away: 'B',
          league: 'la-liga',
          date: '2026-09-29T18:45:00.000Z',
          winner: 'preferred',
          preferred: { ran: 1, kept: 3 },
          bulk: { ran: 0, kept: 0 },
          general: { ran: 0, kept: 0 },
          channels: [0, 1, 2].map((i) => ({ ...ch(`v${i}`, 'ONE', undefined, `t${i}`), tier: 'preferred' as const })),
          results: 3,
          rateLimited: false,
        },
      ],
    },
  ];
  const res = aggregateCandidates(days, emptyOps());
  check('preferred-tier channels ignored', res.candidates.length === 0);
}

// 7. Dominant-team scope: 3 of 4 wins involve Germany (75%, not unanimous).
{
  const days = [
    entry('nations-league', 'Germany', 'France', [ch('v1', 'DFB Fan TV', 'UCFFF', 't1')]),
    entry('nations-league', 'Germany', 'Spain', [ch('v2', 'DFB Fan TV', 'UCFFF', 't2')]),
    entry('nations-league', 'Italy', 'Germany', [ch('v3', 'DFB Fan TV', 'UCFFF', 't3')]),
    entry('nations-league', 'France', 'Spain', [ch('v4', 'DFB Fan TV', 'UCFFF', 't4')]),
  ];
  const res = aggregateCandidates(days, emptyOps());
  const c = res.candidates.find((x) => x.channelId === 'UCFFF');
  check('dominant team scope suggested', !!c && c.scope.teams?.length === 1 && c.scope.teams[0] === 'Germany', c?.scope);
  check(
    'teamWins counts games per team',
    !!c && c.teamWins[0].team === 'Germany' && c.teamWins[0].games === 3,
    c?.teamWins
  );
}

// 8. Top-pair scope: Germany+Netherlands jointly cover 6 of 7 wins (86%).
{
  const days = [
    entry('nations-league', 'Germany', 'France', [ch('v1', 'Dual TV', 'UCGGG', 't1')]),
    entry('nations-league', 'Germany', 'Spain', [ch('v2', 'Dual TV', 'UCGGG', 't2')]),
    entry('nations-league', 'Netherlands', 'France', [ch('v3', 'Dual TV', 'UCGGG', 't3')]),
    entry('nations-league', 'Netherlands', 'Spain', [ch('v4', 'Dual TV', 'UCGGG', 't4')]),
    entry('nations-league', 'Germany', 'Netherlands', [ch('v5', 'Dual TV', 'UCGGG', 't5')]),
    entry('nations-league', 'Italy', 'Spain', [ch('v6', 'Dual TV', 'UCGGG', 't6')]),
    entry('nations-league', 'Germany', 'Italy', [ch('v7', 'Dual TV', 'UCGGG', 't7')]),
  ];
  const res = aggregateCandidates(days, emptyOps());
  const c = res.candidates.find((x) => x.channelId === 'UCGGG');
  check(
    'top-pair scope suggested',
    !!c && c.scope.teams?.length === 2 && c.scope.teams.includes('Germany') && c.scope.teams.includes('Netherlands'),
    c?.scope
  );
}

// 9. Single game (3 hits, 1 game) never suggests team scope.
{
  const days = [
    entry('nations-league', 'Germany', 'France', [
      ch('v1', 'One Game TV', 'UCHHH', 't1'),
      ch('v2', 'One Game TV', 'UCHHH', 't2'),
      ch('v3', 'One Game TV', 'UCHHH', 't3'),
    ]),
  ];
  const res = aggregateCandidates(days, emptyOps());
  const c = res.candidates.find((x) => x.channelId === 'UCHHH');
  check('single game stays league-wide', !!c && !c.scope.teams, c?.scope);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
