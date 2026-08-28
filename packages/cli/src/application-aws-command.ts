// typecast-file-boundary: persisted AWS plan JSON is validated before it is
// admitted to the Alchemy lifecycle.
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createApplicationAwsDeployment } from '@applik8s/deployment-alchemy';
import { applicationCelldRuntimeRelease } from '@applik8s/deployment-compiler';
import {
  type ApplicationAwsDeploymentPlan,
  validateApplicationAwsDeploymentPlan,
} from '@applik8s/deployment-contract';
import type {
  ApplicationDeploymentCommandIo,
  ApplicationDeploymentCommandRuntime,
} from './application-deployment-command-contract.js';
import {
  type ApplicationTargetPlanCommandOptions,
  compileApplicationTargetPlan,
  renderAwsPlanText,
} from './application-target-plan-command.js';

export interface ApplicationAwsCommandOptions extends ApplicationTargetPlanCommandOptions {
  readonly imageUri?: string;
  readonly endpoint?: string;
  readonly awsProfile?: string;
  readonly planOnly?: boolean;
  readonly skipImageBuild?: boolean;
}

export interface ApplicationAwsStoredCommandOptions {
  readonly environment: string;
  readonly outDir?: string;
  readonly endpoint?: string;
  readonly awsProfile?: string;
  readonly imageUri?: string;
  readonly json?: boolean;
}

export async function runApplicationAwsDeploy(
  entrypoint: string,
  options: ApplicationAwsCommandOptions,
  io: ApplicationDeploymentCommandIo,
  runtime: ApplicationDeploymentCommandRuntime,
): Promise<number> {
  const compiled = await compileApplicationTargetPlan(entrypoint, options, io, runtime);
  io.stdout(renderAwsPlanText(compiled.plan));
  io.stdout(`AWS plan artifact: ${compiled.planPath}`);
  const deployment = createApplicationAwsDeployment({
    plan: compiled.plan,
    stateRoot: awsStateRoot(io.cwd, options.outDir),
    ...(options.imageUri ? { imageUri: requireImmutableImage(options.imageUri) } : {}),
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    ...(options.awsProfile ? { profile: options.awsProfile } : {}),
    ...(!options.imageUri && !options.skipImageBuild && compiled.plan.resources.some(({ resourceType }) => resourceType === 'fargate-service') ? {
      buildApplicationImage: applicationImageBuilder({
        contextDirectory: resolve(compiled.compileOutDir, 'typekro', 'application-host'),
        stateDirectory: awsStateRoot(io.cwd, options.outDir),
        region: options.region,
        ...(options.awsProfile ? { profile: options.awsProfile } : {}),
        ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      }),
    } : {}),
    ...(!options.skipImageBuild && compiled.plan.runtimeArtifacts.some(({ role }) => role !== 'operator') ? {
      buildRuntimeArtifactImage: runtimeArtifactImageBuilder({
        workspaceRoot: io.cwd,
        stateDirectory: awsStateRoot(io.cwd, options.outDir),
        region: options.region,
        ...(options.awsProfile ? { profile: options.awsProfile } : {}),
        ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      }),
    } : {}),
    ...(compiled.plan.resources.some(({ resourceType }) => resourceType === 'celld-fleet') ? {
      buildCelldWorkerImage: celldWorkerImageBuilder({
        stateDirectory: awsStateRoot(io.cwd, options.outDir),
        region: options.region,
        ...(options.awsProfile ? { profile: options.awsProfile } : {}),
        ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      }),
    } : {}),
  });
  const planned = await deployment.plan();
  const changes = planned.changes.filter(({ action }) => action !== 'noop');
  io.stdout(`Alchemy AWS plan: ${planned.changes.length} resources, ${changes.length} changes.`);
  for (const change of changes) io.stdout(`  ${change.action} ${change.type} ${change.id}`);
  if (options.planOnly) return 0;
  if (compiled.plan.resources.some(({ resourceType }) => resourceType === 'fargate-service') && !options.imageUri && options.skipImageBuild) {
    throw new Error('AWS deployment contains an ApplicationHost and --skip-image-build was requested. Supply --image-uri with an immutable repository@sha256:... reference or allow the compiler artifact to be published automatically.');
  }
  if (compiled.plan.runtimeArtifacts.some(({ role }) => role !== 'operator') && options.skipImageBuild) {
    throw new Error('AWS deployment contains compiler-owned runtime artifacts and --skip-image-build was requested. Allow Applik8s to publish their immutable images.');
  }
  const applied = await deployment.apply();
  io.stdout(`AWS application ready through native Alchemy resources (${applied.aws.status}, ${applied.aws.planDigest}).`);
  for (const [resourceId, values] of Object.entries(applied.aws.directOutputs).sort(([left], [right]) => left.localeCompare(right))) {
    for (const [name, value] of Object.entries(values).sort(([left], [right]) => left.localeCompare(right))) {
      io.stdout(`  ${resourceId}.${name}=${value}`);
    }
  }
  return 0;
}

