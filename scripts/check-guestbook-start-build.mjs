import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const example = join(root, 'examples/guestbook-start');
await run('bun', ['run', 'build'], example);

const ssrDirectory = join(example, '.output/server/_ssr');
const ssrFiles = (await readdir(ssrDirectory)).filter((name) => name.endsWith('.mjs'));
for (const name of ssrFiles) {
  const source = await readFile(join(ssrDirectory, name), 'utf8');
  if (source.includes('jsxDEV')) {
    throw new Error(`GuestBook production SSR artifact ${name} contains jsxDEV and is incompatible with React's production JSX runtime.`);
  }
}

process.env.APPLIK8S_CURSOR_SECRET = 'local-guestbook-start-build-secret-at-least-32-bytes';
const ssrEntrypoint = pathToFileURL(join(example, 'node_modules/.nitro/vite/services/ssr/index.js')).href;
// static-import-exception: the build-generated SSR entrypoint does not exist until the preceding Vite build completes.
const ssr = await import(`${ssrEntrypoint}?smoke=${Date.now()}`);
const response = await ssr.default.fetch(new Request('http://guestbook.test/healthz'));
const html = await response.text();
if (!response.ok || !html.includes('ok')) {
  throw new Error(`GuestBook production SSR smoke returned ${response.status}: ${html}`);
}
console.log('GuestBook production Vite/Nitro SSR artifact passed.');

async function run(command, args, cwd) {
  const child = spawn(command, args, { cwd, env: process.env, stdio: 'inherit' });
  const code = await new Promise((resolve) => child.once('exit', resolve));
  if (code !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${code}.`);
}
