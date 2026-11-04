import type { ActionType, Match, MatchEvent, Player, PlayerAction, Side } from './types';

export interface ActionDef {
  group: 'Podání' | 'Přihrávka' | 'Útok' | 'Blok' | 'Ostatní';
  label: string;
  /** Plný popis pro čtečky obrazovky a historii. */
  title: string;
  tone: 'good' | 'neutral' | 'bad';
  /** Libero nesmí podávat, útočit nad sítí ani blokovat. */
  liberoAllowed: boolean;
}

/** Pořadí odpovídá sloupcům záznamové tabulky. */
export const PLAYER_ACTIONS: Record<PlayerAction, ActionDef> = {
  srvAce: { group: 'Podání', label: 'Eso', title: 'Podání – eso', tone: 'good', liberoAllowed: false },
  srv: { group: 'Podání', label: 'V poli', title: 'Podání v poli', tone: 'neutral', liberoAllowed: false },
  srvErr: { group: 'Podání', label: 'Chyba', title: 'Podání – chyba', tone: 'bad', liberoAllowed: false },
  rcv: { group: 'Přihrávka', label: 'OK', title: 'Přihrávka', tone: 'neutral', liberoAllowed: true },
  rcvErr: { group: 'Přihrávka', label: 'Chyba', title: 'Přihrávka – chyba', tone: 'bad', liberoAllowed: true },
  // „Celkem“ zapíše útok, který neskončil bodem ani chybou; v zápisu ukazuje počet všech útoků hráče.
  atk: { group: 'Útok', label: 'Celkem', title: 'Útok (bez bodu a chyby)', tone: 'neutral', liberoAllowed: false },
  atkKill: { group: 'Útok', label: 'Bod', title: 'Útok – bod', tone: 'good', liberoAllowed: false },
  atkErr: { group: 'Útok', label: 'Chyba', title: 'Útok – chyba', tone: 'bad', liberoAllowed: false },
  atkBlocked: { group: 'Útok', label: 'Zabl.', title: 'Útok – zablokován', tone: 'bad', liberoAllowed: false },
  blk: { group: 'Blok', label: 'Bod', title: 'Blok – bod', tone: 'good', liberoAllowed: false },
  err: { group: 'Ostatní', label: 'Chyba', title: 'Jiná chyba (síť, dotyk, přešlap…)', tone: 'bad', liberoAllowed: true },
};

export const PLAYER_ACTION_KEYS = Object.keys(PLAYER_ACTIONS) as PlayerAction[];

export const TEAM_ACTION_TITLES = {
  oppErr: 'Chyba soupeře',
  oppPoint: 'Bod soupeře',
} as const;

/** Komu akce hráče našeho týmu přinese bod (u soupeře obráceně). */
const EFFECT: Record<ActionType, Side | null> = {
  srvAce: 'us',
  atkKill: 'us',
  blk: 'us',
  oppErr: 'us',
  srvErr: 'them',
  rcvErr: 'them',
  atkErr: 'them',
  atkBlocked: 'them',
  err: 'them',
  oppPoint: 'them',
  srv: null,
  rcv: null,
  atk: null,
};

export const teamPlayers = (m: Pick<Match, 'players' | 'oppPlayers'>, side: Side): Player[] =>
  side === 'us' ? m.players : m.oppPlayers;

export const teamName = (m: Pick<Match, 'team' | 'opponent'>, side: Side) => (side === 'us' ? m.team : m.opponent);

export function pointFor(e: MatchEvent): Side | null {
  const effect = EFFECT[e.type];
  if (!effect || e.team !== 'them') return effect;
  return effect === 'us' ? 'them' : 'us';
}

/** Akce druhého týmu popisující stejnou výměnu: eso ↔ chyba přihrávky, zablokovaný útok ↔ bodový blok. */
const COUNTERPART: Partial<Record<ActionType, ActionType>> = { srvAce: 'rcvErr', rcvErr: 'srvAce', atkBlocked: 'blk', blk: 'atkBlocked' };

/** Když se zapíšou obě strany jedné výměny hned po sobě, bod se počítá jen jednou. */
/** Obě strany jedné výměny zapisovatel zadá hned po sobě; další výměna přijde nejdřív po pár desítkách sekund. */
export const SAME_RALLY_MS = 12_000;

const sameRally = (prev: MatchEvent | undefined, e: MatchEvent) =>
  !!prev?.playerId &&
  !!e.playerId &&
  prev.set === e.set &&
  prev.team !== e.team &&
  COUNTERPART[prev.type] === e.type &&
  Math.abs(e.t - prev.t) <= SAME_RALLY_MS;

