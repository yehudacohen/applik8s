#!/usr/bin/env node
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, CommanderError } from 'commander';
import type {
  ApplicationDeleteCommandOptions,
  ApplicationDeployCommandOptions,
  ApplicationDeploymentCommandIo,
  ApplicationStatusCommandOptions,
} from './application-deployment-command.js';
import {
  readApplicationProjectConfiguration,
  resolveApplicationContext,
  resolveApplicationEntrypoint,
} from './application-project-config.js';
import { resolveApplicationBuildPackage } from './application-build-package.js';

interface CliIo extends ApplicationDeploymentCommandIo {}

interface BuildCommandOptions {
  readonly outDir?: string;
  readonly operatorName?: string;
  readonly typekro?: boolean;
  readonly compositionName?: string;
  readonly connectionBindings?: string;
  readonly production?: boolean;
}

interface ApplicationDeployCliOptions
  extends Omit<ApplicationDeployCommandOptions, 'context'> {
  readonly context?: string;
}

interface ApplicationDeleteCliOptions
  extends Omit<ApplicationDeleteCommandOptions, 'context'> {
  readonly context?: string;
}

interface ApplicationStatusCliOptions
  extends Omit<ApplicationStatusCommandOptions, 'context'> {
  readonly context?: string;
}

interface ExplainCommandOptions {
  readonly entrypoint?: string;
  readonly outDir?: string;
  readonly compositionName?: string;
  readonly connectionBindings?: string;
  readonly skipAppBuild?: boolean;
  readonly json?: boolean;
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
    .option('--production', 'enforce production operation classification and release contracts')
    .action(async (entrypoint: string, options: BuildCommandOptions) => {
      const code = await runBuild(entrypoint, options, io);
      if (code !== 0) throw new CommanderError(code, 'applik8s.build.failed', 'Build failed.');
    });

  program
    .command('plan')
    .description('Compile and preview the graph-native Alchemy and TypeKro deployment without applying effects.')
    .argument('[entrypoint]', 'application entrypoint module; defaults to package.json applik8s.entrypoint')
    .option('--context <context>', 'explicit kubeconfig context; defaults to APPLIK8S_CONTEXT or package configuration')
    .option('--strategy <strategy>', 'root TypeKro deployment strategy: kro or direct', 'kro')
    .option('--out-dir <dir>', 'output directory')
    .option('--composition-name <name>', 'TypeKro composition export name')
    .option('--connection-bindings <path>', 'JSON operator-to-alias connection bindings')
    .option('--instance <path>', 'explicit Application instance YAML')
    .option('--skip-app-build', 'skip the application package build')
    .option(
      '--acknowledge <token>',
      'acknowledge one exact installation-scoped destructive profile transition',
      collectOption,
      [],
    )
    .action(async (entrypoint: string | undefined, options: ApplicationDeployCliOptions) => {
      const resolved = await resolveDeployCommand(entrypoint, options, io);
      const code = await runDeploy(resolved.entrypoint, {
        ...resolved.options,
        planOnly: true,
      }, io);
      if (code !== 0) throw new CommanderError(code, 'applik8s.plan.failed', 'Plan failed.');
    });

  program
    .command('deploy')
    .description('Build, plan, and reconcile an Application through Alchemy and TypeKro.')
    .argument('[entrypoint]', 'application entrypoint module; defaults to package.json applik8s.entrypoint')
    .option('--context <context>', 'explicit kubeconfig context; defaults to APPLIK8S_CONTEXT or package configuration')
    .option('--strategy <strategy>', 'root TypeKro deployment strategy: kro or direct', 'kro')
    .option('--out-dir <dir>', 'output directory')
    .option('--composition-name <name>', 'TypeKro composition export name')
    .option('--connection-bindings <path>', 'JSON operator-to-alias connection bindings')
    .option('--instance <path>', 'explicit Application instance YAML')
    .option('--skip-app-build', 'skip the application package build')
    .option('--skip-image-build', 'reject image-building deployment work')
    .option('--plan-only', 'compile and preview without applying effects')
    .option(
      '--development',
      'run the graph-owned ApplicationHost from an allowlisted local source mount',
    )
    .option(
      '--allow-breaking-changes',
      'allow one reviewed TypeKro root-schema migration for this deployment only',
    )
    .option(
      '--acknowledge <token>',
      'acknowledge one exact installation-scoped destructive profile transition',
      collectOption,
      [],
    )
    .option('--runtime-entrypoint <path>', 'internal prebuilt application module used by the Node deployment host')
    .action(async (entrypoint: string | undefined, options: ApplicationDeployCliOptions) => {
      const resolved = await resolveDeployCommand(entrypoint, options, io);
      const code = await runDeploy(resolved.entrypoint, resolved.options, io);
      if (code !== 0) throw new CommanderError(code, 'applik8s.deploy.failed', 'Deploy failed.');
    });

