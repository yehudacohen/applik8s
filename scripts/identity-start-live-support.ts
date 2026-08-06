// typecast-file-boundary: Kubernetes and Playwright JSON are validated at the
// release-evidence boundary before becoming typed values.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

export interface IdentityStartLiveContext {
  readonly root: string;
  readonly context: string;
  readonly label: string;
}

export interface CapturedProcess {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface IdentityStartServiceTunnel {
  readonly url: string;
  readonly close: () => Promise<void>;
}

export interface PassedBrowserTest {
  readonly completedAt: string;
}

export async function runIdentityStartCommand(
  execution: IdentityStartLiveContext,
  label: string,
  executable: string,
  arguments_: readonly string[],
  cwd: string,
  extraEnvironment: Readonly<Record<string, string>> = {},
): Promise<void> {
  console.log(`\n[${execution.label}] ${label}`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, arguments_, {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, ...extraEnvironment },
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${label} failed with ${signal ? `signal ${signal}` : `exit ${code}`}.`,
        ),
      );
    });
  });
}

export function captureIdentityStartCommand(
  executable: string,
  arguments_: readonly string[],
  cwd: string,
  environment: Readonly<Record<string, string>> = {},
): Promise<CapturedProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...environment },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

export async function identityStartResourceExists(
  execution: IdentityStartLiveContext,
  resource: string,
  namespace?: string,
): Promise<boolean> {
  const result = await captureIdentityStartCommand(
    'kubectl',
    [
      '--context',
      execution.context,
      'get',
      resource,
      ...(namespace ? ['--namespace', namespace] : []),
      '--output=name',
    ],
    execution.root,
  );
  if (result.code === 0) return true;
  if (
    /not found|NotFound|the server doesn't have a resource type|the server could not find the requested resource/iu
      .test(result.stderr)
  ) {
    return false;
  }
  throw new Error(
    `Failed to observe ${resource}: ${result.stderr || result.stdout}`,
  );
}

export async function waitForIdentityStartAbsent(
  execution: IdentityStartLiveContext,
  resource: string,
  namespace: string | undefined,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (!await identityStartResourceExists(execution, resource, namespace)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(
    `${resource}${namespace ? ` in ${namespace}` : ''} did not become absent within ${timeoutMs}ms.`,
  );
}

export async function identityStartKubectlJson(
  execution: IdentityStartLiveContext,
  arguments_: readonly string[],
): Promise<Record<string, unknown>> {
  const result = await captureIdentityStartCommand(
    'kubectl',
    ['--context', execution.context, ...arguments_],
    execution.root,
  );
  if (result.code !== 0) {
    throw new Error(`kubectl failed: ${result.stderr || result.stdout}`);
  }
  return jsonObject(JSON.parse(result.stdout), 'Kubernetes object');
}

export async function identityStartServiceUrl(
  execution: IdentityStartLiveContext,
  name: string,
  namespace: string,
  port: number,
): Promise<string> {
  const service = await identityStartKubectlJson(execution, [
    'get',
    `service/${name}`,
    '--namespace',
    namespace,
    '--output=json',
  ]);
  const clusterIp = nestedString(service, ['spec', 'clusterIP']);
  if (!clusterIp || clusterIp === 'None') {
    throw new Error(`Service ${namespace}/${name} has no routable ClusterIP.`);
  }
  const servicePorts = nestedArray(service, ['spec', 'ports'])
    .map((entry) => Number(entry.port))
    .filter((candidate) => Number.isInteger(candidate));
  if (!servicePorts.includes(port)) {
    throw new Error(
      `Service ${namespace}/${name} does not expose port ${port}; available ports: ${servicePorts.join(', ') || '<none>'}.`,
    );
  }
  return `http://${clusterIp}:${port}`;
}

/**
 * Exposes a cluster service through an explicitly loopback-bound kubectl
 * tunnel. Use this for security-sensitive provider adapters whose transport
 * contract intentionally rejects plaintext HTTP to arbitrary cluster IPs.
 */
export async function identityStartServiceTunnel(
  execution: IdentityStartLiveContext,
  name: string,
  namespace: string,
  port: number,
): Promise<IdentityStartServiceTunnel> {
  const child = spawn(
    'kubectl',
    [
      '--context',
      execution.context,
      'port-forward',
      `service/${name}`,
      '--namespace',
      namespace,
      '--address',
      '127.0.0.1',
      `:${port}`,
    ],
    {
      cwd: execution.root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    },
  );
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  let output = '';
  let settled = false;
  let closePromise: Promise<void> | undefined;
  const forwarded = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      finish(new Error(
        `Timed out establishing loopback tunnel to ${namespace}/${name}:${port}: ${output}`,
      ));
    }, 30_000);
    const onData = (chunk: string): void => {
      output += chunk;
      const match = /Forwarding from 127\.0\.0\.1:(\d+) -> \d+/u.exec(output);
      if (match?.[1]) finish(undefined, Number(match[1]));
    };
    const onError = (error: Error): void => finish(error);
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      finish(new Error(
        `kubectl port-forward for ${namespace}/${name}:${port} exited before readiness `
        + `(${signal ? `signal ${signal}` : `code ${code}`}): ${output}`,
      ));
    };
    const finish = (error?: Error, localPort?: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      child.off('error', onError);
      child.off('exit', onExit);
      if (error) {
        child.kill('SIGTERM');
        reject(error);
      } else {
        resolve(localPort!);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });

  return Object.freeze({
    url: `http://127.0.0.1:${forwarded}`,
    close: () => {
      if (closePromise) return closePromise;
      closePromise = new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
      });
      return closePromise;
    },
  });
}

