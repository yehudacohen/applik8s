import { spawn } from 'node:child_process';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { parseAllDocuments } from 'yaml';

const root = process.cwd();
const example = join(root, 'examples/identity-start');
const deploymentOutput = join(root, 'dist/examples/identity-start');
const budgets = JSON.parse(
  await readFile(join(root, 'benchmarks/v0.7/budgets.json'), 'utf8'),
).identityStart;

if (!budgets) {
  throw new Error('v0.7 budgets must define the identityStart production artifact ceilings.');
}

await run('bun', ['run', 'build:prepared'], example);
await rm(deploymentOutput, { recursive: true, force: true });
await run('bun', [
  'run',
  'applik8s',
  'build',
  'examples/identity-start/src/application.ts',
  '--typekro',
  '--composition-name',
  'application',
  '--out-dir',
  'dist/examples/identity-start',
], root);

const browserManifest = await json(
  join(example, '.applik8s/web-artifacts/browser.json'),
);
const serverManifest = await json(
  join(example, '.applik8s/web-artifacts/server.json'),
);
const generatedIdentitySources = await generatedSources(
  join(example, '.applik8s/generated'),
  'identity-',
);
const graph = await json(
  join(deploymentOutput, 'typekro/application-graph.json'),
);
const typeKroResources = parseAllDocuments(
  await readFile(join(deploymentOutput, 'typekro/resources.yaml'), 'utf8'),
).map((document) => document.toJSON());
const facade = await json(
  join(example, '.applik8s/application-facade.json'),
);
const identityViewSource = await readFile(
  join(example, 'src/features/access/view.tsx'),
  'utf8',
);
assert(
  browserManifest.target === 'browser'
    && browserManifest.output === '.output/public',
  'Identity Start browser artifact manifest must describe the final public output.',
);
assert(
  serverManifest.target === 'server'
    && serverManifest.output === '.output'
    && serverManifest.entrypoint === 'server/index.mjs',
  'Identity Start server artifact manifest must describe the final Nitro entrypoint.',
);

const publicAssets = join(example, '.output/public/assets');
const browserJavaScript = (await readdir(publicAssets))
  .filter((name) => name.endsWith('.js'));
const browserGzipBytes = (
  await Promise.all(
    browserJavaScript.map(async (name) =>
      gzipSync(await readFile(join(publicAssets, name)), { level: 9 }).byteLength),
  )
).reduce((total, bytes) => total + bytes, 0);
assert(
  browserGzipBytes <= budgets.maximumBrowserJavaScriptGzipBytes,
  `Identity Start browser JavaScript is ${browserGzipBytes} gzip bytes; budget is ${budgets.maximumBrowserJavaScriptGzipBytes}.`,
);

const browserSource = (
  await Promise.all(
    browserJavaScript.map((name) => readFile(join(publicAssets, name), 'utf8')),
  )
).join('\n');
for (const forbidden of [
  '@kubernetes/client-node',
  '@applik8s/operations/server',
  '@applik8s/identity/server',
  '@applik8s/deployment-typekro',
  'kubeconfig',
]) {
  assert(
    !browserSource.includes(forbidden),
    `Identity Start browser output contains server-only marker ${forbidden}.`,
  );
}

const serverFiles = await recursiveFiles(join(example, '.output/server'));
const serverOutputBytes = (
  await Promise.all(serverFiles.map(async (path) => (await stat(path)).size))
).reduce((total, bytes) => total + bytes, 0);
assert(
  serverOutputBytes <= budgets.maximumServerOutputBytes,
  `Identity Start server output is ${serverOutputBytes} bytes; budget is ${budgets.maximumServerOutputBytes}.`,
);

const serverSource = (
  await Promise.all(
    serverFiles
      .filter((path) => path.endsWith('.mjs') || path.endsWith('.js'))
      .map((path) => readFile(path, 'utf8')),
  )
).join('\n');
assert(
  !serverSource.includes('jsxDEV'),
  'Identity Start production SSR output contains the development JSX runtime.',
);
assert(
  generatedIdentitySources.some(
    ({ name, source }) =>
      name.startsWith('identity-starter-')
      && source.includes('@applik8s/start-agentic/identity-runtime')
      && source.includes('authenticateAgenticStarterRequest(request)'),
  ),
  'Identity Start Starter admission must use the maintained deterministic administrator and authoritative workspace-membership boundary.',
);
assert(
  facade.agents?.some(
    (agent) =>
      agent.name === 'access-advisor'
      && agent.exportNames?.includes('AccessAdvisor'),
  ),
  'Identity Start must publish AccessAdvisor as a browser-safe typed agent facade.',
);
assert(
  identityViewSource.includes(
    'createApplicationTanStackConnection({ agent: AccessAdvisor })',
  )
    && !identityViewSource.includes('forwardedProps:')
    && !identityViewSource.includes("agent: 'access-advisor'"),
  'Identity Start must select its agent through the shared typed application handle without a repeated string selector.',
);

