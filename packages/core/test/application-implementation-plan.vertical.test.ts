import { describe, expect, it } from 'vitest';
import {
  resolveApplicationImplementationPlan,
  serializeApplicationImplementationPlan,
  sourceProvenance,
  type ApplicationCapabilityReference,
  type ApplicationImplementationDeclaration,
  type ApplicationImplementationResolutionInput,
} from '../src/index.js';

const sha = (value: string) => {
  const nibble = ((value.codePointAt(0) ?? 0) % 16).toString(16);
  return `sha256:${nibble.repeat(64)}`;
};
const Database: ApplicationCapabilityReference = { interface: 'TransactionalDatabase' };
const Scheduler: ApplicationCapabilityReference = { interface: 'Scheduler' };
const Operator: ApplicationCapabilityReference = { interface: 'OperatorRuntime' };
const ModelStore: ApplicationCapabilityReference = { interface: 'ManagedModelStore', qualifier: 'Workspace.store' };

function implementation(
  key: string,
  capability: ApplicationCapabilityReference,
  overrides: Partial<ApplicationImplementationDeclaration> = {},
): ApplicationImplementationDeclaration {
  return {
    key,
    capability,
    provider: { package: '@applik8s/test-provider', export: `${key}Provider`, version: '0.9.0' },
    identity: { kind: 'declaration' },
    provenance: sourceProvenance({
      origin: 'authored',
      module: 'src/profiles/production.ts',
      symbol: key,
    }),
    configurationDigest: sha(key[0] ?? 'a'),
    configurationSources: [],
    guarantees: ['ready'],
    runtimeAdapter: `${key}.runtime`,
    readiness: `${key}.ready`,
    lifecycle: 'application',
    migration: `${key}.migration.v1`,
    evidence: [`${key}.conformance`],
    maturity: 'beta',
    dependencies: [],
    ...overrides,
  };
}

function input(overrides: Partial<ApplicationImplementationResolutionInput> = {}): ApplicationImplementationResolutionInput {
  const database = implementation('database', Database);
  const scheduler = implementation('scheduler', Scheduler);
  const operator = implementation('operator', Operator, {
    dependencies: [
      { slot: 'database', requirement: Database, requiredGuarantees: ['ready'], operations: ['transaction.use'], input: { kind: 'implementation', declaration: 'database' }, visibility: 'private' },
      { slot: 'scheduler', requirement: Scheduler, requiredGuarantees: ['ready'], operations: ['schedule.configure'], input: { kind: 'implementation', declaration: 'scheduler' }, visibility: 'private' },
    ],
  });
  const models = implementation('models', ModelStore, {
    dependencies: [
      { slot: 'database', requirement: Database, requiredGuarantees: ['ready'], operations: ['model.read', 'model.write'], input: { kind: 'capability-reference', capability: Database }, visibility: 'private' },
    ],
  });
  return {
    application: 'chirp',
    profile: {
      id: 'production-kubernetes',
      digest: sha('p'),
      provenance: [sourceProvenance({ origin: 'authored', module: 'src/profiles/production.ts', symbol: 'production' })],
    },
    declarations: [operator, database, models, scheduler],
    bindings: [
      { id: 'binding:database', capability: Database, implementation: 'database', provenance: database.provenance },
      { id: 'binding:operator', capability: Operator, implementation: 'operator', provenance: operator.provenance },
      { id: 'binding:models', capability: ModelStore, implementation: 'models', provenance: models.provenance },
    ],
    ...overrides,
  };
}

