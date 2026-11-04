import type { Match, Player, Side, Substitution } from './types';
import { teamPlayers } from './stats';

/** Maximální počet střídání jednoho týmu v setu (libero se nepočítá). */
export const MAX_SUBS = 8;

interface Pair {
  starter: string;
  sub: string;
  returned: boolean;
}

/**
 * Dvojice ze střídání v setu. Hráč základní sestavy smí odejít a vrátit se jen jednou a jen za svého
 * náhradníka; náhradník smí přijít jen jednou a vystřídat ho smí jen tentýž hráč. Po návratu je dvojice uzavřená.
 */
export function subPairs(subs: Substitution[]): Pair[] {
  const pairs: Pair[] = [];
  for (const s of subs) {
    const back = pairs.find((p) => !p.returned && p.sub === s.out && p.starter === s.in);
    if (back) back.returned = true;
    else pairs.push({ starter: s.out, sub: s.in, returned: false });
  }
  return pairs;
}

export const setSubs = (m: Pick<Match, 'subs' | 'currentSet'>, side: Side) =>
  m.subs.filter((s) => s.set === m.currentSet && s.side === side);

/** Set už běží (je zapsaná aspoň jedna akce) – do té doby jde sestavu měnit volně, nejde o střídání. */
export const setStarted = (m: Pick<Match, 'events' | 'currentSet'>) => m.events.some((e) => e.set === m.currentSet);

/** Jde o střídání podle pravidel (běží set, bez libera)? */
export const countsAsSub = (m: Match, out?: Player, inn?: Player) => setStarted(m) && !out?.libero && !inn?.libero;

const num = (m: Match, side: Side, id: string) => {
  const p = teamPlayers(m, side).find((x) => x.id === id);
  return p ? `#${p.number || '?'}` : 'hráč';
};

/** Proč střídání není podle pravidel povolené (null = povolené). Stačí zadat jen jednoho z hráčů. */
export function subError(m: Match, side: Side, out?: Player, inn?: Player): string | null {
  if (!countsAsSub(m, out, inn)) return null;
  const subs = setSubs(m, side);
  const pairs = subPairs(subs);
  const pairOf = (p?: Player) => (p ? pairs.find((x) => x.starter === p.id || x.sub === p.id) : undefined);
  const po = pairOf(out);
  const pi = pairOf(inn);
  for (const [p, pair] of [[out, po], [inn, pi]] as const) {
    if (p && pair?.returned) return `${num(m, side, p.id)} už v tomto setu střídal tam i zpět, znovu nesmí.`;
  }
  if (out && inn && po?.sub === out.id && po.starter !== inn.id) {
    return `${num(m, side, out.id)} může vystřídat jen ${num(m, side, po.starter)}, za kterého přišel.`;
  }
  if (out && inn && pi?.starter === inn.id && pi.sub !== out.id) {
    return `${num(m, side, inn.id)} se může vrátit jen za ${num(m, side, pi.sub)}.`;
  }
  if (subs.length >= MAX_SUBS) return `Tým už v tomto setu vyčerpal ${MAX_SUBS} střídání.`;
  return null;
}

/** Krátký popisek ke hráči ve dvojici: „za #7“, „jen za #12“, „už nestřídá“. */
export function subTag(m: Match, side: Side, id: string): string | null {
  const pair = subPairs(setSubs(m, side)).find((p) => p.starter === id || p.sub === id);
  if (!pair) return null;
  if (pair.returned) return 'už nestřídá';
  return id === pair.sub ? `za ${num(m, side, pair.starter)}` : `jen za ${num(m, side, pair.sub)}`;
}
