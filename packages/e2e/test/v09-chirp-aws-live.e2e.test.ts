// typecast-file-boundary: AWS emulator responses and checked-in compiler artifacts are validated at this live acceptance boundary.
import {
  type BucketLocationConstraint,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  CreateDatabaseCommand,
  CreateTableCommand,
  DeleteDatabaseCommand,
  DeleteTableCommand,
  GetTablesCommand,
  GlueClient,
} from '@aws-sdk/client-glue';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { type } from '@applik8s/applik8s';
import type { ApplicationGraph, ApplicationImplementationPlanSet } from '@applik8s/core';
import {
  applicationImplementationConfigurationValues,
  compileApplicationAwsDeploymentPlan,
} from '@applik8s/deployment-compiler';
import type { DeploymentJsonObject } from '@applik8s/deployment-contract';
import { createAwsApplicationLakehouseDatasetRuntime } from '@applik8s/runtime-aws/lakehouse';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { resolveApplicationInstallationValues } from '../../cli/src/application-installation-values.js';

const realAws = process.env.APPLIK8S_E2E_AWS === '1';
const localAws = process.env.APPLIK8S_E2E_AWS_LOCAL === '1';
const live = realAws || localAws ? describe : describe.skip;
const endpoint = localAws
  ? process.env.APPLIK8S_AWS_LOCAL_ENDPOINT ?? 'http://127.0.0.1:4566'
  : undefined;
const credentials = localAws ? { accessKeyId: 'test', secretAccessKey: 'test' } : undefined;
const region = realAws ? requiredEnvironment('APPLIK8S_E2E_AWS_REGION') : 'us-east-1';
const accountId = realAws ? requiredEnvironment('APPLIK8S_E2E_AWS_ACCOUNT_ID') : '123456789012';
const suffix = `${process.pid}-${Date.now().toString(36)}`.toLowerCase();
const bucket = `applik8s-v09-chirp-${suffix}`;
const database = `applik8s_v09_chirp_${suffix.replaceAll('-', '_')}`;
const prefix = `qualification/${suffix}`;
const s3 = new S3Client({
  region,
  forcePathStyle: localAws,
  ...(endpoint ? { endpoint } : {}),
  ...(credentials ? { credentials } : {}),
});
const glue = new GlueClient({
  region,
  ...(endpoint ? { endpoint } : {}),
  ...(credentials ? { credentials } : {}),
});
const run = promisify(execFile);
let bucketCreated = false;
let databaseCreated = false;

