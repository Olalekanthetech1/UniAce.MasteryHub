import { z } from 'zod';

/**
 * UniAce Platform-Level Mermaid Validation, Grammar-Aware Repair & Structured Serialization Engine
 *
 * Implements a strict defence-in-depth pipeline under the ZeroMock Policy:
 * 1. Prevention: Structured diagram specification schema + deterministic serializer.
 * 2. Detection: Pre-render validation via mermaid.parse().
 * 3. Recovery: Diagram-type-aware, grammar-aware label quoting and readable math notation conversion,
 *    followed by a constrained AI syntax correction pass when deterministic repair cannot validate.
 * 4. Academic Fidelity: Never alters the academic meaning, nodes, edges, or values of a diagram,
 *    and never fabricates a static fallback diagram when recovery fails.
 */

export type MermaidDiagramType =
  | 'flowchart'
  | 'sequenceDiagram'
  | 'classDiagram'
  | 'stateDiagram'
  | 'erDiagram'
  | 'gantt'
  | 'pie'
  | 'mindmap'
  | 'timeline'
  | 'quadrantChart'
  | 'unknown';

export const StructuredDiagramNodeSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().min(1),
  shape: z.enum(['rect', 'rounded', 'stadium', 'subroutine', 'cylinder', 'circle', 'rhombus', 'hexagon']).optional()
});

export const StructuredDiagramEdgeSchema = z.object({
  from: z.string().trim().min(1),
  to: z.string().trim().min(1),
  label: z.string().optional(),
  style: z.enum(['solid', 'dotted', 'thick']).optional()
});

export const StructuredDiagramSubgraphSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().min(1),
  nodeIds: z.array(z.string().trim().min(1)).min(1)
});

export const StructuredDiagramSpecSchema = z.object({
  type: z.enum(['flowchart', 'graph']).default('flowchart'),
  direction: z.enum(['TD', 'TB', 'BT', 'RL', 'LR']).default('TD'),
  title: z.string().optional(),
  nodes: z.array(StructuredDiagramNodeSchema).min(1),
  edges: z.array(StructuredDiagramEdgeSchema).default([]),
  subgraphs: z.array(StructuredDiagramSubgraphSchema).optional()
}).superRefine((spec, ctx) => {
  const rawNodeIds = new Set<string>();
  const safeNodeIds = new Map<string, string>();

  spec.nodes.forEach((node, index) => {
    const rawId = node.id.trim();
    if (rawNodeIds.has(rawId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['nodes', index, 'id'],
        message: `Duplicate diagram node ID: "${rawId}".`
      });
      return;
    }
    rawNodeIds.add(rawId);

    const safeId = sanitizeMermaidNodeId(rawId, index + 1);
    const existingOwner = safeNodeIds.get(safeId);
    if (existingOwner && existingOwner !== rawId) {
      ctx.addIssue({
        code: 'custom',
        path: ['nodes', index, 'id'],
        message: `Diagram node IDs "${existingOwner}" and "${rawId}" both normalize to Mermaid ID "${safeId}". Use distinct node IDs.`
      });
    } else {
      safeNodeIds.set(safeId, rawId);
    }
  });

  spec.edges.forEach((edge, index) => {
    if (!rawNodeIds.has(edge.from)) {
      ctx.addIssue({
        code: 'custom',
        path: ['edges', index, 'from'],
        message: `Edge references undefined source node "${edge.from}".`
      });
    }
    if (!rawNodeIds.has(edge.to)) {
      ctx.addIssue({
        code: 'custom',
        path: ['edges', index, 'to'],
        message: `Edge references undefined target node "${edge.to}".`
      });
    }
  });

  const safeSubgraphIds = new Map<string, string>();
  const assignedNodes = new Set<string>();
  (spec.subgraphs || []).forEach((subgraph, index) => {
    const rawId = subgraph.id.trim();
    const safeId = sanitizeMermaidNodeId(rawId, index + 1);
    if (safeNodeIds.has(safeId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['subgraphs', index, 'id'],
        message: `Subgraph ID "${rawId}" conflicts with a diagram node after Mermaid ID normalization.`
      });
    }
    const existingSubgraph = safeSubgraphIds.get(safeId);
    if (existingSubgraph) {
      ctx.addIssue({
        code: 'custom',
        path: ['subgraphs', index, 'id'],
        message: `Subgraph IDs "${existingSubgraph}" and "${rawId}" normalize to the same Mermaid ID "${safeId}".`
      });
    } else {
      safeSubgraphIds.set(safeId, rawId);
    }

    subgraph.nodeIds.forEach((nodeId, nodeIndex) => {
      if (!rawNodeIds.has(nodeId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['subgraphs', index, 'nodeIds', nodeIndex],
          message: `Subgraph references undefined diagram node "${nodeId}".`
        });
        return;
      }
      if (assignedNodes.has(nodeId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['subgraphs', index, 'nodeIds', nodeIndex],
          message: `Diagram node "${nodeId}" is assigned to more than one subgraph.`
        });
      } else {
        assignedNodes.add(nodeId);
      }
    });
  });
});

