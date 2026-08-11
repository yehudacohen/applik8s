import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ApplicationDeploymentCommandIo } from './application-deployment-command.js';
import {
  readApplicationProjectConfiguration,
  resolveApplicationContext,
} from './application-project-config.js';
import { makeKubernetesApiClient } from './kubernetes-api-client.js';

export interface ApplicationDoctorOptions {
  readonly context?: string;
  readonly json?: boolean;
  readonly outDir?: string;
}

export interface ApplicationDoctorCheck {
  readonly id: string;
  readonly state: 'pass' | 'warning' | 'failure';
  readonly summary: string;
  readonly detail?: string;
}

export interface ApplicationDoctorReport {
  readonly apiVersion: 'applik8s.doctor/v1alpha1';
  readonly context?: string;
  readonly checks: readonly ApplicationDoctorCheck[];
  readonly summary: {
    readonly passed: number;
    readonly warnings: number;
    readonly failures: number;
  };
}

interface ApplicationDoctorDependencies {
  readonly environment?: NodeJS.ProcessEnv;
  readonly probeCluster?: (
    context: string,
  ) => Promise<readonly ApplicationDoctorCheck[]>;
}

/**
 * Runs read-only project, environment-name, and Kubernetes prerequisite checks.
 * It never reads an application `.env` file or prints environment values.
 */
export async function runApplicationDoctor(
  options: ApplicationDoctorOptions,
  io: ApplicationDeploymentCommandIo,
  dependencies: ApplicationDoctorDependencies = {},
): Promise<number> {
  const checks: ApplicationDoctorCheck[] = [];
  const environment = dependencies.environment ?? process.env;
  const configuration = await readApplicationProjectConfiguration(io.cwd);
  let context: string | undefined;
  try {
    context = resolveApplicationContext(options.context, configuration);
  } catch (cause) {
    checks.push({
      id: 'kubernetes.context',
      state: 'failure',
      summary: 'No explicit Kubernetes context is configured.',
      detail: cause instanceof Error ? cause.message : String(cause),
    });
  }

  checks.push(runtimeCheck());
  checks.push(...await projectChecks(io.cwd, configuration, environment));
  if (context) {
    checks.push(...await (dependencies.probeCluster ?? probeKubernetesCluster)(
      context,
    ));
  }

  const report = doctorReport(context, checks);
  if (options.json) {
    io.stdout(JSON.stringify(report));
  } else {
    for (const check of report.checks) {
      io.stdout(
        `${doctorStateLabel(check.state)} ${check.id}: ${check.summary}`,
      );
      if (check.detail) io.stdout(`  ${check.detail}`);
    }
    io.stdout(
      `Doctor: ${report.summary.passed} passed, ${report.summary.warnings} warning(s), ${report.summary.failures} failure(s).`,
    );
  }
  await recordDoctorEvidence(options, report, io);
  return report.summary.failures === 0 ? 0 : 1;
}

async function recordDoctorEvidence(
  options: ApplicationDoctorOptions,
  report: ApplicationDoctorReport,
  io: ApplicationDeploymentCommandIo,
): Promise<void> {
  const outDir = options.outDir ?? '.applik8s/deploy';
  const graphPath = resolve(
    io.cwd,
    join(outDir, 'typekro', 'application-deployment-graph.json'),
  );
  if (!await access(graphPath).then(() => true).catch(() => false)) return;
  const [{ readApplicationDeploymentGraph }, { recordApplicationDeploymentEvidence }]
    = await Promise.all([
      // static-import-exception: deployment evidence remains outside CLI/doctor startup until a compiled graph exists.
      import('./application-alchemy-deployment.js'),
      // static-import-exception: deployment evidence remains outside CLI/doctor startup until a compiled graph exists.
      import('./application-deployment-evidence.js'),
    ]);
  const graph = await readApplicationDeploymentGraph(graphPath);
  await recordApplicationDeploymentEvidence({
    graph,
    action: 'doctor',
    state:
      report.summary.failures > 0
        ? 'action-required'
        : report.summary.warnings > 0
          ? 'unknown'
          : 'ready',
    evidence: {
      passedCount: report.summary.passed,
      warningCount: report.summary.warnings,
      failureCount: report.summary.failures,
      clusterReachable: report.checks.some(
        (check) => check.id === 'kubernetes.reachable' && check.state === 'pass',
      ),
    },
    outDir,
    cwd: io.cwd,
    stdout: options.json ? io.stderr : io.stdout,
  });
}

