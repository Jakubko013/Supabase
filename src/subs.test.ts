import { describe, expect, it } from 'vitest';
import type { Match, Player, Substitution } from './types';
import { MAX_SUBS, subError, subTag } from './subs';

const pl = (id: string, libero?: boolean): Player => ({ id, number: id, name: '', libero });
const P = Object.fromEntries(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16'].map((n) => [n, pl(n)]));
const L = pl('L', true);

function match(subs: [string, string][], started = true): Match {
  return {
    id: 'm', createdAt: 0, date: '2026-10-17', team: 'A', opponent: 'B', setsToWin: 3,
    players: [...Object.values(P), L], onCourt: [], oppPlayers: [], oppOnCourt: [],
    subs: subs.map(([out, inn]): Substitution => ({ set: 1, side: 'us', out, in: inn })),
    events: started ? [{ id: 'e', set: 1, type: 'srv', playerId: '1', t: 0 }] : [], currentSet: 1, finished: false,
  };
}

describe('střídání podle pravidel', () => {
  it('náhradníka smí vystřídat jen hráč, za kterého přišel', () => {
    const m = match([['1', '7']]);
    expect(subError(m, 'us', P['7'], P['8'])).toMatch(/#7 může vystřídat jen #1/);
    expect(subError(m, 'us', P['7'], P['1'])).toBeNull();
    expect(subError(m, 'us', P['2'], P['1'])).toMatch(/#1 se může vrátit jen za #7/);
    expect(subTag(m, 'us', '7')).toBe('za #1');
    expect(subTag(m, 'us', '1')).toBe('jen za #7');
  });

  it('po návratu už dvojice v setu nestřídá', () => {
    const m = match([['1', '7'], ['7', '1']]);
    expect(subError(m, 'us', P['1'], P['8'])).toMatch(/#1 už v tomto setu střídal/);
    expect(subError(m, 'us', P['2'], P['7'])).toMatch(/#7 už v tomto setu střídal/);
    expect(subTag(m, 'us', '1')).toBe('už nestřídá');
  });

  it(`hlídá limit ${MAX_SUBS} střídání v setu`, () => {
    const pairs: [string, string][] = [['1', '9'], ['9', '1'], ['2', '10'], ['10', '2'], ['3', '11'], ['11', '3'], ['4', '12'], ['12', '4']];
    expect(subError(match(pairs), 'us', P['5'], P['13'])).toMatch(/vyčerpal 8 střídání/);
    expect(subError(match(pairs.slice(0, 7)), 'us', P['5'], P['13'])).toBeNull();
  });

  it('libero a změny sestavy před začátkem setu se nepočítají', () => {
    expect(subError(match([['1', '7']]), 'us', P['7'], L)).toBeNull();
    expect(subError(match([['1', '7']], false), 'us', P['7'], P['8'])).toBeNull();
  });
});