export type StructuredDiagramSpec = z.infer<typeof StructuredDiagramSpecSchema>;

export interface MermaidRepairResult {
  originalChart: string;
  repairedChart: string;
  diagramType: MermaidDiagramType;
  changed: boolean;
  repairsApplied: string[];
}

export interface MermaidValidationRecoveryResult {
  isValid: boolean;
  chart: string;
  diagramType: MermaidDiagramType;
  stage: 'original' | 'structured_spec' | 'deterministic_repair' | 'ai_repair' | 'failed';
  repairsApplied: string[];
  errorMessage?: string;
  diagnosticDetails?: string;
}

export type ConstrainedAiRepairFn = (
  brokenChart: string,
  parseErrorMessage: string,
  diagramType: MermaidDiagramType
) => Promise<string | null>;

const LATEX_SYMBOL_TO_READABLE_MAP: ReadonlyArray< readonly [RegExp, string] > = [
  [/\\alpha\b/g, 'α'],
  [/\\beta\b/g, 'β'],
  [/\\gamma\b/g, 'γ'],
  [/\\delta\b/g, 'δ'],
  [/\\epsilon\b/g, 'ε'],
  [/\\varepsilon\b/g, 'ε'],
  [/\\zeta\b/g, 'ζ'],
  [/\\eta\b/g, 'η'],
  [/\\theta\b/g, 'θ'],
  [/\\vartheta\b/g, 'θ'],
  [/\\kappa\b/g, 'κ'],
  [/\\lambda\b/g, 'λ'],
  [/\\mu\b/g, 'μ'],
  [/\\nu\b/g, 'ν'],
  [/\\xi\b/g, 'ξ'],
  [/\\pi\b/g, 'π'],
  [/\\rho\b/g, 'ρ'],
  [/\\sigma\b/g, 'σ'],
  [/\\tau\b/g, 'τ'],
  [/\\upsilon\b/g, 'υ'],
  [/\\phi\b/g, 'φ'],
  [/\\varphi\b/g, 'φ'],
  [/\\chi\b/g, 'χ'],
  [/\\psi\b/g, 'ψ'],
  [/\\omega\b/g, 'ω'],
  [/\\Gamma\b/g, 'Γ'],
  [/\\Delta\b/g, 'Δ'],
  [/\\Theta\b/g, 'Θ'],
  [/\\Lambda\b/g, 'Λ'],
  [/\\Xi\b/g, 'Ξ'],
  [/\\Pi\b/g, 'Π'],
  [/\\Sigma\b/g, 'Σ'],
  [/\\Phi\b/g, 'Φ'],
  [/\\Psi\b/g, 'Ψ'],
  [/\\Omega\b/g, 'Ω'],
  [/\\partial\b/g, '∂'],
  [/\\nabla\b/g, '∇'],
  [/\\infty\b/g, '∞'],
  [/\\pm\b/g, '±'],
  [/\\mp\b/g, '∓'],
  [/\\times\b/g, '×'],
  [/\\div\b/g, '÷'],
  [/\\cdot\b/g, '·'],
  [/\\approx\b/g, '≈'],
  [/\\neq\b/g, '≠'],
  [/\\ne\b/g, '≠'],
  [/\\equiv\b/g, '≡'],
  [/\\le\b/g, '≤'],
  [/\\leq\b/g, '≤'],
  [/\\ge\b/g, '≥'],
  [/\\geq\b/g, '≥'],
  [/\\in\b/g, '∈'],
  [/\\notin\b/g, '∉'],
  [/\\subset\b/g, '⊂'],
  [/\\subseteq\b/g, '⊆'],
  [/\\cup\b/g, '∪'],
  [/\\cap\b/g, '∩'],
  [/\\to\b/g, '→'],
  [/\\rightarrow\b/g, '→'],
  [/\\leftarrow\b/g, '←'],
  [/\\implies\b/g, '⇒'],
  [/\\iff\b/g, '⇔'],
  [/\\int\b/g, '∫'],
  [/\\sum\b/g, '∑'],
  [/\\prod\b/g, '∏'],
  [/\\propto\b/g, '∝'],
  [/\\[,;!:]/g, ' ']
];

const SUPERSCRIPT_CHAR_MAP: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  n: 'ⁿ',
  i: 'ⁱ'
};

