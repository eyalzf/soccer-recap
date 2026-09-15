import { CLUBS, type ClubEntry } from './teams';

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

/** Find a club by an English name or alias (case/punctuation insensitive). */
export function lookupClubEn(name: string): ClubEntry | undefined {
  return enIndex.get(normEn(name));
}

/** Find a club by an exact Hebrew name or alias. */
export function lookupClubHe(name: string): ClubEntry | undefined {
  return heIndex.get(normHe(name));
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
