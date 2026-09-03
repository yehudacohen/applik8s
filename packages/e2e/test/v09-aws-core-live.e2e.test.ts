// typecast-file-boundary: Real AWS CLI JSON is validated against exact
// account, resource, tag, and lifecycle assertions before becoming evidence.
import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { ApplicationGraph } from '@applik8s/core';
import { createApplicationAwsDeployment } from '@applik8s/deployment-alchemy';
import { compileApplicationAwsDeploymentPlan } from '@applik8s/deployment-compiler';
import {
  type ApplicationAwsDeploymentPlan,
  normalizeApplicationAwsDeploymentPlan,
} from '@applik8s/deployment-contract';
import { afterAll, describe, expect, test } from 'vitest';
import {
  collectV06GitIdentity,
  createV06AssertionEvidence,
  discardV06Evidence,
  writeV06EvidenceReceipt,
} from '../../../scripts/v06-evidence.js';

const live = process.env.APPLIK8S_E2E_AWS === '1' ? describe : describe.skip;
const runCommand = promisify(execFile);
const evidencePath = resolve('.applik8s-tmp/evidence/v0.9/aws-core-smoke.json');
const temporaryPaths: string[] = [];

afterAll(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

live('v0.9 real AWS bounded serverless lifecycle', () => {
  test('creates, uses, updates, repairs, and removes only its exact S3/SQS/Kinesis slice', async () => {
    await discardV06Evidence(evidencePath);
    const startedAt = new Date();
    const accountId = requiredEnvironment('APPLIK8S_E2E_AWS_ACCOUNT_ID');
    const expectedArn = requiredEnvironment('APPLIK8S_E2E_AWS_EXPECTED_ARN');
    const region = requiredEnvironment('APPLIK8S_E2E_AWS_REGION');
    const confirmation = requiredEnvironment('APPLIK8S_E2E_AWS_CONFIRM');
    const runId = requiredEnvironment('APPLIK8S_E2E_AWS_RUN_ID');
    const expiresAt = requiredEnvironment('APPLIK8S_E2E_AWS_EXPIRES_AT');
    if (confirmation !== `${accountId}/${region}`) {
      throw new Error(`Real AWS qualification requires APPLIK8S_E2E_AWS_CONFIRM=${accountId}/${region}.`);
    }
    const expiry = Date.parse(expiresAt);
    if (!Number.isFinite(expiry) || expiry <= startedAt.getTime() || expiry > startedAt.getTime() + 2 * 60 * 60 * 1_000) {
      throw new Error('APPLIK8S_E2E_AWS_EXPIRES_AT must be a future ISO timestamp no more than two hours after test start.');
    }
    if (!/^[a-z0-9][a-z0-9-]{2,40}$/u.test(runId)) {
      throw new Error('APPLIK8S_E2E_AWS_RUN_ID must be a bounded lowercase AWS-safe identifier.');
    }
    const caller = jsonObject(await aws(['sts', 'get-caller-identity'], region));
    expect(caller).toMatchObject({ Account: accountId, Arn: expectedArn });

    const graph = qualificationGraph(`applik8s-v09-${runId}`);
    const compiled = compileApplicationAwsDeploymentPlan({
      graph,
      target: 'aws',
      includeApplicationHosts: false,
      environment: 'qualification',
      region,
      accountId,
    });
    const repeated = compileApplicationAwsDeploymentPlan({
      graph,
      target: 'aws',
      includeApplicationHosts: false,
      environment: 'qualification',
      region,
      accountId,
    });
    expect(repeated).toEqual(compiled);
    expect(compiled.diagnostics).toEqual([]);
    expect(resourceKinds(compiled)).toEqual(['kinesis/stream', 's3/bucket', 'sqs/queue']);
    const initialPlan = normalizeApplicationAwsDeploymentPlan({
      ...compiled,
      resources: compiled.resources.map((resource) => resource.service === 's3'
        ? { ...resource, configuration: { ...resource.configuration, forceDestroy: true } }
        : resource),
    });
    const requiredTags = {
      Project: 'applik8s',
      Purpose: 'v0.9-live-test',
      ManagedBy: 'applik8s',
      RunId: runId,
      ExpiresAt: expiresAt,
    } as const;
    const stateRoot = resolve(`.applik8s-tmp/aws-qualification/${runId}`);
    await mkdir(stateRoot, { recursive: true });
    let activePlan = initialPlan;
    let deployment = createApplicationAwsDeployment({
      plan: activePlan,
      stateRoot,
      owner: `v0.9-aws-qualification/${runId}`,
      resourceTags: requiredTags,
    });
    let deploymentAttempted = false;
    const assertions: { assertion: string; test: string; observedAt?: string }[] = [
      { assertion: 'identity-verified', test: 'STS account and ARN matched the explicit qualification boundary' },
      { assertion: 'plan-bounded', test: 'deterministic plan contained only S3, SQS, and Kinesis' },
    ];
    let inventory: readonly Record<string, unknown>[] = [];
    try {
      const createPlan = await deployment.plan();
      expect(createPlan.changes.length).toBeGreaterThan(0);
      expect(createPlan.changes.every(({ action }) => action === 'create')).toBe(true);
      deploymentAttempted = true;
      const applied = await deployment.apply();
      expect(applied.aws).toMatchObject({ ready: true, planDigest: activePlan.digest, ownership: 'alchemy-native' });
      assertions.push({ assertion: 'apply-ready', test: 'public Alchemy deployment boundary reported the complete native graph ready' });

      const bucket = requiredResource(activePlan, 's3').physicalName;
      const queue = requiredResource(activePlan, 'sqs').physicalName;
      const stream = requiredResource(activePlan, 'kinesis').physicalName;
      const queueUrl = stringField(jsonObject(await aws(['sqs', 'get-queue-url', '--queue-name', queue], region)), 'QueueUrl');
      const probePath = join(stateRoot, 'probe.txt');
      await writeFile(probePath, 'applik8s-v09\n');
      await aws(['s3api', 'put-object', '--bucket', bucket, '--key', 'qualification/probe.txt', '--body', probePath], region);
      expect(jsonObject(await aws(['s3api', 'head-object', '--bucket', bucket, '--key', 'qualification/probe.txt'], region))).toMatchObject({ ContentLength: 13 });
      expect(await resourceTags('s3', bucket, region)).toMatchObject(requiredTags);
      await aws(['sqs', 'send-message', '--queue-url', queueUrl, '--message-body', 'applik8s-v09'], region);
      expect(await receiveQueueMessage(queueUrl, region)).toBe(true);
      expect(await resourceTags('sqs', queueUrl, region)).toMatchObject(requiredTags);
      await aws(['kinesis', 'put-record', '--stream-name', stream, '--partition-key', 'qualification', '--data', 'YXBwbGlrOHMtdjA5'], region);
      const streamSummary = objectField(jsonObject(await aws(['kinesis', 'describe-stream-summary', '--stream-name', stream], region)), 'StreamDescriptionSummary');
      expect(streamSummary.StreamStatus).toBe('ACTIVE');
      expect(await resourceTags('kinesis', stream, region)).toMatchObject(requiredTags);
      assertions.push({ assertion: 'functional-data-plane', test: 'S3 put/head, SQS send/receive, and Kinesis put/describe succeeded' });
      assertions.push({ assertion: 'required-tags', test: 'all three AWS resources exposed the complete bounded ownership tag set' });

      expect((await deployment.plan()).changes.every(({ action }) => action === 'noop')).toBe(true);
      assertions.push({ assertion: 'noop-redeploy', test: 'second public deployment plan contained only no-op changes' });

      activePlan = normalizeApplicationAwsDeploymentPlan({
        ...initialPlan,
        resources: initialPlan.resources.map((resource) => resource.service === 'sqs'
          ? { ...resource, configuration: { ...resource.configuration, visibilityTimeoutSeconds: 180 } }
          : resource),
      });
      deployment = createApplicationAwsDeployment({
        plan: activePlan,
        stateRoot,
        owner: `v0.9-aws-qualification/${runId}`,
        resourceTags: requiredTags,
      });
      expect((await deployment.plan()).changes.some(({ action }) => action === 'update')).toBe(true);
      await deployment.apply();
      expect(await queueVisibility(queueUrl, region)).toBe('180');
      assertions.push({ assertion: 'desired-update', test: 'public deployment updated the exact queue visibility contract' });

      // Exercise a provider-supported, narrowly scoped drift class without
      // inventing a second lifecycle implementation in Applik8s. The native
      // S3 provider owns the full tag set and rewrites it during forced apply.
      const driftedBucketTags = await resourceTags('s3', bucket, region);
      delete driftedBucketTags.Purpose;
      await aws([
        's3api', 'put-bucket-tagging', '--bucket', bucket, '--tagging',
        JSON.stringify({ TagSet: Object.entries(driftedBucketTags).map(([Key, Value]) => ({ Key, Value })) }),
      ], region);
      expect((await resourceTags('s3', bucket, region)).Purpose).toBeUndefined();
      await deployment.apply();
      expect(await resourceTags('s3', bucket, region)).toMatchObject(requiredTags);
      expect((await deployment.plan()).changes.every(({ action }) => action === 'noop')).toBe(true);
      assertions.push({ assertion: 'drift-repair', test: 'public deployment repaired an externally removed ownership tag on the exact run-owned bucket' });

      inventory = [
        { type: 'AWS.S3.Bucket', name: bucket, arn: `arn:aws:s3:::${bucket}` },
        { type: 'AWS.SQS.Queue', name: queue, arn: `arn:aws:sqs:${region}:${accountId}:${queue}` },
        { type: 'AWS.Kinesis.Stream', name: stream, arn: stringField(streamSummary, 'StreamARN') },
      ];
      await deployment.destroy();
      deploymentAttempted = false;
      expect(await deployment.status()).toBeUndefined();
      assertions.push({ assertion: 'owner-destroy', test: 'public Alchemy owner destroyed its complete deployment graph' });

      await expectAbsent(['s3api', 'head-bucket', '--bucket', bucket], region);
      await expectAbsent(['sqs', 'get-queue-url', '--queue-name', queue], region);
      await expectAbsent(['kinesis', 'describe-stream-summary', '--stream-name', stream], region);
      assertions.push({ assertion: 'exact-absence', test: 'all three run-scoped physical identities were absent after owner teardown' });

      const completedAt = new Date().toISOString();
      await writeV06EvidenceReceipt(evidencePath, {
        suite: 'aws-core-smoke',
        run: { id: runId, startedAt: startedAt.toISOString(), completedAt },
        candidate: { git: await collectV06GitIdentity(process.cwd(), { exclude: ['.applik8s-tmp/'] }) },
        environment: {
          kind: 'aws',
          accountId,
          callerArn: expectedArn,
          region,
          deploymentStack: deployment.stack.key,
          stateRoot,
          planDigest: activePlan.digest,
          expiresAt,
          maxEstimatedCostUsd: 1,
        },
        assertionEvidence: createV06AssertionEvidence(
          assertions.map(assertion => ({ ...assertion, observedAt: completedAt })),
          runId,
        ),
        inventory,
        teardown: { authority: 'createApplicationAwsDeployment.destroy', complete: true },
        scope: {
          implemented: ['ObjectStorage/S3', 'Queue/SQS', 'EventLog/Kinesis'],
          notTested: ['full Chirp AWS production topology', 'recovery after out-of-band deletion of a persisted AWS resource'],
        },
      });
      // Remove local state only after owner teardown, exact cloud absence, and
      // durable evidence have all succeeded. A failed teardown deliberately
      // leaves its state available for an exact-owner retry.
      temporaryPaths.push(stateRoot);
    } finally {
      if (deploymentAttempted) {
        await deployment.destroy();
      }
    }
  }, 900_000);
});

async function queueVisibility(queueUrl: string, region: string): Promise<string> {
  const response = jsonObject(await aws(['sqs', 'get-queue-attributes', '--queue-url', queueUrl, '--attribute-names', 'VisibilityTimeout'], region));
  return stringField(objectField(response, 'Attributes'), 'VisibilityTimeout');
}

async function receiveQueueMessage(queueUrl: string, region: string): Promise<boolean> {
  const deadline = Date.now() + 30_000;
  do {
    const response = jsonObject(await aws(['sqs', 'receive-message', '--queue-url', queueUrl, '--wait-time-seconds', '2'], region));
    if (Array.isArray(response.Messages) && response.Messages.length > 0) return true;
  } while (Date.now() < deadline);
  return false;
}

async function resourceTags(service: 's3' | 'sqs' | 'kinesis', identity: string, region: string): Promise<Record<string, string>> {
  if (service === 's3') {
    const response = jsonObject(await aws(['s3api', 'get-bucket-tagging', '--bucket', identity], region));
    const entries = Array.isArray(response.TagSet) ? response.TagSet : [];
    return Object.fromEntries(entries.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
      const key = Reflect.get(entry, 'Key');
      const value = Reflect.get(entry, 'Value');
      return typeof key === 'string' && typeof value === 'string' ? [[key, value]] : [];
    }));
  }
  if (service === 'sqs') {
    return stringRecord(objectField(jsonObject(await aws(['sqs', 'list-queue-tags', '--queue-url', identity], region)), 'Tags'));
  }
  const response = jsonObject(await aws(['kinesis', 'list-tags-for-stream', '--stream-name', identity], region));
  const entries = Array.isArray(response.Tags) ? response.Tags : [];
  return Object.fromEntries(entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const key = Reflect.get(entry, 'Key');
    const value = Reflect.get(entry, 'Value');
    return typeof key === 'string' && typeof value === 'string' ? [[key, value]] : [];
  }));
}