const SUBSCRIPT_CHAR_MAP: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  '+': '₊',
  '-': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
  a: 'ₐ',
  e: 'ₑ',
  i: 'ᵢ',
  j: 'ⱼ',
  k: 'ₖ',
  m: 'ₘ',
  n: 'ₙ',
  o: 'ₒ',
  p: 'ₚ',
  r: 'ᵣ',
  s: 'ₛ',
  t: 'ₜ',
  u: 'ᵤ',
  v: 'ᵥ',
  x: 'ₓ'
};

/**
 * Converts LaTeX fragments inside a Mermaid label into clean, human-readable mathematical notation
 * without altering the underlying equation, symbols, or units.
 */
export function convertLatexLabelToReadableText(label: string): { text: string; changed: boolean } {
  if (!label || typeof label !== 'string') return { text: '', changed: false };
  let working = label;

  // Strip inline $...$ or \(...\) math delimiters inside labels while keeping the math expression
  working = working
    .replace(/\$\$([\s\S]+?)\$\$/g, '$1')
    .replace(/\$([^$\n]+?)\$/g, '$1')
    .replace(/\\\(([\s\S]+?)\\\)/g, '$1')
    .replace(/\\\[([\s\S]+?)\\\]/g, '$1');

  // Unwrap \text{...}, \mathrm{...}, \mathbf{...}, \vec{...}, \hat{...}
  working = working.replace(/\\(?:text|mathrm|mathbf|mathit|mathsf|operatorname|vec|hat|bar)\s*\{([^{}]*)\}/g, '$1');
  working = working.replace(/\\\|/g, '||');

  // Convert \frac{a}{b} -> (a)/(b) or a/b when simple
  working = working.replace(/\\(?:d|t)?frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, (_m, num: string, den: string) => {
    const cleanNum = num.trim();
    const cleanDen = den.trim();
    const numWrapped = /[+\-*/\s]/.test(cleanNum) ? `(${cleanNum})` : cleanNum;
    const denWrapped = /[+\-*/\s]/.test(cleanDen) ? `(${cleanDen})` : cleanDen;
    return `${numWrapped}/${denWrapped}`;
  });

  // Convert \sqrt{x} -> √(x)
  working = working.replace(/\\sqrt\s*\{([^{}]+)\}/g, (_m, rad: string) => {
    const cleanRad = rad.trim();
    return cleanRad.length === 1 ? `√${cleanRad}` : `√(${cleanRad})`;
  });

  // Replace known LaTeX Greek/operator commands with Unicode symbols
  for (const [pattern, replacement] of LATEX_SYMBOL_TO_READABLE_MAP) {
    working = working.replace(pattern, replacement);
  }

  // Convert simple superscripts ^{...} or ^2 when all characters map cleanly to Unicode superscripts
  working = working.replace(/\^\{([^{}]+)\}|\^([0-9+\-ni])/g, (match, braced?: string, single?: string) => {
    const rawExp = (braced ?? single ?? '').trim();
    if (!rawExp) return match;
    const chars = Array.from(rawExp);
    if (chars.every((ch) => Boolean(SUPERSCRIPT_CHAR_MAP[ch]))) {
      return chars.map((ch) => SUPERSCRIPT_CHAR_MAP[ch]).join('');
    }
    return `^(${rawExp})`;
  });

  // Convert simple subscripts _{...} or _0 when all characters map cleanly to Unicode subscripts.
  // Because Unicode lacks subscript 'y' and 'z', keep single-letter coordinate subscripts (_x, _y, _z)
  // consistent rather than producing mixed Aₓ, A_(y), A_(z).
  const hasYOrZSubscript = /_(?:\{[yz]\}|[yz]\b)/i.test(working);
  working = working.replace(/_\{([^{}]+)\}|_([0-9a-zA-Z])/g, (match, braced?: string, single?: string) => {
    const rawSub = (braced ?? single ?? '').trim();
    if (!rawSub) return match;
    if (hasYOrZSubscript && /^[xyzXYZ]$/.test(rawSub)) {
      return `_${rawSub}`;
    }
    const chars = Array.from(rawSub);
    if (chars.every((ch) => Boolean(SUBSCRIPT_CHAR_MAP[ch]))) {
      return chars.map((ch) => SUBSCRIPT_CHAR_MAP[ch]).join('');
    }
    if (/^[a-zA-Z0-9]$/.test(rawSub)) {
      return `_${rawSub}`;
    }
    return `_(${rawSub})`;
  });

  return {
    text: working,
    changed: working !== label
  };
}

/**
 * Detects the Mermaid diagram family from the first non-comment, non-directive line.
 */
