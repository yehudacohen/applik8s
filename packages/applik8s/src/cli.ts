#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { KubernetesConnectionBinding } from '@applik8s/core';
import { Command, CommanderError } from 'commander';

interface CliIo {
  readonly cwd: string;
  stdout(message: string): void;
  stderr(message: string): void;
}

interface BuildCommandOptions {
  readonly outDir?: string;
  readonly operatorName?: string;
  readonly typekro?: boolean;
  readonly compositionName?: string;
  readonly connectionBindings?: string;
}

interface DeployCommandOptions extends BuildCommandOptions {
  readonly context: string;
  readonly skipAppBuild?: boolean;
  readonly skipImageBuild?: boolean;
}

interface ChildProcessOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly input?: string;
  readonly stdio?: 'inherit' | 'ignore';
}

export async function runCli(args: readonly string[], io: CliIo = defaultIo()): Promise<number> {
  const program = createProgram(io);
  try {
    await program.parseAsync(args, { from: 'user' });
    return 0;
  } catch (cause) {
    if (cause instanceof CommanderError) {
      return cause.exitCode;
    }
    io.stderr(cause instanceof Error ? cause.message : String(cause));
    return 1;
  }
}

function createProgram(io: CliIo): Command {
  const program = new Command();
  program
    .name('applik8s')
    .description('Thin applik8s wrappers over compiler, diagnostics, replay, and tests.')
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: (message) => io.stdout(trimTrailingNewline(message)),
      writeErr: (message) => io.stderr(trimTrailingNewline(message)),
    });

  program
    .command('build')
    .description('Compile an operator entrypoint into applik8s artifacts.')
    .argument('<entrypoint>', 'operator entrypoint module')
    .option('--out-dir <dir>', 'output directory')
    .option('--operator-name <name>', 'operator export name when the entrypoint exports more than one operator')
    .option('--typekro', 'compile an exported applik8s TypeKro composition instead of a single operator')
    .option('--composition-name <name>', 'TypeKro composition export name when the entrypoint exports more than one composition')
    .option('--connection-bindings <path>', 'JSON connection bindings (alias map, or operator-to-alias map with --typekro)')
    .action(async (entrypoint: string, options: BuildCommandOptions) => {
      const code = await runBuild(entrypoint, options, io);
      if (code !== 0) {
        throw new CommanderError(code, 'applik8s.build.failed', 'Build failed.');
      }
    });

  program
    .command('deploy')
    .description('Build a complete TypeKro application and deploy its generated root instance to an explicit Kubernetes context.')
    .argument('<entrypoint>', 'application entrypoint module')
    .requiredOption('--context <context>', 'explicit kubeconfig context')
    .option('--out-dir <dir>', 'output directory', '.applik8s/deploy')
    .option('--composition-name <name>', 'TypeKro composition export name', 'app')
    .option('--connection-bindings <path>', 'JSON operator-to-alias connection bindings')
    .option('--skip-app-build', 'do not run the package build before compiling the application graph')
    .option('--skip-image-build', 'do not build generated operator images in the local container engine')
    .action(async (entrypoint: string, options: DeployCommandOptions) => {
      const code = await runDeploy(entrypoint, options, io);
      if (code !== 0) {
        throw new CommanderError(code, 'applik8s.deploy.failed', 'Deploy failed.');
      }
    });

  program
    .command('explain')
    .description('Explain a diagnostic reason and first recovery steps.')
    .argument('<reason>', 'diagnostic reason, such as UndeclaredPermission')
    .action(async (reason: string) => {
      const code = await runExplain(reason, io);
      if (code !== 0) {
        throw new CommanderError(code, 'applik8s.explain.failed', 'Explain failed.');
      }
    });

  const replay = program.command('replay').description('Replay artifact utilities.');
  replay
    .command('inspect')
    .description('Inspect an applik8s replay artifact.')
    .argument('<artifact>', 'replay artifact JSON path')
    .option('--bundle-dir <dir>', 'compiled dist/applik8s directory for digest verification')
    .option('--execute', 'execute full-payload deterministic replay locally')
    .option('--json', 'print JSON summary')
    .action(async (artifact: string, options: { readonly bundleDir?: string; readonly execute?: boolean; readonly json?: boolean }) => {
      const replayArgs = [artifact, ...(options.bundleDir ? ['--bundle-dir', options.bundleDir] : []), ...(options.execute ? ['--execute'] : []), ...(options.json ? ['--json'] : [])];
      const code = await runChild({ command: 'node', args: ['scripts/replay-artifact.mjs', ...replayArgs], cwd: io.cwd });
      if (code !== 0) {
        throw new CommanderError(code, 'applik8s.replay.inspect.failed', 'Replay inspect failed.');
      }
    });

  program
    .command('test')
    .description('Run Vitest through the workspace test setup.')
    .allowUnknownOption(true)
    .argument('[vitestArgs...]', 'arguments forwarded to vitest run')
    .action(async (vitestArgs: readonly string[]) => {
      const code = await runChild({ command: 'bunx', args: ['vitest', 'run', ...vitestArgs], cwd: io.cwd });
      if (code !== 0) {
        throw new CommanderError(code, 'applik8s.test.failed', 'Tests failed.');
      }
    });

  return program;
}

