// typecast-file-boundary: checked-in application fixtures and portable deployment graphs are normalized at this release-evidence boundary.
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ApplicationDeploymentNode,
} from '@applik8s/deployment-contract';
import { parse } from 'yaml';
import { type } from 'arktype';
import { InstallationSpec as ChirpInstallationSpec } from '../examples/chirp-start/src/installation.js';
import {
  applicationDeploymentCompilerVersion,
  emitApplicationDeploymentGraph,
} from '../packages/compiler/src/application-deployment-graph.js';
import { resolveApplicationInstallationValues } from '../packages/cli/src/application-installation-values.js';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const reuseBuild = process.argv.includes('--reuse-build');
const record = process.argv.includes('--record');
const snapshotPath = join(root, 'benchmarks/v0.7/profile-graphs.json');

if (!reuseBuild) {
  await buildApplicationHost('examples/guestbook-start');
  await build(
    'examples/guestbook-start/src/application.ts',
    'dist/examples/guestbook-start',
  );
  await buildApplicationHost('examples/chirp-start');
  await build(
    'examples/chirp-start/src/application.ts',
    'dist/examples/chirp',
  );
  await buildApplicationHost('examples/identity-start');
  await build(
    'examples/identity-start/src/application.ts',
    'dist/examples/identity-start',
    'application',
  );
}

const snapshots = {
  apiVersion: 'applik8s.profileGraphEvidence/v1alpha1',
  release: 'v0.7',
  profiles: [
    await guestBookProfile(),
    await chirpProfile('starter', 'chirp.example.yaml'),
    await chirpProfile('dedicated', 'chirp.dedicated.example.yaml'),
    await chirpProfile('external', 'chirp.external.example.yaml'),
    await identityProfile('starter', 'application.yaml'),
    await identityProfile('dedicated', 'application.dedicated.example.yaml'),
    await identityProfile('external', 'application.external.example.yaml'),
  ],
};

if (record) {
  await mkdir(join(root, 'benchmarks/v0.7'), { recursive: true });
  await writeFile(snapshotPath, `${JSON.stringify(snapshots, null, 2)}\n`);
  console.log(`Recorded v0.7 profile graph topology at ${snapshotPath}.`);
} else {
  const expected = JSON.parse(await readFile(snapshotPath, 'utf8')) as unknown;
  if (stable(expected) !== stable(snapshots)) {
    throw new Error(
      'v0.7 application deployment topology changed. Review the GuestBook, Chirp, and Identity Start profile graph diff, then run bun run check:v07:profile-graphs:record intentionally.',
    );
  }
  console.log(
    `v0.7 profile graphs match: ${snapshots.profiles.map((profile) =>
      `${profile.name}=${profile.nodes.length} nodes/${profile.edges.length} edges`).join(', ')}.`,
  );
}

async function buildApplicationHost(example: string): Promise<void> {
  await run('bun', ['run', '--cwd', example, 'build']);
}

async function build(
  entrypoint: string,
  output: string,
  compositionName = 'app',
): Promise<void> {
  await run('bun', [
    'run',
    'applik8s',
    'build',
    entrypoint,
    '--typekro',
    '--composition-name',
    compositionName,
    '--out-dir',
    output,
  ]);
}

async function guestBookProfile() {
  const namespace = 'guestbook-profile-contract';
  const output = join(root, 'dist/examples/guestbook-start/typekro');
  const spec = { name: namespace, profile: 'starter' };
  return profileSnapshot(
    'guestbook',
    output,
    spec,
    {
      metadata: { name: namespace, namespace: 'applik8s-system' },
      spec,
    },
  );
}

async function chirpProfile(
  profile: 'starter' | 'dedicated' | 'external',
  fixture: string,
) {
  const document = parse(
    await readFile(
      join(root, 'examples/chirp-start/kubernetes', fixture),
      'utf8',
    ),
  ) as {
    readonly metadata: { readonly name: string; readonly namespace: string };
    readonly spec: Readonly<Record<string, unknown>>;
  };
  if (document.spec.profile !== profile) {
    throw new Error(
      `Chirp fixture ${fixture} declares ${String(document.spec.profile)} instead of ${profile}.`,
    );
  }
  const validated = ChirpInstallationSpec(document.spec);
  if (validated instanceof type.errors) {
    throw new Error(
      `Chirp fixture ${fixture} does not satisfy its authored installation branch: ${validated.summary}`,
    );
  }
  return profileSnapshot(
    `chirp-${profile}`,
    join(root, 'dist/examples/chirp/typekro'),
    document.spec,
    document,
  );
}

