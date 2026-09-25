import { NATIONS, type NationEntry } from './nations';

function normEn(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['`’‘.]/g, '')
    .replace(/[-–—/]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normHe(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

const enIndex = new Map<string, NationEntry>();
const heIndex = new Map<string, NationEntry>();

for (const nation of NATIONS) {
  const enKeys = new Set([nation.en, ...nation.enAliases].map(normEn));
  for (const k of enKeys) {
    if (k && !enIndex.has(k)) enIndex.set(k, nation);
  }
  const heKeys = new Set([nation.he, ...nation.heAliases].map(normHe));
  for (const k of heKeys) {
    if (k && !heIndex.has(k)) heIndex.set(k, nation);
  }
}

/** Find a nation by an English name, FIFA trigram, or alias. */
export function lookupNationEn(name: string): NationEntry | undefined {
  return enIndex.get(normEn(name));
}

/** Find a nation by an exact Hebrew name or alias. */
export function lookupNationHe(name: string): NationEntry | undefined {
  return heIndex.get(normHe(name));
}

/** Hebrew display name for an English nation name; falls back to the input. */
export function nationToHebrew(englishName: string): string {
  return lookupNationEn(englishName)?.he ?? englishName;
}

/** Flag thumbnail URL for an English nation name; null when unknown. */
export function nationFlag(englishName: string): string | null {
  const n = lookupNationEn(englishName);
  return n ? `https://flagcdn.com/w80/${n.iso}.png` : null;
}

/** True when the English name belongs to a nation (not a club). */
export function isNationName(englishName: string): boolean {
  return lookupNationEn(englishName) !== undefined;
}
