import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { gzipSync } from 'node:zlib';

const root = process.cwd();
const example = join(root, 'examples/guestbook-start');
await run('bun', ['run', 'build'], example);

const budgets = JSON.parse(await readFile(join(root, 'benchmarks/v0.6/budgets.json'), 'utf8'));
const publicAssets = join(example, '.output/public/assets');
const browserJavaScript = (await readdir(publicAssets)).filter((name) => name.endsWith('.js'));
const browserGzipBytes = (await Promise.all(browserJavaScript.map(async (name) => gzipSync(await readFile(join(publicAssets, name))).byteLength)))
  .reduce((total, bytes) => total + bytes, 0);
if (browserGzipBytes > budgets.guestbook.maximumBrowserJavaScriptGzipBytes) {
  throw new Error(`GuestBook browser JavaScript is ${browserGzipBytes} gzip bytes; budget is ${budgets.guestbook.maximumBrowserJavaScriptGzipBytes}.`);
}

const ssrDirectory = join(example, '.output/server/_ssr');
const ssrFiles = (await readdir(ssrDirectory)).filter((name) => name.endsWith('.mjs'));
for (const name of ssrFiles) {
  const source = await readFile(join(ssrDirectory, name), 'utf8');
  if (source.includes('jsxDEV')) {
    throw new Error(`GuestBook production SSR artifact ${name} contains jsxDEV and is incompatible with React's production JSX runtime.`);
  }
}

const port = await availablePort();
const server = spawn(process.execPath, [join(example, '.output/server/index.mjs')], {
  cwd: example,
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    APPLIK8S_NAMESPACE: 'guestbook-build-smoke',
    APPLIK8S_CURSOR_SECRET: 'local-guestbook-start-build-secret-at-least-32-bytes',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
// Subscribe before the health probe: a fast server failure can otherwise emit
// `exit` before teardown starts waiting and leave top-level await unsettled.
const serverExit = new Promise((resolve) => server.once('exit', resolve));
let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += String(chunk); });
server.stderr.on('data', (chunk) => { serverOutput += String(chunk); });
try {
  const response = await waitForHttp(`http://127.0.0.1:${port}/__applik8s/v1/healthz`);
  const body = await response.text();
  if (!response.ok || !body.includes('"live":true')) {
    throw new Error(`GuestBook production gateway health smoke returned ${response.status}: ${body}`);
  }
} finally {
  if (server.exitCode === null && server.signalCode === null) server.kill('SIGTERM');
  await serverExit;
}
console.log('GuestBook production Vite/Nitro SSR artifact passed.');

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForHttp(url) {
  const deadline = Date.now() + 10_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await fetch(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`GuestBook production server did not become reachable: ${lastError}\n${serverOutput}`);
}

async function run(command, args, cwd) {
  const child = spawn(command, args, { cwd, env: process.env, stdio: 'inherit' });
  const code = await new Promise((resolve) => child.once('exit', resolve));
  if (code !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${code}.`);
}
