import type { Player } from './types';
import { toPosition } from './positions';

const CVF_ORIGIN = 'https://www.cvf.cz';
const COMPETITION_PATH = '/souteze/celostatni-souteze';

declare global {
  interface Window {
    /** Most z Electronu (electron/preload.cjs) – stahuje bez omezení CORS. */
    electronAPI?: { fetchText(url: string): Promise<string> };
    /** Vkládá Capacitor v nativní aplikaci; fetch pak jde přes nativní HTTP. */
    Capacitor?: { isNativePlatform?: () => boolean };
  }
}

export type RosterEntry = Omit<Player, 'id'>;

export interface CvfCompetition {
  id: string;
  name: string;
}

export interface CvfTeam {
  id: string;
  name: string;
}

/** V hale se slabým signálem nesmí načítání viset donekonečna. */
const TIMEOUT_MS = 15_000;

async function fetchCvf(query: string): Promise<string> {
  const path = query ? `${COMPETITION_PATH}?${query}` : COMPETITION_PATH;
  if (window.electronAPI) return window.electronAPI.fetchText(CVF_ORIGIN + path);

  // Web nemůže cvf.cz volat přímo (CORS) – jde přes proxy /cvf (Vite dev server, Netlify) nebo VITE_CVF_PROXY.
  const base = window.Capacitor?.isNativePlatform?.() ? CVF_ORIGIN : (import.meta.env.VITE_CVF_PROXY ?? '/cvf');
  const res = await fetch(base + path, { signal: AbortSignal.timeout?.(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`cvf.cz vrátil chybu ${res.status}`);
  return res.text();
}

/**
 * Soutěže dospělých aktuální sezóny (Extraliga, 1. a 2. liga muži/ženy).
 * Čísla soutěží se každou sezónu mění, proto se načítají z cvf.cz a nejsou v kódu napevno.
 */
export async function fetchCompetitions(): Promise<CvfCompetition[]> {
  return parseCompetitions(await fetchCvf(''));
}

export function parseCompetitions(html: string): CvfCompetition[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const list = new Map<string, string>();
  doc.querySelectorAll('a.h4[href*="competitionId="]').forEach((a) => {
    const id = a.getAttribute('href')?.match(/competitionId=(\d+)/)?.[1];
    const name = clean(a.textContent);
    // Mládežnické soutěže končí kategorií (U18, U20…), dospělé „muži“ / „ženy“.
    if (id && /(muži|ženy)$/i.test(name) && !list.has(id)) list.set(id, name);
  });
  return [...list].map(([id, name]) => ({ id, name }));
}

/** Přijme celou URL soutěže z cvf.cz nebo jen číslo soutěže. */
export function parseCompetitionId(input: string): string | null {
  const m = input.match(/competitionId=(\d+)/i) ?? input.trim().match(/^(\d+)$/);
  return m ? m[1] : null;
}

export async function fetchTeams(competitionId: string): Promise<CvfTeam[]> {
  return parseTeams(await fetchCvf(`mode=clubs&competitionId=${encodeURIComponent(competitionId)}`));
}

/** Soupiska týmu podle názvu (např. soupeře během zápasu); null, když tým v soutěži není. */
export async function fetchRosterByName(competitionId: string, name: string): Promise<RosterEntry[] | null> {
  const team = (await fetchTeams(competitionId)).find((t) => t.name === name);
  return team ? fetchRoster(competitionId, team.id) : null;
}

export async function fetchRoster(competitionId: string, teamId: string): Promise<RosterEntry[]> {
  const html = await fetchCvf(
    `mode=clubs&competitionId=${encodeURIComponent(competitionId)}&teamId=${encodeURIComponent(teamId)}`,
  );
  return parseRoster(html);
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

export function parseTeams(html: string): CvfTeam[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Text odkazu má přednost před title/alt loga, které bývá u stejného týmu dřív.
  const teams = new Map<string, { name: string; weak: boolean }>();
  doc.querySelectorAll('a[href*="teamId="]').forEach((a) => {
    const id = a.getAttribute('href')?.match(/teamId=(\d+)/)?.[1];
    const text = clean(a.textContent);
    const name = text || clean(a.getAttribute('title')) || clean(a.querySelector('img')?.getAttribute('alt'));
    const prev = id && teams.get(id);
    if (id && name && (!prev || (prev.weak && text))) teams.set(id, { name, weak: !text });
  });
  return [...teams]
    .map(([id, { name }]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'cs'));
}

const LIBERO_RE = /\(L\)|\blibero\b/i;
const STAFF_RE = /trenér|vedoucí|asistent|lékař|fyzio|masér|statistik/i;
const NUMBER_RE = /^\d{1,2}$/;
const NAME_RE = /^[\p{Lu}][\p{L}'’.-]*(?:\s+[\p{Lu}][\p{L}'’.-]*){1,3}$/u;

/** Převede buňky jednoho řádku (zkopírovaného z tabulky) na hráče. */
function rowToPlayer(cells: string[]): RosterEntry | null {
  const row = cells.join(' ');
  if (STAFF_RE.test(row)) return null;
  const position = cells.map(toPosition).find(Boolean);
  const names = cells
    .filter((c) => !toPosition(c))
    .map((c) => clean(c.replace(LIBERO_RE, '')))
    .filter((c) => /\p{L}/u.test(c));
  const name = names.find((c) => NAME_RE.test(c)) ?? names[0];
  if (!name) return null;
  const libero = LIBERO_RE.test(row) || position === 'libero' || undefined;
  return { number: cells.find((c) => NUMBER_RE.test(c)) ?? '', name, libero, position };
}

function uniqueByName(list: (RosterEntry | null)[]): RosterEntry[] {
  const map = new Map<string, RosterEntry>();
  for (const p of list) if (p && !map.has(p.name.toLowerCase())) map.set(p.name.toLowerCase(), p);
  return [...map.values()];
}

/**
 * Soupiska ze stránky družstva na cvf.cz: záložka #lineup, karty a.playerItem
 * (číslo v .playerItem__num, jméno v h3, post v .fw-bold). Sekci „Trenéři/funkcionáři“ vynechá.
 */
export function parseRoster(html: string): RosterEntry[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.querySelector('#lineup') ?? doc;
  return uniqueByName(
    [...root.querySelectorAll('a.playerItem')].map((card) => {
      const section = clean(card.closest('.row')?.previousElementSibling?.textContent);
      const name = clean(card.querySelector('h3')?.textContent);
      if (!name || STAFF_RE.test(section) || /funkcionář/i.test(section)) return null;
      const position = toPosition(card.querySelector('.fw-bold')?.textContent);
      return {
        number: clean(card.querySelector('.playerItem__num')?.textContent),
        name,
        libero: position === 'libero' || undefined,
        position,
      };
    }),
  );
}

/** Ručně vložená soupiska: jeden hráč na řádek, např. „7 Novák Jan“, „Novák Jan 7“ nebo řádek zkopírovaný z tabulky. */
export function parseRosterText(text: string): RosterEntry[] {
  return uniqueByName(
    text.split(/\r?\n/).map((line) => {
      const cells = line.split('\t').map(clean).filter(Boolean);
      if (cells.length > 1) return rowToPlayer(cells);
      const libero = LIBERO_RE.test(line) || undefined;
      const s = clean(line.replace(LIBERO_RE, ''));
      const lead = s.match(/^#?(\d{1,2})[.):\s-]+(.+)$/);
      const trail = s.match(/^(.+?)\s+#?(\d{1,2})$/);
      const [number, name] = lead ? [lead[1], lead[2]] : trail ? [trail[2], trail[1]] : ['', s];
      return /\p{L}/u.test(name) ? { number, name, libero } : null;
    }),
  );
}

/**
 * Rychlé zadání hráčů během zápasu: čísla oddělená mezerou nebo čárkou, jméno je nepovinné,
 * „L“ u čísla = libero. Např. „1 3 5 7 9 11 2L“ nebo „7 Novák, 12 Dvořák“.
 */
export function parseQuickPlayers(text: string): RosterEntry[] {
  return uniqueByNumber(
    text
      .split(/[,;\n]+/)
      .flatMap((chunk) => (/^[\s\d#lL]+$/.test(chunk) ? chunk.trim().split(/\s+/) : [chunk.trim()]))
      .map((token) => {
        const m = token.match(/^#?(\d{1,2})\s*(L\b)?\s*(.*)$/i);
        return m ? { number: m[1], name: clean(m[3]), libero: m[2] ? true : undefined } : null;
      }),
  );
}

function uniqueByNumber(list: (RosterEntry | null)[]): RosterEntry[] {
  const map = new Map<string, RosterEntry>();
  for (const p of list) if (p && !map.has(p.number)) map.set(p.number, p);
  return [...map.values()];
}

