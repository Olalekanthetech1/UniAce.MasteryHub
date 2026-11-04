import { parse } from 'mathjs';
import { z } from 'zod';
import { StructuredDiagramSpecSchema } from '../services/mermaidRepairService';

const blockIdentity = {
  id: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(300),
  academicRole: z.string().trim().min(1).max(240).optional(),
  disciplineHint: z.string().trim().min(1).max(240).optional()
};

const identifierSchema = z.string().regex(
  /^[A-Za-z][A-Za-z0-9_]*$/,
  'Use a simple identifier beginning with a letter.'
);

const finiteNumber = z.number().finite();

const simulationDomainSchema = z.object({
  min: finiteNumber,
  max: finiteNumber
}).superRefine((domain, ctx) => {
  if (domain.min >= domain.max) {
    ctx.addIssue({
      code: 'custom',
      path: ['max'],
      message: 'The simulation domain maximum must be greater than its minimum.'
    });
  }
});

const simulationParameterSchema = z.object({
  symbol: identifierSchema,
  label: z.string().trim().min(1).max(120),
  initialValue: finiteNumber,
  min: finiteNumber,
  max: finiteNumber,
  step: finiteNumber,
  unit: z.string().trim().max(40).optional()
}).superRefine((parameter, ctx) => {
  if (parameter.min >= parameter.max) {
    ctx.addIssue({
      code: 'custom',
      path: ['max'],
      message: 'The parameter maximum must be greater than its minimum.'
    });
  }
  if (parameter.initialValue < parameter.min || parameter.initialValue > parameter.max) {
    ctx.addIssue({
      code: 'custom',
      path: ['initialValue'],
      message: 'The initial parameter value must be within its declared range.'
    });
  }
  if (parameter.step <= 0 || parameter.step > parameter.max - parameter.min) {
    ctx.addIssue({
      code: 'custom',
      path: ['step'],
      message: 'The parameter step must be positive and no greater than its range.'
    });
  }
});

const ALLOWED_SIMULATION_OPERATORS = new Set(['+', '-', '*', '/', '^', '%']);
const ALLOWED_SIMULATION_FUNCTIONS = new Set([
  'abs', 'cos', 'exp', 'log', 'log10', 'max', 'min', 'sin', 'sqrt', 'tan'
]);

const RESERVED_SIMULATION_SYMBOLS = new Set([
  'pi',
  'e',
  ...ALLOWED_SIMULATION_FUNCTIONS
]);

/**
 * Allows arithmetic expressions only. Assignment, accessors, indexing, object
 * construction, arbitrary function calls and user-defined functions are rejected.
 */
export function validateSimulationExpression(
  expression: string,
  independentVariable: string,
  parameterSymbol: string
): { valid: true } | { valid: false; reason: string } {
  if (RESERVED_SIMULATION_SYMBOLS.has(independentVariable)) {
    return { valid: false, reason: `The independent variable symbol "${independentVariable}" is reserved by the simulation language.` };
  }
  if (RESERVED_SIMULATION_SYMBOLS.has(parameterSymbol)) {
    return { valid: false, reason: `The adjustable parameter symbol "${parameterSymbol}" is reserved by the simulation language.` };
  }
  if (independentVariable === parameterSymbol) {
    return { valid: false, reason: 'The independent variable and adjustable parameter must use different symbols.' };
  }
  if (!expression.trim() || expression.length > 300) {
    return { valid: false, reason: 'The simulation expression must contain 1–300 characters.' };
  }
  if (!/^[A-Za-z0-9_\s.+\-*/^(),]+$/.test(expression)) {
    return { valid: false, reason: 'The expression contains characters outside the supported arithmetic grammar.' };
  }

  try {
    const tree = parse(expression);
    let failure: string | null = null;
    const allowedSymbols = new Set([independentVariable, parameterSymbol, 'pi', 'e']);

    tree.traverse((node: any, _path: string, parent: any) => {
      if (failure) return;

      if (node.isConstantNode) {
        if (typeof node.value !== 'number' || !Number.isFinite(node.value)) {
          failure = 'Only finite numeric constants are supported.';
        }
        return;
      }

      if (node.isSymbolNode) {
        // MathJS represents the callee of a FunctionNode as a SymbolNode child.
        // Treat that symbol as a function identifier, not as a free variable.
        const isFunctionIdentifier = Boolean(parent?.isFunctionNode && parent.fn === node);
        if (isFunctionIdentifier) {
          if (!ALLOWED_SIMULATION_FUNCTIONS.has(node.name)) {
            failure = 'The expression calls a function that is not on the simulation allowlist.';
          }
        } else if (!allowedSymbols.has(node.name)) {
          failure = `Unsupported simulation symbol: ${String(node.name)}.`;
        }
        return;
      }

      if (node.isParenthesisNode) return;

      if (node.isOperatorNode) {
        if (!ALLOWED_SIMULATION_OPERATORS.has(node.op)) {
          failure = `Unsupported arithmetic operator: ${String(node.op)}.`;
        }
        return;
      }

      if (node.isFunctionNode) {
        const functionName = node.fn?.isSymbolNode ? node.fn.name : '';
        if (!ALLOWED_SIMULATION_FUNCTIONS.has(functionName)) {
          failure = 'The expression calls a function that is not on the simulation allowlist.';
        }
        return;
      }

      failure = `Unsupported expression construct: ${String(node.type || 'unknown')}.`;
    });

    return failure ? { valid: false, reason: failure } : { valid: true };
  } catch {
    return { valid: false, reason: 'The simulation expression could not be parsed.' };
  }
}