function runtimeCheck(): ApplicationDoctorCheck {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
  return major >= 22
    ? {
        id: 'runtime.node',
        state: 'pass',
        summary: `Node ${process.versions.node} satisfies the supported Node 22+ compiler host.`,
      }
    : {
        id: 'runtime.node',
        state: 'failure',
        summary: `Node ${process.versions.node} is unsupported; install Node 22 or newer.`,
      };
}

async function projectChecks(
  cwd: string,
  configuration: Awaited<ReturnType<typeof readApplicationProjectConfiguration>>,
  environment: NodeJS.ProcessEnv,
): Promise<readonly ApplicationDoctorCheck[]> {
  const checks: ApplicationDoctorCheck[] = [];
  if (!configuration.entrypoint) {
    checks.push({
      id: 'project.entrypoint',
      state: 'failure',
      summary: 'package.json does not declare applik8s.entrypoint.',
    });
  } else {
    checks.push(await fileCheck(
      'project.entrypoint',
      resolve(cwd, configuration.entrypoint),
      'Application entrypoint',
    ));
  }
  if (!configuration.instance) {
    checks.push({
      id: 'project.instance',
      state: 'warning',
      summary: 'No default Application instance is configured.',
      detail: 'Pass --instance for plan/deploy or declare package.json applik8s.instance.',
    });
  } else {
    checks.push(await fileCheck(
      'project.instance',
      resolve(cwd, configuration.instance),
      'Application instance',
    ));
  }
  checks.push(await environmentNameCheck(cwd, environment));
  return checks;
}

async function fileCheck(
  id: string,
  path: string,
  label: string,
): Promise<ApplicationDoctorCheck> {
  const exists = await access(path).then(() => true).catch(() => false);
  return exists
    ? { id, state: 'pass', summary: `${label} exists at ${path}.` }
    : { id, state: 'failure', summary: `${label} is missing at ${path}.` };
}

async function environmentNameCheck(
  cwd: string,
  environment: NodeJS.ProcessEnv,
): Promise<ApplicationDoctorCheck> {
  const examplePath = resolve(cwd, '.env.example');
  let source: string;
  try {
    source = await readFile(examplePath, 'utf8');
  } catch {
    return {
      id: 'environment.names',
      state: 'warning',
      summary: 'No .env.example contract was found.',
      detail: 'Doctor never reads .env values; add .env.example to document operation-host names.',
    };
  }
  const names = [
    ...new Set(
      source
        .split(/\r?\n/u)
        .map((line) => line.match(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/u)?.[1])
        .filter((name): name is string => Boolean(name)),
    ),
  ].sort();
  const configured = names.filter((name) => Object.hasOwn(environment, name));
  return {
    id: 'environment.names',
    state: 'pass',
    summary: `${names.length} operation-host environment name(s) documented; ${configured.length} exported by the current process.`,
    detail:
      names.length === 0
        ? 'Starter requires no provider credentials.'
        : `Names only: ${names.join(', ')}. Values were not read or printed.`,
  };
}

