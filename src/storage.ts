import type { Match, Player } from './types';

/** Prefix klíčů: každý přihlášený uživatel má v zařízení vlastní oddělenou cache; prázdný = starší data bez účtu. */
let scope = '';
export const setStorageUser = (userId: string | null): void => {
  scope = userId ? `u:${userId}:` : '';
};
const matchesKey = () => `vs:${scope}matches`;
const rostersKey = () => `vs:${scope}rosters`;

/** Smaže z tohoto zařízení veškerou cache uživatele (po odhlášení). */
export function clearUserStorage(userId: string): void {
  for (const k of Object.keys(localStorage)) if (k.startsWith(`vs:u:${userId}:`)) localStorage.removeItem(k);
}

export const LEGACY_MATCHES_KEY = 'vs:matches';
export const LEGACY_ROSTERS_KEY = 'vs:rosters';

export function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Starší uložené zápasy (i ze zálohy) nemají soupisku soupeře ani záznam střídání – doplní se prázdné. */
export const normalizeMatch = (m: Match): Match => ({ ...m, oppPlayers: m.oppPlayers ?? [], oppOnCourt: m.oppOnCourt ?? [], subs: m.subs ?? [] });

const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
export const loadMatches = (): Match[] =>
  asArray<Match>(read<unknown>(matchesKey(), []))
    .filter((m) => m && typeof m.id === 'string' && Array.isArray(m.players) && Array.isArray(m.events))
    .map(normalizeMatch);
export const saveMatches = (matches: Match[]): boolean => write(matchesKey(), matches);

export interface SavedRoster {
  team: string;
  players: Player[];
  savedAt: number;
}

export const loadRosters = (): SavedRoster[] =>
  asArray<SavedRoster>(read<unknown>(rostersKey(), [])).filter((r) => r && typeof r.team === 'string' && Array.isArray(r.players));

let rosterListener: (() => void) | null = null;
/** Zavolá se po uložení soupisky uživatelem (slouží k synchronizaci se serverem). */
export const setRosterListener = (fn: (() => void) | null): void => {
  rosterListener = fn;
};

/** Uloží soupisku pro offline použití (přepíše starší soupisku stejného týmu). */
export function saveRoster(team: string, players: Player[]): void {
  const others = loadRosters().filter((r) => r.team !== team);
  write(rostersKey(), [{ team, players, savedAt: Date.now() }, ...others].slice(0, 20));
  rosterListener?.();
}

/** Soupisky ze zálohy: u stejného týmu vyhraje novější. */
export function mergeRosters(incoming: SavedRoster[]): void {
  const byTeam = new Map(loadRosters().map((r) => [r.team, r]));
  for (const r of incoming) if (!byTeam.has(r.team) || byTeam.get(r.team)!.savedAt < r.savedAt) byTeam.set(r.team, r);
  write(rostersKey(), [...byTeam.values()].sort((a, b) => b.savedAt - a.savedAt).slice(0, 40));
}

/** cvf.cz často nemá čísla dresů ani posty – doplní je z dříve uložené soupisky týmu (podle jména). */
export function withSavedNumbers<T extends Omit<Player, 'id'>>(team: string, roster: T[]): T[] {
  const saved = loadRosters().find((r) => r.team === team)?.players ?? [];
  const known = new Map(saved.map((p) => [p.name.toLowerCase(), p]));
  return roster.map((p) => {
    const s = known.get(p.name.toLowerCase());
    return s ? { ...p, number: p.number || s.number, libero: p.libero ?? s.libero, position: p.position ?? s.position } : p;
  });
}

/** Požádá prohlížeč, aby data nemazal při nedostatku místa (hlavně iOS/Safari). */
export function requestPersistentStorage(): void {
  navigator.storage?.persist?.().catch(() => undefined);
}

export function uid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
