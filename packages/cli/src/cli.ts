#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Command, CommanderError } from 'commander';
import {
  runApplicationDeploy,
  runApplicationDelete,
  type ApplicationDeleteCommandOptions,
  type ApplicationDeployCommandOptions,
  type ApplicationDeploymentCommandIo,
} from './application-deployment-command.js';

interface CliIo extends ApplicationDeploymentCommandIo {}

interface BuildCommandOptions {
  readonly outDir?: string;
  readonly operatorName?: string;
  readonly typekro?: boolean;
  readonly compositionName?: string;
  readonly connectionBindings?: string;
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
    if (cause instanceof CommanderError) return cause.exitCode;
    io.stderr(cause instanceof Error ? cause.message : String(cause));
    return 1;
  }
}

function createProgram(io: CliIo): Command {
  const program = new Command();
  program
    .name('applik8s')
    .description('Compile, plan, and reconcile Applik8s applications.')
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: (message) => io.stdout(trimTrailingNewline(message)),
      writeErr: (message) => io.stderr(trimTrailingNewline(message)),
    });

  program
    .command('build')
    .description('Compile an operator or application entrypoint into Applik8s artifacts.')
    .argument('<entrypoint>', 'operator or application entrypoint module')
    .option('--out-dir <dir>', 'output directory')
    .option('--operator-name <name>', 'operator export name when the entrypoint exports more than one operator')
    .option('--typekro', 'compile an exported Applik8s TypeKro composition')
    .option('--composition-name <name>', 'TypeKro composition export name')
    .option('--connection-bindings <path>', 'JSON connection bindings')
    .action(async (entrypoint: string, options: BuildCommandOptions) => {
      const code = await runBuild(entrypoint, options, io);
      if (code !== 0) throw new CommanderError(code, 'applik8s.build.failed', 'Build failed.');
    });

  program
    .command('deploy')
    .description('Build, plan, and reconcile an Application through Alchemy and TypeKro.')
    .argument('<entrypoint>', 'application entrypoint module')
    .requiredOption('--context <context>', 'explicit kubeconfig context')
    .option('--strategy <strategy>', 'root TypeKro deployment strategy: kro or direct', 'kro')
    .option('--out-dir <dir>', 'output directory', '.applik8s/deploy')
    .option('--composition-name <name>', 'TypeKro composition export name', 'app')
    .option('--connection-bindings <path>', 'JSON operator-to-alias connection bindings')
    .option('--instance <path>', 'explicit Application instance YAML')
    .option('--skip-app-build', 'skip the application package build')
    .option('--skip-image-build', 'reject image-building deployment work')
    .option('--plan-only', 'compile and preview without applying effects')
    .option('--runtime-entrypoint <path>', 'internal prebuilt application module used by the Node deployment host')
    .action(async (entrypoint: string, options: ApplicationDeployCommandOptions) => {
      const code = await runDeploy(entrypoint, options, io);
      if (code !== 0) throw new CommanderError(code, 'applik8s.deploy.failed', 'Deploy failed.');
    });

  program
    .command('delete')
    .description('Destroy the scoped Alchemy Stack and its TypeKro application lifecycle.')
    .argument('<entrypoint>', 'application entrypoint module')
    .requiredOption('--context <context>', 'explicit kubeconfig context')
    .option('--out-dir <dir>', 'existing deployment artifact directory', '.applik8s/deploy')
    .option('--composition-name <name>', 'TypeKro composition export name', 'app')
    .option('--instance-name <name>', 'instance name when selection is ambiguous')
    .option('--control-plane-namespace <namespace>', 'namespace containing the root Application instance')
    .action(async (entrypoint: string, options: ApplicationDeleteCommandOptions) => {
      const code = await runDelete(entrypoint, options, io);
      if (code !== 0) throw new CommanderError(code, 'applik8s.delete.failed', 'Delete failed.');
    });

  program
    .command('explain')
    .description('Explain a diagnostic reason and first recovery steps.')
    .argument('<reason>', 'diagnostic reason')
    .action(async (reason: string) => {
      const code = await runExplain(reason, io);
      if (code !== 0) throw new CommanderError(code, 'applik8s.explain.failed', 'Explain failed.');
    });

  const replay = program.command('replay').description('Replay artifact utilities.');
  replay
    .command('inspect')
    .description('Inspect an Applik8s replay artifact.')
    .argument('<artifact>', 'replay artifact JSON path')
    .option('--bundle-dir <dir>', 'compiled bundle directory')
    .option('--execute', 'execute full-payload deterministic replay locally')
    .option('--json', 'print JSON summary')
    .action(async (artifact: string, options: { readonly bundleDir?: string; readonly execute?: boolean; readonly json?: boolean }) => {
      const replayArgs = [
        artifact,
        ...(options.bundleDir ? ['--bundle-dir', options.bundleDir] : []),
        ...(options.execute ? ['--execute'] : []),
        ...(options.json ? ['--json'] : []),
      ];
      const code = await runChild({ command: 'node', args: ['scripts/replay-artifact.mjs', ...replayArgs], cwd: io.cwd });
      if (code !== 0) throw new CommanderError(code, 'applik8s.replay.inspect.failed', 'Replay inspect failed.');
    });

  program
    .command('test')
    .description('Run Vitest through the workspace test setup.')
    .allowUnknownOption(true)
    .argument('[vitestArgs...]', 'arguments forwarded to vitest run')
    .action(async (vitestArgs: readonly string[]) => {
      const code = await runChild({ command: 'bunx', args: ['vitest', 'run', ...vitestArgs], cwd: io.cwd });
      if (code !== 0) throw new CommanderError(code, 'applik8s.test.failed', 'Tests failed.');
    });

  return program;
}

