/**
 * Zero-quota unit test for the deny list + sweep proposal logic
 * (lib/recap/denyList.ts, lib/recap/sweep.ts, and the deny-list check in
 * filterCandidate). Run: npx tsx scripts/deny_list_test.ts
 */
import {
  dropDeniedCandidates,
  isDeniedChannel,
  isDeniedPlanEntry,
  normHandle,
  type DenySet,
} from '../lib/recap/denyList';
import {
  denyCriterion,
  DENY_DISCARD_RESURFACE,
  mergeProposals,
  type ChannelDeathStats,
  type SweepProposal,
} from '../lib/recap/sweep';
import { filterCandidate } from '../lib/recap/match';
import type { RawCandidate } from '../lib/recap/types';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log(`ok   ${name}`);
  else {
    failures += 1;
    console.log(`FAIL ${name}`, extra ?? '');
  }
};

const denySet = (): DenySet => ({
  ids: new Set(['UCBADCHANNEL']),
  handles: new Set(['badhandle']),
});

// 1. Handle normalization.
check('normHandle strips @ and lowercases', normHandle('@BadHandle ') === 'badhandle');

// 2. Deny matching.
check(
  'deny match by channelId',
  isDeniedChannel({ channelId: 'UCBADCHANNEL', channelHandle: null }, denySet())
);
check(
  'deny match by handle (@ and case variants)',
  isDeniedChannel({ channelId: 'UCOTHER', channelHandle: '@BadHandle' }, denySet())
);
check(
  'no match for clean channel',
  !isDeniedChannel({ channelId: 'UCCLEAN', channelHandle: '@clean' }, denySet())
);
check(
  'plan entry matched by handle only',
  isDeniedPlanEntry({ handle: 'badhandle' }, denySet())
);
check(
  'plan entry not matched when clean',
  !isDeniedPlanEntry({ handle: 'someother', channelId: 'UCX' }, denySet())
);

// 3. Proposal criteria.
check('3 dead -> volume', denyCriterion({ dead: 3, total: 20 }) === 'volume');
check('2 dead of 3 (66%) -> rate', denyCriterion({ dead: 2, total: 3 }) === 'rate');
check('2 dead of 10 (20%) -> none', denyCriterion({ dead: 2, total: 10 }) === null);
check('1 dead -> none', denyCriterion({ dead: 1, total: 1 }) === null);
check('0 dead -> none', denyCriterion({ dead: 0, total: 5 }) === null);

// 4. mergeProposals.
const stats = (
  channel: string,
  dead: number,
  total: number,
  channelId?: string
): ChannelDeathStats => ({
  channel,
  channelId,
  dead,
  total,
  sampleTitles: ['t'],
  games: ['g'],
  inPlans: [],
});

{
  // New qualifier becomes pending.
  const out = mergeProposals([], [stats('Bad', 4, 10, 'UC1')]);
  check('new qualifier -> pending', out.length === 1 && out[0].status === 'pending');
}
{
  // Pending refreshes counts.
  const prev: SweepProposal[] = [
    {
      ...stats('Bad', 3, 10, 'UC1'),
      criterion: 'volume',
      status: 'pending',
      deadAtProposal: 3,
    },
  ];
  const out = mergeProposals(prev, [stats('Bad', 5, 12, 'UC1')]);
  check('pending refreshes', out.length === 1 && out[0].dead === 5);
}
{
  // Denied stays denied even as deaths grow.
  const prev: SweepProposal[] = [
    {
      ...stats('Bad', 3, 10, 'UC1'),
      criterion: 'volume',
      status: 'denied',
      deadAtProposal: 3,
      deniedAt: 1,
    },
  ];
  const out = mergeProposals(prev, [stats('Bad', 8, 15, 'UC1')]);
  check('denied stays denied', out.length === 1 && out[0].status === 'denied');
}
{
  // Discarded: +1 new death stays hidden, +2 re-surfaces.
  const prev: SweepProposal[] = [
    {
      ...stats('Bad', 3, 10, 'UC1'),
      criterion: 'volume',
      status: 'discarded',
      deadAtProposal: 3,
      deadAtDiscard: 3,
    },
  ];
  const hidden = mergeProposals(prev, [stats('Bad', 3 + DENY_DISCARD_RESURFACE - 1, 12, 'UC1')]);
  check(
    'discarded stays hidden below resurface threshold',
    hidden.length === 1 && hidden[0].status === 'discarded'
  );
  const resurfaced = mergeProposals(prev, [stats('Bad', 3 + DENY_DISCARD_RESURFACE, 12, 'UC1')]);
  check(
    'discarded re-surfaces at threshold',
    resurfaced.length === 1 &&
      resurfaced[0].status === 'pending' &&
      resurfaced[0].deadAtDiscard === undefined
  );
}

// 5. filterCandidate rejects deny-listed channels.
{
  const game = {
    home: 'Arsenal',
    away: 'Chelsea',
    dateISO: '2026-09-20T15:00:00Z',
    league: 'premier-league',
    homeScore: null,
    awayScore: null,
  };
  const cand = (channelId: string): RawCandidate => ({
    id: 'yt:x',
    title: 'Arsenal vs Chelsea 2-1 Highlights',
    url: 'https://www.youtube.com/watch?v=x',
    source: 'youtube',
    videoId: 'x',
    channelName: 'Test',
    channelId,
    lang: 'en',
  });
  const denied = filterCandidate(cand('UCBADCHANNEL'), game, denySet());
  check('deny-listed channel rejected', !denied.keep && denied.reason === 'deny-listed');
  const clean = filterCandidate(cand('UCCLEAN'), game, denySet());
  check(
    'clean channel not deny-rejected',
    clean.reason !== 'deny-listed',
    clean.reason
  );
  const noSet = filterCandidate(cand('UCBADCHANNEL'), game);
  check('no deny set -> no deny filtering', noSet.reason !== 'deny-listed', noSet.reason);
}

// 6. dropDeniedCandidates: cached-result filtering (route serve path).
{
  const list = [
    { id: 'a', channelId: 'UCBADCHANNEL' },
    { id: 'b', channelId: 'UCCLEAN', channelHandle: '@clean' },
    { id: 'c', channelId: 'UCOTHER', channelHandle: '@BadHandle' },
    { id: 'd' },
    { id: 'e', channelId: null, channelHandle: null },
  ];
  const out = dropDeniedCandidates(list, denySet());
  check(
    'dropDenied removes by id and by handle, keeps the rest',
    out.map((x) => x.id).join(',') === 'b,d,e',
    out.map((x) => x.id)
  );
  const empty: DenySet = { ids: new Set(), handles: new Set() };
  check(
    'dropDenied with empty set returns the list untouched',
    dropDeniedCandidates(list, empty) === list
  );
}

if (failures > 0) {
  console.log(`\n${failures} FAILURES`);
  process.exit(1);
}
console.log('\nall deny-list tests passed');
