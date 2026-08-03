import { describe, expect, it } from 'vitest';

import { evaluateArithmetic } from '../src/utils/arithmetic';

describe('evaluateArithmetic', () => {
  it('respects precedence, parentheses and unary signs', () => {
    expect(evaluateArithmetic('2 + 3 * 4')).toBe(14);
    expect(evaluateArithmetic('(2 + 3) * -4')).toBe(-20);
  });

  it('supports decimal values', () => {
    expect(evaluateArithmetic('.5 + 1.25')).toBe(1.75);
  });

  it('rejects JavaScript and invalid arithmetic', () => {
    expect(evaluateArithmetic('window.alert(1)')).toBeNull();
    expect(evaluateArithmetic('1 / 0')).toBeNull();
    expect(evaluateArithmetic('2 +')).toBeNull();
  });
});