export function detectMermaidDiagramType(source: string): MermaidDiagramType {
  if (!source || typeof source !== 'string') return 'unknown';
  const lines = source
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('%%'));

  if (lines.length === 0) return 'unknown';
  const first = lines[0];

  if (/^(?:flowchart|graph)\b/i.test(first)) return 'flowchart';
  if (/^sequenceDiagram\b/i.test(first)) return 'sequenceDiagram';
  if (/^classDiagram(?:-v2)?\b/i.test(first)) return 'classDiagram';
  if (/^stateDiagram(?:-v2)?\b/i.test(first)) return 'stateDiagram';
  if (/^erDiagram\b/i.test(first)) return 'erDiagram';
  if (/^gantt\b/i.test(first)) return 'gantt';
  if (/^pie\b/i.test(first)) return 'pie';
  if (/^mindmap\b/i.test(first)) return 'mindmap';
  if (/^timeline\b/i.test(first)) return 'timeline';
  if (/^quadrantChart\b/i.test(first)) return 'quadrantChart';

  return 'unknown';
}

/**
 * Sanitizes a node identifier into a valid Mermaid token while preserving readability.
 */
export function sanitizeMermaidNodeId(rawId: string, fallbackIndex = 0): string {
  const cleaned = String(rawId || '')
    .trim()
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!cleaned) return `node_${fallbackIndex}`;
  if (/^[0-9]/.test(cleaned)) return `n_${cleaned}`;
  // Avoid reserved Mermaid keywords as bare node IDs
  if (/^(?:end|subgraph|graph|flowchart|style|classDef|class|click|direction)$/i.test(cleaned)) {
    return `node_${cleaned}`;
  }
  return cleaned;
}

/**
 * Formats a label inside double quotes with safe entity escaping for internal quotes.
 */
export function quoteMermaidLabel(rawLabel: string): string {
  const { text } = convertLatexLabelToReadableText(rawLabel);
  const normalizedNewlines = text.replace(/\\n/g, '<br/>').replace(/\r?\n/g, '<br/>').trim();
  const escapedQuotes = normalizedNewlines.replace(/"/g, '#quot;');
  return `"${escapedQuotes}"`;
}

/**
 * Validates and serializes a StructuredDiagramSpec into guaranteed-valid Mermaid syntax.
 */
export function serializeStructuredDiagramToMermaid(rawSpec: unknown): string {
  const parsed = StructuredDiagramSpecSchema.parse(rawSpec);
  const direction = parsed.direction || 'TD';
  const lines: string[] = [`flowchart ${direction}`];

  const idMap = new Map<string, string>();
  parsed.nodes.forEach((node, idx) => {
    const safeId = sanitizeMermaidNodeId(node.id, idx + 1);
    idMap.set(node.id, safeId);
  });

  const renderNodeDef = (node: z.infer<typeof StructuredDiagramNodeSchema>, idx: number): string => {
    const safeId = idMap.get(node.id) || sanitizeMermaidNodeId(node.id, idx + 1);
    const quoted = quoteMermaidLabel(node.label);
    switch (node.shape) {
      case 'rounded':
        return `${safeId}(${quoted})`;
      case 'stadium':
        return `${safeId}([${quoted}])`;
      case 'subroutine':
        return `${safeId}[[${quoted}]]`;
      case 'cylinder':
        return `${safeId}[(${quoted})]`;
      case 'circle':
        return `${safeId}((${quoted}))`;
      case 'rhombus':
        return `${safeId}{${quoted}}`;
      case 'hexagon':
        return `${safeId}{{${quoted}}}`;
      case 'rect':
      default:
        return `${safeId}[${quoted}]`;
    }
  };

  const nodesInSubgraphs = new Set<string>();
  if (Array.isArray(parsed.subgraphs) && parsed.subgraphs.length > 0) {
    parsed.subgraphs.forEach((sg, sIdx) => {
      const sgId = sanitizeMermaidNodeId(sg.id, sIdx + 1);
      const sgTitle = quoteMermaidLabel(sg.title);
      lines.push(`    subgraph ${sgId}[${sgTitle}]`);
      for (const rawNodeId of sg.nodeIds) {
        const matchedNode = parsed.nodes.find((n) => n.id === rawNodeId);
        if (matchedNode && !nodesInSubgraphs.has(matchedNode.id)) {
          nodesInSubgraphs.add(matchedNode.id);
          lines.push(`        ${renderNodeDef(matchedNode, sIdx)}`);
        }
      }
      lines.push('    end');
    });
  }

  parsed.nodes.forEach((node, idx) => {
    if (!nodesInSubgraphs.has(node.id)) {
      lines.push(`    ${renderNodeDef(node, idx)}`);
    }
  });

  parsed.edges.forEach((edge, eIdx) => {
    const fromId = idMap.get(edge.from) || sanitizeMermaidNodeId(edge.from, eIdx * 2 + 100);
    const toId = idMap.get(edge.to) || sanitizeMermaidNodeId(edge.to, eIdx * 2 + 101);
    const arrow =
      edge.style === 'dotted' ? '-.->' : edge.style === 'thick' ? '==>' : '-->';
    if (edge.label && edge.label.trim()) {
      const quotedEdgeLabel = quoteMermaidLabel(edge.label.trim());
      lines.push(`    ${fromId} ${arrow}|${quotedEdgeLabel}| ${toId}`);
    } else {
      lines.push(`    ${fromId} ${arrow} ${toId}`);
    }
  });

  return lines.join('\n');
}

/**
 * Attempts to parse a raw string as a JSON StructuredDiagramSpec and serialize it to Mermaid.
 * Returns null if the input is not a JSON diagram specification.
 */
export function trySerializeStructuredDiagramJson(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsedJson = JSON.parse(trimmed);
    if (parsedJson && typeof parsedJson === 'object' && Array.isArray(parsedJson.nodes)) {
      return serializeStructuredDiagramToMermaid(parsedJson);
    }
  } catch {
    return null;
  }
  return null;
}