function celldWorkerImageBuilder(options: {
  readonly stateDirectory: string;
  readonly region: string;
  readonly profile?: string;
  readonly endpoint?: string;
}) {
  return async ({ repositoryUri, plan, signal }: { readonly repositoryUri: string; readonly plan: ApplicationAwsDeploymentPlan; readonly signal?: AbortSignal }): Promise<string> => {
    const registry = repositoryUri.split('/')[0];
    if (!registry) throw new Error(`AWS ECR repository URI ${repositoryUri} has no registry authority.`);
    const run = promisify(execFile);
    const environment = options.endpoint
      ? { ...process.env, AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? 'test', AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? 'test' }
      : process.env;
    const password = await run('aws', [
      'ecr', 'get-login-password', '--region', options.region,
      ...(options.profile ? ['--profile', options.profile] : []),
      ...(options.endpoint ? ['--endpoint-url', options.endpoint] : []),
    ], { encoding: 'utf8', env: environment, ...(signal ? { signal } : {}) }).then(({ stdout }) => stdout.trim());
    if (!password) throw new Error('AWS ECR returned an empty authorization password for the celld Worker image.');
    await dockerLogin(registry, password, signal);
    const context = join(options.stateDirectory, `celld-worker-${plan.digest.slice(-16)}`);
    const metadataPath = join(options.stateDirectory, `celld-worker-build-${plan.digest.slice(-16)}.json`);
    await rm(context, { recursive: true, force: true });
    await mkdir(context, { recursive: true });
    await mkdir(options.stateDirectory, { recursive: true });
    const entry = join(context, 'worker-entry.ts');
    const bundled = join(context, 'worker.mjs');
    await writeFile(entry, "export { default, Applik8sActorCell } from '@applik8s/runtime-celld/worker';\n", { mode: 0o600 });
    await run('bunx', ['esbuild', entry, '--bundle', '--format=esm', '--platform=browser', '--target=es2022', `--outfile=${bundled}`], { encoding: 'utf8', env: process.env, ...(signal ? { signal } : {}) });
    await writeFile(join(context, 'wrangler.template.json'), JSON.stringify({
      name: 'applik8s-actor-authority',
      main: 'worker.mjs',
      compatibility_date: '2026-08-19',
      durable_objects: { bindings: [{ name: 'APPLIK8S_ACTOR_CELLS', class_name: 'Applik8sActorCell' }] },
      migrations: [{ tag: 'v1', new_sqlite_classes: ['Applik8sActorCell'] }],
      vars: {
        APPLIK8S_ACTOR_AUTHORIZATION: '__APPLIK8S_ACTOR_AUTHORIZATION__',
        APPLIK8S_ACTOR_APPLICATION_ENDPOINT: '__APPLIK8S_ACTOR_APPLICATION_ENDPOINT__',
        APPLIK8S_ACTOR_APPLICATION_AUTHORIZATION: '__APPLIK8S_ACTOR_APPLICATION_AUTHORIZATION__',
      },
    }, null, 2), { mode: 0o600 });
    await writeFile(join(context, 'deploy.sh'), `#!/bin/sh
set -eu
umask 077
case "$APPLIK8S_ACTOR_AUTHORIZATION" in (*[!A-Za-z0-9]*|'') echo 'invalid actor authorization' >&2; exit 64;; esac
case "$APPLIK8S_ACTOR_APPLICATION_AUTHORIZATION" in (*[!A-Za-z0-9]*|'') echo 'invalid application authorization' >&2; exit 64;; esac
case "$APPLIK8S_ACTOR_APPLICATION_ENDPOINT" in (http://[A-Za-z0-9._:-]*|https://[A-Za-z0-9._:-]*) ;; (*) echo 'invalid application endpoint' >&2; exit 64;; esac
mkdir -p /tmp/applik8s-celld-worker
cp /worker/worker.mjs /tmp/applik8s-celld-worker/worker.mjs
sed -e "s|__APPLIK8S_ACTOR_AUTHORIZATION__|$APPLIK8S_ACTOR_AUTHORIZATION|g" \
  -e "s|__APPLIK8S_ACTOR_APPLICATION_ENDPOINT__|$APPLIK8S_ACTOR_APPLICATION_ENDPOINT|g" \
  -e "s|__APPLIK8S_ACTOR_APPLICATION_AUTHORIZATION__|$APPLIK8S_ACTOR_APPLICATION_AUTHORIZATION|g" \
  /worker/wrangler.template.json > /tmp/applik8s-celld-worker/wrangler.json
exec celld deploy /tmp/applik8s-celld-worker --bucket "$CELLD_BUCKET" --region "$AWS_REGION"
`, { mode: 0o700 });
    await writeFile(join(context, 'Dockerfile'), `FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS esbuild
RUN npm install --global --ignore-scripts=false esbuild@0.28.1
FROM ${applicationCelldRuntimeRelease.image}
COPY --from=esbuild --chmod=0555 /usr/local/lib/node_modules/esbuild/bin/esbuild /usr/local/bin/esbuild
COPY worker.mjs wrangler.template.json deploy.sh /worker/
RUN chmod 0555 /worker/deploy.sh && chmod 0444 /worker/worker.mjs /worker/wrangler.template.json
ENTRYPOINT ["/worker/deploy.sh"]
`, { mode: 0o600 });
    const tag = `${repositoryUri}:celld-worker-${plan.digest.slice('sha256:'.length, 'sha256:'.length + 20)}`;
    await rm(metadataPath, { force: true });
    try {
      await run('docker', ['buildx', 'build', '--file', join(context, 'Dockerfile'), '--tag', tag, '--push', '--metadata-file', metadataPath, context], { encoding: 'utf8', env: process.env, ...(signal ? { signal } : {}) });
      const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as Readonly<Record<string, unknown>>;
      const digest = metadata['containerimage.digest'];
      if (typeof digest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(digest)) throw new Error('Docker Buildx did not report an immutable celld Worker image digest.');
      return `${repositoryUri}@${digest}`;
    } finally {
      await Promise.all([rm(metadataPath, { force: true }), rm(context, { recursive: true, force: true })]);
    }
  };
}

