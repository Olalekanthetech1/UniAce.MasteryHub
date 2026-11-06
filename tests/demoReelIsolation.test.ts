import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoScenario, isDemoScenarioIsolated } from '../src/services/demoReelService';

function scenario(step: Record<string, unknown>): DemoScenario {
  return {
    id: 'test-scenario',
    name: 'Test scenario',
    tagline: 'Test',
    totalDurationSec: 10,
    recommendedFor: [],
    aspectRatioHint: '16:9 Landscape',
    steps: [{
      id: 'step-1',
      view: 'ai-tutor',
      durationMs: 10000,
      title: 'Tutor',
      subtitle: 'Tutor step',
      badge: 'Test',
      ...step,
    } as any],
    captions: { twitter: '', linkedin: '', tiktok: '', whatsapp: '' },
  };
}

test('AI Tutor recording step is blocked without an isolated response', () => {
  assert.equal(isDemoScenarioIsolated(scenario({})), false);
});

test('AI Tutor recording step accepts a completed isolated admin response', () => {
  assert.equal(isDemoScenarioIsolated(scenario({
    isolatedTutorPreview: {
      prompt: 'Explain viscosity.',
      courseContext: 'GET 205 — Fluid Mechanics',
      response: 'Viscosity measures resistance to fluid flow.',
      providerUsed: 'gemini_direct',
      latencyMs: 842,
    },
  })), true);
});

test('AI Tutor recording step rejects empty responses and caller-supplied history', () => {
  assert.equal(isDemoScenarioIsolated(scenario({
    isolatedTutorPreview: { prompt: 'Explain viscosity.', response: '   ' },
  })), false);
  assert.equal(isDemoScenarioIsolated(scenario({
    isolatedTutorPreview: {
      prompt: 'Explain viscosity.',
      response: 'A response.',
      history: [{ role: 'user', content: 'previous chat' }],
    },
  })), false);
});

test('AI Tutor recording step rejects the legacy student demoPrompt field', () => {
  assert.equal(isDemoScenarioIsolated(scenario({
    demoPrompt: 'Run a student chat request.',
    isolatedTutorPreview: {
      prompt: 'Explain viscosity.',
      response: 'A response.',
    },
  })), false);
});
