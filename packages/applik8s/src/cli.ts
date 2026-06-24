#!/usr/bin/env bun
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { Command, CommanderError } from 'commander';

interface CliIo {
  readonly cwd: string;
  stdout(message: string): void;
  stderr(message: string): void;
}

interface BuildCommandOptions {
  readonly outDir?: string;
  readonly operatorName?: string;
}

interface ChildProcessOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
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
    .action(async (entrypoint: string, options: BuildCommandOptions) => {
      const code = await runBuild(entrypoint, options, io);
      if (code !== 0) {
        throw new CommanderError(code, 'applik8s.build.failed', 'Build failed.');
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

async function runBuild(entrypoint: string, options: BuildCommandOptions, io: CliIo): Promise<number> {
  if (isBunRuntime()) {
    return runChild({
      command: 'node',
      args: [fileURLToPath(new URL('./node-build-runner.mjs', import.meta.url)), JSON.stringify({ entrypoint, options, cwd: io.cwd })],
      cwd: io.cwd,
    });
  }

  // static-import-exception: Bun CLI must not eagerly load the compiler because ComponentizeJS requires Node APIs before build delegation can run.
  const { createCompilerPipeline } = await import('@applik8s/compiler');
  const result = await createCompilerPipeline().run({
    entrypoint,
    ...(options.outDir ? { outDir: options.outDir } : {}),
    ...(options.operatorName ? { operatorName: options.operatorName } : {}),
    runtimeVersionRange: '^0.1.0',
    handlerAbiVersion: 'applik8s.handler/v1alpha1',
    adapter: 'wasmComponent',
    portability: {
      deterministicBuild: true,
      allowEnvironmentAccess: false,
      allowFilesystemAccess: false,
      allowNetworkAccess: true,
      allowedHostImports: [],
      sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false },
    },
  });
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
    const child = spawn(options.command, options.args, { cwd: options.cwd, stdio: 'inherit', env: process.env });
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

if (process.argv[1]?.endsWith('/cli.ts')) {
  process.exitCode = await runCli(process.argv.slice(2));
}
