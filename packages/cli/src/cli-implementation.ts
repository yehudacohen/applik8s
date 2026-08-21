#!/usr/bin/env node
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, CommanderError } from 'commander';
import { resolveApplicationBuildPackage } from './application-build-package.js';
import { loadApplicationEnvironmentFile } from './application-environment-file.mjs';
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
import { checkApplicationStartUpdate } from './application-start-update-command.js';

interface CliIo extends ApplicationDeploymentCommandIo {}

interface BuildCommandOptions {
  readonly outDir?: string;
  readonly operatorName?: string;
  readonly typekro?: boolean;
  readonly compositionName?: string;
  readonly connectionBindings?: string;
  readonly production?: boolean;
  /** Internal local-supervisor compile mode; not exposed by the build CLI. */
  readonly localDevelopment?: boolean;
  /** Internal compiler target used to emit target-specific runtime artifacts. */
  readonly executionTarget?: 'kubernetes' | 'local' | 'aws-local' | 'aws';
}

interface ApplicationDeployCliOptions
  extends Omit<ApplicationDeployCommandOptions, 'context'> {
  readonly context?: string;
  readonly target?: 'kubernetes' | 'aws';
  readonly environment?: string;
  readonly region?: string;
  readonly accountId?: string;
  readonly availabilityZone?: readonly string[];
  readonly hostedZone?: readonly string[];
  readonly imageUri?: string;
  readonly endpoint?: string;
  readonly awsProfile?: string;
}

interface ApplicationPlanCliOptions extends ApplicationDeployCliOptions {
  readonly target?: 'kubernetes' | 'aws';
  readonly environment?: string;
  readonly region?: string;
  readonly accountId?: string;
  readonly availabilityZone?: readonly string[];
  readonly format?: 'text' | 'json' | 'graph';
  readonly diff?: string;
}

interface ApplicationDeleteCliOptions
  extends Omit<ApplicationDeleteCommandOptions, 'context'> {
  readonly context?: string;
  readonly target?: 'kubernetes' | 'aws';
  readonly environment?: string;
  readonly endpoint?: string;
  readonly awsProfile?: string;
  readonly imageUri?: string;
}

interface ApplicationStatusCliOptions
  extends Omit<ApplicationStatusCommandOptions, 'context'> {
  readonly context?: string;
  readonly target?: 'kubernetes' | 'aws';
  readonly environment?: string;
  readonly endpoint?: string;
  readonly awsProfile?: string;
  readonly imageUri?: string;
}

interface ExplainCommandOptions {
  readonly entrypoint?: string;
  readonly outDir?: string;
  readonly compositionName?: string;
  readonly connectionBindings?: string;
  readonly skipAppBuild?: boolean;
  readonly json?: boolean;
}

interface DoctorCommandOptions {
  readonly context?: string;
  readonly json?: boolean;
}

interface StartUpdateCommandOptions {
  readonly check?: boolean;
  readonly json?: boolean;
}

interface LocalDevelopmentCliOptions {
  readonly target?: 'local' | 'aws-local';
  readonly profile?: string;
  readonly outDir?: string;
  readonly compositionName?: string;
  readonly status?: boolean;
  readonly reset?: boolean;
  readonly json?: boolean;
  readonly portalPort?: number;
  readonly portal?: boolean;
  readonly agent?: boolean;
  readonly agentPort?: number;
  readonly agentExecutable?: string;
  readonly allowDockerSocket?: boolean;
}

interface OperatorIdentityCommandOptions {
  readonly issuer: string;
  readonly subject: string;
  readonly identityId?: string;
  readonly kind?: 'human' | 'service' | 'external';
  readonly reason: string;
  readonly outDir?: string;
  readonly json?: boolean;
}

interface OperatorBreakGlassCommandOptions extends OperatorIdentityCommandOptions {
  readonly incident: string;
  readonly expiresIn: string;
  readonly acknowledge: string;
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

