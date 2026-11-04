import { describe, expect, it } from 'vitest';
import type { ActionType, MatchEvent } from './types';
import { countByPlayer, isSetOver, servingSide, setScores, setsWon, sumCounts, toStats } from './stats';

let n = 0;
const ev = (type: ActionType, set = 1, playerId?: string, team?: 'them'): MatchEvent => ({ id: String(n++), set, type, playerId, team, t: 0 });
const repeat = (count: number, type: ActionType, set = 1, playerId?: string) => Array.from({ length: count }, () => ev(type, set, playerId));

describe('skóre', () => {
  it('připíše body správné straně', () => {
    const events = [ev('srvAce', 1, 'a'), ev('atkKill', 1, 'a'), ev('oppErr'), ev('srvErr', 1, 'a'), ev('atk', 1, 'a'), ev('oppPoint')];
    expect(setScores({ events, currentSet: 1 })).toEqual([{ us: 3, them: 2 }]);
  });

  it('akce hráčů soupeře připíše opačně', () => {
    const events = [ev('atkKill', 1, 'x', 'them'), ev('srvErr', 1, 'x', 'them'), ev('blk', 1, 'x', 'them')];
    expect(setScores({ events, currentSet: 1 })).toEqual([{ us: 1, them: 2 }]);
  });

  it('obě strany jedné výměny započítá jen jednou', () => {
    const events = [
      ev('srvAce', 1, 'a'), ev('rcvErr', 1, 'x', 'them'), // naše eso + chyba přihrávky soupeře = 1 bod
      ev('atkBlocked', 1, 'a'), ev('blk', 1, 'x', 'them'), // náš zablokovaný útok + blok soupeře = 1 bod soupeři
      ev('rcvErr', 1, 'a'), ev('srvAce', 1, 'x', 'them'), // i v opačném pořadí
      ev('srvAce', 1, 'a'), ev('srvAce', 1, 'b'), // dvě esa po sobě = dvě výměny
    ];
    expect(setScores({ events, currentSet: 1 })).toEqual([{ us: 3, them: 2 }]);
  });

  it('protistranu započítá zvlášť, když od předchozí akce uběhla delší doba (jiná výměna)', () => {
    const blocked = { ...ev('atkBlocked', 1, 'a'), t: 0 };
    const block = { ...ev('blk', 1, 'x', 'them'), t: 30_000 };
    expect(setScores({ events: [blocked, block], currentSet: 1 })).toEqual([{ us: 0, them: 2 }]);
  });

  it('pozná konec setu včetně tie-breaku a rozdílu 2 bodů', () => {
    expect(isSetOver({ us: 25, them: 23 }, 1, 3)).toBe(true);
    expect(isSetOver({ us: 25, them: 24 }, 1, 3)).toBe(false);
    expect(isSetOver({ us: 15, them: 13 }, 5, 3)).toBe(true);
    expect(isSetOver({ us: 15, them: 13 }, 3, 2)).toBe(true);
    expect(isSetOver({ us: 15, them: 13 }, 3, 3)).toBe(false);
  });

  it('spočítá vyhrané sety', () => {
    const events = [...repeat(25, 'oppErr', 1), ...repeat(20, 'oppPoint', 1), ...repeat(25, 'oppPoint', 2), ...repeat(10, 'oppErr', 3)];
    expect(setsWon({ events, currentSet: 3, setsToWin: 3 })).toEqual({ us: 1, them: 1 });
  });
});

