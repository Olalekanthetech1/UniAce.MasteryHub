import test from 'node:test';
import assert from 'node:assert/strict';
import mermaid from 'mermaid';
import {
  repairMermaidSyntaxDeterministically,
  validateAndRecoverMermaidDiagram
} from '../src/services/mermaidRepairService';
import { sanitizeLatex } from '../src/services/aiCourseGenerator';

// These integration checks use Mermaid's installed parser, not the lightweight grammar
// emulator used by the broader headless recovery tests.
mermaid.initialize({
  startOnLoad: false,
  suppressErrorRendering: true
});

async function parseWithInstalledMermaid(source: string): Promise<boolean> {
  const result = await mermaid.parse(source, { suppressErrors: false });
  return Boolean(result);
}

test('real Mermaid parser accepts deterministic repair of engineering labels', async () => {
  const source = `flowchart TD
    A[Specific Weight (γ = ρg)]
    B[Units: N/m³ (SI)]
    A --> B`;

  const repaired = repairMermaidSyntaxDeterministically(source);
  assert.equal(repaired.changed, true);
  assert.equal(await parseWithInstalledMermaid(repaired.repairedChart), true);
  assert.match(repaired.repairedChart, /A\["Specific Weight \(γ = ρg\)"\]/);
  assert.match(repaired.repairedChart, /B\["Units: N\/m³ \(SI\)"\]/);
});

test('real Mermaid parser validates the complete recovery pipeline output', async () => {
  const source = `flowchart LR
    density[Fluid Density ($\\rho = m/V$)]
    weight[Specific Weight (\\gamma = \\rho g)]
    density --> weight`;

  const recovered = await validateAndRecoverMermaidDiagram(source, {
    parseValidator: parseWithInstalledMermaid,
    aiRepairFn: null
  });

  assert.equal(recovered.isValid, true);
  assert.equal(recovered.stage, 'deterministic_repair');
  assert.equal(await parseWithInstalledMermaid(recovered.chart), true);
});

test('LaTeX sanitization isolates Mermaid blocks and leaves them parseable', async () => {
  const lesson = `Specific weight is $\\gamma = \\rho g$.

\`\`\`mermaid
flowchart TD
  A[Specific Weight (γ = ρg)] --> B[Units: N/m³ (SI)]
\`\`\`

The equation is used in hydrostatics.`;

  const sanitized = sanitizeLatex(lesson);
  const block = sanitized.match(/\`\`\`mermaid\\n([\\s\\S]*?)\\n\`\`\`/i);
  assert.ok(block, 'sanitized lesson should retain its Mermaid code block');
  assert.equal(await parseWithInstalledMermaid(block[1]), true);
  assert.ok(sanitized.includes('$\\gamma = \\rho g$'));
});

test('real Mermaid parser rejects malformed syntax without invoking render', async () => {
  const malformed = `flowchart TD
    A[Unclosed label --> B[Valid node]`;

  await assert.rejects(() => parseWithInstalledMermaid(malformed));
});
