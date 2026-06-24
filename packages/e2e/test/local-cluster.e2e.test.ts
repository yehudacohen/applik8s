import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const namespace = process.env.APPLIK8S_E2E_NAMESPACE ?? `applik8s-e2e-${process.pid}`;
const expectedContext = process.env.APPLIK8S_E2E_CONTEXT;
const artifactDir = process.env.APPLIK8S_E2E_ARTIFACT_DIR ?? 'dist/e2e/image-pipeline/kubernetes';
const sampleResourcePath = process.env.APPLIK8S_E2E_SAMPLE_RESOURCE ?? 'dist/e2e/image-pipeline/samples/imagejob.yaml';
const operatorDeployment = process.env.APPLIK8S_E2E_OPERATOR_DEPLOYMENT ?? 'applik8s-image-pipeline';
const reconciledResource = process.env.APPLIK8S_E2E_RECONCILED_RESOURCE ?? 'imagejobs.media.applik8s.dev/hero-image';
const statusJsonPath = process.env.APPLIK8S_E2E_STATUS_JSONPATH ?? '{.status.phase}';
const statusValue = process.env.APPLIK8S_E2E_STATUS_VALUE ?? 'Processing';
const expectedAppliedResource = process.env.APPLIK8S_E2E_EXPECTED_APPLIED_RESOURCE ?? 'jobs.batch/hero-image-proxy';

describe('local Kubernetes end-to-end', () => {
  beforeAll(async () => {
    if (process.env.APPLIK8S_E2E !== '1') {
      throw new Error('Set APPLIK8S_E2E=1 or run npm run test:e2e / npm run test:e2e:orbstack.');
    }

    const context = await kubectl(['config', 'current-context']);
    if (expectedContext && context.stdout.trim() !== expectedContext) {
      throw new Error(`Expected kubectl context ${expectedContext}, got ${context.stdout.trim()}.`);
    }

    await kubectl(['create', 'namespace', namespace]);
    await kubectl(['label', 'namespace', namespace, 'app.kubernetes.io/part-of=applik8s-e2e']);
  });

  afterAll(async () => {
    if (process.env.APPLIK8S_E2E === '1') {
      await kubectl(['delete', 'namespace', namespace, '--ignore-not-found=true', '--wait=false']);
    }
  });

  it('reaches the requested local Kubernetes cluster', async () => {
    const version = await kubectl(['version', '--client=true', '--output=json']);
    const namespaceResult = await kubectl(['get', 'namespace', namespace, '--output=name']);

    expect(version.stdout).toContain('clientVersion');
    expect(namespaceResult.stdout.trim()).toBe(`namespace/${namespace}`);
  });

  it('applies generated operator manifests', async () => {
    const manifestPaths = await generatedManifestPaths();

    expect(manifestPaths.length).toBeGreaterThan(0);

    for (const manifestPath of manifestPaths) {
      await kubectl(['apply', '--namespace', namespace, '--filename', manifestPath]);
    }

    await kubectl(['rollout', 'status', `deployment/${operatorDeployment}`, '--namespace', namespace, '--timeout=120s']);
  });

  it('reconciles a sample custom resource through the generated operator', async () => {
    await kubectl(['apply', '--namespace', namespace, '--filename', sampleResourcePath]);
    await kubectl([
      'wait',
      reconciledResource,
      '--namespace',
      namespace,
      `--for=jsonpath=${statusJsonPath}=${statusValue}`,
      '--timeout=120s',
    ]);

    const appliedResource = await kubectl(['get', expectedAppliedResource, '--namespace', namespace, '--output=name']);

    expect(appliedResource.stdout.trim()).toBe(expectedAppliedResource);
  });
});

async function generatedManifestPaths(): Promise<readonly string[]> {
  let names: readonly string[];

  try {
    names = await readdir(artifactDir);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Generated manifest directory is missing: ${artifactDir}. Build the E2E operator artifacts first. ${error.message}`);
    }

    throw new Error(`Generated manifest directory is missing: ${artifactDir}. Build the E2E operator artifacts first.`);
  }

  const yamlNames = names.filter((name) => name.endsWith('.yaml') || name.endsWith('.yml')).sort();

  if (yamlNames.length === 0) {
    throw new Error(`Generated manifest directory contains no YAML files: ${artifactDir}.`);
  }

  return yamlNames.map((name) => join(artifactDir, name));
}

async function kubectl(args: readonly string[]): Promise<{ readonly stdout: string; readonly stderr: string }> {
  try {
    return await execFileAsync('kubectl', args, {
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`kubectl ${args.join(' ')} failed: ${error.message}`);
    }

    throw new Error(`kubectl ${args.join(' ')} failed.`);
  }
}
