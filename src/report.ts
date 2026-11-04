import type { Match, Player, Side } from './types';
import {
  countByPlayer,
  emptyCounts,
  setScores,
  setsWon,
  sumCounts,
  teamName,
  teamPlayers,
  toStats,
  type PlayerStats,
  type SetScore,
} from './stats';
import { positionLabel } from './positions';

/** Sloupce statistické tabulky – sdílí je obrazovka, export do schránky/CSV i PDF. */
export interface Col {
  group: string;
  label: string;
  get: (s: PlayerStats) => number | null;
  pct?: boolean;
  /** Vyšší je lepší – nejlepší hodnota v týmu se zvýrazní. */
  best?: boolean;
}

export const COLS: Col[] = [
  { group: 'Body', label: 'Celk.', get: (s) => s.points, best: true },
  { group: 'Body', label: 'Chyby', get: (s) => s.errors },
  { group: 'Body', label: '+/−', get: (s) => s.plusMinus, best: true },
  { group: 'Podání', label: 'Celk.', get: (s) => s.srvTot },
  { group: 'Podání', label: 'Chyby', get: (s) => s.srvErr },
  { group: 'Podání', label: 'Esa', get: (s) => s.srvAce, best: true },
  { group: 'Přihrávka', label: 'Celk.', get: (s) => s.rcvTot },
  { group: 'Přihrávka', label: 'Chyby', get: (s) => s.rcvErr },
  { group: 'Útok', label: 'Celk.', get: (s) => s.atkTot },
  { group: 'Útok', label: 'Chyby', get: (s) => s.atkErr },
  { group: 'Útok', label: 'Zabl.', get: (s) => s.atkBlocked },
  { group: 'Útok', label: 'Body', get: (s) => s.atkKill, best: true },
  { group: 'Útok', label: 'Úsp.', get: (s) => s.atkPct, pct: true, best: true },
  { group: 'Blok', label: 'Body', get: (s) => s.blk, best: true },
];

export const GROUPS = COLS.reduce<{ name: string; span: number }[]>((acc, c) => {
  if (acc.at(-1)?.name === c.group) acc.at(-1)!.span++;
  else acc.push({ name: c.group, span: 1 });
  return acc;
}, []);

/** První sloupec skupiny (Body, Podání, …) – před ním se kreslí dělicí čára. */
export const isGroupStart = (i: number) => i === 0 || COLS[i].group !== COLS[i - 1].group;

export const fmt = (v: number | null, col: Col) =>
  !v ? '–' : col.pct ? `${v} %` : col.label === '+/−' && v > 0 ? `+${v}` : String(v);

export interface TeamReport {
  side: Side;
  name: string;
  rows: { player: Player; stats: PlayerStats }[];
  total: PlayerStats;
}

export interface Report {
  match: Match;
  /** 0 = celý zápas, jinak číslo setu. */
  set: number;
  scores: SetScore[];
  won: SetScore;
  /** Náš tým, případně i soupeř (když se zapisuje). */
  teams: TeamReport[];
  /** Body bez určení hráče: chyby soupeře (pro nás) a body soupeře. */
  oppErr: number;
  oppPoint: number;
}

export interface ReportOptions {
  /** Vynechat hráče bez jediné zapsané akce. */
  hideEmpty?: boolean;
  /** Řadit sestupně podle sloupce (index do COLS); jinak podle čísla dresu. */
  sortCol?: number | null;
}

const hasActivity = (s: PlayerStats) => s.points + s.errors + s.srvTot + s.rcvTot + s.atkTot + s.blk > 0;
/** Úspěšnost útoku se porovnává jen u hráčů s aspoň 3 útoky. */
const MIN_ATTACKS_FOR_PCT = 3;
const comparable = (col: Col, s: PlayerStats) => (col.pct && s.atkTot < MIN_ATTACKS_FOR_PCT ? null : col.get(s));

/** Nejlepší hodnota každého sloupce v týmu (jen sloupce, kde je vyšší lepší a hodnota > 0). */
export function bestValues(rows: TeamReport['rows']): (number | null)[] {
  return COLS.map((col) => {
    if (!col.best) return null;
    const max = Math.max(...rows.map(({ stats }) => comparable(col, stats) ?? -Infinity));
    return max > 0 ? max : null;
  });
}

export const isBest = (best: (number | null)[], i: number, s: PlayerStats) => best[i] !== null && comparable(COLS[i], s) === best[i];

export function buildReport(match: Match, set: number, opts: ReportOptions = {}): Report {
  const counts = countByPlayer(match.events, set || undefined);
  const inSet = match.events.filter((e) => !set || e.set === set);
  const sides: Side[] = match.oppPlayers.length ? ['us', 'them'] : ['us'];
  return {
    match,
    set,
    scores: setScores(match),
    won: setsWon(match),
    teams: sides.map((side) => {
      const players = [...teamPlayers(match, side)].sort((a, b) => (Number(a.number) || 99) - (Number(b.number) || 99));
      const playerCounts = players.map((p) => counts.get(p.id) ?? emptyCounts());
      let rows = players.map((player, i) => ({ player, stats: toStats(playerCounts[i]) }));
      if (opts.hideEmpty) rows = rows.filter((r) => hasActivity(r.stats));
      const col = opts.sortCol != null ? COLS[opts.sortCol] : null;
      if (col) rows.sort((a, b) => (col.get(b.stats) ?? -Infinity) - (col.get(a.stats) ?? -Infinity));
      return { side, name: teamName(match, side), rows, total: toStats(sumCounts(playerCounts)) };
    }),
    oppErr: inSet.filter((e) => e.type === 'oppErr').length,
    oppPoint: inSet.filter((e) => e.type === 'oppPoint').length,
  };
}

export const setLabel = (set: number) => (set ? `${set}. set` : 'Celý zápas');

export const reportTitle = (r: Report) => `${r.match.team} – ${r.match.opponent}`;

/** Název souboru bez diakritiky – prohlížeče jinak název s diakritikou zahodí („download“). */
export function reportFileName(r: Report): string {
  const part = r.set ? `-${r.set}set` : '';
  return `statistika-${r.match.date}-${r.match.team}-${r.match.opponent}${part}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z\d-]+/g, '_');
}

/** Tabulka jako text (TSV pro schránku, CSV se středníkem pro Excel); každý tým má vlastní blok. */
export function reportToTable(r: Report, sep: string): string {
  const esc = (raw: string) => {
    // Text začínající =, +, -, @ by Excel spustil jako vzorec – čísla (např. -2) nechá být.
    const v = /^[=+\-@\t\r]/.test(raw) && Number.isNaN(Number(raw)) ? `'${raw}` : raw;
    return v.includes(sep) || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const head = ['Číslo', 'Hráč', 'Post', ...COLS.map((c) => `${c.group} ${c.label}`)];
  return r.teams
    .map((t) => {
      const body = t.rows.map(({ player, stats }) => [
        player.number,
        player.name,
        positionLabel(player),
        ...COLS.map((c) => String(c.get(stats) ?? '')),
      ]);
      const foot = ['', 'Celkem', '', ...COLS.map((c) => String(c.get(t.total) ?? ''))];
      return [[t.name], head, ...body, foot].map((row) => row.map(esc).join(sep)).join('\r\n');
    })
    .join('\r\n\r\n');
}