async function runDeploy(entrypoint: string, options: DeployCommandOptions, io: CliIo): Promise<number> {
  if (!options.context.trim()) {
    io.stderr('applik8s deploy requires a non-empty --context and never uses the ambient current context implicitly.');
    return 1;
  }
  if (!options.skipAppBuild) {
    const buildCode = await runChild({ command: 'bun', args: ['run', 'build'], cwd: io.cwd });
    if (buildCode !== 0) return buildCode;
  }
  const outDir = options.outDir ?? '.applik8s/deploy';
  const buildCode = await runBuild(entrypoint, {
    outDir,
    typekro: true,
    compositionName: options.compositionName ?? 'app',
    ...(options.connectionBindings ? { connectionBindings: options.connectionBindings } : {}),
  }, io);
  if (buildCode !== 0) return buildCode;
  if (!options.skipImageBuild) {
    const imageCode = await buildGeneratedImages(resolve(io.cwd, outDir, 'typekro', 'typekro-composition.json'), io);
    if (imageCode !== 0) return imageCode;
  }
  const prepareCode = await prepareGeneratedApplicationHosts(resolve(io.cwd, outDir, 'typekro', 'typekro-composition.json'), options.context, io);
  if (prepareCode !== 0) return prepareCode;
  const applyScript = resolve(io.cwd, outDir, 'typekro', 'apply.sh');
  io.stdout(`Deploying through generated TypeKro artifacts to context ${options.context}`);
  return runChild({
    command: 'sh',
    args: [applyScript],
    cwd: io.cwd,
    env: { ...process.env, APPLIK8S_KUBE_CONTEXT: options.context },
  });
}

// typecast-boundary: the compiler-owned bundle is parsed only for its validated operator artifact references.
async function buildGeneratedImages(bundlePath: string, io: CliIo): Promise<number> {
  const bundle = JSON.parse(await readFile(bundlePath, 'utf8')) as {
    readonly spec?: { readonly operators?: readonly { readonly name?: string; readonly outDir?: string }[] };
  };
  for (const operator of bundle.spec?.operators ?? []) {
    if (!operator.outDir) throw new Error(`Generated TypeKro operator ${operator.name ?? '<unnamed>'} does not declare its artifact directory.`);
    const kubernetesDir = resolve(operator.outDir, 'kubernetes');
    const deploymentFiles = (await readdir(kubernetesDir)).filter((file) => file.startsWith('deployment-') && file.endsWith('.yaml')).sort();
    if (deploymentFiles.length !== 1) throw new Error(`Generated operator ${operator.name ?? operator.outDir} must emit exactly one deployment manifest before local image build.`);
    // typecast: the exact-one-file guard proves this array element exists.
    const deployment = await readFile(resolve(kubernetesDir, deploymentFiles[0] as string), 'utf8');
    const image = /^\s*image:\s*(\S+)\s*$/m.exec(deployment)?.[1];
    if (!image) throw new Error(`Generated operator ${operator.name ?? operator.outDir} deployment does not declare a runtime image.`);
    io.stdout(`Building generated operator image ${image}`);
    const code = await runChild({
      command: process.env.APPLIK8S_CONTAINER_ENGINE ?? 'docker',
      args: ['build', '--file', resolve(operator.outDir, 'Dockerfile.applik8s-runtime'), '--tag', image, operator.outDir],
      cwd: io.cwd,
    });
    if (code !== 0) return code;
  }
  const hostDirectory = resolve(dirname(bundlePath), 'application-host');
  const hostManifestPath = resolve(hostDirectory, 'application-host.json');
  if (await access(hostManifestPath).then(() => true).catch(() => false)) {
    const host = JSON.parse(await readFile(hostManifestPath, 'utf8')) as {
      readonly spec?: { readonly image?: string; readonly dockerfile?: string; readonly context?: string };
    };
    const image = host.spec?.image;
    if (!image) throw new Error('Generated ApplicationHost artifact does not declare an image.');
    io.stdout(`Building generated application host image ${image}`);
    const code = await runChild({
      command: process.env.APPLIK8S_CONTAINER_ENGINE ?? 'docker',
      args: ['build', '--file', resolve(hostDirectory, host.spec?.dockerfile ?? 'Dockerfile.applik8s-host'), '--tag', image, resolve(hostDirectory, host.spec?.context ?? '.')],
      cwd: io.cwd,
    });
    if (code !== 0) return code;
  }
  return 0;
}

