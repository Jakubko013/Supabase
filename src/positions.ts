import type { Player, Position } from './types';

export const POSITIONS: { value: Position; label: string; short: string }[] = [
  { value: 'nahrávač', label: 'Nahrávač', short: 'N' },
  { value: 'smečař', label: 'Smečař', short: 'S' },
  { value: 'blokař', label: 'Blokař', short: 'B' },
  { value: 'univerzál', label: 'Univerzál', short: 'U' },
  { value: 'libero', label: 'Libero', short: 'L' },
];

const POSITION_RE = /^(nahrávač|smečař|blokař|univerzál|libero)(ka)?$/i;

/** Post z textu buňky nebo z cvf.cz, např. „smečařka“ → smečař. */
export function toPosition(text?: string | null): Position | undefined {
  const m = (text ?? '').trim().match(POSITION_RE);
  return m ? (m[1].toLowerCase() as Position) : undefined;
}

const find = (p: Pick<Player, 'libero' | 'position'>) => POSITIONS.find((x) => x.value === (p.libero ? 'libero' : p.position));

/** Zkratka postu (N, S, B, U, L) nebo prázdný řetězec. */
export const positionShort = (p: Pick<Player, 'libero' | 'position'>) => find(p)?.short ?? '';
export const positionLabel = (p: Pick<Player, 'libero' | 'position'>) => find(p)?.label ?? '';
