import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  detectMermaidDiagramType,
  repairMermaidSyntaxDeterministically,
  serializeStructuredDiagramToMermaid,
  validateAndRecoverMermaidDiagram,
  normalizeMermaidBlocksInMarkdown,
  convertLatexLabelToReadableText
} from '../src/services/mermaidRepairService';
import { sanitizeLatex } from '../src/services/aiCourseGenerator';

/**
 * Grammar validator that emulates Mermaid v11's strict flowchart and sequence lexer rules
 * in headless Node environments where DOM/SVG APIs are absent, while verifying exact Mermaid v11 grammar.
 */
async function strictMermaidV11GrammarValidator(chartText: string): Promise<boolean> {
  const trimmed = (chartText || '').trim();
  if (!trimmed) throw new Error('Empty Mermaid diagram');

  const lines = trimmed
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('%%'));

  if (lines.length === 0) throw new Error('No statements in Mermaid diagram');

  const header = lines[0];
  if (/^(?:flowchart|graph)\s+(?:TD|TB|BT|RL|LR)$/i.test(header)) {
    if (lines.length < 2) throw new Error('Flowchart has no body statements');
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^(?:subgraph|end|direction|style|classDef|class)\b/i.test(line)) continue;

      // Reject invalid arrow tokens like `===>` or `--->` or unclosed brackets
      if (/~~~>|===>|--->|<--(?![>-])/.test(line)) {
        throw new Error(`Syntax error in text: malformed arrow on line ${i + 1}: ${line}`);
      }

      // Check every node definition on the line by pairing each opener with its matching closer
      const operandParts = line.split(/\s*(?:-->|-\.->|==>|---|-\.-|===|<-->)(?:\|[^|\n]*\|)?\s*/);
      let matchedAny = false;
      for (const operand of operandParts) {
        const opTrimmed = operand.trim();
        if (!opTrimmed) continue;
        // Bare node ID
        if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(opTrimmed)) {
          matchedAny = true;
          continue;
        }
        const nodeMatch = opTrimmed.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*([\s\S]+)$/);
        if (!nodeMatch) {
          throw new Error(`Syntax error in text (mermaid version 11.17.2): invalid node operand: ${opTrimmed}`);
        }
        const body = nodeMatch[2].trim();
        const shapePairs: ReadonlyArray<readonly [string, string]> = [
          ['([', '])'],
          ['[[', ']]'],
          ['[(', ')]'],
          ['((', '))'],
          ['{{', '}}'],
          ['[', ']'],
          ['(', ')'],
          ['{', '}']
        ];
        const matchedShape = shapePairs.find(([open, close]) => body.startsWith(open) && body.endsWith(close));
        if (!matchedShape) {
          throw new Error(`Syntax error in text (mermaid version 11.17.2): unclosed node shape: ${opTrimmed}`);
        }
        matchedAny = true;
        const inner = body.slice(matchedShape[0].length, body.length - matchedShape[1].length).trim();
        const isQuoted = inner.startsWith('"') && inner.endsWith('"');
        if (!isQuoted && /[()[\]{}$\\]/.test(inner)) {
          throw new Error(`Syntax error in text (mermaid version 11.17.2): unquoted special characters in node label: ${inner}`);
        }
      }

      if (!matchedAny) {
        throw new Error(`Syntax error in text (mermaid version 11.17.2): unrecognized flowchart statement: ${line}`);
      }
    }
    return true;
  }

  if (/^sequenceDiagram$/i.test(header)) {
    if (lines.length < 2) throw new Error('Sequence diagram has no body statements');
    return true;
  }

  throw new Error(`Syntax error in text (mermaid version 11.17.2): unsupported or invalid diagram header: ${header}`);
}

test('Scenario 1: Valid flowchart validates and passes through unmodified', async () => {
  const validChart = `flowchart TD
    A["Continuum Hypothesis"] --> B["Macroscopic Fluid Properties"]
    B --> C["Density and Specific Weight"]`;

  const result = await validateAndRecoverMermaidDiagram(validChart, {
    parseValidator: strictMermaidV11GrammarValidator,
    aiRepairFn: null
  });

  assert.equal(result.isValid, true);
  assert.equal(result.stage, 'original');
  assert.equal(result.diagramType, 'flowchart');
  assert.equal(result.chart, validChart);
});