interface ParsedShapeToken {
  openToken: string;
  closeToken: string;
}

const FLOWCHART_SHAPES: readonly ParsedShapeToken[] = [
  { openToken: '([', closeToken: '])' },
  { openToken: '[[', closeToken: ']]' },
  { openToken: '[(', closeToken: ')]' },
  { openToken: '((', closeToken: '))' },
  { openToken: '{{', closeToken: '}}' },
  { openToken: '[', closeToken: ']' },
  { openToken: '(', closeToken: ')' },
  { openToken: '{', closeToken: '}' }
];

/**
 * Grammar-aware scanner for a single flowchart line.
 * Locates node definitions `NodeId<openShape>Label<closeShape>` and edge labels `-->|Label|`,
 * quoting any unquoted labels that contain parentheses, brackets, colons, math symbols, LaTeX, or quotes,
 * without corrupting nested parentheses inside the label text.
 */
function repairFlowchartLine(
  line: string,
  repairsApplied: Set<string>
): string {
  const trimmed = line.trim();
  if (
    !trimmed ||
    trimmed.startsWith('%%') ||
    /^(?:flowchart|graph|direction|classDef|class|style|linkStyle|click)\b/i.test(trimmed)
  ) {
    return line;
  }

  // Handle `subgraph ID[Title (with parens)]`
  if (/^subgraph\b/i.test(trimmed)) {
    const sgMatch = line.match(/^(\s*subgraph\s+[A-Za-z0-9_-]+\s*)\[([\s\S]+)\]\s*$/i);
    if (sgMatch) {
      const inner = sgMatch[2].trim();
      if (!(inner.startsWith('"') && inner.endsWith('"'))) {
        repairsApplied.add('Quoted subgraph header label');
        return `${sgMatch[1]}[${quoteMermaidLabel(inner)}]`;
      }
    }
    return line;
  }

  if (/^end\b/i.test(trimmed)) {
    return line;
  }

  let updated = line;

  // Normalize malformed single-dash or Unicode arrows between nodes on flowchart lines
  if (/(?:—>|–>|->)/.test(updated)) {
    const arrowFixed = updated
      .replace(/\s*[—–]>\s*/g, ' --> ')
      .replace(/(?<![-.=])\s*->\s*(?!>)/g, ' --> ');
    if (arrowFixed !== updated) {
      repairsApplied.add('Normalized malformed flowchart arrow to -->');
      updated = arrowFixed;
    }
  }

  // Quote edge labels `-->|label|` if they contain special characters or LaTeX
  updated = updated.replace(
    /(-->|-\.->|==>|---|-\.-|===)\|([^|\n]+)\|/g,
    (fullMatch, arrow: string, rawEdgeLabel: string) => {
      const edgeTrimmed = rawEdgeLabel.trim();
      if (edgeTrimmed.startsWith('"') && edgeTrimmed.endsWith('"')) {
        const inner = edgeTrimmed.slice(1, -1);
        const converted = convertLatexLabelToReadableText(inner);
        if (converted.changed) {
          repairsApplied.add('Converted LaTeX notation inside edge label');
          return `${arrow}|${quoteMermaidLabel(converted.text)}|`;
        }
        return fullMatch;
      }
      if (/[()[\]{}"$\\:;]/.test(edgeTrimmed)) {
        repairsApplied.add('Quoted special characters in edge label');
        return `${arrow}|${quoteMermaidLabel(edgeTrimmed)}|`;
      }
      return fullMatch;
    }
  );

  // Split flowchart line around arrow operators so each node operand is parsed cleanly
  // Preserves the exact arrow tokens (`-->|...|`, `-->`, `-.->`, `==>`, `---`, etc.)
  const arrowSplitRegex = /(\s*(?:-->|-\.->|==>|---|-\.-|===|<-->)(?:\|[^|\n]*\|)?\s*|\s*&\s*)/g;
  const parts = updated.split(arrowSplitRegex);

  const repairedParts = parts.map((part, idx) => {
    // Odd indices are arrow separators
    if (idx % 2 === 1) return part;

    const leadingSpace = part.match(/^\s*/)?.[0] || '';
    const trailingSpace = part.match(/\s*$/)?.[0] || '';
    const core = part.trim();
    if (!core) return part;

    // Match node ID followed by shape opener
    const idMatch = core.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*([\s\S]+)$/);
    if (!idMatch) return part;

    const rawId = idMatch[1];
    const safeId = sanitizeMermaidNodeId(rawId);
    if (safeId !== rawId) {
      repairsApplied.add(`Sanitized reserved node identifier "${rawId}"`);
    }
    const rest = idMatch[2];

    for (const shape of FLOWCHART_SHAPES) {
      if (rest.startsWith(shape.openToken) && rest.endsWith(shape.closeToken)) {
        const inner = rest.slice(shape.openToken.length, rest.length - shape.closeToken.length).trim();
        if (!inner) return part;

        // If already quoted with "...", check if internal quotes or LaTeX need normalization
        if (inner.startsWith('"') && inner.endsWith('"') && inner.length >= 2) {
          const unquoted = inner.slice(1, -1);
          const { text: mathCleaned, changed: mathChanged } = convertLatexLabelToReadableText(unquoted);
          const hasUnescapedInnerQuotes = /"/g.test(mathCleaned);
          const hasLiteralNewline = /\\n/.test(mathCleaned);
          if (mathChanged || hasUnescapedInnerQuotes || hasLiteralNewline) {
            repairsApplied.add('Normalized math/quotes inside quoted flowchart node label');
            return `${leadingSpace}${safeId}${shape.openToken}${quoteMermaidLabel(mathCleaned)}${shape.closeToken}${trailingSpace}`;
          }
          if (safeId !== rawId) {
            return `${leadingSpace}${safeId}${shape.openToken}${inner}${shape.closeToken}${trailingSpace}`;
          }
          return part;
        }

        // Unquoted label: check if it contains characters that require quoting or LaTeX conversion
        const { text: mathCleaned, changed: mathChanged } = convertLatexLabelToReadableText(inner);
        const needsQuoting =
          mathChanged ||
          /[()[\]{}"$\\:;|<>^_=/*+]/.test(mathCleaned) ||
          /\\n/.test(mathCleaned) ||
          shape.openToken === '(' ||
          shape.openToken === '{';

        if (needsQuoting || safeId !== rawId) {
          if (needsQuoting) {
            repairsApplied.add('Applied grammar-aware label quoting to flowchart node');
          }
          return `${leadingSpace}${safeId}${shape.openToken}${quoteMermaidLabel(mathCleaned)}${shape.closeToken}${trailingSpace}`;
        }
        return part;
      }
    }

    return part;
  });

  return repairedParts.join('');
}

/**
 * Repairs sequenceDiagram lines where message text contains LaTeX or unescaped special tokens.
 */
function repairSequenceDiagramLine(line: string, repairsApplied: Set<string>): string {
  const msgMatch = line.match(/^(\s*[A-Za-z0-9_"-]+\s*(?:->>|-->>|->|-->|-x|--x|-\)|--\))\+?-?\s*[A-Za-z0-9_"-]+\s*:\s*)(.+)$/);
  if (!msgMatch) return line;
  const prefix = msgMatch[1];
  const rawMessage = msgMatch[2];
  const { text: converted, changed } = convertLatexLabelToReadableText(rawMessage);
  const cleaned = converted.replace(/\\n/g, '<br/>');
  if (changed || cleaned !== rawMessage) {
    repairsApplied.add('Normalized math/line-breaks in sequenceDiagram message');
    return `${prefix}${cleaned}`;
  }
  return line;
}

/**
 * Layered, diagram-type-aware deterministic Mermaid syntax repair engine.
 * Never alters the academic meaning of a diagram and only applies flowchart rules to flowcharts.
 */
export function repairMermaidSyntaxDeterministically(rawChart: string): MermaidRepairResult {
  if (!rawChart || typeof rawChart !== 'string') {
    return {
      originalChart: rawChart || '',
      repairedChart: '',
      diagramType: 'unknown',
      changed: false,
      repairsApplied: []
    };
  }

  const repairsApplied = new Set<string>();
  let working = rawChart.replace(/\r\n/g, '\n').trim();

  // Unwrap accidental outer markdown fences if present
  const fenceMatch = working.match(/^```(?:mermaid|mermaid-json|diagram-spec)?\s*\n([\s\S]*?)\n```$/i);
  if (fenceMatch && fenceMatch[1]) {
    working = fenceMatch[1].trim();
    repairsApplied.add('Stripped outer markdown fence wrapper');
  }

  // Check if input is actually a JSON StructuredDiagramSpec
  const serializedFromSpec = trySerializeStructuredDiagramJson(working);
  if (serializedFromSpec) {
    return {
      originalChart: rawChart,
      repairedChart: serializedFromSpec,
      diagramType: 'flowchart',
      changed: true,
      repairsApplied: ['Serialized structured JSON diagram specification to Mermaid']
    };
  }

  let diagramType = detectMermaidDiagramType(working);

  // If diagramType is unknown, check if all lines look like flowchart edges/nodes missing `flowchart TD`
  if (diagramType === 'unknown') {
    const nonEmptyLines = working
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('%%'));
    const looksLikeFlowchartBody =
      nonEmptyLines.length > 0 &&
      nonEmptyLines.some((l) => /-->|-\.->|==>/.test(l) || /^[A-Za-z_][A-Za-z0-9_-]*\s*[[({]/.test(l));
    if (looksLikeFlowchartBody) {
      working = `flowchart TD\n${working}`;
      diagramType = 'flowchart';
      repairsApplied.add('Added missing flowchart TD header');
    }
  }

  const lines = working.split('\n');
  let repairedLines: string[] = lines;

  if (diagramType === 'flowchart') {
    repairedLines = lines.map((line, index) => {
      if (index === 0 && /^(?:flowchart|graph)\b/i.test(line.trim())) {
        // Ensure valid direction token on header line
        const headerMatch = line.trim().match(/^(flowchart|graph)(?:\s+(TD|TB|BT|RL|LR))?\s*$/i);
        if (headerMatch) {
          const keyword = headerMatch[1];
          const dir = (headerMatch[2] || 'TD').toUpperCase();
          return `${keyword} ${dir}`;
        }
        // If the first line put a node right after `flowchart TD A[...] --> B[...]`
        const inlineRestMatch = line.trim().match(/^(flowchart|graph)\s+(TD|TB|BT|RL|LR)\s+(.+)$/i);
        if (inlineRestMatch) {
          repairsApplied.add('Split inline flowchart header and first statement onto separate lines');
          const repairedStmt = repairFlowchartLine(inlineRestMatch[3], repairsApplied);
          return `${inlineRestMatch[1]} ${inlineRestMatch[2].toUpperCase()}\n    ${repairedStmt}`;
        }
      }
      return repairFlowchartLine(line, repairsApplied);
    });
  } else if (diagramType === 'sequenceDiagram') {
    repairedLines = lines.map((line) => repairSequenceDiagramLine(line, repairsApplied));
  }

  const repairedChart = repairedLines.join('\n').trim();
  return {
    originalChart: rawChart,
    repairedChart,
    diagramType,
    changed: repairedChart !== rawChart.trim(),
    repairsApplied: Array.from(repairsApplied)
  };
}

/**
 * Default client-side helper to invoke the constrained backend AI syntax repair endpoint (`/api/mermaid/repair`).
 */
export async function requestServerAiMermaidRepair(
  brokenChart: string,
  parseErrorMessage: string,
  diagramType: MermaidDiagramType
): Promise<string | null> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return null;
  }
  try {
    let token = '';
    try {
      const { auth } = await import('../firebase');
      if (auth?.currentUser) {
        token = await auth.currentUser.getIdToken();
      }
    } catch {
      // Proceed without token if firebase client is unavailable in test context
    }

    const res = await fetch('/api/mermaid/repair', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        chart: brokenChart,
        errorMessage: parseErrorMessage,
        diagramType
      })
    });

    if (!res.ok) return null;
    const data = await res.json();
    if (data && typeof data.repairedChart === 'string' && data.repairedChart.trim()) {
      return data.repairedChart.trim();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Executes the full Detection -> Deterministic Repair -> Constrained AI Repair -> Re-Validation pipeline.
 * Uses the provided `parseValidator` (defaults to `mermaid.parse`) so every candidate is verified before rendering.
 */
export async function validateAndRecoverMermaidDiagram(
  rawChart: string,
  options?: {
    parseValidator?: (chartText: string) => Promise<boolean | void>;
    aiRepairFn?: ConstrainedAiRepairFn | null;
  }
): Promise<MermaidValidationRecoveryResult> {
  const trimmed = (rawChart || '').trim();
  if (!trimmed) {
    return {
      isValid: false,
      chart: '',
      diagramType: 'unknown',
      stage: 'failed',
      repairsApplied: [],
      errorMessage: 'Diagram source is empty.'
    };
  }

  const runParse = async (candidate: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      if (options?.parseValidator) {
        const res = await options.parseValidator(candidate);
        if (res === false) {
          return { ok: false, error: 'Mermaid parser rejected diagram syntax.' };
        }
        return { ok: true };
      }
      const mermaidModule = await import('mermaid');
      const mermaidInstance = mermaidModule.default;
      const parseResult = await mermaidInstance.parse(candidate, { suppressErrors: false });
      if (!parseResult) {
        return { ok: false, error: 'Mermaid parser rejected diagram syntax.' };
      }
      return { ok: true };
    } catch (err: any) {
      return {
        ok: false,
        error: err?.message || String(err)
      };
    }
  };

  // Stage 0: If the block is a JSON StructuredDiagramSpec, serialize and validate it first
  const serializedSpec = trySerializeStructuredDiagramJson(trimmed);
  if (serializedSpec) {
    const specValidation = await runParse(serializedSpec);
    if (specValidation.ok) {
      return {
        isValid: true,
        chart: serializedSpec,
        diagramType: 'flowchart',
        stage: 'structured_spec',
        repairsApplied: ['Serialized structured diagram specification to Mermaid']
      };
    }
  }

  // Stage 1: Validate original source directly via mermaid.parse()
  const initialValidation = await runParse(trimmed);
  const initialType = detectMermaidDiagramType(trimmed);
  if (initialValidation.ok) {
    return {
      isValid: true,
      chart: trimmed,
      diagramType: initialType,
      stage: 'original',
      repairsApplied: []
    };
  }

  // Stage 2: Run grammar-aware deterministic repair and validate
  const deterministic = repairMermaidSyntaxDeterministically(trimmed);
  if (deterministic.changed && deterministic.repairedChart) {
    const repairedValidation = await runParse(deterministic.repairedChart);
    if (repairedValidation.ok) {
      return {
        isValid: true,
        chart: deterministic.repairedChart,
        diagramType: deterministic.diagramType,
        stage: 'deterministic_repair',
        repairsApplied: deterministic.repairsApplied
      };
    }
  }

  // Stage 3: Constrained AI syntax repair (if configured or in browser environment)
  const aiRepairCallback =
    options?.aiRepairFn !== undefined ? options.aiRepairFn : requestServerAiMermaidRepair;

  if (aiRepairCallback) {
    try {
      const candidateForAi = deterministic.repairedChart || trimmed;
      const aiCandidate = await aiRepairCallback(
        candidateForAi,
        initialValidation.error || 'Mermaid syntax validation failed',
        deterministic.diagramType
      );
      if (aiCandidate && aiCandidate.trim()) {
        // Also pass AI output through deterministic label hygiene before final parse check
        const postAiNormalized = repairMermaidSyntaxDeterministically(aiCandidate.trim());
        const finalAiChart = postAiNormalized.repairedChart || aiCandidate.trim();
        const aiValidation = await runParse(finalAiChart);
        if (aiValidation.ok) {
          return {
            isValid: true,
            chart: finalAiChart,
            diagramType: detectMermaidDiagramType(finalAiChart),
            stage: 'ai_repair',
            repairsApplied: [
              ...deterministic.repairsApplied,
              'Constrained AI syntax correction validated by mermaid.parse()'
            ]
          };
        }
      }
    } catch {
      // Proceed to transparent failure state
    }
  }

  // Stage 4: Unrecoverable syntax — return transparent failure state (never fabricate a diagram)
  return {
    isValid: false,
    chart: trimmed,
    diagramType: deterministic.diagramType,
    stage: 'failed',
    repairsApplied: deterministic.repairsApplied,
    errorMessage:
      'This diagram could not be rendered because its syntax could not be validated. The rest of this lesson remains available.',
    diagnosticDetails: initialValidation.error || 'Mermaid syntax validation failed.'
  };
}

/**
 * Processes Markdown content to compile structured `diagram-spec` / `mermaid-json` blocks
 * into verified Mermaid fenced blocks and applies grammar-aware deterministic label quoting
 * to `mermaid` fenced blocks, while keeping all other Markdown and math blocks untouched.
 */
export function normalizeMermaidBlocksInMarkdown(markdown: string): string {
  if (!markdown || typeof markdown !== 'string') return markdown || '';
  return markdown.replace(
    /(^|\n)(```|~~~)(mermaid|mermaid-json|diagram-spec)[ \t]*\n([\s\S]*?)\n\2(?=\n|$)/gi,
    (fullMatch, leading: string, fence: string, lang: string, body: string) => {
      const normalizedLang = lang.trim().toLowerCase();
      if (normalizedLang === 'mermaid-json' || normalizedLang === 'diagram-spec') {
        const serialized = trySerializeStructuredDiagramJson(body);
        if (serialized) {
          return `${leading}${fence}mermaid\n${serialized}\n${fence}`;
        }
        return fullMatch;
      }
      const repaired = repairMermaidSyntaxDeterministically(body);
      return `${leading}${fence}mermaid\n${repaired.repairedChart}\n${fence}`;
    }
  );
}
