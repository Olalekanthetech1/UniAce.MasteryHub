import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateSimulationExpression,
  validateSimulationExpression
} from '../src/shared/simulationExpression';

test('validates declared simulation variables and evaluates engineering expressions', () => {
  validateSimulationExpression('rho * g * x', ['rho', 'g']);
  assert.equal(
    evaluateSimulationExpression('rho * g * x', { rho: 1000, g: 9.81, x: 2 }),
    19620
  );
});

test('supports bounded mathematical functions, constants and exponent precedence', () => {
  validateSimulationExpression('sqrt(x^2) + sin(pi / 2) + e', []);
  const result = evaluateSimulationExpression('sqrt(x^2) + sin(pi / 2) + e', { x: 3 });
  assert.ok(Math.abs(result - (3 + 1 + Math.E)) < 1e-12);
  assert.equal(evaluateSimulationExpression('pow(x, 2)', { x: 4 }), 16);
});

test('rejects undeclared variables, unsupported functions and malformed syntax', () => {
  assert.throws(
    () => validateSimulationExpression('rho * g * x', ['rho']),
    /undeclared variable "g"/
  );
  assert.throws(
    () => validateSimulationExpression('process(1)', []),
    /Unsupported mathematical function "process"/
  );
  assert.throws(
    () => validateSimulationExpression('sqrt(', []),
    /unmatched parenthesis|ended unexpectedly/
  );
});

test('reports undefined model domains such as division by zero', () => {
  assert.throws(
    () => evaluateSimulationExpression('1 / (x - 2)', { x: 2 }),
    /division by zero/
  );
});
