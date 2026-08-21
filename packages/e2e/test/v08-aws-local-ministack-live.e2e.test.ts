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

const live = process.env.APPLIK8S_E2E_AWS_LOCAL === '1' ? describe : describe.skip;
const endpoint = process.env.APPLIK8S_AWS_LOCAL_ENDPOINT ?? 'http://127.0.0.1:4566';
const run = promisify(execFile);
const stateRoots: string[] = [];

afterAll(async () => {
  await Promise.all(stateRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

live('v0.8 pinned MiniStack AWS-local lifecycle', () => {
  test('applies the canonical AWS plan, exercises APIs, repairs drift, and deletes completely', async () => {
    const suffix = `${process.pid}-${Date.now().toString(36)}`.toLowerCase();
    const graph = awsLocalGraph(`v08-mini-${suffix}`);
    const plan = compileApplicationAwsDeploymentPlan({
      graph,
      target: 'aws-local',
      includeApplicationHosts: false,
      environment: 'live',
      region: 'us-east-1',
      accountId: '000000000000',
    });
    expect(plan.diagnostics).toEqual([]);
    const stateRoot = await mkdtemp(join(tmpdir(), 'applik8s-v08-ministack-'));
    stateRoots.push(stateRoot);
    const probePath = join(stateRoot, 'probe.txt');
    await writeFile(probePath, 'applik8s-v08\n');
    let activePlan = plan;
    let deployment = createApplicationAwsDeployment({ plan: activePlan, endpoint, stateRoot, dev: true });
    let attempted = false;
    try {
      expect((await deployment.plan()).changes.some(({ action }) => action === 'create')).toBe(true);
      attempted = true;
      const applied = await deployment.apply();
      expect(applied.aws.ready).toBe(true);
      expect(applied.aws.planDigest).toBe(plan.digest);

      const bucket = requiredResource(plan, 's3', 'bucket').physicalName;
      const queue = requiredResource(plan, 'sqs', 'queue').physicalName;
      const stream = requiredResource(plan, 'kinesis', 'stream').physicalName;
      await aws(['s3api', 'put-object', '--bucket', bucket, '--key', 'qualification/probe.txt', '--body', probePath]);
      expect(JSON.parse(await aws(['s3api', 'head-object', '--bucket', bucket, '--key', 'qualification/probe.txt']))).toMatchObject({ ContentLength: 13 });
      expect(JSON.stringify(JSON.parse(await aws(['s3api', 'get-bucket-encryption', '--bucket', bucket])))).toContain('AES256');
      const queueUrl = String(JSON.parse(await aws(['sqs', 'get-queue-url', '--queue-name', queue])).QueueUrl);
      await aws(['sqs', 'send-message', '--queue-url', queueUrl, '--message-body', 'applik8s-v08']);
      expect(JSON.parse(await aws(['sqs', 'receive-message', '--queue-url', queueUrl, '--wait-time-seconds', '1'])).Messages).toHaveLength(1);
      await aws(['kinesis', 'put-record', '--stream-name', stream, '--partition-key', 'qualification', '--data', 'YXBwbGlrOHMtdjA4']);
      expect(JSON.parse(await aws(['kinesis', 'describe-stream-summary', '--stream-name', stream])).StreamDescriptionSummary.StreamStatus).toBe('ACTIVE');

      expect((await deployment.plan()).changes.every(({ action }) => action === 'noop')).toBe(true);

      await aws(['sqs', 'set-queue-attributes', '--queue-url', queueUrl, '--attributes', JSON.stringify({ VisibilityTimeout: '41' })]);
      expect(JSON.parse(await aws(['sqs', 'get-queue-attributes', '--queue-url', queueUrl, '--attribute-names', 'VisibilityTimeout'])).Attributes.VisibilityTimeout).toBe('41');
      expect((await deployment.plan()).changes.some(({ action }) => action === 'update')).toBe(true);
      await deployment.apply();
      expect(JSON.parse(await aws(['sqs', 'get-queue-attributes', '--queue-url', queueUrl, '--attribute-names', 'VisibilityTimeout'])).Attributes.VisibilityTimeout).toBe('300');

      activePlan = normalizeApplicationAwsDeploymentPlan({
        ...plan,
        resources: plan.resources.map((resource) => resource.service === 'sqs' && resource.resourceType === 'queue'
          ? { ...resource, configuration: { ...resource.configuration, visibilityTimeoutSeconds: 180 } }
          : resource),
      });
      deployment = createApplicationAwsDeployment({ plan: activePlan, endpoint, stateRoot, dev: true });
      expect((await deployment.plan()).changes.some(({ action }) => action === 'update')).toBe(true);
      await deployment.apply();
      expect(JSON.parse(await aws(['sqs', 'get-queue-attributes', '--queue-url', queueUrl, '--attribute-names', 'VisibilityTimeout'])).Attributes.VisibilityTimeout).toBe('180');
      expect((await deployment.plan()).changes.every(({ action }) => action === 'noop')).toBe(true);

      await restartMiniStack();
      expect((await deployment.plan()).changes.some(({ action }) => action === 'update')).toBe(true);
      await deployment.apply();
      const recoveredQueueUrl = String(JSON.parse(await aws(['sqs', 'get-queue-url', '--queue-name', queue])).QueueUrl);
      expect(JSON.parse(await aws(['sqs', 'get-queue-attributes', '--queue-url', recoveredQueueUrl, '--attribute-names', 'VisibilityTimeout'])).Attributes.VisibilityTimeout).toBe('180');

      await aws(['s3api', 'delete-object', '--bucket', bucket, '--key', 'qualification/probe.txt']).catch(() => undefined);
      await deployment.destroy();
      attempted = false;
      expect(await deployment.status()).toBeUndefined();
    } finally {
      if (attempted) {
        const bucket = activePlan.resources.find(({ service, resourceType }) => service === 's3' && resourceType === 'bucket')?.physicalName;
        if (bucket) await aws(['s3', 'rm', `s3://${bucket}`, '--recursive']).catch(() => undefined);
        await deployment.destroy().catch(() => undefined);
      }
    }
  }, 300_000);
});

async function aws(args: readonly string[]): Promise<string> {
  const { stdout } = await run('aws', [
    ...args,
    '--region', 'us-east-1',
    '--endpoint-url', endpoint,
    '--output', 'json',
  ], {
    env: {
      ...process.env,
      AWS_ACCESS_KEY_ID: 'test',
      AWS_SECRET_ACCESS_KEY: 'test',
      AWS_DEFAULT_REGION: 'us-east-1',
    },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

async function restartMiniStack(): Promise<void> {
  const container = process.env.APPLIK8S_MINISTACK_CONTAINER ?? 'applik8s-v08-ministack-live';
  await run('docker', ['restart', container], { encoding: 'utf8' });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/_ministack/health`);
      const health: unknown = await response.json();
      const version = health && typeof health === 'object' ? Reflect.get(health, 'version') : undefined;
      if (response.ok && version === '1.4.20') return;
    } catch {
      // The loopback listener is intentionally absent while MiniStack restarts.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error('Pinned MiniStack did not become healthy within 60 seconds after restart.');
}

function requiredResource(
  plan: ReturnType<typeof compileApplicationAwsDeploymentPlan>,
  service: 's3' | 'sqs' | 'kinesis',
  resourceType: string,
) {
  const resource = plan.resources.find((candidate) => candidate.service === service && candidate.resourceType === resourceType);
  if (!resource) throw new Error(`Expected ${service}/${resourceType} in the AWS-local plan.`);
  return resource;
}

function awsLocalGraph(name: string): ApplicationGraph {
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