export const StructuredTableSchema = z.object({
  caption: z.string().trim().max(300).optional(),
  headers: z.array(z.string().trim().min(1).max(160)).min(1).max(12),
  rows: z.array(z.array(z.string().trim().max(1000)).min(1).max(12)).min(1).max(60)
});

export const StructuredSectionItemSchema = z.object({
  heading: z.string().trim().min(1).max(200),
  content: z.string().trim().min(5).max(10000)
});

export const StructuredKeyValueItemSchema = z.object({
  label: z.string().trim().min(1).max(200),
  detail: z.string().trim().min(1).max(4000),
  tag: z.string().trim().max(80).optional()
});

export const ExplanationBlockSchema = z.object({
  ...blockIdentity,
  type: z.literal('explanation'),
  body: z.string().trim().min(40).max(30000),
  keyTakeaways: z.array(z.string().trim().min(3).max(500)).max(12).optional(),
  sections: z.array(StructuredSectionItemSchema).max(20).optional(),
  items: z.array(StructuredKeyValueItemSchema).max(30).optional(),
  table: StructuredTableSchema.optional(),
  codeSnippet: z.string().trim().min(1).max(10000).optional(),
  language: z.string().trim().max(40).optional(),
  citations: z.array(z.string().trim().min(2).max(600)).max(25).optional(),
  callout: z.string().trim().min(5).max(3000).optional()
});

export const MathematicalDerivationBlockSchema = z.object({
  ...blockIdentity,
  type: z.literal('mathematical_derivation'),
  introduction: z.string().trim().min(10).max(5000),
  assumptions: z.array(z.string().trim().min(2).max(500)).max(20).default([]),
  steps: z.array(z.object({
    explanation: z.string().trim().min(5).max(3000),
    equationLatex: z.string().trim().min(1).max(2000).optional(),
    codeSnippet: z.string().trim().min(1).max(4000).optional(),
    language: z.string().trim().max(40).optional(),
    evidenceOrCitation: z.string().trim().min(2).max(1000).optional()
  })).min(2).max(30),
  conclusion: z.string().trim().min(5).max(3000)
});

export const EngineeringDiagramBlockSchema = z.object({
  ...blockIdentity,
  type: z.literal('engineering_diagram'),
  description: z.string().trim().min(10).max(3000),
  diagram: StructuredDiagramSpecSchema
});

export const WorkedExampleBlockSchema = z.object({
  ...blockIdentity,
  type: z.literal('worked_example'),
  exampleType: z.string().trim().min(2).max(120).default('numerical'),
  problem: z.string().trim().min(5).max(8000),
  givens: z.array(z.object({
    symbol: z.string().trim().min(1).max(120),
    value: z.string().trim().min(1).max(500),
    unit: z.string().trim().max(80).optional()
  })).max(30).default([]),
  contextFactors: z.array(z.object({
    label: z.string().trim().min(1).max(160),
    detail: z.string().trim().min(1).max(1000)
  })).max(30).optional(),
  target: z.string().trim().min(2).max(1000).default('Determine the required solution'),
  assumptions: z.array(z.string().trim().min(2).max(500)).max(20).default([]),
  steps: z.array(z.object({
    explanation: z.string().trim().min(5).max(3000),
    equationLatex: z.string().trim().min(1).max(2000).optional(),
    codeSnippet: z.string().trim().min(1).max(4000).optional(),
    language: z.string().trim().max(40).optional(),
    evidenceOrCitation: z.string().trim().min(2).max(1000).optional()
  })).min(2).max(40),
  finalAnswer: z.object({
    value: z.string().trim().min(1).max(1500),
    unit: z.string().trim().max(80).optional()
  }),
  verification: z.string().trim().min(5).max(3000)
});