function applicationImageBuilder(options: {
  readonly contextDirectory: string;
  readonly stateDirectory: string;
  readonly region: string;
  readonly profile?: string;
  readonly endpoint?: string;
}) {
  return async ({ repositoryUri, plan, signal }: { readonly repositoryUri: string; readonly plan: ApplicationAwsDeploymentPlan; readonly signal?: AbortSignal }): Promise<string> => {
    const registry = repositoryUri.split('/')[0];
    if (!registry) throw new Error(`AWS ECR repository URI ${repositoryUri} has no registry authority.`);
    const run = promisify(execFile);
    const awsArguments = [
      'ecr', 'get-login-password', '--region', options.region,
      ...(options.profile ? ['--profile', options.profile] : []),
      ...(options.endpoint ? ['--endpoint-url', options.endpoint] : []),
    ];
    const environment = options.endpoint
      ? { ...process.env, AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? 'test', AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? 'test' }
      : process.env;
    const password = await run('aws', awsArguments, { encoding: 'utf8', env: environment, ...(signal ? { signal } : {}) }).then(({ stdout }) => stdout.trim());
    if (!password) throw new Error('AWS ECR returned an empty registry authorization password.');
    await dockerLogin(registry, password, signal);
    const tag = `${repositoryUri}:applik8s-${plan.digest.slice('sha256:'.length, 'sha256:'.length + 20)}`;
    const metadataPath = join(options.stateDirectory, `image-build-${plan.digest.slice(-16)}.json`);
    await mkdir(options.stateDirectory, { recursive: true });
    await rm(metadataPath, { force: true });
    try {
      await run('docker', [
        'buildx', 'build',
        '--file', resolve(options.contextDirectory, 'Dockerfile.applik8s-host'),
        '--tag', tag,
        '--push',
        '--metadata-file', metadataPath,
        options.contextDirectory,
      ], { encoding: 'utf8', env: process.env, ...(signal ? { signal } : {}) });
      const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as Readonly<Record<string, unknown>>;
      const digest = metadata['containerimage.digest'];
      if (typeof digest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(digest)) {
        throw new Error('Docker Buildx did not report one immutable containerimage.digest for the compiler-owned host artifact.');
      }
      return `${repositoryUri}@${digest}`;
    } finally {
      await rm(metadataPath, { force: true });
    }
  };
}

