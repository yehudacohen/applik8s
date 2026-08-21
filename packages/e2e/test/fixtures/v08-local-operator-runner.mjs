import { readFile } from 'node:fs/promises';
import { Applik8sLocalResourceStore } from '@applik8s/server/local-resource-authority';
import { startApplik8sLocalOperatorRuntime } from '@applik8s/server/local-operator-runtime';

const [artifactPath, statePath] = process.argv.slice(2);
if (!artifactPath || !statePath) throw new Error('Usage: v08-local-operator-runner.mjs <artifact.json> <state.json>');

const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
const store = new Applik8sLocalResourceStore(statePath);
await store.load();
const runtime = await startApplik8sLocalOperatorRuntime([artifact], store);

try {
  const address = {
    group: 'guestbook.applik8s.dev',
    version: 'v1alpha1',
    namespace: 'guestbook',
    plural: 'guestbookentries',
    name: 'first',
  };
  await store.create(address, {
    apiVersion: 'guestbook.applik8s.dev/v1alpha1',
    kind: 'GuestBookEntry',
    metadata: { name: 'first', namespace: 'guestbook' },
    spec: { guestbook: 'demo', author: 'codex', message: '  hello   from local target  ' },
  });
  const deadline = Date.now() + 10_000;
  for (;;) {
    const object = store.get(address);
    if (object.status?.phase === 'Published') {
      process.stdout.write(`${JSON.stringify(object.status)}\n`);
      break;
    }
    if (Date.now() >= deadline) throw new Error(`GuestBookEntry did not converge: ${JSON.stringify(object)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
} finally {
  runtime.close();
}