async function identityProfile(
  profile: 'starter' | 'dedicated' | 'external',
  fixture: string,
) {
  const document = parse(
    await readFile(
      join(root, 'examples/identity-start/kubernetes', fixture),
      'utf8',
    ),
  ) as {
    readonly metadata: { readonly name: string; readonly namespace: string };
    readonly spec: Readonly<Record<string, unknown>>;
  };
  if (document.spec.profile !== profile) {
    throw new Error(
      `Identity Start fixture ${fixture} declares ${String(document.spec.profile)} instead of ${profile}.`,
    );
  }
  return profileSnapshot(
    `identity-start-${profile}`,
    join(root, 'dist/examples/identity-start/typekro'),
    document.spec,
    document,
  );
}

async function profileSnapshot(
  name: string,
  output: string,
  spec: Readonly<Record<string, unknown>>,
  instance: {
    readonly metadata: { readonly name: string; readonly namespace: string };
    readonly spec: Readonly<Record<string, unknown>>;
  },
) {
  const bundlePath = join(output, 'typekro-composition.json');
  await access(bundlePath);
  const bundle = JSON.parse(await readFile(bundlePath, 'utf8')) as {
    readonly spec?: { readonly applicationGraph?: { readonly digest?: string } };
  };
  const sourceGraphDigest = bundle.spec?.applicationGraph?.digest;
  if (!sourceGraphDigest) {
    throw new Error(`${name} bundle has no source ApplicationGraph digest.`);
  }
  const sourceGraph = JSON.parse(
    await readFile(join(output, 'application-graph.json'), 'utf8'),
  );
  const graph = resolveApplicationInstallationValues(sourceGraph, spec, {
    preserveUnknownReferences: true,
  });
  const emitted = await emitApplicationDeploymentGraph({
    bundlePath,
    projectRoot: root,
    graph,
    sourceGraphDigest,
    compilerVersion: applicationDeploymentCompilerVersion,
    context: 'v07-profile-contract',
    controlPlaneNamespace: instance.metadata.namespace,
    instance: instance.metadata.name,
    profile: typeof spec.profile === 'string' ? spec.profile : 'starter',
    strategy: 'kro',
    installationSpec: spec,
  });
  return {
    name,
    nodes: emitted.graph.nodes.map(nodeSnapshot),
    edges: emitted.graph.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      relationship: edge.relationship,
      ...('output' in edge && edge.output ? { output: edge.output } : {}),
    })),
  };
}

function nodeSnapshot(node: ApplicationDeploymentNode) {
  return {
    id: node.id,
    kind: node.kind,
    scope: node.scope,
    lifecycle: node.lifecycle,
    source: node.source,
    ...(node.kind === 'kubernetesDirect'
      ? { compositionId: node.spec.compositionId }
      : {}),
    ...(node.kind === 'kubernetesComposition'
      ? {
          fragments: compositionFragments(node.spec.fragments),
        }
      : {}),
  };
}

function compositionFragments(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error('Application Kubernetes composition has no fragment array.');
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Application Kubernetes composition contains an invalid fragment.');
    }
    return {
      sourceNodeId: stringField(entry, 'sourceNodeId'),
      providerInterface: stringField(entry, 'providerInterface'),
      providerImplementation: stringField(entry, 'providerImplementation'),
      execution: stringField(entry, 'execution'),
    };
  });
}

function stringField(value: object, key: string): string {
  const field = Reflect.get(value, key);
  if (typeof field !== 'string') {
    throw new Error(`Application deployment fragment ${key} must be a string.`);
  }
  return field;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
    .join(',')}}`;
}

async function run(command: string, args: readonly string[]): Promise<void> {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, TYPEKRO_LOG_LEVEL: 'fatal' },
    stdio: 'inherit',
  });
  const code = await new Promise<number | null>((resolve) =>
    child.once('exit', resolve));
  if (code !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${code}.`);
  }
}