  program
    .command('status')
    .description('Observe the persisted Alchemy plan and authoritative TypeKro Application status.')
    .argument('[entrypoint]', 'application entrypoint module; defaults to package.json applik8s.entrypoint')
    .option('--context <context>', 'explicit kubeconfig context; defaults to APPLIK8S_CONTEXT or package configuration')
    .option('--out-dir <dir>', 'existing deployment artifact directory')
    .option('--composition-name <name>', 'TypeKro composition export name')
    .option('--instance-name <name>', 'instance name when selection is ambiguous')
    .option('--control-plane-namespace <namespace>', 'namespace containing the root Application instance')
    .option('--json', 'print the shared machine-readable status contract')
    .action(async (entrypoint: string | undefined, options: ApplicationStatusCliOptions) => {
      const resolved = await resolveStatusCommand(entrypoint, options, io);
      const code = await runStatus(resolved.entrypoint, resolved.options, io);
      if (code !== 0) throw new CommanderError(code, 'applik8s.status.failed', 'Status failed.');
    });

  program
    .command('destroy')
    .description('Destroy the scoped Alchemy Stack and its TypeKro application lifecycle.')
    .argument('[entrypoint]', 'application entrypoint module; defaults to package.json applik8s.entrypoint')
    .option('--context <context>', 'explicit kubeconfig context; defaults to APPLIK8S_CONTEXT or package configuration')
    .option('--out-dir <dir>', 'existing deployment artifact directory')
    .option('--composition-name <name>', 'TypeKro composition export name')
    .option('--instance-name <name>', 'instance name when selection is ambiguous')
    .option('--control-plane-namespace <namespace>', 'namespace containing the root Application instance')
    .action(async (entrypoint: string | undefined, options: ApplicationDeleteCliOptions) => {
      const resolved = await resolveDeleteCommand(entrypoint, options, io);
      const code = await runDelete(resolved.entrypoint, resolved.options, io);
      if (code !== 0) throw new CommanderError(code, 'applik8s.destroy.failed', 'Destroy failed.');
    });

  program
    .command('delete')
    .description('Deprecated alias for destroy.')
    .argument('[entrypoint]', 'application entrypoint module; defaults to package.json applik8s.entrypoint')
    .option('--context <context>', 'explicit kubeconfig context; defaults to APPLIK8S_CONTEXT or package configuration')
    .option('--out-dir <dir>', 'existing deployment artifact directory')
    .option('--composition-name <name>', 'TypeKro composition export name')
    .option('--instance-name <name>', 'instance name when selection is ambiguous')
    .option('--control-plane-namespace <namespace>', 'namespace containing the root Application instance')
    .action(async (entrypoint: string | undefined, options: ApplicationDeleteCliOptions) => {
      const resolved = await resolveDeleteCommand(entrypoint, options, io);
      const code = await runDelete(resolved.entrypoint, resolved.options, io);
      if (code !== 0) throw new CommanderError(code, 'applik8s.delete.failed', 'Delete failed.');
    });

