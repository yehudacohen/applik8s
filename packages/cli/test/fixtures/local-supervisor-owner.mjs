import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const [modulePath, planPath, stateRoot] = process.argv.slice(2);
if (!modulePath || !planPath || !stateRoot) throw new Error('Expected local-supervisor module, plan, and state paths.');
// static-import-exception: the fixture receives the built supervisor module path from its parent test.
const { startLocalSupervisor } = await import(pathToFileURL(modulePath).href);
const plan = JSON.parse(await readFile(planPath, 'utf8'));
const session = await startLocalSupervisor(plan, {
  cwd: process.cwd(),
  stdout() {},
  stderr(message) { process.stderr.write(`${message}\n`); },
}, { stateRoot });
process.stdout.write(`${JSON.stringify({ ready: true, state: session.state })}\n`);
await new Promise(() => {});