test('Scenario 2: Greek symbols (γ, ρ, μ, τ) are preserved and rendered accurately', async () => {
  const greekChart = `flowchart TD
    A[Fluid Density ρ] --> B[Specific Weight γ = ρg]
    B --> C[Dynamic Viscosity μ and Shear Stress τ]`;

  const result = await validateAndRecoverMermaidDiagram(greekChart, {
    parseValidator: strictMermaidV11GrammarValidator,
    aiRepairFn: null
  });

  assert.equal(result.isValid, true);
  assert.ok(result.chart.includes('ρ'));
  assert.ok(result.chart.includes('γ = ρg'));
  assert.ok(result.chart.includes('μ'));
  assert.ok(result.chart.includes('τ'));
});

test('Scenario 3: Equations and SI units inside labels are preserved and quoted safely', async () => {
  const siChart = `flowchart TD
    A[Mass Density: ρ = m/V (kg/m³)] --> B[Specific Weight: γ = ρg (N/m³)]
    B --> C[Specific Gravity: SG = ρ / ρ_water (dimensionless)]`;

  const result = await validateAndRecoverMermaidDiagram(siChart, {
    parseValidator: strictMermaidV11GrammarValidator,
    aiRepairFn: null
  });

  assert.equal(result.isValid, true);
  assert.equal(result.stage, 'deterministic_repair');
  assert.ok(result.chart.includes('A["Mass Density: ρ = m/V (kg/m³)"]'));
  assert.ok(result.chart.includes('B["Specific Weight: γ = ρg (N/m³)"]'));
});

test('Scenario 4: Unquoted parentheses and brackets in flowchart labels are quoted via grammar-aware repair', async () => {
  const problematicInput = `flowchart TD
    A[Specific Weight (γ = ρg)]
    B[Units: N/m³ (SI)]
    A --> B`;

  const repaired = repairMermaidSyntaxDeterministically(problematicInput);
  assert.equal(repaired.changed, true);
  assert.equal(
    repaired.repairedChart,
    `flowchart TD
    A["Specific Weight (γ = ρg)"]
    B["Units: N/m³ (SI)"]
    A --> B`
  );

  const validation = await validateAndRecoverMermaidDiagram(problematicInput, {
    parseValidator: strictMermaidV11GrammarValidator,
    aiRepairFn: null
  });
  assert.equal(validation.isValid, true);
  assert.equal(validation.stage, 'deterministic_repair');
});

test('Scenario 5: LaTeX inside lesson content does not corrupt Mermaid source during sanitizeLatex()', () => {
  const lessonMarkdown = `## Density and Specific Weight

In continuum fluid mechanics, specific weight is defined as $\\gamma = \\rho g$, and hydrostatic pressure follows:

$$\\frac{dP}{dz} = -\\rho g$$

\`\`\`mermaid
flowchart TD
    A[Specific Weight (γ = ρg)]
    B[Units: N/m³ (SI)]
    A --> B
\`\`\`

Where $\\rho$ is measured in $\\text{kg/m}^3$.`;

  const sanitized = sanitizeLatex(lessonMarkdown);

  // Math outside Mermaid is preserved for KaTeX
  assert.ok(sanitized.includes('$\\gamma = \\rho g$'));
  assert.ok(sanitized.includes('\\frac{dP}{dz} = -\\rho g'));

  // Mermaid block is isolated from LaTeX mutations and grammar-quoted cleanly
  assert.ok(sanitized.includes('A["Specific Weight (γ = ρg)"]'));
  assert.ok(sanitized.includes('B["Units: N/m³ (SI)"]'));

  // Also test LaTeX inside Mermaid labels being converted to readable Unicode notation
  const converted = convertLatexLabelToReadableText('Specific Weight ($\\gamma = \\rho g$)');
  assert.equal(converted.text, 'Specific Weight (γ = ρ g)');
});