  program
    .command('explain')
    .description('Explain one operation from the normalized graph, or a registered diagnostic reason.')
    .argument('<target>', 'operation alias/id or diagnostic reason')
    .option('--entrypoint <path>', 'application entrypoint; defaults to package.json applik8s.entrypoint')
    .option('--out-dir <dir>', 'compiled graph/deployment artifact directory')
    .option('--composition-name <name>', 'TypeKro composition export name')
    .option('--connection-bindings <path>', 'JSON operator-to-alias connection bindings')
    .option('--skip-app-build', 'skip the application package build when graph artifacts need compilation')
    .option('--json', 'print the shared machine-readable explanation contract')
    .action(async (target: string, options: ExplainCommandOptions) => {
      const code = await runExplain(target, options, io);
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

async function resolveDeployCommand(
  entrypoint: string | undefined,
  options: ApplicationDeployCliOptions,
  io: CliIo,
): Promise<{
  readonly entrypoint: string;
  readonly options: ApplicationDeployCommandOptions;
}> {
  const configuration = await readApplicationProjectConfiguration(io.cwd);
  return {
    entrypoint: resolveApplicationEntrypoint(entrypoint, configuration),
    options: {
      ...options,
      context: resolveApplicationContext(options.context, configuration),
      outDir: options.outDir ?? configuration.outDir ?? '.applik8s/deploy',
      compositionName:
        options.compositionName ?? configuration.compositionName ?? 'app',
      ...(options.instance ?? configuration.instance
        ? { instance: options.instance ?? configuration.instance }
        : {}),
    },
  };
}

async function resolveDeleteCommand(
  entrypoint: string | undefined,
  options: ApplicationDeleteCliOptions,
  io: CliIo,
): Promise<{
  readonly entrypoint: string;
  readonly options: ApplicationDeleteCommandOptions;
}> {
  const configuration = await readApplicationProjectConfiguration(io.cwd);
  return {
    entrypoint: resolveApplicationEntrypoint(entrypoint, configuration),
    options: {
      ...options,
      context: resolveApplicationContext(options.context, configuration),
      outDir: options.outDir ?? configuration.outDir ?? '.applik8s/deploy',
      compositionName:
        options.compositionName ?? configuration.compositionName ?? 'app',
    },
  };
}

async function resolveStatusCommand(
  entrypoint: string | undefined,
  options: ApplicationStatusCliOptions,
  io: CliIo,
): Promise<{
  readonly entrypoint: string;
  readonly options: ApplicationStatusCommandOptions;
}> {
  const resolved = await resolveDeleteCommand(entrypoint, options, io);
  return {
    entrypoint: resolved.entrypoint,
    options: {
      ...resolved.options,
      ...(options.json ? { json: true } : {}),
    },
  };
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
  const { runApplicationDeploy } = await loadApplicationDeploymentCommands();
  return runApplicationDeploy(entrypoint, options, io, { runChild, runBuild });
}

async function runStatus(
  entrypoint: string,
  options: ApplicationStatusCommandOptions,
  io: CliIo,
): Promise<number> {
  if (isBunRuntime() && process.env.APPLIK8S_DISABLE_NODE_STATUS_HANDOFF !== '1') {
    io.stdout('Handing application status observation to the Node deployment host.');
    return runChild({
      command: 'node',
      args: [
        fileURLToPath(new URL('./node-deploy-runner.mjs', import.meta.url)),
        JSON.stringify({ command: 'status', entrypoint, options, cwd: io.cwd }),
      ],
      cwd: io.cwd,
    });
  }
  const { runApplicationStatus } = await loadApplicationDeploymentCommands();
  return runApplicationStatus(entrypoint, options, io);
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
  const { runApplicationDelete } = await loadApplicationDeploymentCommands();
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

async function runExplain(
  target: string,
  options: ExplainCommandOptions,
  io: CliIo,
): Promise<number> {
  // static-import-exception: diagnostics stay out of the startup path until the explain command is selected.
  const { diagnosticAdviceForReason } = await import('@applik8s/compiler/diagnostics');
  const advice = diagnosticAdviceForReason(target);
  if (advice) {
    if (options.json) {
      io.stdout(JSON.stringify({
        apiVersion: 'applik8s.diagnosticExplanation/v1alpha1',
        ...advice,
      }));
      return 0;
    }
    io.stdout(`${advice.reason} (${advice.category})`);
    io.stdout(`What happened: ${advice.whatHappened}`);
    io.stdout(`Likely cause: ${advice.likelyCause}`);
    io.stdout(`How to fix: ${advice.howToFix}`);
    io.stdout(`Effects: ${advice.effects}`);
    io.stdout(`Retry: ${advice.retry}`);
    return 0;
  }
  const configuration = await readApplicationProjectConfiguration(io.cwd);
  const outDir = options.outDir ?? configuration.outDir ?? '.applik8s/deploy';
  const graphPath = resolve(
    io.cwd,
    outDir,
    'typekro',
    'application-graph.json',
  );
  if (!await fileExists(graphPath)) {
    const entrypoint = resolveApplicationEntrypoint(
      options.entrypoint,
      configuration,
    );
    if (!options.skipAppBuild) {
      const applicationPackage = await resolveApplicationBuildPackage(
        resolve(io.cwd, entrypoint),
      );
      const applicationBuild = await runChild({
        command: 'bun',
        args: ['run', 'build'],
        cwd: applicationPackage.directory,
      });
      if (applicationBuild !== 0) return applicationBuild;
    }
    const build = await runBuild(entrypoint, {
      outDir,
      typekro: true,
      compositionName:
        options.compositionName ?? configuration.compositionName ?? 'app',
      ...(options.connectionBindings
        ? { connectionBindings: options.connectionBindings }
        : {}),
    }, io);
    if (build !== 0) return build;
  }
  const { explainCompiledApplicationOperation } =
    await loadApplicationExplainCommand();
  return explainCompiledApplicationOperation(
    target,
    { outDir, ...(options.json ? { json: true } : {}) },
    io,
  );
}

async function runChild(options: ChildProcessOptions): Promise<number> {
  if (isBunRuntime()) {
    const stdio = options.stdio ?? 'inherit';
    const child = Bun.spawnSync([options.command, ...options.args], {
      cwd: options.cwd,
      stdin:
        options.input === undefined ? 'inherit' : Buffer.from(options.input),
      stdout: stdio,
      stderr: stdio,
      env: options.env ?? process.env,
    });
    return child.exitCode;
  }
  const { spawn } = await loadNodeChildProcess();
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

async function runChildCapture(
  options: Omit<ChildProcessOptions, 'input' | 'stdio'>,
): Promise<string> {
  if (isBunRuntime()) return runBunChildCapture(options);
  const { spawn } = await loadNodeChildProcess();
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

async function runBunChildCapture(
  options: Omit<ChildProcessOptions, 'input' | 'stdio'>,
): Promise<string> {
  const child = Bun.spawnSync([options.command, ...options.args], {
    cwd: options.cwd,
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
    env: options.env ?? process.env,
  });
  const code = child.exitCode;
  if (code === 0) return '';
  throw new Error(
    `${options.command} ${options.args.join(' ')} failed with exit code ${code}.`,
  );
}

function isBunRuntime(): boolean {
  return typeof process.versions.bun === 'string';
}

function loadApplicationDeploymentCommands() {
  // static-import-exception: deployment planning must not initialize in Bun before the CLI hands it to Node.
  return import('./application-deployment-command.js');
}

function loadApplicationExplainCommand() {
  // static-import-exception: explain reaches compiler workers and must load only in the selected runtime.
  return import('./application-explain-command.js');
}

function loadNodeChildProcess() {
  // static-import-exception: the Bun-distributed CLI must not eagerly load Node's child-process implementation.
  return import('node:child_process');
}

async function fileExists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}

function collectOption(value: string, previous: readonly string[]): string[] {
  return [...previous, value];
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
  resolveGeneratedApplicationDeleteTarget,
  stageExplicitApplicationInstance,
} from './application-deployment-files.js';
export {
  resolveApplicationBuildPackage,
  resolveApplicationProjectRoot,
} from './application-build-package.js';
export {
  applicationInstanceSpec,
  applicationInstallationReadiness,
  readApplicationInstance,
  readApplicationInstanceSpec,
  readResourceGraphDefinition,
  resourceGraphDefinitionReadiness,
  waitForApplicationEndpoint,
} from './application-deployment-observer.js';
export {
  applicationGraphDeploymentSlice,
  readGeneratedApplicationGraph,
} from './application-deployment-registry.js';
export {
  readApplicationProjectConfiguration,
  resolveApplicationContext,
  resolveApplicationEntrypoint,
} from './application-project-config.js';
