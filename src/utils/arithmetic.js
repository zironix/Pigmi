function createParser(source) {
  let position = 0;

  function parseNumber() {
    const match = source.slice(position).match(/^(?:\d+\.?\d*|\.\d+)/);
    if (!match) throw new SyntaxError('Expected a number');
    position += match[0].length;
    return Number(match[0]);
  }

  function parseFactor() {
    const operator = source[position];
    if (operator === '+' || operator === '-') {
      position += 1;
      const value = parseFactor();
      return operator === '-' ? -value : value;
    }

    if (source[position] === '(') {
      position += 1;
      const value = parseExpression();
      if (source[position] !== ')') throw new SyntaxError('Expected a closing parenthesis');
      position += 1;
      return value;
    }

    return parseNumber();
  }

  function parseTerm() {
    let value = parseFactor();
    while (source[position] === '*' || source[position] === '/') {
      const operator = source[position];
      position += 1;
      const right = parseFactor();
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  }

  function parseExpression() {
    let value = parseTerm();
    while (source[position] === '+' || source[position] === '-') {
      const operator = source[position];
      position += 1;
      const right = parseTerm();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  return {
    evaluate() {
      const result = parseExpression();
      if (position !== source.length || !Number.isFinite(result)) {
        throw new SyntaxError('Invalid arithmetic expression');
      }
      return result;
    },
  };
}

/**
 * Evaluates basic numeric input without executing JavaScript.
 *
 * Supported syntax is limited to decimal numbers, parentheses and +, -, *, /.
 * Invalid input returns null so UI controls can preserve the user's value.
 */
export function evaluateArithmetic(expression) {
  const source = String(expression ?? '').replace(/\s+/g, '');
  if (!source) return null;

  try {
    return createParser(source).evaluate();
  } catch {
    return null;
  }
}