async function expectAbsent(args: readonly string[], region: string): Promise<void> {
  const result = await awsResult(args, region);
  if (result.exitCode === 0) throw new Error(`Expected run-scoped AWS resource from ${args[0]} ${args[1]} to be absent.`);
  if (!/not found|non-?existent|does not exist|404|ResourceNotFoundException|NoSuchBucket/iu.test(result.stderr)) {
    throw new Error(`Could not prove AWS resource absence after ${args[0]} ${args[1]}: ${result.stderr.trim() || `exit ${result.exitCode}`}`);
  }
}

async function aws(args: readonly string[], region: string): Promise<string> {
  const result = await awsResult(args, region);
  if (result.exitCode !== 0) {
    throw new Error(`AWS CLI command ${args[0]} ${args[1]} failed: ${result.stderr.trim() || `exit ${result.exitCode}`}`);
  }
  return result.stdout;
}

async function awsResult(args: readonly string[], region: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await runCommand('aws', [...args, '--region', region, '--output', 'json'], {
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (cause) {
    if (!cause || typeof cause !== 'object') throw cause;
    return {
      stdout: typeof Reflect.get(cause, 'stdout') === 'string' ? String(Reflect.get(cause, 'stdout')) : '',
      stderr: typeof Reflect.get(cause, 'stderr') === 'string' ? String(Reflect.get(cause, 'stderr')) : '',
      exitCode: typeof Reflect.get(cause, 'code') === 'number' ? Number(Reflect.get(cause, 'code')) : 1,
    };
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for real AWS qualification.`);
  return value;
}

function requiredResource(plan: ApplicationAwsDeploymentPlan, service: 's3' | 'sqs' | 'kinesis') {
  const resource = plan.resources.find((candidate) => candidate.service === service);
  if (!resource) throw new Error(`Expected exactly one ${service} resource in the bounded AWS plan.`);
  return resource;
}

function resourceKinds(plan: ApplicationAwsDeploymentPlan): readonly string[] {
  return plan.resources.map(({ service, resourceType }) => `${service}/${resourceType}`).sort();
}

function qualificationGraph(name: string): ApplicationGraph {
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

function jsonObject(raw: string): Record<string, unknown> {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an AWS JSON object.');
  return value as Record<string, unknown>;
}

function objectField(value: Record<string, unknown>, name: string): Record<string, unknown> {
  const nested = value[name];
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) throw new Error(`Expected AWS object field ${name}.`);
  return nested as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, name: string): string {
  const nested = value[name];
  if (typeof nested !== 'string' || nested.length === 0) throw new Error(`Expected AWS string field ${name}.`);
  return nested;
}

function stringRecord(value: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (typeof nested !== 'string') throw new Error(`Expected AWS string map value for ${key}.`);
    result[key] = nested;
  }
  return result;
}