async function prepareGeneratedApplicationHosts(bundlePath: string, context: string, io: CliIo): Promise<number> {
  const hostManifestPath = resolve(dirname(bundlePath), 'application-host', 'application-host.json');
  if (!await access(hostManifestPath).then(() => true).catch(() => false)) return 0;
  // typecast: this compiler-owned manifest is narrowed to the metadata required before any cluster mutation.
  const host = JSON.parse(await readFile(hostManifestPath, 'utf8')) as {
    readonly metadata?: { readonly name?: string };
    readonly spec?: {
      readonly namespace?: string;
      readonly cursorSecret?: { readonly name?: string; readonly key?: string };
    };
  };
  const namespace = host.spec?.namespace;
  const secretName = host.spec?.cursorSecret?.name;
  const secretKey = host.spec?.cursorSecret?.key;
  if (!namespace || !secretName || !secretKey) throw new Error('Generated ApplicationHost artifact is missing namespace or cursor Secret metadata.');
  const namespaceExists = await runChild({
    command: 'kubectl',
    args: ['--context', context, 'get', 'namespace', namespace],
    cwd: io.cwd,
    stdio: 'ignore',
  });
  if (namespaceExists !== 0) {
    io.stdout(`Creating ApplicationHost namespace ${namespace}`);
    const code = await runChild({
      command: 'kubectl',
      args: ['--context', context, 'apply', '-f', '-'],
      cwd: io.cwd,
      input: `${JSON.stringify({ apiVersion: 'v1', kind: 'Namespace', metadata: { name: namespace, labels: { 'applik8s.dev/application-host-namespace': host.metadata?.name ?? 'application-host' } } })}\n`,
    });
    if (code !== 0) return code;
  }
  const secretExists = await runChild({
    command: 'kubectl',
    args: ['--context', context, '--namespace', namespace, 'get', 'secret', secretName],
    cwd: io.cwd,
    stdio: 'ignore',
  });
  if (secretExists === 0) return 0;
  io.stdout(`Creating stable ApplicationHost cursor Secret ${namespace}/${secretName}`);
  return runChild({
    command: 'kubectl',
    args: ['--context', context, '--namespace', namespace, 'apply', '-f', '-'],
    cwd: io.cwd,
    input: `${JSON.stringify({
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: secretName,
        namespace,
        labels: { 'app.kubernetes.io/managed-by': 'applik8s', 'applik8s.dev/application-host-secret': 'cursor-signing' },
      },
      type: 'Opaque',
      stringData: { [secretKey]: randomBytes(48).toString('base64url') },
    })}\n`,
  });
}