export const InteractiveSimulationBlockSchema = z.object({
  ...blockIdentity,
  type: z.literal('interactive_simulation'),
  simulationType: z.literal('parameterized_curve'),
  description: z.string().trim().min(10).max(2000),
  expression: z.string().trim().min(1).max(300),
  independentVariable: identifierSchema,
  domain: simulationDomainSchema,
  parameter: simulationParameterSchema,
  dependentUnit: z.string().trim().max(80).optional()
}).superRefine((simulation, ctx) => {
  if (simulation.independentVariable === simulation.parameter.symbol) {
    ctx.addIssue({
      code: 'custom',
      path: ['parameter', 'symbol'],
      message: 'The independent variable and adjustable parameter must use different symbols.'
    });
  }

  const expressionCheck = validateSimulationExpression(
    simulation.expression,
    simulation.independentVariable,
    simulation.parameter.symbol
  );
  if (expressionCheck.valid === false) {
    ctx.addIssue({
      code: 'custom',
      path: ['expression'],
      message: expressionCheck.reason
    });
  }
});

export const KnowledgeCheckBlockSchema = z.object({
  ...blockIdentity,
  type: z.literal('knowledge_check'),
  activityIndex: z.number().int().nonnegative().max(100)
});

/**
 * Open, forward-compatible structured block capability (`type: "structured_block"`)
 * allowing any course discipline or future pedagogy extension to define custom block
 * structures (`customType`, `academicRole`, `sections`, `items`, `table`, `codeSnippet`,
 * `equationsLatex`, `citations`, `callout`) without hardcoding discipline enums.
 */
export const DynamicStructuredBlockSchema = z.object({
  ...blockIdentity,
  type: z.literal('structured_block'),
  customType: z.string().trim().min(2).max(80).optional(),
  summary: z.string().trim().min(10).max(5000).optional(),
  body: z.string().trim().min(10).max(30000).optional(),
  sections: z.array(StructuredSectionItemSchema).min(1).max(30).optional(),
  items: z.array(StructuredKeyValueItemSchema).min(1).max(50).optional(),
  table: StructuredTableSchema.optional(),
  codeSnippet: z.string().trim().min(1).max(10000).optional(),
  language: z.string().trim().max(40).optional(),
  equationsLatex: z.array(z.string().trim().min(1).max(2000)).max(20).optional(),
  citations: z.array(z.string().trim().min(2).max(600)).max(25).optional(),
  callout: z.string().trim().min(5).max(3000).optional()
}).superRefine((block, ctx) => {
  const hasSubstantiveContent = Boolean(
    block.body ||
    block.summary ||
    (block.sections && block.sections.length > 0) ||
    (block.items && block.items.length > 0) ||
    block.table ||
    block.codeSnippet ||
    (block.equationsLatex && block.equationsLatex.length > 0)
  );
  if (!hasSubstantiveContent) {
    ctx.addIssue({
      code: 'custom',
      path: ['body'],
      message: `Dynamic structured block "${block.id}" must include at least one structured content field (body, summary, sections, items, table, codeSnippet, or equationsLatex).`
    });
  }
});

export const AcademicContentBlockSchema = z.discriminatedUnion('type', [
  ExplanationBlockSchema,
  MathematicalDerivationBlockSchema,
  EngineeringDiagramBlockSchema,
  WorkedExampleBlockSchema,
  InteractiveSimulationBlockSchema,
  KnowledgeCheckBlockSchema,
  DynamicStructuredBlockSchema
]);

