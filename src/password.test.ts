import { describe, expect, it } from 'vitest';
import { passwordProblem } from './password';

describe('passwordProblem', () => {
  it('odmítne krátké heslo', () => expect(passwordProblem('kratke')).toMatch(/12/));
  it('odmítne heslo obsahující jméno z e-mailu', () => expect(passwordProblem('jakubkocvara123!', 'jakubkocvara@x.cz')).not.toBeNull());
  it('odmítne samé stejné znaky', () => expect(passwordProblem('aaaaaaaaaaaaaa')).not.toBeNull());
  it('přijme rozumné heslo', () => expect(passwordProblem('modra-zirafa-skace-9', 'a@b.cz')).toBeNull());
});
