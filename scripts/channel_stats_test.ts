/**
 * Zero-quota unit test for the all-channels statistics aggregation
 * (lib/recap/channelStats.ts) and the deny-list removal matching
 * (lib/recap/denyList.ts). Run: npx tsx scripts/channel_stats_test.ts
 */
import {
  aggregateChannelStats,
  plansForChannel,
} from '../lib/recap/channelStats';
import {
  denyEntryMatches,
  withoutDenyMatches,
  type DenyEntry,
  type DenySet,
} from '../lib/recap/denyList';
import type {
  KeptChannel,
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

let seq = 0;
const entry = (
  league: string,
  home: string,
  away: string,
  date: string,
  channels: KeptChannel[],
  opts: { t?: number; cached?: boolean } = {}
): SearchLogEntry => ({
  t: opts.t ?? 1_700_000_000_000 + seq++ * 1000,
  home,
  away,
  league,
  date,
  cached: opts.cached,
  winner: 'general',
  preferred: { ran: 0, kept: 0 },
  bulk: { ran: 0, kept: 0 },
  general: { ran: 1, kept: channels.length },
  channels,
  results: channels.length,
  rateLimited: false,
});

const day = (entries: SearchLogEntry[]): SearchLogDay => ({
  day: '2026-10-12',
  entries,
});

// 1. Multi-tier aggregation: kept counts, tier breakdown, distinct games,
//    league set, lastSeen, sample-title cap, sort order.
{
  const t0 = 1_700_000_000_000;
  const days = [
    day([
      entry('champions-league', 'Real Madrid', 'Arsenal', '2026-10-12T19:00:00.000Z',
        [kc('v1', 'SPORTS EXTRA', 'UCSE', 'bulk', 'Real Madrid vs Arsenal highlights')], { t: t0 + 5000 }),
      entry('world-cup', 'France', 'Brazil', '2026-10-12T16:00:00.000Z',
        [kc('v2', 'SPORTS EXTRA', 'UCSE', 'bulk', 'France vs Brazil highlights')], { t: t0 + 3000 }),
      entry('premier-league', 'Liverpool', 'Chelsea', '2026-10-12T15:00:00.000Z',
        [kc('v3', 'SPORTS EXTRA', 'UCSE', 'general', 'Liverpool vs Chelsea goals')], { t: t0 + 9000 }),
      entry('la-liga', 'Real Madrid', 'Barcelona', '2026-10-12T19:00:00.000Z',
        [kc('v4', 'ONE', 'UCONE', 'preferred', 'תקציר המשחק')], { t: t0 + 2000 }),
      entry('la-liga', 'Sevilla', 'Valencia', '2026-10-11T19:00:00.000Z',
        [kc('v5', 'ONE', 'UCONE', 'preferred', 'תקציר נוסף')], { t: t0 + 1000 }),
    ]),
  ];
  const res = aggregateChannelStats(days);
  check('searchesSeen counts non-cached entries', res.searchesSeen === 5, res.searchesSeen);
  check('two channels aggregated', res.channels.length === 2, res.channels.length);
  const se = res.channels.find((c) => c.channelId === 'UCSE');
  check('multi-tier kept total', se?.kept === 3, se?.kept);
  check('tier breakdown', !!se && se.tiers.bulk === 2 && se.tiers.general === 1 && se.tiers.preferred === 0, se?.tiers);
  check('distinct games', se?.games === 3, se?.games);
  check(
    'league set',
    !!se && se.leagues.join(',') === 'champions-league,premier-league,world-cup',
    se?.leagues
  );
  check('lastSeen is max entry time', se?.lastSeen === t0 + 9000, se?.lastSeen);
  const one = res.channels.find((c) => c.channelId === 'UCONE');
  check('preferred tier counted', !!one && one.tiers.preferred === 2 && one.kept === 2, one?.tiers);
  check('sorted by kept desc', res.channels[0].channelId === 'UCSE');
}

// 2. Same channel, two videos in ONE game: kept 2, games 1; titles capped at 3.
{
  const chans = [1, 2, 3, 4].map((i) =>
    kc(`v${i}`, 'Random Highlights', undefined, 'general', `title ${i}`)
  );
  const days = [
    day([entry('premier-league', 'Arsenal', 'Chelsea', '2026-10-12T15:00:00.000Z', chans)]),
  ];
  const res = aggregateChannelStats(days);
  const c = res.channels[0];
  check('title-keyed channel kept', c?.kept === 4, c?.kept);
  check('same game counted once', c?.games === 1, c?.games);
  check('key falls back to normalized title', c?.key === 't:randomhighlights', c?.key);
  check('sample titles capped at 3', c?.sampleTitles.length === 3, c?.sampleTitles);
  check('no channelId -> empty inPlans', !!c && c.inPlans.length === 0, c?.inPlans);
}

// 3. Cached entries and channel-less entries are ignored entirely.
{
  const days = [
    day([
      entry('la-liga', 'A', 'B', '2026-10-12T15:00:00.000Z',
        [kc('v1', 'ONE', 'UCONE', 'preferred', 't')], { cached: true }),
      entry('la-liga', 'C', 'D', '2026-10-12T17:00:00.000Z', []),
    ]),
  ];
  const res = aggregateChannelStats(days);
  check('cached entries ignored', res.channels.length === 0 && res.searchesSeen === 0, res);
}

// 4. Denied flag via DenySet (by channelId); absent set -> all false.
{
  const days = [
    day([
      entry('premier-league', 'Arsenal', 'Chelsea', '2026-10-12T15:00:00.000Z', [
        kc('v1', 'Bad Actor', 'UCBAD', 'general', 't1'),
        kc('v2', 'Good One', 'UCGOOD', 'general', 't2'),
      ]),
    ]),
  ];
  const deny: DenySet = { ids: new Set(['UCBAD']), handles: new Set() };
  const res = aggregateChannelStats(days, deny);
  check('denied channel flagged', res.channels.find((c) => c.channelId === 'UCBAD')?.denied === true);
  check('clean channel not flagged', res.channels.find((c) => c.channelId === 'UCGOOD')?.denied === false);
  const resNoSet = aggregateChannelStats(days);
  check('no deny set -> nothing flagged', resNoSet.channels.every((c) => !c.denied));
}

// 5. inPlans detection.
{
  // ONE is la-liga's preferred channel (handle 'one-1004', title 'ONE').
  check(
    'ONE detected in la-liga plan',
    plansForChannel('ONE', 'UCONE-UNKNOWN-ID').includes('la-liga'),
    plansForChannel('ONE', 'UCONE-UNKNOWN-ID')
  );
  // Official CONCACAF channel is preferred in both CONCACAF plans.
  const cc = plansForChannel('Concacaf');
  check(
    'Concacaf detected in both CONCACAF plans',
    cc.includes('gold-cup') && cc.includes('concacaf-nations-league'),
    cc
  );
  // Id-keyed bulk entry: כדורגל ישראלי in the Israeli league plan.
  check(
    'channelId-keyed bulk entry detected',
    plansForChannel('כדורגל ישראלי', 'UC5TtVDq_BSplSOHf7lb2AGQ').includes('israeli-league'),
    plansForChannel('כדורגל ישראלי', 'UC5TtVDq_BSplSOHf7lb2AGQ')
  );
  // Label-matched bulk entry: SPORTS EXTRA (world-cup / nations-league bulk).
  const se = plansForChannel('SPORTS EXTRA', 'UCSE-UNKNOWN');
  check(
    'SPORTS EXTRA detected via label',
    se.includes('world-cup') && se.includes('nations-league') && !se.includes('premier-league'),
    se
  );
  // A channel in no plan.
  check(
    'unknown channel in no plan',
    plansForChannel('Totally Random FC TV', 'UCRANDOM').length === 0
  );
  // Aggregated rows carry inPlans too.
  const days = [
    day([
      entry('la-liga', 'Real Madrid', 'Barcelona', '2026-10-12T19:00:00.000Z', [
        kc('v1', 'ONE', 'UCONE', 'preferred', 't'),
      ]),
    ]),
  ];
  const res = aggregateChannelStats(days);
  check('row carries inPlans', res.channels[0]?.inPlans.includes('la-liga') === true, res.channels[0]?.inPlans);
}

// 6. Deny-removal matching (pure helpers behind removeFromDenyList).
{
  const e = (partial: Partial<DenyEntry>): DenyEntry => ({
    channel: 'Ch',
    reason: 'test',
    deadCount: 0,
    addedAt: 1,
    ...partial,
  });
  const byId = e({ channel: 'Some Title', channelId: 'UC111', handle: 'somehandle' });
  check('match by channelId', denyEntryMatches(byId, { channelId: 'UC111' }));
  check('no match on wrong channelId', !denyEntryMatches(byId, { channelId: 'UC999' }));
  check(
    'channelId takes priority over handle',
    !denyEntryMatches(byId, { channelId: 'UC999', handle: 'somehandle' })
  );
  check(
    'match by handle (@ and case variants)',
    denyEntryMatches(byId, { handle: '@SomeHandle' })
  );
  check(
    'match by normalized title',
    denyEntryMatches(e({ channel: 'SPORTS EXTRA' }), { channel: 'Sports Extra!' })
  );
  check('empty match matches nothing', !denyEntryMatches(byId, {}));
  const list = [
    e({ channel: 'A', channelId: 'UC1' }),
    e({ channel: 'B', channelId: 'UC2' }),
    e({ channel: 'A2', channelId: 'UC1' }),
  ];
  const out = withoutDenyMatches(list, { channelId: 'UC1' });
  check('withoutDenyMatches removes all matches', out.length === 1 && out[0].channel === 'B', out);
  check(
    'withoutDenyMatches no-op when nothing matches',
    withoutDenyMatches(list, { channelId: 'UCZZZ' }).length === 3
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
