// Team registry for the quick team filter: canonical key -> Hebrew name + badge.
// Badges are harvested from the currently listed games (crest backfill covers
// the Israeli league and UCL; other leagues fall back to an initials chip).

import { CLUBS } from './teams';
import { lookupClubEn } from './teamIndex';

export interface TeamEntry {
  /** Canonical key: curated English name, or the raw name when unknown. */
  key: string;
  he: string;
  badge: string | null;
}

/** Fixed fallback shown when there is no watch history yet. Canonical English names. */
export const FALLBACK_TOP_TEAMS = [
  'Barcelona',
  'Real Madrid',
  'Manchester City',
  'Liverpool',
  'Arsenal',
  'Bayern Munich',
  'Paris Saint-Germain',
  'Inter',
  'Maccabi Haifa',
  'Maccabi Tel Aviv',
];

interface RegistryGame {
  home: string;
  away: string;
  homeHe: string;
  awayHe: string;
  homeBadge: string | null;
  awayBadge: string | null;
}

/** Build key -> {he, badge} from the currently listed games. */
export function buildTeamRegistry(games: RegistryGame[]): Map<string, TeamEntry> {
  const reg = new Map<string, TeamEntry>();
  const put = (en: string, he: string, badge: string | null) => {
    if (!en) return;
    const club = lookupClubEn(en);
    const key = club?.en ?? en;
    const prev = reg.get(key);
    reg.set(key, {
      key,
      he: prev?.he ?? club?.he ?? he ?? key,
      badge: prev?.badge ?? badge,
    });
  };
  for (const g of games) {
    put(g.home, g.homeHe, g.homeBadge);
    put(g.away, g.awayHe, g.awayBadge);
  }
  return reg;
}

/** TeamEntry for any canonical key (falls back to the curated Hebrew name, no badge). */
export function entryFor(key: string, reg: Map<string, TeamEntry>): TeamEntry {
  const hit = reg.get(key);
  if (hit) return hit;
  return { key, he: lookupClubEn(key)?.he ?? key, badge: null };
}

/** Up to `n` quick teams: most-viewed first, backfilled from the fallback list. */
export function quickTeams(
  reg: Map<string, TeamEntry>,
  views: Record<string, number>,
  n = 10
): TeamEntry[] {
  const ranked = Object.entries(views)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
  const out: string[] = [];
  for (const k of [...ranked, ...FALLBACK_TOP_TEAMS]) {
    if (out.length >= n) break;
    if (!out.includes(k)) out.push(k);
  }
  return out.map((k) => entryFor(k, reg));
}

/** Free-text team matching across Hebrew/English names and aliases. */
export function matchTeams(
  query: string,
  reg: Map<string, TeamEntry>,
  limit = 6
): TeamEntry[] {
  const qHe = query.trim();
  const q = qHe.toLowerCase();
  if (!q) return [];
  const out: TeamEntry[] = [];
  const seen = new Set<string>();
  const push = (e: TeamEntry) => {
    if (seen.has(e.key) || out.length >= limit) return;
    seen.add(e.key);
    out.push(e);
  };
  for (const e of reg.values()) {
    if (e.he.includes(qHe) || e.key.toLowerCase().includes(q)) push(e);
    if (out.length >= limit) return out;
  }
  for (const c of CLUBS) {
    if (seen.has(c.en)) continue;
    if (
      c.en.toLowerCase().includes(q) ||
      c.he.includes(qHe) ||
      c.enAliases.some((a) => a.toLowerCase().includes(q)) ||
      c.heAliases.some((a) => a.includes(qHe))
    ) {
      push(entryFor(c.en, reg));
    }
    if (out.length >= limit) break;
  }
  return out;
}