  const start = program
    .command('start')
    .description('Inspect maintained Start lineage without mutating application source.');
  start
    .command('update')
    .description('Compare generated source with the current maintained Start.')
    .requiredOption('--check', 'perform a read-only update check')
    .option('--json', 'print the machine-readable update report')
    .action(async (options: StartUpdateCommandOptions) => {
      if (!options.check) return;
      const report = await checkApplicationStartUpdate(io.cwd);
      if (options.json) {
        io.stdout(JSON.stringify(report, null, 2));
      } else {
        io.stdout(
          report.updateAvailable
            ? `Agentic Start ${report.availableVersion} has template changes (${report.paths.filter(({ state }) => state !== 'unchanged').length} paths; ${report.conflicts ? 'conflicts require review' : 'no conflicts'}).`
            : `Agentic Start ${report.installedVersion} is current; application-owned modifications are preserved.`,
        );
        for (const path of report.paths.filter(({ state }) => state !== 'unchanged')) {
          io.stdout(
            `${path.state.padEnd(20)} ${path.path}${path.securityRelevant ? ' [security]' : ''}${path.compatibilityChanging ? ' [compatibility]' : ''}`,
          );
        }
      }
    });

  const operator = program
    .command('operator')
    .description('Manage canonical application-operator authority for an exact provider-verified identity.');
  const identityOptions = (command: Command): Command => command
    .requiredOption('--issuer <issuer>', 'exact identity-provider issuer; email addresses are not accepted as identity')
    .requiredOption('--subject <subject>', 'exact provider-verified subject')
    .option('--identity-id <id>', 'provider-normalized identity id; deterministically derived when omitted')
    .option('--kind <kind>', 'identity kind: human, service, or external', 'human')
    .requiredOption('--reason <reason>', 'non-empty reason retained in the authority audit')
    .option('--out-dir <dir>', 'compiled deployment artifact directory', '.applik8s/deploy')
    .option('--json', 'print the machine-readable authority result');
  identityOptions(operator.command('bootstrap')
    .description('Perform the one-time role-level bootstrap; inert after any initial assignee.'))
    .action(async (options: OperatorIdentityCommandOptions) => {
      // static-import-exception: canonical authority and PostgreSQL load only for explicit operator administration.
      const { bootstrapApplicationOperator } = await import('./application-operator-authority-command.js');
      await bootstrapApplicationOperator(options, io);
    });
  identityOptions(operator.command('revoke')
    .description('Revoke every active canonical grant backing the role for one exact identity.'))
    .action(async (options: OperatorIdentityCommandOptions) => {
      // static-import-exception: canonical authority and PostgreSQL load only for explicit operator administration.
      const { revokeApplicationOperator } = await import('./application-operator-authority-command.js');
      await revokeApplicationOperator(options, io);
    });
  identityOptions(operator.command('break-glass')
    .description('Create a bounded, audited exceptional role grant without reopening bootstrap.'))
    .requiredOption('--incident <id>', 'stable incident or recovery identifier')
    .requiredOption('--expires-in <duration>', 'bounded duration up to 24h, for example 30m or 4h')
    .requiredOption('--acknowledge <text>', 'explicit acknowledgement of exceptional production authority')
    .action(async (options: OperatorBreakGlassCommandOptions) => {
      // static-import-exception: canonical authority and PostgreSQL load only for explicit operator administration.
      const { breakGlassApplicationOperator } = await import('./application-operator-authority-command.js');
      await breakGlassApplicationOperator(options, io);
    });

  program
    .command('doctor')
    .description('Check project, environment-name, and Kubernetes deployment prerequisites without applying effects.')
    .option('--context <context>', 'explicit kubeconfig context; defaults to APPLIK8S_CONTEXT or package configuration')
    .option('--out-dir <dir>', 'compiled deployment artifact directory', '.applik8s/deploy')
    .option('--json', 'print the machine-readable doctor report')
    .action(async (options: DoctorCommandOptions) => {
      // static-import-exception: keep Kubernetes diagnostics out of CLI startup until doctor is selected.
      const { runApplicationDoctor } = await import('./application-doctor-command.js');
      const code = await runApplicationDoctor(options, io);
      if (code !== 0) {
        throw new CommanderError(code, 'applik8s.doctor.failed', 'Doctor found blocking prerequisites.');
      }
    });