assert(
  graph.nodes.length <= budgets.maximumApplicationGraphNodes,
  `Identity Start application graph contains ${graph.nodes.length} nodes; budget is ${budgets.maximumApplicationGraphNodes}.`,
);
for (const kind of [
  'aiAgent',
  'authorityManifest',
  'gateway',
  'mcpServer',
  'model',
  'objectStore',
  'processor',
  'provider',
  'query',
  'stream',
  'streamProcessor',
  'subscription',
  'task',
  'workflow',
]) {
  assert(
    graph.nodes.some((node) => node.kind === kind),
    `Identity Start application graph is missing ${kind}.`,
  );
}
const authorityManifest = graph.nodes.find(
  (node) => node.kind === 'authorityManifest',
)?.manifest;
const administrator = authorityManifest?.roles?.find(
  (role) => role.name === 'administrator',
);
const starterAdministrator = authorityManifest?.roles?.find(
  (role) => role.name === 'starter-administrator',
);
const applicationOperator = authorityManifest?.roles?.find(
  (role) => role.name === 'application-operator',
);
const bootstrap = authorityManifest?.roleBootstraps?.find(
  (candidate) => candidate.roleId === starterAdministrator?.id,
);
assert(
  administrator
    && starterAdministrator
    && bootstrap?.identity?.id === 'identity:deterministic:local-developer'
    && !authorityManifest.roleBootstraps.some(
      (candidate) => candidate.roleId === administrator.id,
    ),
  'Identity Start must keep provider-issued administrator authority separate from the exact Starter identity bootstrap.',
);
const operationsForRole = (role) => [
  ...new Set(
    authorityManifest.permissions
      .filter((permission) => role.permissionIds.includes(permission.id))
      .flatMap((permission) => permission.operationIds),
  ),
].sort();
assert(
  JSON.stringify(operationsForRole(administrator))
    === JSON.stringify(operationsForRole(starterAdministrator)),
  'Identity Start provider and Starter administrators must receive the same product-operation policy.',
);
const operationsSnapshotId =
  'applik8s://queries/Conversation/operations/operationsSnapshot';
assert(
  applicationOperator
    && operationsForRole(applicationOperator).includes(operationsSnapshotId)
    && !operationsForRole(administrator).includes(operationsSnapshotId)
    && !operationsForRole(starterAdministrator).includes(operationsSnapshotId),
  'Identity Start must keep application-operator visibility separate from product administration.',
);
assert(
  graph.nodes.some(
    (node) =>
      node.kind === 'aiAgent'
      && node.name === 'access-advisor',
  ),
  'Identity Start must compile the evidence-bearing AccessAdvisor agent.',
);
assert(
  graph.nodes.some(
    (node) =>
      node.kind === 'workflow'
      && node.name === 'access.review-request.v1',
  ),
  'Identity Start must compile the durable access-review workflow.',
);
assert(
  graph.nodes.some(
    (node) =>
      node.kind === 'stream'
      && node.signal?.id === 'access.review.v1',
  ),
  'Identity Start must compile the typed access-review signal stream.',
);
assert(
  graph.nodes.some(
    (node) =>
      node.kind === 'subscription'
      && node.name === 'access-review-requests',
  ),
  'Identity Start must compile the reviewer-authorized signal subscription.',
);
assert(
  graph.nodes.some(
    (node) =>
      node.kind === 'query'
      && node.name === 'Conversation.operationsSnapshot',
  ),
  'Identity Start must compile the maintained redacted operations query.',
);
assert(
  graph.nodes.some(
    (node) =>
      node.kind === 'mcpServer'
      && node.name === 'access',
  ),
  'Identity Start must compile the provider-neutral access MCP server.',
);
const applicationRgd = typeKroResources.find(
  (resource) =>
    resource?.apiVersion === 'kro.run/v1alpha1'
    && resource?.kind === 'ResourceGraphDefinition'
    && resource?.metadata?.name === 'identity-start',
);
const applicationRgdResources = applicationRgd?.spec?.resources ?? [];
const commandStream = applicationRgdResources.find(
  (resource) =>
    resource?.template?.kind === 'Stream'
    && resource?.template?.metadata?.labels?.[
      'app.kubernetes.io/component'
    ] === 'event-log',
);
const commandConsumer = applicationRgdResources.find(
  (resource) =>
    resource?.template?.kind === 'Consumer'
    && resource?.template?.metadata?.name === 'agentic-commands',
);
assert(
  Array.isArray(commandStream?.includeWhen)
    && commandStream.includeWhen.some((condition) =>
      String(condition).includes('schema.spec.profile')),
  'Identity Start must condition application Stream ownership on its selected EventLog provider profile.',
);
assert(
  commandConsumer
    && !Object.hasOwn(commandConsumer, 'includeWhen')
    && !Object.hasOwn(
      commandConsumer.template?.metadata?.annotations ?? {},
      'applik8s.dev/include-when',
    ),
  'Identity Start must always own its durable command Consumer, including when an External provider owns the broker and stream.',
);
const commandConsumerDependencies = Object.values(
  commandConsumer?.template?.metadata?.annotations ?? {},
);
assert(
  !commandConsumerDependencies.includes(
    `\${${commandStream?.id}.metadata.name}`,
  ),
  'Identity Start must not make its always-active Consumer depend on a profile-conditional managed Stream; KRO preserves that dependency when External mode omits the producer.',
);
const resourceGraphBytes = (
  await stat(join(deploymentOutput, 'typekro/resources.yaml'))
).size;
assert(
  resourceGraphBytes <= budgets.maximumResourceGraphBytes,
  `Identity Start TypeKro resources are ${resourceGraphBytes} bytes; budget is ${budgets.maximumResourceGraphBytes}.`,
);

console.log(JSON.stringify({
  identityStart: {
    browserGzipBytes,
    serverOutputBytes,
    applicationGraphNodes: graph.nodes.length,
    applicationGraphEdges: graph.edges.length,
    resourceGraphBytes,
    browserArtifactDigest: browserManifest.digest,
    serverArtifactDigest: serverManifest.digest,
  },
}, null, 2));

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function recursiveFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await recursiveFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function generatedSources(directory, prefix) {
  return Promise.all(
    (await readdir(directory))
      .filter((name) => name.startsWith(prefix) && name.endsWith('.generated.ts'))
      .map(async (name) => ({
        name,
        source: await readFile(join(directory, name), 'utf8'),
      })),
  );
}

async function run(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
  });
  const code = await new Promise((resolve) => child.once('exit', resolve));
  if (code !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${code}.`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
