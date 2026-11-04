import type { Match } from './types';
import { normalizeMatch, type SavedRoster } from './storage';

const APP = 'volejbal-statistika';

export interface Backup {
  app: typeof APP;
  version: 1;
  exportedAt: string;
  matches: Match[];
  rosters: SavedRoster[];
}

export function createBackup(matches: Match[], rosters: SavedRoster[]): string {
  const backup: Backup = { app: APP, version: 1, exportedAt: new Date().toISOString(), matches, rosters };
  return JSON.stringify(backup);
}

const isMatch = (m: unknown): m is Match => {
  const x = m as Match;
  return !!x && typeof x.id === 'string' && typeof x.team === 'string' && Array.isArray(x.players) && Array.isArray(x.events);
};

/** Načte zálohu a ověří, že jde opravdu o zálohu této aplikace (jinak vyhodí srozumitelnou chybu). */
export function parseBackup(text: string): Backup {
  let data: Partial<Backup>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Soubor není platná záloha (nejde přečíst).');
  }
  if (data?.app !== APP || !Array.isArray(data.matches)) throw new Error('Soubor není záloha Volejbal Statistiky.');
  if (!data.matches.every(isMatch)) throw new Error('Záloha je poškozená – obsahuje neplatný zápas.');
  return { app: APP, version: 1, exportedAt: String(data.exportedAt ?? ''), matches: data.matches.map(normalizeMatch), rosters: Array.isArray(data.rosters) ? data.rosters : [] };
}

/** Přidá zápasy ze zálohy; zápasy, které už v zařízení jsou (stejné id), nepřepisuje. */
export function mergeMatches(current: Match[], incoming: Match[]) {
  const known = new Set(current.map((m) => m.id));
  const added = incoming.filter((m) => !known.has(m.id));
  return { merged: [...added, ...current].sort((a, b) => b.createdAt - a.createdAt), added: added.length, skipped: incoming.length - added.length };
}

/** Přibližné využití úložiště prohlížeče (limit bývá kolem 5 MB). */
export const STORAGE_LIMIT = 5 * 1024 * 1024;
export const storageUsed = (matches: Match[]) => JSON.stringify(matches).length * 2; // UTF-16
