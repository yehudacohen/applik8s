import type { ApplicationGraph } from '@applik8s/core';
import { describe, expect, it } from 'vitest';

import { applicationAuthorityDatabaseConnection } from '../src/application-operator-authority-command.js';

describe('application operator authority database discovery', () => {
  it('selects one fully resolved application-authority database connection', () => {
    expect(applicationAuthorityDatabaseConnection(graph([
      model('documents', connection()),
      model('memberships', connection()),
    ]))).toEqual({
      clusterName: 'application-db',
      database: 'application',
      secretKey: 'uri',
      secretName: 'application-db-app',
      secretNamespace: 'application-system',
    });
  });

  it('fails closed when application-authority models resolve to different databases', () => {
    expect(applicationAuthorityDatabaseConnection(graph([
      model('documents', connection()),
      model('memberships', connection({ database: 'other' })),
    ]))).toBeUndefined();
  });

  it('fails closed when a required connection field remains unresolved', () => {
    expect(applicationAuthorityDatabaseConnection(graph([
      model('documents', connection({
        secretName: '${schema.spec.providers.database.secretName}',
      })),
    ]))).toBeUndefined();
  });
});

function connection(
  overrides: Readonly<Record<string, string>> = {},
): Readonly<Record<string, unknown>> {
  return {
    name: 'application',
    tableName: 'documents',
    provider: 'postgres',
    authorityName: 'application',
    database: 'application',
    clusterName: 'application-db',
    secretName: 'application-db-app',
    secretKey: 'uri',
    secretNamespace: 'application-system',
    connectionEnvName: 'APPLICATION_DATABASE_URL',
    constraints: [],
    indexes: [],
    retention: { kind: 'retain' },
    ...overrides,
  };
}

function model(id: string, runtime: Readonly<Record<string, unknown>>): unknown {
  return {
    id: `model.${id}`,
    kind: 'model',
    name: id,
    stability: 'stable',
    runtime,
  };
}

function graph(nodes: readonly unknown[]): ApplicationGraph {
  // typecast: fixture assembles partial nodes; the CLI validates each selected model shape.
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1',
    kind: 'ApplicationGraph',
    metadata: { name: 'application' },
    nodes,
    edges: [],
    providerRequirements: [],
    providerBindings: [],
    compatibility: {
      stablePublicApis: [],
      documentedInternalContracts: [],
      experimentalSurfaces: [],
      postV3Surfaces: [],
      labels: [],
    },
  } as ApplicationGraph;
}
