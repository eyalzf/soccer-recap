import { promises as fs } from 'fs';
import path from 'path';

/**
 * Fixture-based recap testing: recorded /api/recap SSE streams that can be
 * replayed with zero YouTube API quota. See fixtures/recap/README.md.
 *
 * Bump MATCHER_VERSION whenever the search/filter/rank pipeline changes
 * (lib/recap/match.ts, rank.ts, leaguePlans.ts, sources.ts) so stale
 * fixtures are flagged instead of silently trusted.
 */
export const MATCHER_VERSION = 4;

export interface FixtureRequest {
  home: string;
  away: string;
  date: string;
  league: string;
  hs: string;
  as: string;
  homeHe?: string;
  awayHe?: string;
}

export interface RecapFixture {
  slug: string;
  label: string;
  request: FixtureRequest;
  matcherVersion: number;
  recordedAt: string;
  events: Array<Record<string, unknown>>;
}

export interface FixtureMeta {
  slug: string;
  label: string;
  matcherVersion: number;
  recordedAt: string;
  stale: boolean;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

function fixturePath(slug: string): string {
  return path.join(process.cwd(), 'fixtures', 'recap', `${slug}.json`);
}

export async function loadFixture(slug: string): Promise<RecapFixture | null> {
  if (!isValidSlug(slug)) return null;
  try {
    const raw = await fs.readFile(fixturePath(slug), 'utf-8');
    const f = JSON.parse(raw) as RecapFixture;
    if (!f || f.slug !== slug || !Array.isArray(f.events)) return null;
    return f;
  } catch {
    return null;
  }
}

export async function listFixtures(): Promise<FixtureMeta[]> {
  try {
    const dir = path.join(process.cwd(), 'fixtures', 'recap');
    const files = await fs.readdir(dir);
    const out: FixtureMeta[] = [];
    for (const f of files) {
      if (!f.endsWith('.json') || f === 'README.md') continue;
      const fix = await loadFixture(f.slice(0, -'.json'.length));
      if (fix) {
        out.push({
          slug: fix.slug,
          label: fix.label,
          matcherVersion: fix.matcherVersion,
          recordedAt: fix.recordedAt,
          stale: fix.matcherVersion !== MATCHER_VERSION,
        });
      }
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  } catch {
    return [];
  }
}