/** Pro každou událost: je druhou polovinou dvojice? Už spárovaná událost se s další nespáruje. */
function duplicateFlags(events: MatchEvent[]): boolean[] {
  const flags: boolean[] = [];
  events.forEach((e, i) => flags.push(!flags[i - 1] && sameRally(events[i - 1], e)));
  return flags;
}

export function actionTitle(type: ActionType): string {
  return type === 'oppErr' || type === 'oppPoint' ? TEAM_ACTION_TITLES[type] : PLAYER_ACTIONS[type].title;
}

export interface SetScore {
  us: number;
  them: number;
}

/** Skóre všech setů do aktuálního setu včetně. */
export function setScores(match: Pick<Match, 'events' | 'currentSet'>): SetScore[] {
  const scores: SetScore[] = Array.from({ length: match.currentSet }, () => ({ us: 0, them: 0 }));
  const dups = duplicateFlags(match.events);
  match.events.forEach((e, i) => {
    const side = pointFor(e);
    const s = scores[e.set - 1];
    if (side && s && !dups[i]) s[side]++;
  });
  return scores;
}

/** Kdo podává: tým, který vyhrál poslední výměnu aktuálního setu (null před prvním bodem). */
export function servingSide(match: Pick<Match, 'events' | 'currentSet'>): Side | null {
  let side: Side | null = null;
  const dups = duplicateFlags(match.events);
  for (let i = 0; i < match.events.length; i++) {
    const e = match.events[i];
    const point = e.set === match.currentSet ? pointFor(e) : null;
    if (point && !dups[i]) side = point;
  }
  return side;
}

export function isSetOver(score: SetScore, setNo: number, setsToWin: number): boolean {
  const target = setNo === setsToWin * 2 - 1 ? 15 : 25;
  return Math.max(score.us, score.them) >= target && Math.abs(score.us - score.them) >= 2;
}

/** Vyhrané sety: uzavřené sety (před aktuálním) podle vedoucího, aktuální jen když je dohraný. */
export function setsWon(match: Pick<Match, 'events' | 'currentSet' | 'setsToWin'>): SetScore {
  const won = { us: 0, them: 0 };
  setScores(match).forEach((s, i) => {
    const closed = i + 1 < match.currentSet ? s.us !== s.them : isSetOver(s, i + 1, match.setsToWin);
    if (closed) won[s.us > s.them ? 'us' : 'them']++;
  });
  return won;
}

export interface PlayerStats {
  points: number;
  errors: number;
  plusMinus: number;
  srvTot: number;
  srvErr: number;
  srvAce: number;
  rcvTot: number;
  rcvErr: number;
  atkTot: number;
  atkErr: number;
  atkBlocked: number;
  atkKill: number;
  /** Úspěšnost útoku v % (body / pokusy), null když hráč neútočil. */
  atkPct: number | null;
  blk: number;
  otherErr: number;
}

export type ActionCounts = Record<PlayerAction, number>;

export function emptyCounts(): ActionCounts {
  return Object.fromEntries(PLAYER_ACTION_KEYS.map((k) => [k, 0])) as ActionCounts;
}

/** Počty akcí po hráčích; `set` omezí výpočet na jeden set. */
export function countByPlayer(events: MatchEvent[], set?: number): Map<string, ActionCounts> {
  const map = new Map<string, ActionCounts>();
  for (const e of events) {
    if (!e.playerId || (set && e.set !== set) || !(e.type in PLAYER_ACTIONS)) continue;
    let c = map.get(e.playerId);
    if (!c) map.set(e.playerId, (c = emptyCounts()));
    c[e.type as PlayerAction]++;
  }
  return map;
}

export function toStats(c: ActionCounts): PlayerStats {
  const srvTot = c.srvAce + c.srv + c.srvErr;
  const atkTot = c.atkKill + c.atk + c.atkErr + c.atkBlocked;
  const points = c.srvAce + c.atkKill + c.blk;
  const errors = c.srvErr + c.rcvErr + c.atkErr + c.atkBlocked + c.err;
  return {
    points,
    errors,
    plusMinus: points - errors,
    srvTot,
    srvErr: c.srvErr,
    srvAce: c.srvAce,
    rcvTot: c.rcv + c.rcvErr,
    rcvErr: c.rcvErr,
    atkTot,
    atkErr: c.atkErr,
    atkBlocked: c.atkBlocked,
    atkKill: c.atkKill,
    atkPct: atkTot ? Math.round((c.atkKill / atkTot) * 100) : null,
    blk: c.blk,
    otherErr: c.err,
  };
}

export function sumCounts(list: Iterable<ActionCounts>): ActionCounts {
  const total = emptyCounts();
  for (const c of list) for (const k of PLAYER_ACTION_KEYS) total[k] += c[k];
  return total;
}