function runtimeArtifactImageBuilder(options: {
  readonly workspaceRoot: string;
  readonly stateDirectory: string;
  readonly region: string;
  readonly profile?: string;
  readonly endpoint?: string;
}) {
  return async ({ repositoryUri, plan, artifact, signal }: {
    readonly repositoryUri: string;
    readonly plan: ApplicationAwsDeploymentPlan;
    readonly artifact: ApplicationAwsDeploymentPlan['runtimeArtifacts'][number];
    readonly signal?: AbortSignal;
  }): Promise<string> => {
    if (!artifact.container) throw new Error(`AWS runtime artifact ${artifact.role}:${artifact.nodeId} has no compiler-owned container recipe.`);
    const registry = repositoryUri.split('/')[0];
    if (!registry) throw new Error(`AWS ECR repository URI ${repositoryUri} has no registry authority.`);
    const run = promisify(execFile);
    const environment = options.endpoint
      ? { ...process.env, AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? 'test', AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? 'test' }
      : process.env;
    const password = await run('aws', [
      'ecr', 'get-login-password', '--region', options.region,
      ...(options.profile ? ['--profile', options.profile] : []),
      ...(options.endpoint ? ['--endpoint-url', options.endpoint] : []),
    ], { encoding: 'utf8', env: environment, ...(signal ? { signal } : {}) }).then(({ stdout }) => stdout.trim());
    if (!password) throw new Error(`AWS ECR returned an empty authorization password for runtime artifact ${artifact.role}:${artifact.nodeId}.`);
    await dockerLogin(registry, password, signal);
    const artifactId = `${artifact.role}:${artifact.nodeId}`;
    const tag = `${repositoryUri}:runtime-${safeDockerTag(artifactId)}-${artifact.digest.slice('sha256:'.length, 'sha256:'.length + 20)}`;
    const metadataPath = join(options.stateDirectory, `runtime-build-${safeDockerTag(artifactId)}-${plan.digest.slice(-16)}.json`);
    const contextDirectory = resolve(options.workspaceRoot, artifact.container.contextPath);
    const dockerfilePath = resolve(options.workspaceRoot, artifact.container.dockerfilePath);
    await mkdir(options.stateDirectory, { recursive: true });
    await rm(metadataPath, { force: true });
    try {
      await run('docker', [
        'buildx', 'build',
        '--file', dockerfilePath,
        '--tag', tag,
        '--push',
        '--metadata-file', metadataPath,
        contextDirectory,
      ], { encoding: 'utf8', env: process.env, ...(signal ? { signal } : {}) });
      const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as Readonly<Record<string, unknown>>;
      const digest = metadata['containerimage.digest'];
      if (typeof digest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(digest)) {
        throw new Error(`Docker Buildx did not report one immutable digest for runtime artifact ${artifactId}.`);
      }
      return `${repositoryUri}@${digest}`;
    } finally {
      await rm(metadataPath, { force: true });
    }
  };
}

