import { parse } from 'mathjs';
import { z } from 'zod';
import { StructuredDiagramSpecSchema } from '../services/mermaidRepairService';

const blockIdentity = {
  id: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(240)
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

/**
 * Allows arithmetic expressions only. Assignment, accessors, indexing, object
 * construction, arbitrary function calls and user-defined functions are rejected.
 */
export function validateSimulationExpression(
  expression: string,
  independentVariable: string,
  parameterSymbol: string
): { valid: true } | { valid: false; reason: string } {
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

export const ExplanationBlockSchema = z.object({
  ...blockIdentity,
  type: z.literal('explanation'),
  body: z.string().trim().min(40).max(30000)
});

export const MathematicalDerivationBlockSchema = z.object({
  ...blockIdentity,
  type: z.literal('mathematical_derivation'),
  introduction: z.string().trim().min(20).max(5000),
  assumptions: z.array(z.string().trim().min(3).max(500)).max(20),
  steps: z.array(z.object({
    explanation: z.string().trim().min(10).max(3000),
    equationLatex: z.string().trim().min(1).max(2000).optional()
  })).min(2).max(30),
  conclusion: z.string().trim().min(10).max(3000)
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
  exampleType: z.enum(['numerical', 'conceptual', 'proof', 'case-analysis', 'experimental', 'design']),
  problem: z.string().trim().min(10).max(8000),
  givens: z.array(z.object({
    symbol: z.string().trim().min(1).max(80),
    value: z.string().trim().min(1).max(160),
    unit: z.string().trim().max(80).optional()
  })).max(30),
  target: z.string().trim().min(2).max(1000),
  assumptions: z.array(z.string().trim().min(3).max(500)).max(20),
  steps: z.array(z.object({
    explanation: z.string().trim().min(10).max(3000),
    equationLatex: z.string().trim().min(1).max(2000).optional()
  })).min(2).max(40),
  finalAnswer: z.object({
    value: z.string().trim().min(1).max(500),
    unit: z.string().trim().max(80).optional()
  }),
  verification: z.string().trim().min(10).max(3000)
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
  if (!expressionCheck.valid) {
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

export const AcademicContentBlockSchema = z.discriminatedUnion('type', [
  ExplanationBlockSchema,
  MathematicalDerivationBlockSchema,
  EngineeringDiagramBlockSchema,
  WorkedExampleBlockSchema,
  InteractiveSimulationBlockSchema,
  KnowledgeCheckBlockSchema
]);

export const AcademicContentBlockCollectionSchema = z.object({
  schemaVersion: z.literal('1.0'),
  blocks: z.array(AcademicContentBlockSchema).min(1).max(100)
}).superRefine((collection, ctx) => {
  const seenIds = new Set<string>();
  collection.blocks.forEach((block, index) => {
    if (seenIds.has(block.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['blocks', index, 'id'],
        message: `Duplicate academic content block ID: "${block.id}".`
      });
    }
    seenIds.add(block.id);
  });
});

export type AcademicContentBlock = z.infer<typeof AcademicContentBlockSchema>;
export type AcademicContentBlockCollection = z.infer<typeof AcademicContentBlockCollectionSchema>;
export type InteractiveSimulationBlock = z.infer<typeof InteractiveSimulationBlockSchema>;