live('v0.9 Chirp production AWS profile', () => {
  beforeAll(async () => {
    if (realAws) {
      const confirmation = requiredEnvironment('APPLIK8S_E2E_AWS_CONFIRM');
      if (confirmation !== `${accountId}/${region}`) {
        throw new Error(`Real AWS qualification requires APPLIK8S_E2E_AWS_CONFIRM=${accountId}/${region}.`);
      }
      const caller = JSON.parse(await aws(['sts', 'get-caller-identity'])) as { readonly Account?: string };
      if (caller.Account !== accountId) {
        throw new Error(`AWS caller account ${caller.Account ?? '<missing>'} does not match explicitly confirmed account ${accountId}.`);
      }
    }
    await s3.send(new CreateBucketCommand({
      Bucket: bucket,
      ...(realAws && region !== 'us-east-1'
        ? { CreateBucketConfiguration: { LocationConstraint: region as BucketLocationConstraint } }
        : {}),
    }));
    bucketCreated = true;
    await glue.send(new CreateDatabaseCommand({ DatabaseInput: { Name: database } }));
    databaseCreated = true;
  }, 60_000);

  afterAll(async () => {
    const cleanupErrors: unknown[] = [];
    try {
      if (databaseCreated) {
        for (const tableName of await allTableNames()) {
          await glue.send(new DeleteTableCommand({ DatabaseName: database, Name: tableName }));
        }
        await glue.send(new DeleteDatabaseCommand({ Name: database }));
        databaseCreated = false;
      }
    } catch (cause) {
      cleanupErrors.push(cause);
    }
    try {
      if (bucketCreated) {
        const objects = (await allKeys()).map((Key) => ({ Key }));
        for (let index = 0; index < objects.length; index += 1_000) {
          await s3.send(new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: objects.slice(index, index + 1_000), Quiet: true },
          }));
        }
        await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
        bucketCreated = false;
      }
    } catch (cause) {
      cleanupErrors.push(cause);
    } finally {
      s3.destroy();
      glue.destroy();
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, `Failed to remove the exact v0.9 AWS qualification resources ${bucket} and ${database}.`);
    }
  }, 120_000);

  it('lowers Chirp’s unchanged semantic graph through the complete production AWS implementation profile', async () => {
    const root = process.cwd();
    const graphArtifact = JSON.parse(await readFile(resolve(root, 'dist/examples/chirp/typekro/application-graph.json'), 'utf8')) as ApplicationGraph;
    const planSet = JSON.parse(await readFile(resolve(root, 'dist/examples/chirp/typekro/application-implementation-plans.json'), 'utf8')) as ApplicationImplementationPlanSet;
    const profile = planSet.plans.find((candidate) => candidate.profile.id === 'production-aws');
    if (!profile) throw new Error('Chirp compiler output is missing production-aws.');
    const installationDocument = parse(await readFile(resolve(root, 'examples/chirp-start/kubernetes/chirp.dedicated.example.yaml'), 'utf8')) as {
      readonly spec: DeploymentJsonObject;
    };
    const graph = resolveApplicationInstallationValues(graphArtifact, installationDocument.spec, {
      preserveUnknownReferences: true,
    });
    const configurationValues: Readonly<Record<string, string>> = {
      AWS_ACCOUNT_ID: accountId,
      AWS_REGION: region,
      APPLICATION_DOMAIN: 'chirp.example.com',
      ROUTE53_ZONE: 'example.com',
      CHIRP_MEDIA_BUCKET: 'chirp-production-media-example',
      STRUCTURED_GENERATION_ENDPOINT: 'https://generation.example.com/v1',
      STRUCTURED_GENERATION_PROFILE: 'chirp-safe-v1',
    };
    const configuration = applicationImplementationConfigurationValues(
      profile,
      (reference) => configurationValues[reference],
    );
    const plan = compileApplicationAwsDeploymentPlan({
      graph,
      implementationPlan: profile,
      configuration,
      target: 'aws',
      profile: 'production-aws',
      environment: 'qualification',
      region,
      accountId,
      installationSpec: installationDocument.spec,
      workspaceRoot: root,
      hostedZones: { 'example.com': 'Z123QUALIFICATION' },
    });

    expect(plan.diagnostics).toEqual([]);
    expect(plan.lifecycleAuthority).toBe('alchemy');
    expect(plan.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ service: 'rds', resourceType: 'aurora-postgresql-cluster' }),
      expect.objectContaining({ service: 'ecs', resourceType: 'fargate-service' }),
      expect.objectContaining({ service: 'kinesis', resourceType: 'stream' }),
      expect.objectContaining({ service: 's3', resourceType: 'lakehouse-dataset', configuration: expect.objectContaining({ forceDeleteUnretainedData: true }) }),
      expect.objectContaining({ service: 'glue', resourceType: 'catalog-database' }),
      expect.objectContaining({ service: 'athena', resourceType: 'workgroup' }),
      expect.objectContaining({ service: 'acm', resourceType: 'certificate' }),
      expect.objectContaining({ service: 'route53', resourceType: 'record-publication' }),
    ]));
  }, 60_000);

  it('deletes only explicitly authorized, owned lakehouse artifacts and preserves neighbors', async () => {
    const runtime = createAwsApplicationLakehouseDatasetRuntime({
      datasetId: `chirp-history-${suffix}`,
      bucket,
      prefix,
      catalogDatabase: database,
      schemaRevision: 'v1',
      schema: type({ id: 'string', score: 'number' }),
      cursorKey: `v09-chirp-${suffix}-cursor-key-material`,
      retainedSnapshots: 1,
      maximumObjectsPerSnapshot: 1,
      forceDeleteUnretainedData: true,
      s3Client: s3,
      glueClient: glue,
    });
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: 'neighbor/outside-prefix.json', Body: '{}' }));
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: `${prefix}/application-neighbor.json`, Body: '{"owner":"another-resource"}' }));
    await glue.send(new CreateTableCommand({
      DatabaseName: database,
      TableInput: {
        Name: 'foreign_table',
        StorageDescriptor: { Columns: [{ Name: 'id', Type: 'string' }], Location: `s3://${bucket}/foreign/` },
        Parameters: { 'applik8s.dataset': 'another-dataset' },
      },
    }));

    await runtime.append({ frontier: 'one', rows: [{ id: 'one', score: 1 }] });
    await runtime.append({ frontier: 'two', rows: [{ id: 'two', score: 2 }] });
    const current = await runtime.append({ frontier: 'three', rows: [{ id: 'three', score: 3 }] });
    const receipt = await runtime.reconcileLifecycle();

    expect(receipt).toMatchObject({
      state: 'reconciled',
      destructiveCleanupAuthorized: true,
      retainedSnapshots: 1,
      retainedObjects: 1,
      deletedObjects: 2,
      deletedCatalogTables: 2,
    });
    expect(await objectText('neighbor/outside-prefix.json')).toBe('{}');
    expect(await objectText(`${prefix}/application-neighbor.json`)).toBe('{"owner":"another-resource"}');
    const keys = await allKeys();
    expect(keys).toEqual(expect.arrayContaining([
      'neighbor/outside-prefix.json',
      `${prefix}/application-neighbor.json`,
      `${prefix}/authority.json`,
      expect.stringContaining(`${prefix}/manifests/${current.snapshotId}`),
      expect.stringContaining(`${prefix}/snapshot-links/${current.snapshotId}`),
    ]));
    const tables = await glue.send(new GetTablesCommand({ DatabaseName: database }));
    expect(tables.TableList?.map(({ Name }) => Name)).toEqual(expect.arrayContaining(['foreign_table']));
    expect(tables.TableList).toHaveLength(2);
  }, 120_000);
});

async function allKeys(): Promise<readonly string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }));
    keys.push(...(listed.Contents ?? []).flatMap(({ Key }) => Key ? [Key] : []));
    continuationToken = listed.NextContinuationToken;
  } while (continuationToken);
  return keys.sort();
}

async function objectText(key: string): Promise<string> {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return await response.Body!.transformToString();
}

async function allTableNames(): Promise<readonly string[]> {
  const names: string[] = [];
  let nextToken: string | undefined;
  do {
    const tables = await glue.send(new GetTablesCommand({ DatabaseName: database, NextToken: nextToken }));
    names.push(...(tables.TableList ?? []).flatMap(({ Name }) => Name ? [Name] : []));
    nextToken = tables.NextToken;
  } while (nextToken);
  return names.sort();
}

async function aws(args: readonly string[]): Promise<string> {
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
