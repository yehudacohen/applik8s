// typecast-file-boundary: This qualification harness validates child-process
// JSON and network observations before comparing them with acceptance evidence.
import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { promisify } from 'node:util';

const run = promisify(execFile);
const image = 'ministackorg/ministack:1.4.20-full@sha256:42bd7575bb0be3710e5196a32b6adeb9c96b049e6cf6114c8ae8de90fc8e3e89';
const container = `applik8s-v09-chirp-${process.pid}`;
let started = false;

try {
  const port = await availableLoopbackPort();
  await run('docker', [
    'run', '-d', '--rm', '--name', container,
    '-p', `127.0.0.1:${port}:4566`,
    '-e', 'AWS_DEFAULT_REGION=us-east-1',
    image,
  ], { encoding: 'utf8' });
  started = true;
  const endpoint = `http://127.0.0.1:${port}`;
  await waitForMiniStack(endpoint);
  const child = Bun.spawn([
    'bunx', 'vitest', 'run', '--config', 'vitest.e2e.config.ts', '--maxWorkers=1',
    'packages/e2e/test/v09-chirp-aws-live.e2e.test.ts',
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APPLIK8S_E2E_AWS_LOCAL: '1',
      APPLIK8S_AWS_LOCAL_ENDPOINT: endpoint,
    },
    stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) process.exitCode = exitCode;
} finally {
  if (started) await run('docker', ['stop', container], { encoding: 'utf8' }).catch(() => undefined);
}

async function availableLoopbackPort(): Promise<number> {
  return await new Promise<number>((resolvePort, rejectPort) => {
    const server = createServer();
    server.once('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        rejectPort(new Error('Could not reserve a loopback port for MiniStack.'));
        return;
      }
      server.close((cause) => cause ? rejectPort(cause) : resolvePort(address.port));
    });
  });
}

async function waitForMiniStack(endpoint: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/_ministack/health`);
      const health: unknown = await response.json();
      if (response.ok && Reflect.get(health as object, 'version') === '1.4.20') return;
    } catch {
      // MiniStack is not accepting loopback connections yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error('Pinned MiniStack did not become healthy within 60 seconds.');
}
