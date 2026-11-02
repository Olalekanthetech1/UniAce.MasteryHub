import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeStructuredDiagramToMermaid } from '../src/services/mermaidRepairService';

const validDiagram = {
  type: 'flowchart' as const,
  direction: 'TD' as const,
  nodes: [
    { id: 'fluid-density', label: 'Fluid Density (rho = m/V)' },
    { id: 'specific-weight', label: 'Specific Weight (gamma = rho*g)' }
  ],
  edges: [{ from: 'fluid-density', to: 'specific-weight' }]
};

test('structured diagrams serialize valid node and edge references', () => {
  const output = serializeStructuredDiagramToMermaid(validDiagram);
  assert.match(output, /fluid_density\["Fluid Density \(rho = m\/V\)"\]/);
  assert.match(output, /specific_weight\["Specific Weight \(gamma = rho\*g\)"\]/);
  assert.match(output, /fluid_density --> specific_weight/);
});

test('rejects distinct source IDs that collide after Mermaid identifier sanitization', () => {
  const collision = {
    ...validDiagram,
    nodes: [
      { id: 'fluid-density', label: 'Fluid density' },
      { id: 'fluid_density', label: 'Specific weight' }
    ],
    edges: [{ from: 'fluid-density', to: 'fluid_density' }]
  };

  assert.throws(
    () => serializeStructuredDiagramToMermaid(collision),
    /both normalize to Mermaid ID/
  );
});

test('rejects edges that would otherwise create implicit, undefined Mermaid nodes', () => {
  const invalid = {
    ...validDiagram,
    edges: [{ from: 'fluid-density', to: 'pressure' }]
  };

  assert.throws(
    () => serializeStructuredDiagramToMermaid(invalid),
    /undefined target node "pressure"/
  );
});

test('rejects subgraphs containing undefined nodes', () => {
  const invalid = {
    ...validDiagram,
    subgraphs: [{
      id: 'properties',
      title: 'Fluid properties',
      nodeIds: ['fluid-density', 'viscosity']
    }]
  };

  assert.throws(
    () => serializeStructuredDiagramToMermaid(invalid),
    /Subgraph references undefined diagram node "viscosity"/
  );
});

test('rejects a node assigned to more than one subgraph', () => {
  const invalid = {
    ...validDiagram,
    subgraphs: [
      { id: 'group-a', title: 'Group A', nodeIds: ['fluid-density'] },
      { id: 'group-b', title: 'Group B', nodeIds: ['fluid-density'] }
    ]
  };

  assert.throws(
    () => serializeStructuredDiagramToMermaid(invalid),
    /assigned to more than one subgraph/
  );
});

test('rejects subgraph identifiers that collide with diagram node identifiers', () => {
  const invalid = {
    ...validDiagram,
    subgraphs: [{
      id: 'fluid-density',
      title: 'Conflicting group',
      nodeIds: ['specific-weight']
    }]
  };

  assert.throws(
    () => serializeStructuredDiagramToMermaid(invalid),
    /conflicts with a diagram node/
  );
});
