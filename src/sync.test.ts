import { describe, expect, it } from 'vitest';
import { diffMatches, reconcile } from './sync';
import type { Match } from './types';

const m = (id: string, createdAt = 1): Match =>
  ({ id, createdAt, date: '', team: 'A', opponent: 'B', setsToWin: 3, players: [], onCourt: [], oppPlayers: [], oppOnCourt: [], subs: [], events: [], currentSet: 1, finished: false }) as Match;

describe('diffMatches', () => {
  it('pozná změněné, nové i smazané zápasy', () => {
    const a = m('a'), b = m('b');
    const b2 = { ...b, finished: true };
    expect(diffMatches([a, b], [b2, m('c')])).toEqual({ changed: ['b', 'c'], removed: ['a'] });
  });
});

describe('reconcile', () => {
  it('neodeslaná lokální změna vyhraje nad serverem', () => {
    const local = { ...m('a'), team: 'LOCAL' };
    const out = reconcile([local], [{ ...m('a'), team: 'REMOTE' }], new Set(['a']), new Set());
    expect(out[0]!.team).toBe('LOCAL');
  });
  it('jinak platí server a přidají se zápasy z jiných zařízení', () => {
    const out = reconcile([m('a')], [{ ...m('a'), team: 'REMOTE' }, m('b', 5)], new Set(), new Set());
    expect(out.map((x) => x.id)).toEqual(['b', 'a']);
    expect(out.find((x) => x.id === 'a')!.team).toBe('REMOTE');
  });
  it('zápas smazaný na jiném zařízení zmizí, čekající nový zůstane', () => {
    const out = reconcile([m('old'), m('new')], [], new Set(['new']), new Set());
    expect(out.map((x) => x.id)).toEqual(['new']);
  });
  it('lokálně smazaný zápas se ze serveru nevrátí, dokud se nesmaže i tam', () => {
    expect(reconcile([], [m('x')], new Set(), new Set(['x']))).toEqual([]);
  });
});
