import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AcademicContentBlockCollectionSchema,
  validateSimulationExpression
} from '../src/shared/academicContentBlocks';

const collection = {
  schemaVersion: '1.0',
  blocks: [
    {
      id: 'explain-pressure',
      title: 'Pressure in a fluid',
      type: 'explanation',
      body: 'Pressure is the normal force exerted per unit area by a fluid at a point.'
    },
    {
      id: 'derive-pressure',
      title: 'Hydrostatic pressure relation',
      type: 'mathematical_derivation',
      introduction: 'Consider a small stationary fluid element and apply vertical force equilibrium.',
      assumptions: ['The fluid is at rest.', 'Density is constant over the stated depth interval.'],
      steps: [
        { explanation: 'Balance the vertical pressure and weight forces.', equationLatex: 'P A - (P + dP)A - \\rho g A dz = 0' },
        { explanation: 'Divide by the element volume and rearrange.', equationLatex: '\\frac{dP}{dz} = -\\rho g' }
      ],
      conclusion: 'Pressure increases with depth when the vertical coordinate is positive upward.'
    },
    {
      id: 'diagram-pressure',
      title: 'Fluid element',
      type: 'engineering_diagram',
      description: 'A conceptual flowchart of the forces and pressure acting on the fluid element.',
      diagram: {
        type: 'flowchart',
        direction: 'TD',
        nodes: [
          { id: 'pressure', label: 'Pressure forces' },
          { id: 'weight', label: 'Fluid element weight' },
          { id: 'equilibrium', label: 'Vertical force equilibrium' }
        ],
        edges: [
          { from: 'pressure', to: 'equilibrium' },
          { from: 'weight', to: 'equilibrium' }
        ]
      }
    },
    {
      id: 'example-pressure',
      title: 'Calculate pressure at depth',
      type: 'worked_example',
      exampleType: 'numerical',
      problem: 'Determine the gauge pressure at the stated depth using the supplied fluid properties.',
      givens: [{ symbol: 'rho', value: '1000', unit: 'kg/m^3' }, { symbol: 'h', value: '2', unit: 'm' }],
      target: 'Gauge pressure at the specified depth',
      assumptions: ['The fluid is stationary.', 'Gravitational acceleration is 9.81 m/s^2.'],
      steps: [
        { explanation: 'Select the hydrostatic pressure relationship.', equationLatex: 'p = \\rho g h' },
        { explanation: 'Substitute the stated quantities and calculate the pressure.', equationLatex: 'p = 1000 \\times 9.81 \\times 2' }
      ],
      finalAnswer: { value: '19620', unit: 'Pa' },
      verification: 'The units reduce to N/m^2, which is Pa.'
    },
    {
      id: 'simulation-pressure',
      title: 'Explore a parameterized relationship',
      type: 'interactive_simulation',
      simulationType: 'parameterized_curve',
      description: 'Change the coefficient and observe how the curve changes.',
      expression: 'a*x',
      independentVariable: 'x',
      domain: { min: 0, max: 10 },
      parameter: { symbol: 'a', label: 'Coefficient', initialValue: 2, min: 0.5, max: 4, step: 0.1 }
    },
    {
      id: 'check-pressure',
      title: 'Explain the pressure-depth relationship',
      type: 'knowledge_check',
      activityIndex: 0
    }
  ]
};

test('accepts a versioned lesson containing all supported typed block kinds', () => {
  const parsed = AcademicContentBlockCollectionSchema.parse(collection);
  assert.equal(parsed.blocks.length, 6);
  assert.deepEqual(parsed.blocks.map(block => block.type), [
    'explanation',
    'mathematical_derivation',
    'engineering_diagram',
    'worked_example',
    'interactive_simulation',
    'knowledge_check'
  ]);
});

test('rejects duplicate block identifiers', () => {
  const invalid = structuredClone(collection);
  invalid.blocks[1].id = invalid.blocks[0].id;
  assert.throws(() => AcademicContentBlockCollectionSchema.parse(invalid), /Duplicate academic content block ID/);
});

test('simulation expressions accept arithmetic and allowlisted functions', () => {
  assert.deepEqual(validateSimulationExpression('a*sin(x) + sqrt(x^2)', 'x', 'a'), { valid: true });
  assert.deepEqual(validateSimulationExpression('log10(abs(x)) + cos(x)', 'x', 'a'), { valid: true });
});

test('simulation expressions reject bare function identifiers and unapproved callees', () => {
  assert.equal(validateSimulationExpression('sin', 'x', 'a').valid, false);
  assert.equal(validateSimulationExpression('custom(x)', 'x', 'a').valid, false);
});

test('simulation expressions reject unknown symbols and arbitrary code constructs', () => {
  assert.equal(validateSimulationExpression('a*x + externalValue', 'x', 'a').valid, false);
  assert.equal(validateSimulationExpression('x; process.exit()', 'x', 'a').valid, false);
  assert.equal(validateSimulationExpression('import(x)', 'x', 'a').valid, false);
});

test('simulation parameters must have valid ranges and distinct symbols', () => {
  const invalid = structuredClone(collection);
  const simulation = invalid.blocks.find(block => block.type === 'interactive_simulation')!;
  simulation.parameter.initialValue = 8;
  assert.throws(() => AcademicContentBlockCollectionSchema.parse(invalid), /initial parameter value must be within/);
});

test('simulation variables cannot collide with mathematical constants or allowlisted functions', () => {
  assert.equal(validateSimulationExpression('pi*x', 'x', 'pi').valid, false);
  assert.equal(validateSimulationExpression('sin*x', 'sin', 'a').valid, false);
  assert.equal(validateSimulationExpression('e*x', 'x', 'e').valid, false);

  const parameterCollision = structuredClone(collection);
  const parameterSimulation = parameterCollision.blocks.find(block => block.type === 'interactive_simulation')!;
  parameterSimulation.parameter.symbol = 'pi';
  const parameterResult = AcademicContentBlockCollectionSchema.safeParse(parameterCollision);
  assert.equal(parameterResult.success, false);
  if (!parameterResult.success) {
    assert.ok(parameterResult.error.issues.some(issue =>
      issue.message.includes('adjustable parameter symbol "pi" is reserved by the simulation language')
    ));
  }

  const variableCollision = structuredClone(collection);
  const variableSimulation = variableCollision.blocks.find(block => block.type === 'interactive_simulation')!;
  variableSimulation.independentVariable = 'sin';
  const variableResult = AcademicContentBlockCollectionSchema.safeParse(variableCollision);
  assert.equal(variableResult.success, false);
  if (!variableResult.success) {
    assert.ok(variableResult.error.issues.some(issue =>
      issue.message.includes('independent variable symbol "sin" is reserved by the simulation language')
    ));
  }
});
