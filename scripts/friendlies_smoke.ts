/**
 * Live smoke for the friendlies build (zero YouTube quota):
 * does Sport1 have the Albania-Israel friendly, and does the plan/matcher
 * keep it? Run: npx tsx scripts/friendlies_smoke.ts
 */
import { sport1Search } from '../lib/recap/sources';
import { filterCandidate } from '../lib/recap/match';

async function main() {
  const game = {
    home: 'Albania',
    away: 'Israel',
    dateISO: '2026-06-03T18:00:00Z',
    league: 'national-friendlies',
    homeScore: 0,
    awayScore: 1,
  };
  const results = await sport1Search(game);
  console.log(`sport1 candidates: ${results.length}`);
  for (const r of results) {
    const verdict = filterCandidate(r, game);
    console.log(`- ${r.title} | dur=${r.durationSec}s | keep=${verdict.keep} reason=${verdict.reason}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
