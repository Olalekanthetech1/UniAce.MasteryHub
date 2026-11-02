type ArithmeticNode =
  | { kind: 'number'; value: number }
  | { kind: 'variable'; name: string }
  | { kind: 'unary'; operator: '+' | '-'; value: ArithmeticNode }
  | { kind: 'binary'; operator: '+' | '-' | '*' | '/' | '^'; left: ArithmeticNode; right: ArithmeticNode }
  | { kind: 'call'; name: string; args: ArithmeticNode[] };

type ArithmeticToken =
  | { kind: 'number'; value: number }
  | { kind: 'identifier'; value: string }
  | { kind: 'operator'; value: '+' | '-' | '*' | '/' | '^' | '(' | ')' | ',' };

const MATH_FUNCTIONS: Record<string, (...values: number[]) => number> = {
  abs: Math.abs,
  acos: Math.acos,
  acosh: Math.acosh,
  asin: Math.asin,
  asinh: Math.asinh,
  atan: Math.atan,
  atan2: Math.atan2,
  atanh: Math.atanh,
  ceil: Math.ceil,
  cos: Math.cos,
  cosh: Math.cosh,
  exp: Math.exp,
  floor: Math.floor,
  log: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  max: Math.max,
  min: Math.min,
  pow: Math.pow,
  round: Math.round,
  sign: Math.sign,
  sin: Math.sin,
  sinh: Math.sinh,
  sqrt: Math.sqrt,
  tan: Math.tan,
  tanh: Math.tanh,
  trunc: Math.trunc
};

function tokenize(expression: string): ArithmeticToken[] {
  if (typeof expression !== 'string' || !expression.trim() || expression.length > 300) {
    throw new Error('Simulation expression must contain 1–300 characters.');
  }

  const tokens: ArithmeticToken[] = [];
  let cursor = 0;
  while (cursor < expression.length) {
    const rest = expression.slice(cursor);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) {
      cursor += whitespace[0].length;
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
    if (
      operator === '+' ||
      operator === '-' ||
      operator === '*' ||
      operator === '/' ||
      operator === '^' ||
      operator === '(' ||
      operator === ')' ||
      operator === ','
    ) {
      tokens.push({ kind: 'operator', value: operator });
      cursor += 1;
      continue;
    }

    throw new Error(`Unsupported character "${operator}" in simulation expression.`);
  }

  if (tokens.length === 0 || tokens.length > 120) {
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
    if (token.kind === 'identifier') {
      if (token.value === 'pi') return { kind: 'number', value: Math.PI };
      if (token.value === 'e') return { kind: 'number', value: Math.E };

      const opening = peek();
      if (opening?.kind === 'operator' && opening.value === '(') {
        if (!Object.prototype.hasOwnProperty.call(MATH_FUNCTIONS, token.value)) {
          throw new Error(`Unsupported mathematical function "${token.value}".`);
        }
        consume();
        const args: ArithmeticNode[] = [];
        const first = peek();
        if (!(first?.kind === 'operator' && first.value === ')')) {
          while (true) {
            args.push(parseAdditive());
            const separator = peek();
            if (separator?.kind === 'operator' && separator.value === ',') {
              consume();
              continue;
            }
            break;
          }
        }
        const closing = consume();
        if (!closing || closing.kind !== 'operator' || closing.value !== ')') {
          throw new Error(`Function call "${token.value}" has an unmatched parenthesis.`);
        }
        if (args.length === 0) throw new Error(`Function "${token.value}" requires at least one argument.`);
        if (token.value === 'atan2' && args.length !== 2) throw new Error('Function atan2 requires exactly two arguments.');
        if (token.value === 'pow' && args.length !== 2) throw new Error('Function pow requires exactly two arguments.');
        if (!['min', 'max', 'atan2', 'pow'].includes(token.value) && args.length !== 1) {
          throw new Error(`Function ${token.value} requires exactly one argument.`);
        }
        return { kind: 'call', name: token.value, args };
      }

      return { kind: 'variable', name: token.value };
    }
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
  if (node.kind === 'call') {
    const fn = MATH_FUNCTIONS[node.name];
    const result = fn(...node.args.map((argument) => evaluateNode(argument, variables)));
    if (!Number.isFinite(result)) throw new Error(`Function ${node.name} is undefined for the current inputs.`);
    return result;
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

export function compileSimulationExpression(
  expression: string,
  allowedVariables: string[]
): (variables: Record<string, number>) => number {
  const ast = parseExpression(tokenize(expression));
  const allowed = new Set([...allowedVariables, 'x', 'pi', 'e']);
  const inspect = (node: ArithmeticNode): void => {
    if (node.kind === 'variable') {
      if (!allowed.has(node.name)) {
        throw new Error(`Simulation expression references undeclared variable "${node.name}".`);
      }
      return;
    }
    if (node.kind === 'unary') inspect(node.value);
    if (node.kind === 'binary') {
      inspect(node.left);
      inspect(node.right);
    }
    if (node.kind === 'call') node.args.forEach(inspect);
  };
  inspect(ast);

  return (variables) => {
    const result = evaluateNode(ast, variables);
    if (!Number.isFinite(result)) throw new Error('The current inputs produce a non-finite result.');
    return result;
  };
}

export function validateSimulationExpression(expression: string, allowedVariables: string[]): void {
  compileSimulationExpression(expression, allowedVariables);
}

export function evaluateSimulationExpression(expression: string, variables: Record<string, number>): number {
  return compileSimulationExpression(expression, Object.keys(variables))(variables);
}
