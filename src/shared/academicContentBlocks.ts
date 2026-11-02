import { z } from 'zod';
import { validateArithmeticExpression } from './simulationExpression';

const contentBlockId = z.string().trim().min(1).max(120);

export const ExplanationContentBlockSchema = z.object({
  id: contentBlockId,
  type: z.literal('explanation'),
  title: z.string().trim().min(1).max(180).optional(),
  markdown: z.string().trim().min(20).max(60000)
});

export const MathematicalDerivationContentBlockSchema = z.object({
  id: contentBlockId,
  type: z.literal('mathematical_derivation'),
  title: z.string().trim().min(1).max(180),
  introduction: z.string().trim().min(10).max(4000).optional(),
  assumptions: z.array(z.string().trim().min(3).max(1000)).max(12).default([]),
  steps: z.array(z.object({
    label: z.string().trim().min(1).max(160).optional(),
    expression: z.string().trim().min(1).max(1000),
    reasoning: z.string().trim().min(10).max(4000)
  })).min(1).max(20),
  conclusion: z.string().trim().min(10).max(4000).optional()
});

export const EngineeringDiagramContentBlockSchema = z.object({
  id: contentBlockId,
  type: z.literal('engineering_diagram'),
  title: z.string().trim().min(1).max(180).optional(),
  format: z.enum(['mermaid', 'function-plot', 'svg', 'venn']),
  source: z.string().trim().min(10).max(40000),
  altText: z.string().trim().min(10).max(500)
});

export const WorkedExampleContentBlockSchema = z.object({
  id: contentBlockId,
  type: z.literal('worked_example'),
  exampleIndex: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(180).optional()
});

const SimulationVariableSchema = z.object({
  key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,31}$/),
  label: z.string().trim().min(1).max(120),
  unit: z.string().trim().max(40).optional(),
  min: z.number().finite(),
  max: z.number().finite(),
  initialValue: z.number().finite(),
  step: z.number().finite().positive()
});

export const InteractiveSimulationContentBlockSchema = z.object({
  id: contentBlockId,
  type: z.literal('interactive_simulation'),
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().min(10).max(2000),
  variables: z.array(SimulationVariableSchema).min(1).max(6),
  output: z.object({
    label: z.string().trim().min(1).max(120),
    unit: z.string().trim().max(40).optional(),
    expression: z.string().trim().min(1).max(160)
  })
}).superRefine((block, ctx) => {
  const keys = new Set<string>();
  block.variables.forEach((variable, index) => {
    if (keys.has(variable.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['variables', index, 'key'],
        message: `Duplicate simulation variable key "${variable.key}".`
      });
    }
    keys.add(variable.key);
    if (variable.min >= variable.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['variables', index, 'max'],
        message: 'Simulation variable maximum must be greater than its minimum.'
      });
    }
    if (variable.initialValue < variable.min || variable.initialValue > variable.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['variables', index, 'initialValue'],
        message: 'Simulation initial value must be inside the configured range.'
      });
    }
    if (variable.step > variable.max - variable.min) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['variables', index, 'step'],
        message: 'Simulation step cannot exceed the variable range.'
      });
    }
  });

  try {
    validateArithmeticExpression(block.output.expression, [...keys]);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['output', 'expression'],
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

export const KnowledgeCheckContentBlockSchema = z.object({
  id: contentBlockId,
  type: z.literal('knowledge_check'),
  activityIndex: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(180).optional()
});

export const AcademicContentBlockSchema = z.discriminatedUnion('type', [
  ExplanationContentBlockSchema,
  MathematicalDerivationContentBlockSchema,
  EngineeringDiagramContentBlockSchema,
  WorkedExampleContentBlockSchema,
  InteractiveSimulationContentBlockSchema,
  KnowledgeCheckContentBlockSchema
]);

export const AcademicContentBlockDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  blocks: z.array(AcademicContentBlockSchema).min(1).max(50)
}).superRefine((document, ctx) => {
  const ids = new Set<string>();
  let explanationCount = 0;
  document.blocks.forEach((block, index) => {
    if (ids.has(block.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['blocks', index, 'id'],
        message: `Duplicate academic content block ID "${block.id}".`
      });
    }
    ids.add(block.id);
    if (block.type === 'explanation') explanationCount++;
  });

  if (explanationCount === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['blocks'],
      message: 'A structured lesson must contain at least one explanation block.'
    });
  }
});

export type ExplanationContentBlock = z.infer<typeof ExplanationContentBlockSchema>;
export type MathematicalDerivationContentBlock = z.infer<typeof MathematicalDerivationContentBlockSchema>;
export type EngineeringDiagramContentBlock = z.infer<typeof EngineeringDiagramContentBlockSchema>;
export type WorkedExampleContentBlock = z.infer<typeof WorkedExampleContentBlockSchema>;
export type InteractiveSimulationContentBlock = z.infer<typeof InteractiveSimulationContentBlockSchema>;
export type KnowledgeCheckContentBlock = z.infer<typeof KnowledgeCheckContentBlockSchema>;
export type AcademicContentBlock = z.infer<typeof AcademicContentBlockSchema>;
export type AcademicContentBlockDocument = z.infer<typeof AcademicContentBlockDocumentSchema>;

/** Backward-compatible adapter: old Markdown becomes a single typed explanation block. */
export function adaptLegacyMarkdownToContentBlocks(markdown: string): AcademicContentBlockDocument | null {
  if (typeof markdown !== 'string' || markdown.trim().length === 0) return null;
  return {
    schemaVersion: 1,
    blocks: [{
      id: 'legacy-markdown-explanation',
      type: 'explanation',
      title: 'Lesson content',
      markdown
    }]
  };
}

/** Prefer validated blocks; malformed or absent block data falls back to the original Markdown. */
export function resolveAcademicContentBlocks(
  contentBlocks: unknown,
  legacyMarkdown: string
): AcademicContentBlockDocument | null {
  const parsed = AcademicContentBlockDocumentSchema.safeParse(contentBlocks);
  return parsed.success ? parsed.data : adaptLegacyMarkdownToContentBlocks(legacyMarkdown);
}