  program
    .command('dev')
    .description('Run the application graph locally with supervised processes and retained stateful providers.')
    .argument('[entrypoint]', 'application entrypoint module; defaults to package.json applik8s.entrypoint')
    .option('--target <target>', 'portable development target: local or aws-local', 'local')
    .option('--profile <profile>', 'application provider profile; defaults to the configured instance profile')
    .option('--out-dir <dir>', 'local compiler artifact directory', '.applik8s/local-build')
    .option('--composition-name <name>', 'application composition export name')
    .option('--status', 'read local supervisor state without starting the application')
    .option('--reset', 'remove stopped local processes, containers, credentials, and retained volumes')
    .option('--json', 'print machine-readable status')
    .option('--portal-port <port>', 'independent Builder portal loopback port', parseIntegerOption, 4388)
    .option('--no-portal', 'disable the independent Builder portal for this invocation')
    .option('--agent', 'enable the reviewed local OpenCode Builder preview')
    .option('--agent-port <port>', 'private OpenCode loopback port', parseIntegerOption, 4389)
    .option('--agent-executable <path>', 'OpenCode executable used by the local Builder', 'opencode')
    .option('--allow-docker-socket', 'grant aws-local MiniStack access to the host Docker socket for real database/compute data planes')
    .action(async (entrypoint: string | undefined, options: LocalDevelopmentCliOptions) => {
      if (options.target !== undefined && options.target !== 'local' && options.target !== 'aws-local') {
        throw new Error(`applik8s dev --target must be "local" or "aws-local", received ${JSON.stringify(options.target)}.`);
      }
      await loadApplicationEnvironmentFile(io.cwd);
      const configuration = await readApplicationProjectConfiguration(io.cwd);
      const resolvedEntrypoint = resolveApplicationEntrypoint(entrypoint, configuration);
      // static-import-exception: local supervision and Docker/process adapters load only for the selected dev command.
      const { runLocalDevelopmentCommand } = await import('./local-development-command.js');
      const code = await runLocalDevelopmentCommand(resolvedEntrypoint, options, io, { runBuild });
      if (code !== 0) throw new CommanderError(code, 'applik8s.dev.failed', 'Local development failed.');
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
    .description('Compile and preview one graph-native target plan without applying effects.')
    .argument('[entrypoint]', 'application entrypoint module; defaults to package.json applik8s.entrypoint')
    .option('--target <target>', 'deployment target: kubernetes or aws', 'kubernetes')
    .option('--environment <environment>', 'stable deployment environment identity')
    .option('--region <region>', 'AWS region; defaults to AWS_REGION')
    .option('--account-id <accountId>', '12-digit AWS account id; defaults to APPLIK8S_AWS_ACCOUNT_ID')
    .option('--availability-zone <zone>', 'explicit AWS availability zone (repeat at least twice)', collectOption, [])
    .option('--hosted-zone <suffix=zoneId>', 'Route53 hosted-zone binding for managed exposure (repeatable)', collectOption, [])
    .option('--format <format>', 'plan rendering: text, json, or graph', 'text')
    .option('--diff <path>', 'compare with a previous canonical plan artifact')
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
    .action(async (entrypoint: string | undefined, options: ApplicationPlanCliOptions) => {
      if (options.target === 'aws') {
        const configuration = await readApplicationProjectConfiguration(io.cwd);
        const resolvedEntrypoint = resolveApplicationEntrypoint(entrypoint, configuration);
        const environment = options.environment?.trim();
        const region = options.region?.trim() || process.env.AWS_REGION?.trim();
        const accountId = options.accountId?.trim() || process.env.APPLIK8S_AWS_ACCOUNT_ID?.trim();
        if (!environment) throw new Error('applik8s plan --target aws requires --environment.');
        if (!region) throw new Error('applik8s plan --target aws requires --region or AWS_REGION.');
        if (!accountId) throw new Error('applik8s plan --target aws requires --account-id or APPLIK8S_AWS_ACCOUNT_ID.');
        if (options.format !== 'text' && options.format !== 'json' && options.format !== 'graph') throw new Error(`Unknown AWS plan format ${JSON.stringify(options.format)}.`);
        await loadApplicationEnvironmentFile(io.cwd);
        const hostedZones = resolveAwsHostedZones(options.hostedZone, process.env.APPLIK8S_AWS_HOSTED_ZONES);
        // static-import-exception: target-selected AWS planning must not load Kubernetes deployment machinery.
        const { runApplicationTargetPlan } = await import('./application-target-plan-command.js');
        const code = await runApplicationTargetPlan(resolvedEntrypoint, {
          target: 'aws', environment, region, accountId,
          ...(options.availabilityZone?.length ? { availabilityZones: options.availabilityZone } : {}),
          ...(Object.keys(hostedZones).length > 0 ? { hostedZones } : {}),
          outDir: options.outDir ?? '.applik8s/plans',
          compositionName: options.compositionName ?? configuration.compositionName ?? 'app',
          ...(options.connectionBindings ? { connectionBindings: options.connectionBindings } : {}),
          ...(options.skipAppBuild ? { skipAppBuild: true } : {}),
          ...(options.skipImageBuild ? { skipImageBuild: true } : {}),
          format: options.format,
          ...(options.diff ? { diff: options.diff } : {}),
        }, io, { runChild, runBuild });
        if (code !== 0) throw new CommanderError(code, 'applik8s.plan.failed', 'Plan failed.');
        return;
      }
      if (options.target !== undefined && options.target !== 'kubernetes') throw new Error(`applik8s plan --target must be "kubernetes" or "aws", received ${JSON.stringify(options.target)}.`);
      if (options.format !== 'text' && options.format !== 'json' && options.format !== 'graph') throw new Error(`Unknown Kubernetes plan format ${JSON.stringify(options.format)}.`);
      const resolved = await resolveDeployCommand(entrypoint, options, io);
      const code = await runDeploy(resolved.entrypoint, {
        ...resolved.options,
        planOnly: true,
        planFormat: options.format,
        ...(options.diff ? { planDiff: options.diff } : {}),
      }, io);
      if (code !== 0) throw new CommanderError(code, 'applik8s.plan.failed', 'Plan failed.');
    });

  program
    .command('deploy')
    .description('Build, plan, and reconcile an Application through the target-selected Alchemy lifecycle.')
    .argument('[entrypoint]', 'application entrypoint module; defaults to package.json applik8s.entrypoint')
    .option('--target <target>', 'deployment target: kubernetes or aws', 'kubernetes')
    .option('--environment <environment>', 'stable deployment environment identity')
    .option('--region <region>', 'AWS region; defaults to AWS_REGION')
    .option('--account-id <accountId>', '12-digit AWS account id; defaults to APPLIK8S_AWS_ACCOUNT_ID')
    .option('--availability-zone <zone>', 'explicit AWS availability zone (repeat at least twice)', collectOption, [])
    .option('--hosted-zone <suffix=zoneId>', 'Route53 hosted-zone binding for managed exposure (repeatable)', collectOption, [])
    .option('--image-uri <uri>', 'immutable ApplicationHost image repository@sha256:... for AWS')
    .option('--endpoint <url>', 'explicit AWS-compatible endpoint; intended for qualified aws-local use')
    .option('--aws-profile <profile>', 'AWS credential profile')
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
      if (options.target === 'aws') {
        const configuration = await readApplicationProjectConfiguration(io.cwd);
        const resolvedEntrypoint = resolveApplicationEntrypoint(entrypoint, configuration);
        const aws = resolveAwsDeploymentOptions(options);
        await loadApplicationEnvironmentFile(io.cwd);
        const hostedZones = resolveAwsHostedZones(options.hostedZone, process.env.APPLIK8S_AWS_HOSTED_ZONES);
        // static-import-exception: selected AWS deployment must not initialize Kubernetes machinery.
        const { runApplicationAwsDeploy } = await import('./application-aws-command.js');
        const code = await runApplicationAwsDeploy(resolvedEntrypoint, {
          target: 'aws', ...aws,
          ...(options.availabilityZone?.length ? { availabilityZones: options.availabilityZone } : {}),
          ...(Object.keys(hostedZones).length > 0 ? { hostedZones } : {}),
          outDir: options.outDir ?? '.applik8s/plans',
          compositionName: options.compositionName ?? configuration.compositionName ?? 'app',
          ...(options.connectionBindings ? { connectionBindings: options.connectionBindings } : {}),
          ...(options.skipAppBuild ? { skipAppBuild: true } : {}),
          ...(options.imageUri ? { imageUri: options.imageUri } : {}),
          ...(options.endpoint ? { endpoint: options.endpoint } : {}),
          ...(options.awsProfile ? { awsProfile: options.awsProfile } : {}),
          ...(options.planOnly ? { planOnly: true } : {}),
        }, io, { runChild, runBuild });
        if (code !== 0) throw new CommanderError(code, 'applik8s.deploy.failed', 'AWS deploy failed.');
        return;
      }
      if (options.target !== undefined && options.target !== 'kubernetes') throw new Error(`applik8s deploy --target must be "kubernetes" or "aws", received ${JSON.stringify(options.target)}.`);
      const resolved = await resolveDeployCommand(entrypoint, options, io);
      const code = await runDeploy(resolved.entrypoint, resolved.options, io);
      if (code !== 0) throw new CommanderError(code, 'applik8s.deploy.failed', 'Deploy failed.');
    });