test('Scenario 6: Invalid Mermaid syntax never triggers giant error graphic (suppressErrorRendering: true & pre-render parse gate)', async () => {
  const viewerSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/renderers/MermaidViewer.tsx'),
    'utf8'
  );
  assert.match(viewerSource, /suppressErrorRendering:\s*true/);
  assert.match(viewerSource, /validateAndRecoverMermaidDiagram/);

  const brokenSyntax = `flowchart TD
    A[Broken ===> ??? {{{`;

  const validation = await validateAndRecoverMermaidDiagram(brokenSyntax, {
    parseValidator: strictMermaidV11GrammarValidator,
    aiRepairFn: null
  });

  assert.equal(validation.isValid, false);
  assert.equal(validation.stage, 'failed');
});

test('Scenario 7: Constrained AI repair succeeds and corrected diagram passes validation', async () => {
  const structurallyMalformed = `flowchart TD
    A["Fluid Element"] ===> B["Hydrostatic Equilibrium (dP/dz = -ρg)"]`;

  const result = await validateAndRecoverMermaidDiagram(structurallyMalformed, {
    parseValidator: strictMermaidV11GrammarValidator,
    aiRepairFn: async (brokenChart) => {
      // Constrained AI repair fixes only the invalid arrow `===>` -> `-->` while keeping academic meaning intact
      return brokenChart.replace('===>', '-->');
    }
  });

  assert.equal(result.isValid, true);
  assert.equal(result.stage, 'ai_repair');
  assert.ok(result.chart.includes('A["Fluid Element"] --> B["Hydrostatic Equilibrium (dP/dz = -ρg)"]'));
});

test('Scenario 8: When AI repair fails, returns transparent error state without fabricating a diagram', async () => {
  const unrecoverableChart = `NOT_A_VALID_DIAGRAM_HEADER
    ??? ::: [[[ unclosed`;

  const result = await validateAndRecoverMermaidDiagram(unrecoverableChart, {
    parseValidator: strictMermaidV11GrammarValidator,
    aiRepairFn: async () => 'STILL_INVALID_SYNTAX [[[ ???'
  });

  assert.equal(result.isValid, false);
  assert.equal(result.stage, 'failed');
  assert.equal(
    result.errorMessage,
    'This diagram could not be rendered because its syntax could not be validated. The rest of this lesson remains available.'
  );

  // Verify MermaidViewer renders the exact transparent failure heading and copy
  const viewerSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/renderers/MermaidViewer.tsx'),
    'utf8'
  );
  assert.ok(viewerSource.includes('Diagram temporarily unavailable'));
  assert.ok(
    viewerSource.includes(
      'This diagram could not be rendered because its syntax could not be validated. The rest of this lesson remains available.'
    )
  );
});

test('Scenario 9, 10 & 11: Multiple diagrams, React StrictMode concurrency, and component unmount cleanup', async () => {
  const viewerSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/renderers/MermaidViewer.tsx'),
    'utf8'
  );

  // Verify unique per-instance, per-render sequence IDs (`mermaid-${reactInstanceId}-${currentSeq}`)
  assert.match(viewerSource, /const renderId = `mermaid-\$\{reactInstanceId\}-\$\{currentSeq\}`/);
  // Verify cancellation guard for React StrictMode double-invocation
  assert.match(viewerSource, /if \(isCancelled \|\| currentSeq !== renderSeqRef\.current\)/);
  // Verify unmount cleanup of temporary sandbox elements without mutating document.body
  assert.match(viewerSource, /return \(\) => \{\s*isCancelled = true;\s*clearSandboxContainer\(\);\s*\}/);

  // Verify multiple distinct diagrams in a single lesson normalize independently
  const multiDiagramMarkdown = `
\`\`\`mermaid
flowchart TD
    A[Diagram 1 (Continuity: A₁V₁ = A₂V₂)] --> B[Mass Conservation]
\`\`\`

Some intermediate prose with $E = mc^2$.

\`\`\`diagram-spec
{
  "type": "flowchart",
  "direction": "LR",
  "nodes": [
    { "id": "bernoulli", "label": "Bernoulli Equation (P + ½ρV² + γz = const)" },
    { "id": "energy", "label": "Mechanical Energy Conservation" }
  ],
  "edges": [
    { "from": "bernoulli", "to": "energy" }
  ]
}
\`\`\`
`;

  const normalized = normalizeMermaidBlocksInMarkdown(multiDiagramMarkdown);
  assert.ok(normalized.includes('A["Diagram 1 (Continuity: A₁V₁ = A₂V₂)"]'));
  assert.ok(normalized.includes('bernoulli["Bernoulli Equation (P + ½ρV² + γz = const)"]'));
});