export async function passedIdentityStartBrowserTests(
  path: string,
): Promise<Map<string, PassedBrowserTest>> {
  const report = jsonObject(
    JSON.parse(await readFile(path, 'utf8')),
    'Playwright report',
  );
  const output = new Map<string, PassedBrowserTest>();
  collectPassedBrowserTests(nestedArray(report, ['suites']), output);
  return output;
}

function collectPassedBrowserTests(
  suites: readonly Record<string, unknown>[],
  output: Map<string, PassedBrowserTest>,
): void {
  for (const suite of suites) {
    for (const spec of nestedArray(suite, ['specs'])) {
      const title = nestedString(spec, ['title']);
      const tests = nestedArray(spec, ['tests']);
      const results = tests.flatMap((test) => nestedArray(test, ['results']));
      if (
        !title
        || spec.ok !== true
        || results.length === 0
        || results.some((result) => nestedString(result, ['status']) !== 'passed')
      ) {
        continue;
      }
      const completed = results.map((result) => {
        const started = Date.parse(nestedString(result, ['startTime']) ?? '');
        const duration = Number(result.duration);
        if (!Number.isFinite(started) || !Number.isFinite(duration)) {
          throw new Error(`Playwright result ${title} has invalid timing.`);
        }
        return started + duration;
      });
      output.set(title, {
        completedAt: new Date(Math.max(...completed)).toISOString(),
      });
    }
    collectPassedBrowserTests(nestedArray(suite, ['suites']), output);
  }
}

export function jsonObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is not an object.`);
  }
  return value as Record<string, unknown>;
}

export function nestedArray(
  value: Record<string, unknown>,
  path: readonly string[],
): readonly Record<string, unknown>[] {
  const candidate = nestedValue(value, path);
  if (!Array.isArray(candidate)) return [];
  return candidate.map((entry, index) =>
    jsonObject(entry, `${path.join('.')}[${index}]`)
  );
}

export function nestedString(
  value: Record<string, unknown>,
  path: readonly string[],
): string | undefined {
  const candidate = nestedValue(value, path);
  return typeof candidate === 'string' ? candidate : undefined;
}

export function nestedValue(
  value: Record<string, unknown>,
  path: readonly string[],
): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = Reflect.get(current, segment);
  }
  return current;
}
