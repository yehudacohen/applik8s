import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createCompilerPipeline } from '@applik8s/compiler';

const execFileAsync = promisify(execFile);
const describeLive = process.env.APPLIK8S_E2E_LIVE === '1' ? describe : describe.skip;
const expectedContext = process.env.APPLIK8S_E2E_CONTEXT;
const apiGroup = `schema-${process.pid}.applik8s.dev`;
let tempDir: string | undefined;
let artifactDir: string | undefined;

describeLive('API-server CRD schema acceptance', () => {
  beforeAll(async () => {
    const context = await kubectl(['config', 'current-context']);
    if (expectedContext && context.stdout.trim() !== expectedContext) {
      throw new Error(`Expected kubectl context ${expectedContext}, got ${context.stdout.trim()}.`);
    }

    tempDir = await mkdtemp(join(tmpdir(), 'applik8s-crd-schema-acceptance-'));
    const entrypoint = join(tempDir, 'schema-operator.ts');
    await writeFile(entrypoint, schemaOperatorSource(apiGroup));

    const compiled = await createCompilerPipeline().run({
      entrypoint,
      outDir: join(tempDir, 'dist'),
      runtimeVersionRange: '^0.1.0',
      handlerAbiVersion: 'applik8s.handler/v1alpha1',
      adapter: 'wasmComponent',
      portability: {
        deterministicBuild: true,
        allowEnvironmentAccess: false,
        allowFilesystemAccess: false,
        allowNetworkAccess: false,
        allowedHostImports: [],
        sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false },
      },
    });
    if (!compiled.ok) {
      throw new Error(compiled.error.message);
    }
    artifactDir = join(tempDir, 'dist/kubernetes');
  }, 120_000);

  afterAll(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('server-side dry-run accepts generated CRD structural schemas', async () => {
    if (!artifactDir) {
      throw new Error('Artifact directory was not generated.');
    }

    const crdPaths = await generatedCrdManifestPaths(artifactDir);
    expect(crdPaths).toHaveLength(2);

    for (const manifestPath of crdPaths) {
      await kubectl(['apply', '--server-side', '--dry-run=server', '--field-manager=applik8s-schema-e2e', '--filename', manifestPath]);
    }
  }, 120_000);
});

async function generatedCrdManifestPaths(directory: string): Promise<readonly string[]> {
  const yamlNames = (await readdir(directory))
    .filter((name) => name.startsWith('customresourcedefinition-') && (name.endsWith('.yaml') || name.endsWith('.yml')))
    .sort();
  if (yamlNames.length === 0) {
    throw new Error(`Generated manifest directory contains no CRD YAML files: ${directory}.`);
  }
  return yamlNames.map((name) => join(directory, name));
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

function schemaOperatorSource(group: string): string {
  return `import { sdk } from ${JSON.stringify(join(process.cwd(), 'packages/sdk/src/index.ts'))};

interface DataPipelineSpec {
  sourceUrl: string;
  labels?: Record<string, string>;
  steps: Array<{ name: string; enabled: boolean; params?: Record<string, string> }>;
  targets?: Record<string, { bucket: string; prefix?: string }>;
}

interface DataPipelineStatus {
  observedGeneration?: number;
  conditions?: Array<{ type: string; status: string; reason?: string; message?: string; lastTransitionTime?: string; observedGeneration?: number }>;
  outputs?: Record<string, { url: string; digest?: string }>;
}

interface ClusterPolicySpec {
  matchLabels?: Record<string, string>;
  rules: Array<{ apiGroup: string; resource: string; verbs: string[] }>;
}

const pipelineSpec = {
  kind: 'jsonSchema' as const,
  ref: { kind: 'jsonSchema' as const, exportName: 'DataPipelineSpec' },
  schema: {
    type: 'object',
    required: ['sourceUrl', 'steps'],
    additionalProperties: false,
    properties: {
      sourceUrl: { type: 'string' },
      labels: { type: 'object', additionalProperties: { type: 'string' } },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name', 'enabled'],
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            enabled: { type: 'boolean' },
            params: { type: 'object', additionalProperties: { type: 'string' } },
          },
        },
      },
      targets: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          required: ['bucket'],
          additionalProperties: false,
          properties: {
            bucket: { type: 'string' },
            prefix: { type: 'string' },
          },
        },
      },
    },
  },
};

const pipelineStatus = {
  kind: 'jsonSchema' as const,
  ref: { kind: 'jsonSchema' as const, exportName: 'DataPipelineStatus' },
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      outputs: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          required: ['url'],
          additionalProperties: false,
          properties: {
            url: { type: 'string' },
            digest: { type: 'string' },
          },
        },
      },
    },
  },
};

const policySpec = {
  kind: 'jsonSchema' as const,
  ref: { kind: 'jsonSchema' as const, exportName: 'ClusterPolicySpec' },
  schema: {
    type: 'object',
    required: ['rules'],
    additionalProperties: false,
    properties: {
      matchLabels: { type: 'object', additionalProperties: { type: 'string' } },
      rules: {
        type: 'array',
        items: {
          type: 'object',
          required: ['apiGroup', 'resource', 'verbs'],
          additionalProperties: false,
          properties: {
            apiGroup: { type: 'string' },
            resource: { type: 'string' },
            verbs: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
};

export const DataPipeline = sdk.crd<DataPipelineSpec, DataPipelineStatus>({
  apiVersion: ${JSON.stringify(`${group}/v1alpha1`)},
  kind: 'DataPipeline',
  plural: 'datapipelines',
  spec: pipelineSpec,
  status: pipelineStatus,
  statusConvention: { observedGenerationField: 'observedGeneration', conditionsField: 'conditions' },
});

export const ClusterPolicy = sdk.crd<ClusterPolicySpec, object>({
  apiVersion: ${JSON.stringify(`${group}/v1alpha1`)},
  kind: 'ClusterPolicy',
  plural: 'clusterpolicies',
  scope: 'Cluster',
  spec: policySpec,
});

export const schemaOperator = sdk.operator({
  name: 'schema-acceptance',
  deployment: { namespace: 'default', replicas: 0 },
  resources: { DataPipeline, ClusterPolicy },
  handlers: [],
});
`;
}