  program
    .command('status')
    .description('Observe authoritative target state through the persisted Alchemy lifecycle.')
    .argument('[entrypoint]', 'application entrypoint module; defaults to package.json applik8s.entrypoint')
    .option('--target <target>', 'deployment target: kubernetes or aws', 'kubernetes')
    .option('--environment <environment>', 'stable AWS deployment environment identity')
    .option('--endpoint <url>', 'explicit AWS-compatible endpoint')
    .option('--aws-profile <profile>', 'AWS credential profile')
    .option('--image-uri <uri>', 'immutable image identity used by the stored AWS deployment')
    .option('--context <context>', 'explicit kubeconfig context; defaults to APPLIK8S_CONTEXT or package configuration')
    .option('--out-dir <dir>', 'existing deployment artifact directory')
    .option('--composition-name <name>', 'TypeKro composition export name')
    .option('--instance-name <name>', 'instance name when selection is ambiguous')
    .option('--control-plane-namespace <namespace>', 'namespace containing the root Application instance')
    .option('--json', 'print the shared machine-readable status contract')
    .action(async (entrypoint: string | undefined, options: ApplicationStatusCliOptions) => {
      if (options.target === 'aws') {
        const environment = requireAwsEnvironment(options.environment);
        // static-import-exception: selected AWS status must not initialize Kubernetes machinery.
        const { runApplicationAwsStatus } = await import('./application-aws-command.js');
        const code = await runApplicationAwsStatus({ environment, outDir: options.outDir ?? '.applik8s/plans', ...(options.endpoint ? { endpoint: options.endpoint } : {}), ...(options.awsProfile ? { awsProfile: options.awsProfile } : {}), ...(options.imageUri ? { imageUri: options.imageUri } : {}), ...(options.json ? { json: true } : {}) }, io);
        if (code !== 0) throw new CommanderError(code, 'applik8s.status.absent', 'AWS application is absent.');
        return;
      }
      if (options.target !== undefined && options.target !== 'kubernetes') throw new Error(`applik8s status --target must be "kubernetes" or "aws", received ${JSON.stringify(options.target)}.`);
      const resolved = await resolveStatusCommand(entrypoint, options, io);
      const code = await runStatus(resolved.entrypoint, resolved.options, io);
      if (code !== 0) throw new CommanderError(code, 'applik8s.status.failed', 'Status failed.');
    });

