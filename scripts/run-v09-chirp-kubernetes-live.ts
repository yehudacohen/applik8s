// typecast-file-boundary: this release harness invokes only checked-in CLI and
// test commands; subprocess exits are validated before evidence is recorded.
import { spawn } from 'node:child_process';

const root = process.cwd();
const context = process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack';
const namespace = process.env.APPLIK8S_CONTROL_PLANE_NAMESPACE ?? 'chirp-control';
const instance = process.env.APPLIK8S_CHIRP_INSTANCE ?? 'chirp';
let deploymentAttempted = false;
let primaryFailure: unknown;
let cleanupFailure: unknown;

try {
  await requireAbsentRootInstance();
  deploymentAttempted = true;
  await run(['run', 'deploy:v06:chirp-twice']);
  await run([
    'x',
    'vitest',
    'run',
    '--config',
    'vitest.e2e.config.ts',
    '--maxWorkers=1',
    'packages/e2e/test/chirp-start-live.e2e.test.ts',
  ], {
    APPLIK8S_E2E_CHIRP_LIVE: '1',
  });
} catch (cause) {
  primaryFailure = cause;
} finally {
  if (deploymentAttempted) {
    try {
      await destroyChirp();
    } catch (cause) {
      cleanupFailure = cause;
    }
  }
}

if (primaryFailure && cleanupFailure) {
  throw new AggregateError(
    [primaryFailure, cleanupFailure],
    'Chirp Kubernetes qualification and graph-backed cleanup both failed.',
  );
}
if (primaryFailure) throw primaryFailure;
if (cleanupFailure) throw cleanupFailure;

async function requireAbsentRootInstance(): Promise<void> {
  const definition = await run([
    '--context', context,
    'get', 'customresourcedefinition/chirpinstallations.applications.chirp.dev',
    '--ignore-not-found',
    '--output=name',
  ], {}, 'kubectl', true);
  if (!definition.stdout.trim()) return;

  const result = await run([
    '--context', context,
    'get', `chirpinstallations.applications.chirp.dev/${instance}`,
    '--namespace', namespace,
    '--ignore-not-found',
    '--output=name',
  ], {}, 'kubectl', true);
  if (result.stdout.trim()) {
    throw new Error(
      `V09_CHIRP_PREEXISTING_INSTANCE: ${namespace}/${instance} already exists. `
      + 'Destroy it through the originating Applik8s/Alchemy/TypeKro state before running this isolated release gate.',
    );
  }
}

async function destroyChirp(): Promise<void> {
  await run([
    'run',
    'packages/cli/src/bin.ts',
    'destroy',
    'examples/chirp-start/src/application.ts',
    '--context', context,
    '--out-dir', 'examples/chirp-start/.applik8s/deploy',
    '--composition-name', 'app',
    '--instance-name', instance,
    '--control-plane-namespace', namespace,
  ]);
}

async function run(
  args: readonly string[],
  environment: Readonly<Record<string, string>> = {},
  executable = 'bun',
  capture = false,
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    const output: string[] = [];
    const errors: string[] = [];
    const child = spawn(executable, [...args], {
      cwd: root,
      env: { ...process.env, APPLIK8S_E2E_CONTEXT: context, ...environment },
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    if (capture) {
      child.stdout?.on('data', chunk => output.push(String(chunk)));
      child.stderr?.on('data', chunk => errors.push(String(chunk)));
    }
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      const stdout = output.join('');
      const stderr = errors.join('');
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(
        `${executable} ${args.join(' ')} failed with ${signal ? `signal ${signal}` : `exit code ${String(code)}`}`
        + (capture && stderr ? `: ${stderr.trim()}` : ''),
      ));
    });
  });
}