export const AcademicContentBlockCollectionSchema = z.preprocess((raw: unknown) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = { ...(raw as Record<string, any>) };
  if (!obj.schemaVersion) obj.schemaVersion = '1.0';
  if (Array.isArray(obj.blocks)) {
    const seenIds = new Set<string>();
    const seenChecks = new Set<number>();
    const dedupedBlocks: any[] = [];
    for (let i = 0; i < obj.blocks.length; i++) {
      const b = obj.blocks[i];
      if (!b || typeof b !== 'object') continue;
      const copy = { ...b };
      let id = String(copy.id || `block-${i + 1}`).trim();
      if (seenIds.has(id)) id = `${id}-${i + 1}`;
      seenIds.add(id);
      copy.id = id;
      if (Array.isArray(copy.steps)) {
        copy.steps = copy.steps.map((s: any) => (typeof s === 'string' ? { explanation: s } : s));
      }
      if (copy.type === 'worked_example') {
        if (typeof copy.finalAnswer === 'string') {
          copy.finalAnswer = { value: copy.finalAnswer };
        }
        if (Array.isArray(copy.givens)) {
          copy.givens = copy.givens.map((g: any, idx: number) => {
            if (typeof g === 'string') {
              const parts = g.split('=');
              return parts.length >= 2
                ? { symbol: parts[0].trim() || `g${idx + 1}`, value: parts.slice(1).join('=').trim() || g }
                : { symbol: `given_${idx + 1}`, value: g };
            }
            return g;
          });
        }
      }
      if (copy.type === 'knowledge_check' && typeof copy.activityIndex === 'number') {
        if (seenChecks.has(copy.activityIndex)) continue;
        seenChecks.add(copy.activityIndex);
      }
      dedupedBlocks.push(copy);
    }
    obj.blocks = dedupedBlocks;
  }
  return obj;
}, z.object({
  schemaVersion: z.literal('1.0'),
  disciplineEngine: z.string().trim().min(1).max(300).optional(),
  blocks: z.array(AcademicContentBlockSchema).min(1).max(100)
}).superRefine((collection, ctx) => {
  const seenIds = new Set<string>();
  const seenKnowledgeChecks = new Set<number>();
  collection.blocks.forEach((block, index) => {
    if (seenIds.has(block.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['blocks', index, 'id'],
        message: `Duplicate academic content block ID: "${block.id}".`
      });
    }
    seenIds.add(block.id);

    if (block.type === 'knowledge_check') {
      if (seenKnowledgeChecks.has(block.activityIndex)) {
        ctx.addIssue({
          code: 'custom',
          path: ['blocks', index, 'activityIndex'],
          message: `Knowledge-check activity index ${block.activityIndex} is referenced more than once.`
        });
      }
      seenKnowledgeChecks.add(block.activityIndex);
    }
  });
}));

export type ExplanationBlock = z.infer<typeof ExplanationBlockSchema>;
export type MathematicalDerivationBlock = z.infer<typeof MathematicalDerivationBlockSchema>;
export type EngineeringDiagramBlock = z.infer<typeof EngineeringDiagramBlockSchema>;
export type WorkedExampleBlock = z.infer<typeof WorkedExampleBlockSchema>;
export type InteractiveSimulationBlock = z.infer<typeof InteractiveSimulationBlockSchema>;
export type KnowledgeCheckBlock = z.infer<typeof KnowledgeCheckBlockSchema>;
export type DynamicStructuredBlock = z.infer<typeof DynamicStructuredBlockSchema>;
export type AcademicContentBlock = z.infer<typeof AcademicContentBlockSchema>;
export type AcademicContentBlockCollection = z.infer<typeof AcademicContentBlockCollectionSchema>;

/**
 * Checks whether a block serves as a foundational conceptual/narrative block for the lesson.
 */
export function isFoundationalExplanationBlock(block: AcademicContentBlock): boolean {
  if (block.type === 'explanation') {
    return true;
  }
  if (block.type === 'structured_block') {
    return Boolean(
      (block.body && block.body.length >= 40) ||
      (block.sections && block.sections.length > 0)
    );
  }
  return false;
}

/**
 * Resolves the display label for a block dynamically from its runtime `academicRole` or `customType`,
 * falling back to a human-readable formatting of `block.type` without hardcoded discipline dictionaries.
 */
export function resolveBlockAcademicLabel(block: AcademicContentBlock): string {
  if (block.academicRole && block.academicRole.trim().length > 0) {
    return block.academicRole.trim();
  }
  if (block.type === 'structured_block' && block.customType && block.customType.trim().length > 0) {
    return block.customType
      .trim()
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }
  return block.type
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}