describe('application implementation planning', () => {
  it('materializes reused implementations once and retains every typed consumer edge', () => {
    const source = input();
    const plan = resolveApplicationImplementationPlan(input({
      declarations: [...source.declarations, implementation('unused', Scheduler)],
    }));
    expect(plan.implementations).toHaveLength(4);
    const database = plan.implementations.find(({ identity }) => identity.provider.export === 'databaseProvider');
    expect(database).toBeDefined();
    expect(plan.dependencies.filter(({ dependency }) => dependency === database?.id)).toHaveLength(2);
    expect(plan.bindings.find(({ id }) => id === 'binding:database')?.implementation).toBe(database?.id);
    expect(plan.dependencies.find(({ slot, resolution }) => slot === 'database' && resolution === 'capability-reference')).toBeDefined();
  });

  it('keeps implementation identity independent of profile selection and input ordering', () => {
    const first = resolveApplicationImplementationPlan(input());
    const source = input();
    const second = resolveApplicationImplementationPlan(input({
      profile: { ...source.profile, id: 'renamed-production', digest: sha('q') },
      declarations: [...source.declarations].reverse(),
      bindings: [...source.bindings].reverse(),
    }));
    expect(second.implementations.map(({ id }) => id)).toEqual(first.implementations.map(({ id }) => id));
    expect(second.dependencies).toEqual(first.dependencies);
  });

  it('derives inline identity from its parent and slot without exposing it as a binding', () => {
    const source = input();
    const inlineScheduler = implementation('inline-scheduler', Scheduler, {
      identity: { kind: 'inline', parent: 'operator', slot: 'scheduler' },
    });
    const operator = implementation('operator', Operator, {
      dependencies: [
        { slot: 'database', requirement: Database, requiredGuarantees: ['ready'], operations: ['transaction.use'], input: { kind: 'implementation', declaration: 'database' }, visibility: 'private' },
        { slot: 'scheduler', requirement: Scheduler, requiredGuarantees: ['ready'], operations: ['schedule.configure'], input: { kind: 'implementation', declaration: 'inline-scheduler' }, visibility: 'private' },
      ],
    });
    const plan = resolveApplicationImplementationPlan(input({
      declarations: source.declarations.map((entry) => entry.key === 'operator' ? operator : entry).concat(inlineScheduler),
    }));
    const inline = plan.implementations.find(({ identity }) => identity.provider.export === 'inline-schedulerProvider');
    const parent = plan.implementations.find(({ identity }) => identity.provider.export === 'operatorProvider');
    expect(inline?.identity.parent).toEqual({ implementation: parent?.id, slot: 'scheduler' });
    expect(plan.bindings.some(({ implementation }) => implementation === inline?.id)).toBe(false);
  });

  it('serializes identical implementation topology deterministically', () => {
    const source = input();
    const first = resolveApplicationImplementationPlan(source);
    const second = resolveApplicationImplementationPlan({
      ...source,
      declarations: [...source.declarations].reverse(),
      bindings: [...source.bindings].reverse(),
    });
    expect(serializeApplicationImplementationPlan(second)).toBe(serializeApplicationImplementationPlan(first));
  });

  it('uses explicit logical identity to survive source movement without renaming physical resources', () => {
    const named = implementation('database', Database, { identity: { kind: 'named', name: 'control-database.v1' } });
    const moved = { ...named, provenance: sourceProvenance({ origin: 'authored', module: 'src/platform/database.ts', symbol: 'db' }) };
    const first = resolveApplicationImplementationPlan(input({ declarations: [named] , bindings: [
      { id: 'binding:database', capability: Database, implementation: 'database', provenance: named.provenance },
    ] }));
    const second = resolveApplicationImplementationPlan(input({ declarations: [moved], bindings: [
      { id: 'binding:database', capability: Database, implementation: 'database', provenance: moved.provenance },
    ] }));
    expect(second.implementations[0]?.id).toBe(first.implementations[0]?.id);
    expect(second.implementations[0]?.identity.explicitName).toBe('control-database.v1');
  });

  it('fails closed for unstable identity, collisions, missing references, incompatible slots, and cycles', () => {
    const unstable = implementation('dynamic', Database, {
      provenance: sourceProvenance({ origin: 'authored', generatedBy: 'dynamic-factory' }),
    });
    expect(() => resolveApplicationImplementationPlan(input({
      declarations: [unstable],
      bindings: [{ id: 'binding:unstable', capability: Database, implementation: 'dynamic', provenance: unstable.provenance }],
    }))).toThrow('requires module and declaration-symbol provenance');

    const first = implementation('first', Database, { identity: { kind: 'named', name: 'shared' } });
    const second = implementation('second', Database, {
      identity: { kind: 'named', name: 'shared' },
      provider: first.provider,
    });
    const collisionRoot = implementation('collision-root', Operator, {
      dependencies: [
        { slot: 'first', requirement: Database, requiredGuarantees: [], operations: [], input: { kind: 'implementation', declaration: 'first' }, visibility: 'private' },
        { slot: 'second', requirement: Database, requiredGuarantees: [], operations: [], input: { kind: 'implementation', declaration: 'second' }, visibility: 'private' },
      ],
    });
    expect(() => resolveApplicationImplementationPlan(input({
      declarations: [first, second, collisionRoot],
      bindings: [{ id: 'binding:root', capability: Operator, implementation: 'collision-root', provenance: collisionRoot.provenance }],
    }))).toThrow('claim');

    const missing = implementation('consumer', Operator, {
      dependencies: [{ slot: 'database', requirement: Database, requiredGuarantees: [], operations: [], input: { kind: 'implementation', declaration: 'missing' }, visibility: 'private' }],
    });
    expect(() => resolveApplicationImplementationPlan(input({
      declarations: [missing],
      bindings: [{ id: 'binding:consumer', capability: Operator, implementation: 'consumer', provenance: missing.provenance }],
    }))).toThrow('does not exist');

    const wrong = implementation('wrong', Scheduler);
    const incompatible = implementation('consumer', Operator, {
      dependencies: [{ slot: 'database', requirement: Database, requiredGuarantees: [], operations: [], input: { kind: 'implementation', declaration: 'wrong' }, visibility: 'private' }],
    });
    expect(() => resolveApplicationImplementationPlan(input({
      declarations: [wrong, incompatible],
      bindings: [{ id: 'binding:consumer', capability: Operator, implementation: 'consumer', provenance: incompatible.provenance }],
    }))).toThrow('not required TransactionalDatabase');

    const weakDatabase = implementation('weak-database', Database, { guarantees: ['ready'] });
    const demanding = implementation('demanding', Operator, {
      dependencies: [{
        slot: 'database',
        requirement: Database,
        requiredGuarantees: ['serializable-transactions'],
        operations: ['transaction.use'],
        input: { kind: 'implementation', declaration: 'weak-database' },
        visibility: 'private',
      }],
    });
    expect(() => resolveApplicationImplementationPlan(input({
      declarations: [weakDatabase, demanding],
      bindings: [{ id: 'binding:demanding', capability: Operator, implementation: 'demanding', provenance: demanding.provenance }],
    }))).toThrow('lacks required guarantees serializable-transactions');

    const wildcardAuthority = implementation('wildcard-authority', Operator, {
      dependencies: [{
        slot: 'database',
        requirement: Database,
        requiredGuarantees: [],
        operations: ['*'],
        input: { kind: 'implementation', declaration: 'weak-database' },
        visibility: 'private',
      }],
    });
    expect(() => resolveApplicationImplementationPlan(input({
      declarations: [weakDatabase, wildcardAuthority],
      bindings: [{ id: 'binding:wildcard', capability: Operator, implementation: 'wildcard-authority', provenance: wildcardAuthority.provenance }],
    }))).toThrow('without wildcards');

    const detachedInline = implementation('detached-inline', Scheduler, {
      identity: { kind: 'inline', parent: 'detached-parent', slot: 'scheduler' },
    });
    const detachedParent = implementation('detached-parent', Operator);
    expect(() => resolveApplicationImplementationPlan(input({
      declarations: [detachedParent, detachedInline],
      bindings: [{ id: 'binding:inline', capability: Scheduler, implementation: 'detached-inline', provenance: detachedInline.provenance }],
    }))).toThrow('must be consumed by parent');

    const left = implementation('left', Database, {
      dependencies: [{ slot: 'right', requirement: Scheduler, requiredGuarantees: [], operations: [], input: { kind: 'implementation', declaration: 'right' }, visibility: 'private' }],
    });
    const right = implementation('right', Scheduler, {
      dependencies: [{ slot: 'left', requirement: Database, requiredGuarantees: [], operations: [], input: { kind: 'implementation', declaration: 'left' }, visibility: 'private' }],
    });
    expect(() => resolveApplicationImplementationPlan(input({
      declarations: [left, right],
      bindings: [{ id: 'binding:left', capability: Database, implementation: 'left', provenance: left.provenance }],
    }))).toThrow('Provider dependency cycle');
  });
});
