type ArithmeticNode =
  | { kind: 'number'; value: number }
  | { kind: 'variable'; name: string }
  | { kind: 'unary'; operator: '+' | '-'; value: ArithmeticNode }
  | { kind: 'binary'; operator: '+' | '-' | '*' | '/' | '^'; left: ArithmeticNode; right: ArithmeticNode };

type ArithmeticToken =
  | { kind: 'number'; value: number }
  | { kind: 'identifier'; value: string }
  | { kind: 'operator'; value: '+' | '-' | '*' | '/' | '^' | '(' | ')' };

function tokenize(expression: string): ArithmeticToken[] {
  if (typeof expression !== 'string' || !expression.trim() || expression.length > 160) {
    throw new Error('Simulation expression must contain 1–160 characters.');
  }

  const tokens: ArithmeticToken[] = [];
  let cursor = 0;
  while (cursor < expression.length) {
    const rest = expression.slice(cursor);
    if (/^\s+/.test(rest)) {
      cursor += rest.match(/^\s+/)![0].length;
      continue;
    }

    const number = rest.match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
    if (number) {
      const value = Number(number[0]);
      if (!Number.isFinite(value)) throw new Error('Simulation expression contains a non-finite number.');
      tokens.push({ kind: 'number', value });
      cursor += number[0].length;
      continue;
    }

    const identifier = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifier) {
      tokens.push({ kind: 'identifier', value: identifier[0] });
      cursor += identifier[0].length;
      continue;
    }

    const operator = rest[0];
    if ('+-*/^()'.includes(operator)) {
      tokens.push({ kind: 'operator', value: operator as ArithmeticToken & string });
      cursor += 1;
      continue;
    }

    throw new Error(`Unsupported character "${operator}" in simulation expression.`);
  }

  if (tokens.length === 0 || tokens.length > 80) {
    throw new Error('Simulation expression has an invalid number of terms.');
  }
  return tokens;
}

function parseExpression(tokens: ArithmeticToken[]): ArithmeticNode {
  let cursor = 0;
  const peek = () => tokens[cursor];
  const consume = () => tokens[cursor++];

  const parsePrimary = (): ArithmeticNode => {
    const token = consume();
    if (!token) throw new Error('Simulation expression ended unexpectedly.');
    if (token.kind === 'number') return { kind: 'number', value: token.value };
    if (token.kind === 'identifier') return { kind: 'variable', name: token.value };
    if (token.kind === 'operator' && token.value === '(') {
      const inner = parseAdditive();
      const closing = consume();
      if (!closing || closing.kind !== 'operator' || closing.value !== ')') {
        throw new Error('Simulation expression has an unmatched parenthesis.');
      }
      return inner;
    }
    throw new Error('Simulation expression contains an unexpected token.');
  };

  const parsePower = (): ArithmeticNode => {
    const left = parsePrimary();
    const token = peek();
    if (token?.kind === 'operator' && token.value === '^') {
      consume();
      return { kind: 'binary', operator: '^', left, right: parseUnary() };
    }
    return left;
  };

  const parseUnary = (): ArithmeticNode => {
    const token = peek();
    if (token?.kind === 'operator' && (token.value === '+' || token.value === '-')) {
      consume();
      return { kind: 'unary', operator: token.value, value: parseUnary() };
    }
    return parsePower();
  };

  const parseMultiplicative = (): ArithmeticNode => {
    let left = parseUnary();
    while (true) {
      const token = peek();
      if (token?.kind !== 'operator' || (token.value !== '*' && token.value !== '/')) break;
      consume();
      left = { kind: 'binary', operator: token.value, left, right: parseUnary() };
    }
    return left;
  };

  const parseAdditive = (): ArithmeticNode => {
    let left = parseMultiplicative();
    while (true) {
      const token = peek();
      if (token?.kind !== 'operator' || (token.value !== '+' && token.value !== '-')) break;
      consume();
      left = { kind: 'binary', operator: token.value, left, right: parseMultiplicative() };
    }
    return left;
  };

  const ast = parseAdditive();
  if (cursor !== tokens.length) throw new Error('Simulation expression contains trailing or unsupported syntax.');
  return ast;
}

function evaluateNode(node: ArithmeticNode, variables: Record<string, number>): number {
  if (node.kind === 'number') return node.value;
  if (node.kind === 'variable') {
    const value = variables[node.name];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Simulation variable "${node.name}" has no finite value.`);
    }
    return value;
  }
  if (node.kind === 'unary') {
    const value = evaluateNode(node.value, variables);
    return node.operator === '-' ? -value : value;
  }

  const left = evaluateNode(node.left, variables);
  const right = evaluateNode(node.right, variables);
  switch (node.operator) {
    case '+': return left + right;
    case '-': return left - right;
    case '*': return left * right;
    case '/':
      if (right === 0) throw new Error('The current inputs produce division by zero.');
      return left / right;
    case '^': return left ** right;
  }
}

export function validateArithmeticExpression(expression: string, allowedVariables: string[]): void {
  const ast = parseExpression(tokenize(expression));
  const allowed = new Set(allowedVariables);
  const inspect = (node: ArithmeticNode): void => {
    if (node.kind === 'variable') {
      if (!allowed.has(node.name)) {
        throw new Error(`Simulation expression references undefined variable "${node.name}".`);
      }
      return;
    }
    if (node.kind === 'unary') inspect(node.value);
    if (node.kind === 'binary') {
      inspect(node.left);
      inspect(node.right);
    }
  };
  inspect(ast);
}

export function evaluateArithmeticExpression(expression: string, variables: Record<string, number>): number {
  const ast = parseExpression(tokenize(expression));
  const result = evaluateNode(ast, variables);
  if (!Number.isFinite(result)) throw new Error('The current inputs produce a non-finite result.');
  return result;
}