async function runBuild(entrypoint: string, options: BuildCommandOptions, io: CliIo): Promise<number> {
  if (isBunRuntime()) {
    return runChild({
      command: 'node',
      args: [fileURLToPath(new URL('./node-build-runner.mjs', import.meta.url)), JSON.stringify({ entrypoint, options, cwd: io.cwd })],
      cwd: io.cwd,
    });
  }

  // static-import-exception: Bun CLI must not eagerly load the compiler because ComponentizeJS requires Node APIs before build delegation can run.
  const { compileTypeKroComposition, createCompilerPipeline } = await import('@applik8s/compiler');
  const connectionBindings = options.connectionBindings
    // typecast: the compiler validates the complete installation binding contract before emitting artifacts.
    ? JSON.parse(await readFile(resolve(io.cwd, options.connectionBindings), 'utf8')) as Readonly<Record<string, KubernetesConnectionBinding | Readonly<Record<string, KubernetesConnectionBinding>>>>
    : undefined;
  // typecast: preserve literal compiler option types across the lazy compiler import without importing runtime compiler types into the CLI entrypoint.
  const request = {
    entrypoint,
    ...(options.outDir ? { outDir: options.outDir } : {}),
    ...(options.operatorName ? { operatorName: options.operatorName } : {}),
    ...(options.compositionName ? { compositionName: options.compositionName } : {}),
    runtimeVersionRange: '^0.1.0',
    handlerAbiVersion: 'applik8s.handler/v1alpha1',
    adapter: 'wasmComponent',
    ...(connectionBindings
      ? options.typekro
        // typecast: --typekro binding files are operator-name maps; each nested alias map is validated by the compiler.
        ? { operatorKubernetesConnectionBindings: connectionBindings as Readonly<Record<string, Readonly<Record<string, KubernetesConnectionBinding>>>> }
        // typecast: single-operator binding files are alias maps validated by the compiler.
        : { kubernetesConnectionBindings: connectionBindings as Readonly<Record<string, KubernetesConnectionBinding>> }
      : {}),
    portability: {
      deterministicBuild: true,
      allowEnvironmentAccess: false,
      allowFilesystemAccess: false,
      allowNetworkAccess: true,
      allowedHostImports: [],
      sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false },
    },
  } as const;
  if (options.typekro) {
    const typeKroResult = await compileTypeKroComposition(request);
    if (!typeKroResult.ok) {
      io.stderr(typeKroResult.error.message);
      return 1;
    }
    io.stdout(`Built TypeKro composition ${typeKroResult.value.artifacts.manifest.metadata.name}`);
    io.stdout(`Composition: ${typeKroResult.value.artifacts.manifestJsonPath}`);
    io.stdout(`Resources: ${typeKroResult.value.artifacts.combinedYamlPath}`);
    io.stdout(`Apply: ${typeKroResult.value.artifacts.applyScriptPath}`);
    io.stdout(`Operators: ${typeKroResult.value.artifacts.operatorArtifacts.length}`);
    return 0;
  }

  const result = await createCompilerPipeline().run(request);
  if (!result.ok) {
    io.stderr(result.error.message);
    return 1;
  }
  io.stdout(`Built ${result.value.manifest.metadata.name}`);
  io.stdout(`Manifest: ${result.value.artifacts.manifestJsonPath}`);
  io.stdout(`Kubernetes: ${result.value.artifacts.generatedDeploymentYamlPath ? result.value.artifacts.generatedDeploymentYamlPath.replace(/deployment-[^/]+\.yaml$/, '') : '<not emitted>'}`);
  io.stdout(`Apply: ${result.value.artifacts.generatedApplyScriptPath ?? '<not emitted>'}`);
  return 0;
}

async function runExplain(reason: string, io: CliIo): Promise<number> {
  // static-import-exception: keep compiler loading lazy so non-build CLI commands stay usable under Bun's Node API gaps.
  const { diagnosticAdviceForReason } = await import('@applik8s/compiler');
  const advice = diagnosticAdviceForReason(reason);
  if (!advice) {
    io.stderr(`No diagnostic advice is registered for ${reason}.`);
    return 1;
  }
  io.stdout(`${advice.reason} (${advice.category})`);
  io.stdout(`What happened: ${advice.whatHappened}`);
  io.stdout(`Likely cause: ${advice.likelyCause}`);
  io.stdout(`How to fix: ${advice.howToFix}`);
  io.stdout(`Effects: ${advice.effects}`);
  io.stdout(`Retry: ${advice.retry}`);
  return 0;
}

async function runChild(options: ChildProcessOptions): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      stdio: options.input !== undefined ? ['pipe', options.stdio ?? 'inherit', options.stdio ?? 'inherit'] : options.stdio ?? 'inherit',
      env: options.env ?? process.env,
    });
    if (options.input !== undefined) {
      child.stdin?.end(options.input);
    }
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

function defaultIo(): CliIo {
  return {
    cwd: process.cwd(),
    stdout: (message) => process.stdout.write(`${message}\n`),
    stderr: (message) => process.stderr.write(`${message}\n`),
  };
}

function trimTrailingNewline(message: string): string {
  return message.endsWith('\n') ? message.slice(0, -1) : message;
}

function isBunRuntime(): boolean {
  return 'bun' in process.versions;
}