async function probeKubernetesCluster(
  context: string,
): Promise<readonly ApplicationDoctorCheck[]> {
  // static-import-exception: Kubernetes clients load only when doctor reaches its explicit cluster probe.
  const kubernetes = await import('@kubernetes/client-node');
  const kubeConfig = new kubernetes.KubeConfig();
  kubeConfig.loadFromDefault();
  if (!kubeConfig.getContexts().some((candidate) => candidate.name === context)) {
    return [{
      id: 'kubernetes.context',
      state: 'failure',
      summary: `Kubeconfig context ${context} does not exist.`,
    }];
  }
  kubeConfig.setCurrentContext(context);
  const cluster = kubeConfig.getCurrentCluster();
  if (!cluster) {
    return [{
      id: 'kubernetes.context',
      state: 'failure',
      summary: `Kubeconfig context ${context} has no cluster.`,
    }];
  }
  try {
    const core = makeKubernetesApiClient(kubeConfig, kubernetes.CoreV1Api);
    await core.listNamespace({ limit: 1 });
  } catch (cause) {
    return [{
      id: 'kubernetes.reachable',
      state: 'failure',
      summary: `Kubernetes context ${context} is not reachable.`,
      detail: safeErrorMessage(cause),
    }];
  }
  const checks: ApplicationDoctorCheck[] = [
    {
      id: 'kubernetes.reachable',
      state: 'pass',
      summary: `Kubernetes context ${context} is reachable at ${cluster.server}.`,
    },
  ];
  const storage = makeKubernetesApiClient(
    kubeConfig,
    kubernetes.StorageV1Api,
  );
  try {
    const classes = await storage.listStorageClass();
    const defaultClass = classes.items.find((item) =>
      item.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class']
        === 'true'
      || item.metadata?.annotations?.[
        'storageclass.beta.kubernetes.io/is-default-class'
      ] === 'true'
    );
    checks.push(defaultClass
      ? {
          id: 'kubernetes.storage',
          state: 'pass',
          summary: `Default StorageClass ${defaultClass.metadata?.name ?? '<unnamed>'} is available.`,
        }
      : {
          id: 'kubernetes.storage',
          state: 'warning',
          summary: 'The cluster has no default StorageClass.',
          detail: 'Select storage explicitly or install a suitable provisioner before deploying persistent profiles.',
        });
  } catch (cause) {
    checks.push({
      id: 'kubernetes.storage',
      state: 'warning',
      summary: 'StorageClass prerequisites could not be inspected.',
      detail: safeErrorMessage(cause),
    });
  }
  checks.push(...await clusterDefinitionChecks(kubeConfig, kubernetes));
  return checks;
}

async function clusterDefinitionChecks(
  kubeConfig: import('@kubernetes/client-node').KubeConfig,
  kubernetes: typeof import('@kubernetes/client-node'),
): Promise<readonly ApplicationDoctorCheck[]> {
  const extensions = makeKubernetesApiClient(
    kubeConfig,
    kubernetes.ApiextensionsV1Api,
  );
  return Promise.all([
    definitionCheck(
      extensions,
      'resourcegraphdefinitions.kro.run',
      'kubernetes.typekro',
      'TypeKro ResourceGraphDefinition',
    ),
    definitionCheck(
      extensions,
      'helmreleases.helm.toolkit.fluxcd.io',
      'kubernetes.flux',
      'Flux HelmRelease',
    ),
  ]);
}

async function definitionCheck(
  extensions: import('@kubernetes/client-node').ApiextensionsV1Api,
  name: string,
  id: string,
  label: string,
): Promise<ApplicationDoctorCheck> {
  try {
    await extensions.readCustomResourceDefinition({ name });
    return { id, state: 'pass', summary: `${label} API is installed.` };
  } catch (cause) {
    return {
      id,
      state: 'warning',
      summary: `${label} API is not currently observable.`,
      detail: `${safeErrorMessage(cause)} The selected platform bootstrap may install it during deployment.`,
    };
  }
}

function doctorReport(
  context: string | undefined,
  checks: readonly ApplicationDoctorCheck[],
): ApplicationDoctorReport {
  return {
    apiVersion: 'applik8s.doctor/v1alpha1',
    ...(context ? { context } : {}),
    checks,
    summary: {
      passed: checks.filter((check) => check.state === 'pass').length,
      warnings: checks.filter((check) => check.state === 'warning').length,
      failures: checks.filter((check) => check.state === 'failure').length,
    },
  };
}

function doctorStateLabel(state: ApplicationDoctorCheck['state']): string {
  if (state === 'pass') return 'PASS';
  if (state === 'warning') return 'WARN';
  return 'FAIL';
}

function safeErrorMessage(cause: unknown): string {
  return cause instanceof Error
    ? cause.message.replaceAll(/\s+/gu, ' ').trim()
    : String(cause).replaceAll(/\s+/gu, ' ').trim();
}