describe('skóre – deduplikace párů', () => {
  it('již spárovaná událost se nespáruje s další', () => {
    const events = [ev('srvAce', 1, 'p1'), ev('rcvErr', 1, 'o1', 'them'), ev('srvAce', 1, 'p1'), ev('rcvErr', 1, 'o1', 'them')];
    expect(setScores({ events, currentSet: 1 })).toEqual([{ us: 2, them: 0 }]);
  });

  it('eso, chyba přihrávky, eso = 2:0', () => {
    const events = [ev('srvAce', 1, 'p1'), ev('rcvErr', 1, 'o1', 'them'), ev('srvAce', 1, 'p1')];
    expect(setScores({ events, currentSet: 1 })).toEqual([{ us: 2, them: 0 }]);
  });

  it('řetěz blok/zablokovaný útok se páruje po dvojicích', () => {
    const events = [ev('blk', 1, 'p1'), ev('atkBlocked', 1, 'o1', 'them'), ev('blk', 1, 'p1'), ev('atkBlocked', 1, 'o1', 'them')];
    expect(setScores({ events, currentSet: 1 })).toEqual([{ us: 2, them: 0 }]);
  });

  it('pár přes hranici setu se nededuplikuje', () => {
    const events = [ev('srvAce', 1, 'p1'), ev('rcvErr', 2, 'o1', 'them')];
    expect(setScores({ events, currentSet: 2 })).toEqual([{ us: 1, them: 0 }, { us: 1, them: 0 }]);
  });

  it('servingSide: eso, chyba přihrávky, eso → podává my', () => {
    const events = [ev('srvAce', 1, 'p1'), ev('rcvErr', 1, 'o1', 'them'), ev('srvAce', 1, 'p1')];
    expect(servingSide({ events, currentSet: 1 })).toBe('us');
  });

  it('servingSide: třetí událost bod soupeře není dedup ovlivněna', () => {
    const events = [ev('srvAce', 1, 'p1'), ev('rcvErr', 1, 'o1', 'them'), ev('oppPoint', 1)];
    expect(servingSide({ events, currentSet: 1 })).toBe('them');
  });
});

describe('vyhrané sety – nové chování', () => {
  const pts = (us: number, them: number, set: number) => [...repeat(us, 'oppErr', set), ...repeat(them, 'oppPoint', set)];

  it('dřívější set se počítá vedoucímu i bez 25 bodů', () => {
    const events = [...pts(10, 5, 1), ...pts(3, 8, 2), ...pts(1, 0, 3)];
    expect(setsWon({ events, currentSet: 3, setsToWin: 3 })).toEqual({ us: 1, them: 1 });
  });

  it('remíza v dřívějším setu se nepočítá nikomu', () => {
    const events = [...pts(5, 5, 1), ...pts(1, 0, 2)];
    expect(setsWon({ events, currentSet: 2, setsToWin: 3 })).toEqual({ us: 0, them: 0 });
  });

  it('aktuální set se počítá jen když je dohraný', () => {
    expect(setsWon({ events: pts(24, 20, 1), currentSet: 1, setsToWin: 3 })).toEqual({ us: 0, them: 0 });
    expect(setsWon({ events: pts(25, 24, 1), currentSet: 1, setsToWin: 3 })).toEqual({ us: 0, them: 0 });
    expect(setsWon({ events: pts(25, 23, 1), currentSet: 1, setsToWin: 3 })).toEqual({ us: 1, them: 0 });
    expect(setsWon({ events: pts(20, 25, 1), currentSet: 1, setsToWin: 3 })).toEqual({ us: 0, them: 1 });
  });

  it('rozhodující set končí na 15', () => {
    expect(setsWon({ events: pts(15, 13, 3), currentSet: 3, setsToWin: 2 })).toEqual({ us: 1, them: 0 });
    expect(setsWon({ events: pts(15, 14, 3), currentSet: 3, setsToWin: 2 })).toEqual({ us: 0, them: 0 });
  });
});

describe('statistika hráče', () => {
  it('sečte podání, přihrávku, útok, blok a úspěšnost', () => {
    const events = [
      ev('srvAce', 1, 'a'), ev('srv', 1, 'a'), ev('srvErr', 2, 'a'),
      ev('rcv', 1, 'a'), ev('rcvErr', 1, 'a'),
      ev('atkKill', 1, 'a'), ev('atkKill', 1, 'a'), ev('atk', 1, 'a'), ev('atkBlocked', 1, 'a'),
      ev('blk', 1, 'a'), ev('err', 1, 'a'), ev('atkKill', 1, 'b'), ev('oppErr', 1),
    ];
    const s = toStats(countByPlayer(events).get('a')!);
    expect(s).toMatchObject({ srvTot: 3, srvErr: 1, srvAce: 1, rcvTot: 2, rcvErr: 1, atkTot: 4, atkKill: 2, atkBlocked: 1, atkPct: 50, blk: 1 });
    expect(s.points).toBe(4);
    expect(s.errors).toBe(4);
    expect(s.plusMinus).toBe(0);
    expect(toStats(countByPlayer(events, 2).get('a')!).srvErr).toBe(1);
    expect(toStats(sumCounts(countByPlayer(events).values())).atkKill).toBe(3);
  });

  it('bez útoku nemá úspěšnost', () => {
    expect(toStats(countByPlayer([ev('rcv', 1, 'a')]).get('a')!).atkPct).toBeNull();
  });
});
