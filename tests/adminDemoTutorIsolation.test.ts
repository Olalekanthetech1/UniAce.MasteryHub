import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminDemoTutorRequestSchema, buildAdminDemoTutorMessages } from '../server/services/adminDemoTutor';

test('isolated admin tutor request accepts only prompt and optional course context', () => {
  assert.equal(AdminDemoTutorRequestSchema.safeParse({ message: 'Explain viscosity.' }).success, true);
  assert.equal(AdminDemoTutorRequestSchema.safeParse({ message: 'Explain viscosity.', courseContext: 'GET 205' }).success, true);
  assert.equal(AdminDemoTutorRequestSchema.safeParse({ message: '   ' }).success, false);
  assert.equal(AdminDemoTutorRequestSchema.safeParse({ message: 'Explain this.', uid: 'student-123' }).success, false);
  assert.equal(AdminDemoTutorRequestSchema.safeParse({ message: 'Explain this.', currentSparks: 100 }).success, false);
  assert.equal(AdminDemoTutorRequestSchema.safeParse({ message: 'Explain this.', history: [{ role: 'user', content: 'Prior conversation' }] }).success, false);
  assert.equal(AdminDemoTutorRequestSchema.safeParse({ message: 'Explain this.', role: 'admin' }).success, false);
});

test('isolated admin tutor prompt contains no student identity, profile or conversation history', () => {
  const messages = buildAdminDemoTutorMessages({ message: 'Explain Bernoulli equation.', courseContext: 'GET 205 — Fluid Mechanics' });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].role, 'user');
  assert.match(messages[1].content, /Explain Bernoulli equation/);
  assert.match(messages[1].content, /GET 205/);
  assert.match(messages[0].content, /There is no student profile, learning history, name, progress record or previous conversation available/);
  assert.equal(messages.some((entry: any) => 'history' in entry || 'uid' in entry || 'sparks' in entry), false);
});

test('isolated admin prompt builder does not invent course context', () => {
  const messages = buildAdminDemoTutorMessages({ message: 'Define density.' });
  assert.equal(messages[1].content, 'Define density.');
  assert.doesNotMatch(messages[1].content, /MTH|PHY|GET|KWASU|100L/);
});
