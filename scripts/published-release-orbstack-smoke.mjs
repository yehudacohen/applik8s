import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(process.cwd());
const workspaceManifest = JSON.parse(await readFile(join(root, 'packages/applik8s/package.json'), 'utf8'));
const requestedVersion = argument('--version') ?? process.env.APPLIK8S_PUBLISHED_VERSION ?? workspaceManifest.version;
const version = requestedVersion.startsWith('v') ? requestedVersion.slice(1) : requestedVersion;
const buildOnly = process.argv.includes('--build-only');
const candidate = process.argv.includes('--candidate');
const expectedContext = argument('--context') ?? process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack';
const namespace = 'applik8s-release-smoke';
const crd = 'works.smoke.applik8s.dev';
const deployment = 'published-host-smoke';
const workDir = await mkdtemp(join(tmpdir(), `applik8s-published-${version}-`));
const outDir = join(workDir, 'dist');
const kubernetesDir = join(outDir, 'kubernetes');
let contextValidated = false;
let failure;

try {
  let context;
  if (!buildOnly) {
    context = (await run('kubectl', ['config', 'current-context'])).stdout.trim();
    if (context !== expectedContext) {
      throw new Error(`Refusing live release smoke: expected kubectl context ${expectedContext}, got ${context || '<empty>'}.`);
    }
    contextValidated = true;
  }

  const dependencies = candidate ? await packCandidatePackages() : { '@applik8s/applik8s': version };
  await writeFile(join(workDir, 'package.json'), `${JSON.stringify({
    name: 'applik8s-published-release-smoke',
    private: true,
    type: 'module',
    dependencies,
  }, null, 2)}\n`);
  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: workDir, timeout: 300_000 });

  const entrypoint = join(workDir, 'operator.ts');
  await writeFile(entrypoint, `import { sdk } from '@applik8s/applik8s/operator';

const Work = sdk.crd({
  apiVersion: 'smoke.applik8s.dev/v1alpha1',
  kind: 'Work',
  spec: {
    kind: 'jsonSchema',
    ref: { kind: 'jsonSchema', exportName: 'WorkSpec' },
    schema: { type: 'object', additionalProperties: false, properties: {} },
  },
  status: {
    kind: 'jsonSchema',
    ref: { kind: 'jsonSchema', exportName: 'WorkStatus' },
    schema: { type: 'object', properties: { phase: { type: 'string' } } },
  },
});

export const publishedHostSmoke = sdk.operator({
  name: '${deployment}',
  deployment: { namespace: '${namespace}' },
  resources: { Work },
  handlers: [Work.on.reconcile((work) => { work.status.phase = 'Ready'; })],
});
`);

  const executable = join(workDir, 'node_modules/.bin/applik8s');
  await run(executable, ['build', entrypoint, '--out-dir', outDir, '--operator-name', deployment], { cwd: workDir, timeout: 300_000 });

  const manifest = JSON.parse(await readFile(join(outDir, 'operator-manifest.json'), 'utf8'));
  const baseImage = imageRefString(manifest.spec?.container?.baseImage);
  if (baseImage !== `ghcr.io/yehudacohen/applik8s-operator-host:v${version}`) {
    throw new Error(`Published compiler ${version} emitted an unexpected operator-host image: ${baseImage || '<missing>'}.`);
  }
  const dockerfile = await readFile(join(outDir, 'Dockerfile.applik8s-runtime'), 'utf8');
  if (!dockerfile.startsWith(`ARG APPLIK8S_BASE_IMAGE=${baseImage}\nFROM \${APPLIK8S_BASE_IMAGE}\n`)) {
    throw new Error(`Generated Dockerfile does not default to manifest base image ${baseImage}.`);
  }
  const buildBaseImage = candidate
    ? process.env.APPLIK8S_CANDIDATE_HOST_IMAGE ?? 'ghcr.io/applik8s/applik8s-operator-host:dev'
    : baseImage;
  let resolvedHost;
  if (candidate && !process.env.APPLIK8S_CANDIDATE_HOST_IMAGE) {
    await run('docker', ['build', '--file', join(root, 'Dockerfile.operator-host'), '--tag', buildBaseImage, root], { cwd: root, timeout: 600_000 });
    resolvedHost = (await run('docker', ['image', 'inspect', buildBaseImage, '--format', '{{.Id}}'], { cwd: workDir })).stdout.trim();
  } else {
    await run('docker', ['pull', buildBaseImage], { cwd: workDir, timeout: 300_000 });
    const inspected = await run('docker', ['image', 'inspect', buildBaseImage, '--format', '{{json .RepoDigests}}'], { cwd: workDir });
    const repoDigests = JSON.parse(inspected.stdout);
    const expectedDigest = candidate
      ? /@sha256:[a-f0-9]{64}$/
      : /^ghcr\.io\/yehudacohen\/applik8s-operator-host@sha256:[a-f0-9]{64}$/;
    resolvedHost = Array.isArray(repoDigests)
      ? repoDigests.find((value) => expectedDigest.test(value))
      : undefined;
    if (!resolvedHost) throw new Error(`Published host ${buildBaseImage} did not resolve to an immutable public digest.`);
  }

  const operatorImage = imageRefString(manifest.spec?.container?.image);
  if (!operatorImage) throw new Error('Published compiler did not emit an operator image reference.');
  await run('docker', ['build', '--build-arg', `APPLIK8S_BASE_IMAGE=${buildBaseImage}`, '--file', join(outDir, 'Dockerfile.applik8s-runtime'), '--tag', operatorImage, outDir], { cwd: workDir, timeout: 300_000 });

  if (buildOnly) {
    console.log(`${candidate ? 'Packed candidate' : 'Published'} Applik8s ${version} clean-install build smoke passed with declared ${baseImage} and tested ${buildBaseImage} (${resolvedHost}).`);
    process.exitCode = 0;
  } else {
    await cleanCluster();
    await run('kubectl', ['create', 'namespace', namespace]);
    for (const file of (await readdir(kubernetesDir)).filter((candidate) => candidate.endsWith('.yaml')).sort()) {
      await run('kubectl', ['apply', '--server-side', '--field-manager=applik8s-release-smoke', '--filename', join(kubernetesDir, file)]);
    }
    await run('kubectl', ['wait', `crd/${crd}`, '--for=condition=Established', '--timeout=60s']);
    await run('kubectl', ['rollout', 'status', `deployment/${deployment}`, '--namespace', namespace, '--timeout=180s']);

    const instancePath = join(workDir, 'work.yaml');
    await writeFile(instancePath, `apiVersion: smoke.applik8s.dev/v1alpha1
kind: Work
metadata:
  name: proof
  namespace: ${namespace}
spec: {}
`);
    await run('kubectl', ['apply', '--server-side', '--field-manager=applik8s-release-smoke', '--filename', instancePath]);
    await run('kubectl', ['wait', 'work/proof', '--namespace', namespace, '--for=jsonpath={.status.phase}=Ready', '--timeout=180s']);

    console.log(`${candidate ? 'Packed candidate' : 'Published'} Applik8s ${version} clean-install smoke passed on ${context} with declared ${baseImage} and tested ${buildBaseImage} (${resolvedHost}).`);
  }
} catch (error) {
  const diagnostics = contextValidated ? await Promise.allSettled([
    run('kubectl', ['get', 'all', '--namespace', namespace, '--ignore-not-found=true', '--output=wide']),
    run('kubectl', ['get', 'crd', crd, '--ignore-not-found=true', '--output=yaml']),
    run('kubectl', ['logs', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${deployment}`, '--all-containers=true', '--tail=500']),
    run('kubectl', ['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
  ]) : [];
  failure = new Error(`${error instanceof Error ? error.message : String(error)}\n${diagnostics.map(formatDiagnostic).join('\n')}`);
}

let cleanupFailure;
if (contextValidated) {
  try {
    await cleanCluster();
  } catch (error) {
    cleanupFailure = error instanceof Error ? error : new Error(String(error));
  }
}
await rm(workDir, { recursive: true, force: true });
if (failure && cleanupFailure) {
  throw new Error(`${failure.message}\nRelease smoke cleanup also failed: ${cleanupFailure.message}`);
}
if (failure) throw failure;
if (cleanupFailure) throw cleanupFailure;

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function imageRefString(ref) {
  if (!ref || typeof ref.repository !== 'string') return '';
  const tagged = `${ref.registry ? `${ref.registry}/` : ''}${ref.repository}${ref.tag ? `:${ref.tag}` : ''}`;
  return ref.digest ? `${tagged}@${ref.digest}` : tagged;
}

async function packCandidatePackages() {
  const packageDirs = ['core', 'runtime-contract', 'typetainer', 'sdk', 'compiler', 'testing', 'runtime', 'typekro-adapter', 'client', 'react', 'tanstack-start', 'applik8s'];
  const packDir = join(workDir, 'packs');
  const npmCache = join(workDir, 'npm-cache');
  await mkdir(packDir, { recursive: true });
  await run(process.execPath, [join(root, 'scripts/build-publishable-packages.mjs')], { cwd: root, timeout: 300_000 });
  const dependencies = {};
  for (const packageDir of packageDirs) {
    const cwd = join(root, 'packages', packageDir);
    const packageManifest = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));
    const result = await run('npm', ['pack', '--json', '--pack-destination', packDir, '.'], {
      cwd,
      timeout: 120_000,
      env: { ...process.env, npm_config_cache: npmCache },
    });
    const [pack] = JSON.parse(result.stdout);
    if (!pack?.filename) throw new Error(`${packageManifest.name}: npm pack did not produce a filename.`);
    dependencies[packageManifest.name] = `file:${join(packDir, pack.filename)}`;
  }
  return dependencies;
}

async function cleanCluster() {
  const crdResult = await run('kubectl', ['get', 'crd', crd, '--ignore-not-found=true', '--output=name']);
  if (crdResult.stdout.trim()) {
    await run('kubectl', ['delete', 'work/proof', '--namespace', namespace, '--ignore-not-found=true', '--wait=true', '--timeout=60s']);
  }
  if (await pathExists(kubernetesDir)) {
    await run('kubectl', ['delete', '--filename', kubernetesDir, '--ignore-not-found=true', '--wait=false']);
  } else if (crdResult.stdout.trim()) {
    await run('kubectl', ['delete', 'crd', crd, '--ignore-not-found=true', '--wait=false']);
  }
  await waitForCrdDeleted();
  await run('kubectl', ['delete', 'namespace', namespace, '--ignore-not-found=true', '--wait=false']);
  await waitForNamespaceDeleted();
}

async function waitForCrdDeleted() {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const result = await run('kubectl', ['get', 'crd', crd, '--ignore-not-found=true', '--output=name']);
    if (result.stdout.trim() === '') return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  const remaining = await run('kubectl', ['get', 'works.smoke.applik8s.dev', '--all-namespaces', '--ignore-not-found=true', '--output=name']);
  if (remaining.stdout.trim()) {
    throw new Error(`Refusing to finalize crd/${crd}; smoke Work instances remain:\n${remaining.stdout}`);
  }
  // OrbStack's K3s CRD cleanup controller can retain this built-in finalizer
  // after an authoritative empty list. The escape hatch is limited to this
  // disposable release-smoke API and only runs after proving it has no instances.
  await run('kubectl', ['patch', 'crd', crd, '--type=merge', '--patch', '{"metadata":{"finalizers":[]}}']);
  await waitAbsent('crd', crd, 30_000);
}

async function waitForNamespaceDeleted() {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const result = await run('kubectl', ['get', 'namespace', namespace, '--ignore-not-found=true', '--output=name']);
    if (result.stdout.trim() === '') return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  // K3s can leave an otherwise-empty test namespace on its built-in finalizer.
  // Remove ephemeral control-plane objects, then prove every discoverable
  // namespaced resource type is empty before using the finalize subresource.
  await run('kubectl', ['delete', 'configmaps,events,serviceaccounts', '--all', '--namespace', namespace, '--ignore-not-found=true', '--wait=false']);
  await run('kubectl', ['delete', 'events.events.k8s.io', '--all', '--namespace', namespace, '--ignore-not-found=true', '--wait=false']);
  const resourceTypes = (await run('kubectl', ['api-resources', '--verbs=list', '--namespaced', '--output=name'])).stdout
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
  const remaining = resourceTypes.length > 0
    ? await run('kubectl', ['get', resourceTypes.join(','), '--namespace', namespace, '--ignore-not-found=true', '--output=name'], { timeout: 180_000 })
    : { stdout: '' };
  if (remaining.stdout.trim()) {
    throw new Error(`Refusing to finalize namespace/${namespace}; resources remain:\n${remaining.stdout}`);
  }

  const namespaceState = JSON.parse((await run('kubectl', ['get', 'namespace', namespace, '--output=json'])).stdout);
  namespaceState.spec = { ...(namespaceState.spec ?? {}), finalizers: [] };
  const finalizePath = join(workDir, 'namespace-finalize.json');
  await writeFile(finalizePath, JSON.stringify(namespaceState));
  await run('kubectl', ['replace', '--raw', `/api/v1/namespaces/${namespace}/finalize`, '--filename', finalizePath]);
  await waitAbsent('namespace', namespace, 30_000);
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function waitAbsent(kind, name, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await run('kubectl', ['get', kind, name, '--ignore-not-found=true', '--output=name']);
    if (result.stdout.trim() === '') return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for ${kind}/${name} deletion.`);
}

async function run(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      timeout: options.timeout ?? 120_000,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    const output = [error?.stdout, error?.stderr].filter(Boolean).join('\n');
    throw new Error(`${command} ${args.join(' ')} failed${output ? `:\n${output}` : '.'}`);
  }
}

function formatDiagnostic(result) {
  return result.status === 'fulfilled' ? `${result.value.stdout}\n${result.value.stderr}`.trim() : String(result.reason);
}
