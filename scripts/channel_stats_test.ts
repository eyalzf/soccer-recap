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
  // Roster rows (kept 0) now accompany the log-derived rows; the two
  // channels with activity are the ones with kept > 0.
  check(
    'two channels aggregated',
    res.channels.filter((c) => c.kept > 0).length === 2,
    res.channels.filter((c) => c.kept > 0).length
  );
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
  // Cached entries contribute nothing: no searches seen, and every row
  // is a zero-kept roster row (ONE's included — its only "activity"
  // here was a cache hit).
  check(
    'cached entries ignored',
    res.searchesSeen === 0 && res.channels.every((c) => c.kept === 0),
    res.searchesSeen
  );
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

// 7. Classification + scopeByLeague on log rows; precedence
//    blocked > per-team > curated > general.
{
  const days = [
    day([
      entry('la-liga', 'Real Madrid', 'Sevilla', '2026-10-12T19:00:00.000Z', [
        kc('v1', 'Real Madrid', undefined, 'bulk', 'Madrid highlights'),
      ]),
      entry('premier-league', 'Arsenal', 'Chelsea', '2026-10-12T15:00:00.000Z', [
        kc('v2', 'Random Highlights', undefined, 'general', 'goals'),
        kc('v3', 'SPORTS EXTRA', 'UCSE', 'general', 'extended highlights'),
      ]),
    ]),
  ];
  const res = aggregateChannelStats(days);
  const rm = res.channels.find((c) => c.channel === 'Real Madrid');
  check('club channel classified per-team', rm?.classification === 'per-team', rm?.classification);
  check(
    'per-team scope carries teams in both leagues',
    !!rm &&
      rm.scopeByLeague.length === 2 &&
      rm.scopeByLeague.every((s) => s.teams?.join(',') === 'Real Madrid'),
    rm?.scopeByLeague
  );
  const rnd = res.channels.find((c) => c.channel === 'Random Highlights');
  check(
    'plan-less channel classified general',
    rnd?.classification === 'general' && rnd.scopeByLeague.length === 0,
    rnd?.classification
  );
  const se = res.channels.find((c) => c.channelId === 'UCSE');
  check('league-wide plan channel classified curated', se?.classification === 'curated', se?.classification);
  check(
    'curated scope has no team scopes',
    !!se && se.scopeByLeague.length >= 5 && se.scopeByLeague.every((s) => !s.teams),
    se?.scopeByLeague.length
  );
  // The log row absorbed the plan scope — SPORTS EXTRA appears once,
  // not as a log row plus a separate roster row.
  check(
    'active plan channel not duplicated as roster row',
    res.channels.filter((c) => c.channel === 'SPORTS EXTRA').length === 1
  );

  // Blocked beats per-team and curated.
  const deny: DenySet = { ids: new Set(['UCSE', 'UCBARCA']), handles: new Set() };
  const days2 = [
    day([
      entry('la-liga', 'Barcelona', 'Sevilla', '2026-10-12T19:00:00.000Z', [
        kc('v1', 'FC Barcelona', 'UCBARCA', 'bulk', 'Barca highlights'),
        kc('v2', 'SPORTS EXTRA', 'UCSE', 'bulk', 'Sevilla v Barca'),
      ]),
    ]),
  ];
  const res2 = aggregateChannelStats(days2, deny);
  check(
    'denied club channel classified blocked (beats per-team)',
    res2.channels.find((c) => c.channelId === 'UCBARCA')?.classification === 'blocked'
  );
  check(
    'denied league-wide channel classified blocked (beats curated)',
    res2.channels.find((c) => c.channelId === 'UCSE')?.classification === 'blocked'
  );
}

// 8. Roster rows: plan channels with no activity are emitted with
//    their scope, merged across leagues into a single row.
{
  const res = aggregateChannelStats([]);
  check(
    'no activity -> roster rows only',
    res.channels.length > 0 && res.channels.every((c) => c.kept === 0),
    res.channels.length
  );
  const espn = res.channels.find((c) => c.channel === 'ESPN FC');
  check(
    'league-wide roster row (ESPN FC, la-liga)',
    !!espn &&
      espn.classification === 'curated' &&
      espn.scopeByLeague.length === 1 &&
      espn.scopeByLeague[0].league === 'la-liga' &&
      !espn.scopeByLeague[0].teams &&
      espn.games === 0 &&
      espn.lastSeen === 0 &&
      espn.sampleTitles.length === 0,
    espn?.scopeByLeague
  );
  const sev = res.channels.find((c) => c.channel === 'Sevilla FC');
  check(
    'team-scoped roster row (Sevilla FC)',
    !!sev &&
      sev.classification === 'per-team' &&
      sev.scopeByLeague.length === 1 &&
      sev.scopeByLeague[0].teams?.join(',') === 'Sevilla',
    sev?.scopeByLeague
  );
  const seRows = res.channels.filter((c) => c.channel === 'SPORTS EXTRA');
  check(
    'multi-league channel merged into one roster row',
    seRows.length === 1 && seRows[0].scopeByLeague.length >= 6,
    seRows.map((r) => r.scopeByLeague.length)
  );
  const ifa = res.channels.find(
    (c) => c.channelId === 'UC-5AVLhL2v04-lfbVzejRZQ'
  );
  check(
    'channelId-keyed FA channel roster row (IFA, Israel scope x2)',
    !!ifa &&
      ifa.classification === 'per-team' &&
      ifa.scopeByLeague.length === 2 &&
      ifa.scopeByLeague.every((s) => s.teams?.join(',') === 'Israel'),
    ifa?.scopeByLeague
  );
  const ipfl = res.channels.find((c) => c.channel === 'Ipflofficial');
  check(
    'handle-only preferred entry named by handle (Ipflofficial)',
    !!ipfl &&
      ipfl.classification === 'curated' &&
      ipfl.scopeByLeague.length === 1 &&
      ipfl.scopeByLeague[0].league === 'israeli-league',
    ipfl?.scopeByLeague
  );
  check(
    'handle-only roster row exposes its handle (channel-page link)',
    !!ipfl && ipfl.handle === 'Ipflofficial' && !ipfl.channelId,
    ipfl?.handle
  );
  const cc = res.channels.find((c) => c.channel === 'concacaf');
  check(
    'handle-only roster row across two leagues (concacaf)',
    !!cc && cc.classification === 'curated' && cc.scopeByLeague.length === 2,
    cc?.scopeByLeague
  );
  // A roster channel denied by handle classifies blocked.
  const deny: DenySet = { ids: new Set(), handles: new Set(['uefa']) };
  const resD = aggregateChannelStats([], deny);
  const uefa = resD.channels.find((c) => c.channel === 'UEFA');
  check(
    'roster row denied by handle classified blocked',
    !!uefa && uefa.denied && uefa.classification === 'blocked',
    uefa?.classification
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
