import { describe, expect, it } from 'vitest';
import { canCreateMatch, canWrite, daysLeft, licenseOf, TRIAL_MATCHES } from './club';

const now = new Date('2026-11-06T12:00:00Z');

describe('licence klubu', () => {
  it('bez licence je zkušební verze s limitem zápasů', () => {
    expect(licenseOf({ licenseUntil: null, matchesCreated: 0 }, now)).toEqual({ kind: 'trial', left: TRIAL_MATCHES });
    const used = licenseOf({ licenseUntil: null, matchesCreated: 5 }, now);
    expect(used).toEqual({ kind: 'trial', left: 0 });
    expect(canCreateMatch(used)).toBe(false);
    expect(canWrite(used)).toBe(true); // existující zkušební zápasy jde dál upravovat
  });

  it('platná licence dovolí vše, vypršelá jen čtení', () => {
    const active = licenseOf({ licenseUntil: new Date('2027-11-06T12:00:00Z'), matchesCreated: 99 }, now);
    expect(active.kind).toBe('active');
    expect(canCreateMatch(active) && canWrite(active)).toBe(true);
    const expired = licenseOf({ licenseUntil: new Date('2026-11-05T12:00:00Z'), matchesCreated: 0 }, now);
    expect(expired.kind).toBe('expired');
    expect(canCreateMatch(expired) || canWrite(expired)).toBe(false);
  });

  it('spočítá zbývající dny', () => {
    expect(daysLeft(new Date('2026-11-16T12:00:00Z'), now)).toBe(10);
  });
});