  program
    .command('destroy')
    .description('Destroy the scoped Alchemy Stack through its target lifecycle authority.')
    .argument('[entrypoint]', 'application entrypoint module; defaults to package.json applik8s.entrypoint')
    .option('--target <target>', 'deployment target: kubernetes or aws', 'kubernetes')
    .option('--environment <environment>', 'stable AWS deployment environment identity')
    .option('--endpoint <url>', 'explicit AWS-compatible endpoint')
    .option('--aws-profile <profile>', 'AWS credential profile')
    .option('--image-uri <uri>', 'immutable image identity used by the stored AWS deployment')
    .option('--context <context>', 'explicit kubeconfig context; defaults to APPLIK8S_CONTEXT or package configuration')
    .option('--out-dir <dir>', 'existing deployment artifact directory')
    .option('--composition-name <name>', 'TypeKro composition export name')
    .option('--instance-name <name>', 'instance name when selection is ambiguous')
    .option('--control-plane-namespace <namespace>', 'namespace containing the root Application instance')
    .action(async (entrypoint: string | undefined, options: ApplicationDeleteCliOptions) => {
      if (options.target === 'aws') {
        const environment = requireAwsEnvironment(options.environment);
        // static-import-exception: selected AWS destruction must not initialize Kubernetes machinery.
        const { runApplicationAwsDestroy } = await import('./application-aws-command.js');
        const code = await runApplicationAwsDestroy({ environment, outDir: options.outDir ?? '.applik8s/plans', ...(options.endpoint ? { endpoint: options.endpoint } : {}), ...(options.awsProfile ? { awsProfile: options.awsProfile } : {}), ...(options.imageUri ? { imageUri: options.imageUri } : {}) }, io);
        if (code !== 0) throw new CommanderError(code, 'applik8s.destroy.failed', 'AWS destroy failed.');
        return;
      }
      if (options.target !== undefined && options.target !== 'kubernetes') throw new Error(`applik8s destroy --target must be "kubernetes" or "aws", received ${JSON.stringify(options.target)}.`);
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

function resolveAwsDeploymentOptions(options: ApplicationDeployCliOptions): {
  readonly environment: string;
  readonly region: string;
  readonly accountId: string;
} {
  const environment = requireAwsEnvironment(options.environment);
  const region = options.region?.trim() || process.env.AWS_REGION?.trim();
  const accountId = options.accountId?.trim() || process.env.APPLIK8S_AWS_ACCOUNT_ID?.trim();
  if (!region) throw new Error('applik8s deploy --target aws requires --region or AWS_REGION.');
  if (!accountId) throw new Error('applik8s deploy --target aws requires --account-id or APPLIK8S_AWS_ACCOUNT_ID.');
  return { environment, region, accountId };
}

function requireAwsEnvironment(value: string | undefined): string {
  const environment = value?.trim();
  if (!environment) throw new Error('AWS lifecycle commands require --environment.');
  return environment;
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
  // The installed executable starts under Node, while source/workspace
  // invocations can start under Bun and hand off to Node. Load the
  // application-root environment at the command boundary so both execution
  // paths give providers the same operation-host inputs. The handoff runner
  // also loads defensively before registering authored TypeScript; repeated
  // loading is idempotent because already-exported values remain authoritative.
  await loadApplicationEnvironmentFile(io.cwd);
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

function resolveAwsHostedZones(
  commandLine: readonly string[] | undefined,
  environmentJson: string | undefined,
): Readonly<Record<string, string>> {
  let environment: Readonly<Record<string, unknown>> = {};
  if (environmentJson?.trim()) {
    const parsed: unknown = JSON.parse(environmentJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('APPLIK8S_AWS_HOSTED_ZONES must be a JSON object mapping DNS suffixes to Route53 zone IDs.');
    }
    environment = parsed as Readonly<Record<string, unknown>>;
  }
  const entries: [string, string][] = Object.entries(environment).map(([suffix, zoneId]) => {
    if (typeof zoneId !== 'string') throw new Error(`APPLIK8S_AWS_HOSTED_ZONES value for ${suffix} must be a string.`);
    return [suffix, zoneId];
  });
  for (const binding of commandLine ?? []) {
    const separator = binding.indexOf('=');
    if (separator <= 0 || separator === binding.length - 1) throw new Error(`AWS hosted-zone binding ${JSON.stringify(binding)} must use <dns-suffix=zone-id>.`);
    entries.push([binding.slice(0, separator), binding.slice(separator + 1)]);
  }
  return Object.fromEntries(entries.map(([suffix, zoneId]) => {
    const normalizedSuffix = suffix.trim().toLowerCase().replace(/\.$/u, '');
    const normalizedZoneId = zoneId.trim();
    if (!normalizedSuffix || !/^Z[A-Z0-9]+$/u.test(normalizedZoneId)) throw new Error(`AWS hosted-zone binding ${JSON.stringify(`${suffix}=${zoneId}`)} is invalid.`);
    return [normalizedSuffix, normalizedZoneId];
  }));
}

function parseIntegerOption(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`Expected an integer option, received ${JSON.stringify(value)}.`);
  return parsed;
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
  resolveApplicationProjectRoot,
} from './application-build-package.js';
export {
  resolveGeneratedApplicationDeleteTarget,
  stageExplicitApplicationInstance,
} from './application-deployment-files.js';
export {
  applicationInstallationReadiness,
  applicationInstanceSpec,
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