async function runDeploy(
  entrypoint: string,
  options: ApplicationDeployCommandOptions,
  io: CliIo,
): Promise<number> {
  if (!options.context.trim()) {
    io.stderr('applik8s deploy requires a non-empty --context and never uses the ambient current context implicitly.');
    return 1;
  }
  if (options.strategy !== undefined && options.strategy !== 'direct' && options.strategy !== 'kro') {
    io.stderr(`applik8s deploy --strategy must be "direct" or "kro", received ${JSON.stringify(options.strategy)}.`);
    return 1;
  }
  if (isBunRuntime() && process.env.APPLIK8S_DISABLE_NODE_DEPLOY_HANDOFF !== '1') {
    io.stdout('Handing application planning and deployment to the Node deployment host.');
    return runChild({
      command: 'node',
      args: [
        fileURLToPath(new URL('./node-deploy-runner.mjs', import.meta.url)),
        JSON.stringify({ command: 'deploy', entrypoint, options, cwd: io.cwd }),
      ],
      cwd: io.cwd,
    });
  }
  return runApplicationDeploy(entrypoint, options, io, { runChild, runBuild });
}

async function runDelete(
  entrypoint: string,
  options: ApplicationDeleteCommandOptions,
  io: CliIo,
): Promise<number> {
  if (!options.context.trim()) {
    io.stderr('applik8s delete requires a non-empty --context and never uses the ambient current context implicitly.');
    return 1;
  }
  if (isBunRuntime() && process.env.APPLIK8S_DISABLE_NODE_DELETE_HANDOFF !== '1') {
    io.stdout('Handing application deletion to the Node deployment host.');
    return runChild({
      command: 'node',
      args: [
        fileURLToPath(new URL('./node-deploy-runner.mjs', import.meta.url)),
        JSON.stringify({ command: 'delete', entrypoint, options, cwd: io.cwd }),
      ],
      cwd: io.cwd,
    });
  }
  return runApplicationDelete(entrypoint, options, io);
}

async function runBuild(
  entrypoint: string,
  options: BuildCommandOptions,
  io: CliIo,
): Promise<number> {
  try {
    const output = await runChildCapture({
      command: 'node',
      args: [
        fileURLToPath(new URL('./node-build-runner.mjs', import.meta.url)),
        JSON.stringify({ entrypoint, options, cwd: io.cwd }),
      ],
      cwd: io.cwd,
    });
    for (const line of output.trimEnd().split('\n')) if (line) io.stdout(line);
    return 0;
  } catch (cause) {
    io.stderr(cause instanceof Error ? cause.message : String(cause));
    return 1;
  }
}

async function runExplain(reason: string, io: CliIo): Promise<number> {
  // static-import-exception: diagnostics stay out of the startup path until the explain command is selected.
  const { diagnosticAdviceForReason } = await import('@applik8s/compiler/diagnostics');
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

function runChild(options: ChildProcessOptions): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      stdio: options.input !== undefined ? ['pipe', options.stdio ?? 'inherit', options.stdio ?? 'inherit'] : options.stdio ?? 'inherit',
      env: options.env ?? process.env,
    });
    if (options.input !== undefined) child.stdin?.end(options.input);
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

function runChildCapture(options: Omit<ChildProcessOptions, 'input' | 'stdio'>): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env ?? process.env,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolveOutput(Buffer.concat(stdout).toString('utf8'));
      reject(new Error(`${options.command} ${options.args.join(' ')} failed: ${Buffer.concat(stderr).toString('utf8').trim()}`));
    });
  });
}

function isBunRuntime(): boolean {
  return typeof process.versions.bun === 'string';
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

export {
  resolveApplicationBuildPackage,
  resolveGeneratedApplicationDeleteTarget,
  stageExplicitApplicationInstance,
} from './application-deployment-files.js';
export {
  applicationInstallationReadiness,
  resourceGraphDefinitionReadiness,
  waitForApplicationEndpoint,
} from './application-deployment-observer.js';
export {
  applicationGraphDeploymentSlice,
  readGeneratedApplicationGraph,
} from './application-deployment-registry.js';
