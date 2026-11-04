// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDemoMatch } from './demo';
import { createBackup, mergeMatches, parseBackup } from './backup';

describe('záloha', () => {
  it('uloží a znovu načte zápasy i soupisky', () => {
    const m = createDemoMatch();
    const restored = parseBackup(createBackup([m], [{ team: 'TJ Ukázka', players: m.players, savedAt: 1 }]));
    expect(restored.matches[0].events).toHaveLength(m.events.length);
    expect(restored.rosters[0].team).toBe('TJ Ukázka');
  });

  it('odmítne cizí nebo poškozený soubor', () => {
    expect(() => parseBackup('nic')).toThrow(/nejde přečíst/);
    expect(() => parseBackup('{"app":"jina"}')).toThrow(/není záloha/);
    expect(() => parseBackup('{"app":"volejbal-statistika","matches":[{"id":1}]}')).toThrow(/poškozená/);
  });

  it('nepřepíše zápasy, které už v zařízení jsou', () => {
    const a = { ...createDemoMatch(), id: 'a', createdAt: 1 };
    const b = { ...createDemoMatch(), id: 'b', createdAt: 2 };
    const { merged, added, skipped } = mergeMatches([a], [a, b]);
    expect([added, skipped]).toEqual([1, 1]);
    expect(merged.map((m) => m.id)).toEqual(['b', 'a']);
  });
});