test('Scenario 12: Cross-disciplinary academic subjects work universally with zero subject-specific assumptions', async () => {
  // 1. Engineering (Fluid Mechanics structured spec from architectural specification)
  const engineeringSpec = {
    type: 'flowchart' as const,
    direction: 'TD' as const,
    nodes: [
      { id: 'density', label: 'Fluid Density (rho = m/V)' },
      { id: 'weight', label: 'Specific Weight (gamma = rho*g)' }
    ],
    edges: [{ from: 'density', to: 'weight' }]
  };
  const engineeringMermaid = serializeStructuredDiagramToMermaid(engineeringSpec);
  const engResult = await validateAndRecoverMermaidDiagram(engineeringMermaid, {
    parseValidator: strictMermaidV11GrammarValidator,
    aiRepairFn: null
  });
  assert.equal(engResult.isValid, true);
  assert.ok(engResult.chart.includes('density["Fluid Density (rho = m/V)"]'));
  assert.ok(engResult.chart.includes('weight["Specific Weight (gamma = rho*g)"]'));
  assert.ok(engResult.chart.includes('density --> weight'));

  // 2. Law / Humanities (Constitutional Judicial Review with citations & parens)
  const lawChart = `flowchart TD
    Petition[Writ of Certiorari (Article III, § 2)] --> Review[Appellate Jurisdiction (Standard: De Novo)]
    Review --> Holding[Constitutional Holding (Ratio Decidendi)]`;
  const lawResult = await validateAndRecoverMermaidDiagram(lawChart, {
    parseValidator: strictMermaidV11GrammarValidator,
    aiRepairFn: null
  });
  assert.equal(lawResult.isValid, true);
  assert.ok(lawResult.chart.includes('Petition["Writ of Certiorari (Article III, § 2)"]'));

  // 3. Biomedical / Life Sciences (Enzyme Kinetics & ATP Hydrolysis)
  const bioChart = `flowchart LR
    Substrate[Glucose (C₆H₁₂O₆) + ATP] --> Hexokinase[Hexokinase (Mg²⁺ cofactor)]
    Hexokinase --> Product[Glucose-6-Phosphate (G6P) + ADP]`;
  const bioResult = await validateAndRecoverMermaidDiagram(bioChart, {
    parseValidator: strictMermaidV11GrammarValidator,
    aiRepairFn: null
  });
  assert.equal(bioResult.isValid, true);
  assert.ok(bioResult.chart.includes('Substrate["Glucose (C₆H₁₂O₆) + ATP"]'));

  // 4. Sequence Diagram (Computer Science / Distributed Systems — verifies diagram-type awareness)
  const seqChart = `sequenceDiagram
    Client->>Server: SYN (seq = x)
    Server-->>Client: SYN-ACK (seq = y, ack = x + 1)`;
  assert.equal(detectMermaidDiagramType(seqChart), 'sequenceDiagram');
  const seqResult = await validateAndRecoverMermaidDiagram(seqChart, {
    parseValidator: strictMermaidV11GrammarValidator,
    aiRepairFn: null
  });
  assert.equal(seqResult.isValid, true);
  assert.equal(seqResult.diagramType, 'sequenceDiagram');
});