function safeDockerTag(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.-]+/gu, '-').replace(/^[.-]+|[.-]+$/gu, '').slice(0, 80) || 'artifact';
}

async function dockerLogin(registry: string, password: string, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolveLogin, reject) => {
    const child = spawn('docker', ['login', '--username', 'AWS', '--password-stdin', registry], {
      stdio: ['pipe', 'ignore', 'pipe'],
      ...(signal ? { signal } : {}),
    });
    const stderr: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolveLogin()
      : reject(new Error(`Docker registry login failed for ${registry}: ${Buffer.concat(stderr).toString('utf8').trim()}`)));
    child.stdin?.end(password);
  });
}

export async function runApplicationAwsStatus(options: ApplicationAwsStoredCommandOptions, io: ApplicationDeploymentCommandIo): Promise<number> {
  const plan = await readStoredPlan(io.cwd, options);
  const deployment = deploymentFromStoredPlan(plan, options, io.cwd);
  const status = await deployment.status();
  if (options.json) io.stdout(JSON.stringify(status ?? { state: 'absent' }, null, 2));
  else io.stdout(status ? `alchemy-native ${status.status} ${status.planDigest}` : `AWS application ${plan.application}/${plan.environment} is absent.`);
  return status ? 0 : 1;
}

export async function runApplicationAwsDestroy(options: ApplicationAwsStoredCommandOptions, io: ApplicationDeploymentCommandIo): Promise<number> {
  const plan = await readStoredPlan(io.cwd, options);
  const deployment = deploymentFromStoredPlan(plan, options, io.cwd);
  await deployment.destroy();
  io.stdout(`AWS application ${plan.application}/${plan.environment} destroyed through Alchemy.`);
  return 0;
}

function deploymentFromStoredPlan(plan: ApplicationAwsDeploymentPlan, options: ApplicationAwsStoredCommandOptions, cwd: string) {
  return createApplicationAwsDeployment({
    plan,
    stateRoot: awsStateRoot(cwd, options.outDir),
    ...(options.imageUri ? { imageUri: requireImmutableImage(options.imageUri) } : {}),
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    ...(options.awsProfile ? { profile: options.awsProfile } : {}),
  });
}

async function readStoredPlan(cwd: string, options: ApplicationAwsStoredCommandOptions): Promise<ApplicationAwsDeploymentPlan> {
  const path = resolve(cwd, options.outDir ?? '.applik8s/plans', `${options.environment}.aws.json`);
  const plan = JSON.parse(await readFile(path, 'utf8')) as ApplicationAwsDeploymentPlan;
  const diagnostics = validateApplicationAwsDeploymentPlan(plan);
  if (diagnostics.some(({ severity }) => severity === 'error')) {
    throw new Error(`Stored AWS plan ${path} is invalid: ${diagnostics.map(({ code, message }) => `${code}: ${message}`).join('; ')}`);
  }
  return plan;
}

function requireImmutableImage(value: string): string {
  if (!/^[^\s@]+@sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`AWS ApplicationHost image ${value} must be an immutable repository@sha256:<64 lowercase hex> reference.`);
  }
  return value;
}

function awsStateRoot(cwd: string, outDir = '.applik8s/plans'): string {
  return resolve(cwd, outDir, 'alchemy-state');
}
