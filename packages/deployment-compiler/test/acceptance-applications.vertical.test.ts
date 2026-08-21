// typecast-file-boundary: Parameterized acceptance fixtures retain literal application identities and installation profile discriminants.
import { resolve } from 'node:path';
import { discoverApplicationGraph } from '@applik8s/compiler';
import type { ApplicationGraph } from '@applik8s/core';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileApplicationAwsDeploymentPlan,
  compileLocalSupervisorPlan,
} from '../src/index.js';

describe.each([
  ['GuestBook', 'examples/guestbook-start/src/application.ts'],
  ['Chirp', 'examples/chirp-start/src/application.ts'],
] as const)('v0.8 %s target compatibility', (_name, entrypoint) => {
  let graph: ApplicationGraph;
  const installationSpec = { name: 'starter', profile: 'starter' } as const;

  beforeAll(async () => {
    const result = await discoverApplicationGraph(resolve(entrypoint), 'app');
    if (!result.ok) throw result.error;
    graph = result.value;
  }, 120_000);

  it('lowers the same graph to a local supervisor without target branches', () => {
    const plan = compileLocalSupervisorPlan({
      graph,
      target: 'local',
      profile: 'starter',
      projectDigest: `sha256:${'1'.repeat(64)}`,
      projectDirectory: process.cwd(),
      installationSpec,
    });
    expect(plan.diagnostics.filter(({ severity }) => severity === 'error')).toEqual([]);
    expect(plan.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'process' }),
    ]));
  });

  it('lowers the same graph to AWS with one Alchemy lifecycle authority', () => {
    const plan = compileApplicationAwsDeploymentPlan({
      graph,
      target: 'aws',
      environment: 'starter',
      profile: 'starter',
      region: 'us-east-1',
      accountId: '123456789012',
      installationSpec,
      workspaceRoot: process.cwd(),
    });
    expect(plan.lifecycleAuthority).toBe('alchemy');
    expect(plan.diagnostics.filter(({ severity }) => severity === 'error')).toEqual([]);
    expect(plan.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceType: 'fargate-service' }),
    ]));
  });
});
