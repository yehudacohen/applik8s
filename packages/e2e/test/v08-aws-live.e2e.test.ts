// typecast-file-boundary: Real AWS CLI JSON is checked against exact account,
// resource, and lifecycle assertions before it becomes release evidence.
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ApplicationGraph } from '@applik8s/core';
import { createApplicationAwsDeployment } from '@applik8s/deployment-alchemy';
import { compileApplicationAwsDeploymentPlan } from '@applik8s/deployment-compiler';
import { normalizeApplicationAwsDeploymentPlan } from '@applik8s/deployment-contract';
import { afterAll, describe, expect, test } from 'vitest';

const live = process.env.APPLIK8S_E2E_AWS === '1' ? describe : describe.skip;
const run = promisify(execFile);
const stateRoots: string[] = [];

afterAll(async () => {
  await Promise.all(stateRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

live('v0.8 real AWS core lifecycle', () => {
  test('creates, uses, updates, repairs drift, and deletes the exact confirmed account/region slice', async () => {
    const accountId = requiredEnvironment('APPLIK8S_E2E_AWS_ACCOUNT_ID');
    const region = requiredEnvironment('APPLIK8S_E2E_AWS_REGION');
    const confirmation = requiredEnvironment('APPLIK8S_E2E_AWS_CONFIRM');
    if (confirmation !== `${accountId}/${region}`) {
      throw new Error(`Real AWS qualification requires APPLIK8S_E2E_AWS_CONFIRM=${accountId}/${region}.`);
    }
    const caller = JSON.parse(await aws(['sts', 'get-caller-identity'], region)) as { readonly Account?: string };
    if (caller.Account !== accountId) {
      throw new Error(`AWS caller account ${caller.Account ?? '<missing>'} does not match explicitly confirmed account ${accountId}.`);
    }

    const suffix = `${process.pid}-${Date.now().toString(36)}`.toLowerCase();
    const graph = apiQualificationGraph(`v08-aws-${suffix}`);
    const plan = compileApplicationAwsDeploymentPlan({
      graph,
      target: 'aws',
      includeApplicationHosts: false,
      environment: 'qualification',
      region,
      accountId,
    });
    expect(plan.diagnostics).toEqual([]);
    const stateRoot = await mkdtemp(join(tmpdir(), 'applik8s-v08-aws-'));
    stateRoots.push(stateRoot);
    const probePath = join(stateRoot, 'probe.txt');
    await writeFile(probePath, 'applik8s-v08\n');
    let activePlan = plan;
    let deployment = createApplicationAwsDeployment({ plan: activePlan, stateRoot });
    let attempted = false;
    try {
      expect((await deployment.plan()).changes.some(({ action }) => action === 'create')).toBe(true);
      attempted = true;
      const applied = await deployment.apply();
      expect(applied.aws).toMatchObject({ ready: true, planDigest: plan.digest, ownership: 'managed' });

      const bucket = requiredResource(plan, 's3', 'bucket').physicalName;
      const queue = requiredResource(plan, 'sqs', 'queue').physicalName;
      const stream = requiredResource(plan, 'kinesis', 'stream').physicalName;
      await aws(['s3api', 'put-object', '--bucket', bucket, '--key', 'qualification/probe.txt', '--body', probePath], region);
      expect(JSON.parse(await aws(['s3api', 'head-object', '--bucket', bucket, '--key', 'qualification/probe.txt'], region))).toMatchObject({ ContentLength: 13 });
      expect(JSON.stringify(JSON.parse(await aws(['s3api', 'get-bucket-encryption', '--bucket', bucket], region)))).toContain('AES256');
      const queueUrl = String(JSON.parse(await aws(['sqs', 'get-queue-url', '--queue-name', queue], region)).QueueUrl);
      await aws(['sqs', 'send-message', '--queue-url', queueUrl, '--message-body', 'applik8s-v08'], region);
      expect(JSON.parse(await aws(['sqs', 'receive-message', '--queue-url', queueUrl, '--wait-time-seconds', '1'], region)).Messages).toHaveLength(1);
      await aws(['kinesis', 'put-record', '--stream-name', stream, '--partition-key', 'qualification', '--data', 'YXBwbGlrOHMtdjA4'], region);
      expect(JSON.parse(await aws(['kinesis', 'describe-stream-summary', '--stream-name', stream], region)).StreamDescriptionSummary.StreamStatus).toBe('ACTIVE');
      expect((await deployment.plan()).changes.every(({ action }) => action === 'noop')).toBe(true);

      await aws(['sqs', 'set-queue-attributes', '--queue-url', queueUrl, '--attributes', JSON.stringify({ VisibilityTimeout: '41' })], region);
      expect((await deployment.plan()).changes.some(({ action }) => action === 'update')).toBe(true);
      await deployment.apply();
      expect(JSON.parse(await aws(['sqs', 'get-queue-attributes', '--queue-url', queueUrl, '--attribute-names', 'VisibilityTimeout'], region)).Attributes.VisibilityTimeout).toBe('300');

      activePlan = normalizeApplicationAwsDeploymentPlan({
        ...plan,
        resources: plan.resources.map((resource) => resource.service === 'sqs' && resource.resourceType === 'queue'
          ? { ...resource, configuration: { ...resource.configuration, visibilityTimeoutSeconds: 180 } }
          : resource),
      });
      deployment = createApplicationAwsDeployment({ plan: activePlan, stateRoot });
      expect((await deployment.plan()).changes.some(({ action }) => action === 'update')).toBe(true);
      await deployment.apply();
      expect(JSON.parse(await aws(['sqs', 'get-queue-attributes', '--queue-url', queueUrl, '--attribute-names', 'VisibilityTimeout'], region)).Attributes.VisibilityTimeout).toBe('180');
      expect((await deployment.plan()).changes.every(({ action }) => action === 'noop')).toBe(true);

      await aws(['s3api', 'delete-object', '--bucket', bucket, '--key', 'qualification/probe.txt'], region);
      await deployment.destroy();
      attempted = false;
      expect(await deployment.status()).toBeUndefined();
    } finally {
      if (attempted) {
        const bucket = activePlan.resources.find(({ service, resourceType }) => service === 's3' && resourceType === 'bucket')?.physicalName;
        if (bucket) await aws(['s3', 'rm', `s3://${bucket}`, '--recursive'], region).catch(() => undefined);
        await deployment.destroy().catch(() => undefined);
      }
    }
  }, 900_000);
});

async function aws(args: readonly string[], region: string): Promise<string> {
  const { stdout } = await run('aws', [...args, '--region', region, '--output', 'json'], {
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for real AWS qualification.`);
  return value;
}

function requiredResource(
  plan: ReturnType<typeof compileApplicationAwsDeploymentPlan>,
  service: 's3' | 'sqs' | 'kinesis',
  resourceType: string,
) {
  const resource = plan.resources.find((candidate) => candidate.service === service && candidate.resourceType === resourceType);
  if (!resource) throw new Error(`Expected ${service}/${resourceType} in the real AWS plan.`);
  return resource;
}

function apiQualificationGraph(name: string): ApplicationGraph {
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1',
    kind: 'ApplicationGraph',
    metadata: { name },
    nodes: [
      { id: 'provider.ObjectStorage', kind: 'provider', name: 'ObjectStorage', stability: 'stable', interface: 'ObjectStorage', implementation: 's3', config: { objectStorage: { kind: 's3', prefix: 'qualification' } } },
      { id: 'provider.Queue', kind: 'provider', name: 'Queue', stability: 'stable', interface: 'Queue', implementation: 'sqs' },
      { id: 'provider.EventLog', kind: 'provider', name: 'EventLog', stability: 'stable', interface: 'EventLog', implementation: 'kinesis' },
    ],
    edges: [],
    providerRequirements: [],
    providerBindings: [],
    compatibility: { stablePublicApis: [], documentedInternalContracts: [], experimentalSurfaces: [], postV3Surfaces: [], labels: [] },
  };
}
