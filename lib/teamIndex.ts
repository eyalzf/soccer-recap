import { CLUBS, type ClubEntry } from './teams';
import { lookupNationEn } from './nationIndex';

function normEn(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['`\u2019\u2018.]/g, '')
    .replace(/[-\u2013\u2014/]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normHe(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

const enIndex = new Map<string, ClubEntry>();
const heIndex = new Map<string, ClubEntry>();

for (const club of CLUBS) {
  const enKeys = new Set([club.en, ...club.enAliases].map(normEn));
  for (const k of enKeys) {
    if (k && !enIndex.has(k)) enIndex.set(k, club);
  }
  const heKeys = new Set([club.he, ...club.heAliases].map(normHe));
  for (const k of heKeys) {
    if (k && !heIndex.has(k)) heIndex.set(k, club);
  }
}

/**
 * Runtime club additions (data/club-additions.json, loaded by
 * lib/clubAdditions.ts): clubs registered after the code registry was
 * compiled — mostly lower-division cup opponents the daily fixtures
 * update adds when it populates a cup tie. The overlay is consulted
 * AFTER the code index and BEFORE nations, so a curated code entry
 * always wins and an addition can never shadow one. Registration
 * replaces the overlay wholesale, so a corrected entry takes effect
 * on the next load.
 */
const overlayEn = new Map<string, ClubEntry>();
const overlayHe = new Map<string, ClubEntry>();

export function registerClubAdditions(entries: ClubEntry[]): void {
  overlayEn.clear();
  overlayHe.clear();
  for (const club of entries) {
    const enKeys = new Set([club.en, ...club.enAliases].map(normEn));
    for (const k of enKeys) {
      if (k && !overlayEn.has(k)) overlayEn.set(k, club);
    }
    const heKeys = new Set([club.he, ...club.heAliases].map(normHe));
    for (const k of heKeys) {
      if (k && !overlayHe.has(k)) overlayHe.set(k, club);
    }
  }
}

/** Find a team (club or nation) by an English name or alias.
 * Clubs win ties; nations are the fallback. NationEntry is structurally a
 * ClubEntry (plus `iso`), so every matcher call site works unchanged. */
export function lookupClubEn(name: string): ClubEntry | undefined {
  const k = normEn(name);
  return enIndex.get(k) ?? overlayEn.get(k) ?? lookupNationEn(name);
}

/** Find a club by an exact Hebrew name or alias. */
export function lookupClubHe(name: string): ClubEntry | undefined {
  const k = normHe(name);
  return heIndex.get(k) ?? overlayHe.get(k);
}

/** Hebrew display name for an English club name; falls back to the input. */
export function toHebrew(englishName: string): string {
  return lookupClubEn(englishName)?.he ?? englishName;
}

/** All Hebrew spellings for a club (display name + aliases). */
export function hebrewVariants(englishName: string): string[] {
  const c = lookupClubEn(englishName);
  if (!c) return [englishName];
  return [c.he, ...c.heAliases];
}

/** All English spellings for a club (canonical + aliases). */
export function englishVariants(englishName: string): string[] {
  const c = lookupClubEn(englishName);
  if (!c) return [englishName];
  return [c.en, ...c.enAliases];
}
