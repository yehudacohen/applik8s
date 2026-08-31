// typecast-file-boundary: Parameterized acceptance fixtures retain literal application identities and installation profile discriminants.
import { resolve } from 'node:path';
import { discoverApplicationGraph } from '@applik8s/compiler';
import { type ApplicationGraph, serializeApplicationPlanContent, validateApplicationPlan } from '@applik8s/core';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileApplicationAwsApplicationPlan,
  compileApplicationAwsDeploymentPlan,
  compileLocalApplicationPlan,
  compileLocalSupervisorPlan,
} from '../src/index.js';

type AwsDisposition = 'compatible' | 'diagnostic' | 'throw';

describe.each([
  ['GuestBook', 'examples/guestbook-start/src/application.ts', 'app', 'diagnostic' as AwsDisposition],
  ['Chirp', 'examples/chirp-start/src/application.ts', 'app', 'throw' as AwsDisposition],
  ['Agentic Start', 'examples/identity-start/src/application.ts', 'application', 'throw' as AwsDisposition],
] as const)('v0.8 %s target compatibility', (_name, entrypoint, compositionExport, awsDisposition) => {
  let graph: ApplicationGraph;
  const installationSpec = { name: 'starter', profile: 'starter' } as const;

  beforeAll(async () => {
    const result = await discoverApplicationGraph(resolve(entrypoint), compositionExport);
    if (!result.ok) throw result.error;
    graph = result.value;
  }, 120_000);

  it('lowers the same graph to a local supervisor without target branches', () => {
    const plan = compileLocalSupervisorPlan({
      graph,
      target: 'local',
      profile: 'starter',
      projectDigest: `sha256:${'1'.repeat(64)}`,
      applicationHostFrameworkCredentials: [],
      projectDirectory: process.cwd(),
      installationSpec,
    });
    expect(plan.diagnostics.filter(({ severity }) => severity === 'error')).toEqual([]);
    expect(plan.resources.length).toBeGreaterThan(0);
    expect(plan.resources.every(({ kind }) => ['container', 'external', 'process'].includes(kind))).toBe(true);
  });

  it('either lowers to AWS with one lifecycle authority or rejects a known semantic incompatibility', () => {
    const compile = () => compileApplicationAwsDeploymentPlan({
      graph,
      target: 'aws',
      environment: 'starter',
      profile: 'starter',
      region: 'us-east-1',
      accountId: '123456789012',
      installationSpec,
      workspaceRoot: process.cwd(),
    });
    if (awsDisposition === 'throw') {
      expect(compile).toThrow(/SCHEDULE_PRECISION_UNSUPPORTED/u);
      return;
    }
    if (awsDisposition === 'diagnostic') {
      expect(compile().diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'AWS_PROVIDER_INCOMPATIBLE', severity: 'error' }),
      ]));
      return;
    }
    const plan = compile();
    expect(plan.lifecycleAuthority).toBe('alchemy');
    expect(plan.diagnostics.filter(({ severity }) => severity === 'error')).toEqual([]);
    expect(plan.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceType: 'fargate-service' }),
    ]));
  });

  it('keeps canonical plan content repeatable and portable semantic identities aligned where compatible', () => {
    const local = compileLocalSupervisorPlan({
      graph,
      target: 'local',
      profile: 'starter',
      projectDigest: `sha256:${'1'.repeat(64)}`,
      applicationHostFrameworkCredentials: [],
      projectDirectory: process.cwd(),
      installationSpec,
    });
    const localApplication = compileLocalApplicationPlan({ graph, supervisor: local, workspaceRoot: process.cwd() });
    const localAgain = compileLocalApplicationPlan({ graph, supervisor: local, workspaceRoot: process.cwd() });

    expect(serializeApplicationPlanContent(localApplication)).toBe(
      serializeApplicationPlanContent(localAgain),
    );
    expect(localApplication.physical.nativePlans.map(({ authority }) => authority)).toEqual(['local-supervisor']);
    if (awsDisposition !== 'compatible') return;
    expect(validateApplicationPlan(localApplication).diagnostics).toEqual([]);
    const aws = compileApplicationAwsDeploymentPlan({
      graph,
      target: 'aws',
      environment: 'starter',
      profile: 'starter',
      region: 'us-east-1',
      accountId: '123456789012',
      installationSpec,
      workspaceRoot: process.cwd(),
    });
    const awsApplication = compileApplicationAwsApplicationPlan({ graph, aws, workspaceRoot: process.cwd() });
    expect(validateApplicationPlan(awsApplication).diagnostics).toEqual([]);
    expect(localApplication.semantic.nodes.map(({ id }) => id)).toEqual(
      awsApplication.semantic.nodes.map(({ id }) => id),
    );
    expect(awsApplication.physical.nativePlans.map(({ authority }) => authority)).toEqual(['alchemy']);
  });
});
