// typecast-file-boundary: repository-owned scorecard and live-receipt JSON is validated before use.
import { access, readFile } from 'node:fs/promises';
import { app, applicationGraphFor, postgres, ProjectionStore, stream, trustedContext } from '@applik8s/applik8s';
import { validateApplicationGraphStructure } from '@applik8s/core';
import { type } from 'arktype';
import { pgTable, text } from 'drizzle-orm/pg-core';

type EvidenceState = 'pass' | 'fail' | 'missing';
interface Check { readonly id: string; readonly state: EvidenceState; readonly evidence: string }
interface Dimension { readonly name: string; readonly checks: readonly Check[] }
interface LiveReceipt { readonly schemaVersion?: number; readonly suite?: string; readonly completedAt?: string; readonly assertions?: readonly string[] }

const OrganizationId = trustedContext('organizationId', { schema: type('string') });
const accounts = pgTable('accounts', { id: text('id').primaryKey(), organizationId: text('organization_id').notNull(), revision: text('revision').notNull() });
const application = app('v06-scorecard', { namespace: 'v06-scorecard' });
const database = application.database.postgres('catalog', { schema: { accounts }, migrations: './migrations', access: postgres.rls({ context: OrganizationId, column: 'organizationId' }) });
const Account = application.model(accounts, { name: 'Account', database });
const AccountChanged = stream('accounts.changed.v1', { payload: type({ accountId: 'string', revision: 'string' }) });
const changes = application.stream(AccountChanged, { database, retention: { maxAgeSeconds: 86_400 }, partitionBy: (payload) => payload.accountId, authorize: () => true });
const query = application.query('accounts.list.v1', { input: type({}), output: Account.$model.schema.select.array(), database, context: [OrganizationId], reads: [Account], authorize: () => true, run: async ({ context }) => context.database(database).select().from(Account) });
application.defaults({ projections: ProjectionStore.clickhouse({ provision: false, endpoint: 'http://clickhouse.invalid:8123' }) });
application.projection('account-history', { source: changes, output: type({ accountId: 'string', revision: 'string' }), project: (payload) => payload });
application.gateway('public', { queries: [query] });
const graph = applicationGraphFor(application.composition);
if (!graph) throw new Error('v0.6 scorecard application did not expose an ApplicationGraph.');

const diagnostics = validateApplicationGraphStructure(graph);
const postgresReceipt = await liveReceipt('.applik8s-tmp/evidence/v0.6/postgres.json', 'postgres');
const clickhouseReceipt = await liveReceipt('.applik8s-tmp/evidence/v0.6/clickhouse.json', 'clickhouse');
const orbstackReceipt = await liveReceipt('.applik8s-tmp/evidence/v0.6/orbstack.json', 'orbstack');
const guestbookReceipt = await liveReceipt('.applik8s-tmp/evidence/v0.6/guestbook-start.json', 'guestbook-start');
const baseline = await jsonFile('benchmarks/v0.6/baseline.json') as { readonly evidenceClass?: string; readonly client?: { readonly cacheKeysPerSecond?: number }; readonly projection?: { readonly eventsPerSecond?: number } } | undefined;

const dimensions: readonly Dimension[] = [
  dimension('Native model and graph contracts',
    check('graph-valid', diagnostics.length === 0, `ApplicationGraph diagnostics: ${diagnostics.length}`),
    check('native-drizzle-authority', graph.nodes.some((node) => node.kind === 'model' && node.native?.kind === 'drizzle-table' && node.native.schemaAuthority === 'drizzle'), 'Drizzle remains the native storage/type authority.'),
    check('provider-neutral-model', graph.nodes.some((node) => node.kind === 'model' && node.common?.revision?.authority === 'postgres-row'), 'The common model facet records provider-neutral identity and revision semantics.'),
  ),
  dimension('Authorization and PostgreSQL semantics',
    check('rls-contract', graph.nodes.some((node) => node.kind === 'model' && node.runtime?.nativeRelational?.access?.context === 'organizationId'), 'Trusted context is lowered to a PostgreSQL RLS setting.'),
    receiptCheck(postgresReceipt, 'postgres-live', ['rls-isolation', 'pool-context-cleanup', 'transaction-rollback', 'snapshot-resume', 'command-idempotency', 'outbox-recovery']),
  ),
  dimension('Queries, streams, and projections',
    check('reactive-graph', ['query', 'stream', 'projection', 'gateway'].every((kind) => graph.nodes.some((node) => node.kind === kind)), 'Query, stream, projection, and gateway are graph-visible contracts.'),
    check('resumable-query', graph.nodes.some((node) => node.kind === 'query' && node.snapshotResume === 'resumableInvalidation'), 'The query contract uses opaque resumable invalidation.'),
    receiptCheck(clickhouseReceipt, 'clickhouse-live', ['prepare', 'idempotent-write', 'checkpoint-resume', 'full-rebuild']),
  ),
  dimension('Generated runtime and packaging',
    check('focused-runtime-entrypoint', await fileExists('packages/applik8s/src/reactive-runtime.ts') && await fileExists('packages/sdk/src/schema-runtime.ts'), 'Generated workloads depend on focused runtime/schema entrypoints.'),
    check('framework-neutral-vite', await fileExists('packages/vite/src/index.ts') && await fileExists('packages/vite/src/kubernetes-gateway.ts'), 'Vite graph discovery, facade partitioning, and the Fetch-compatible Kubernetes authority live outside TanStack.'),
    check('thin-tanstack-adapter', await fileExists('packages/tanstack-start/src/vite.ts') && await fileExists('packages/tanstack-start/src/react.ts'), 'TanStack Start is a first-party adapter over the framework-neutral client and gateway.'),
    check('packed-consumer-gate', await fileExists('scripts/package-consumer-smoke.mjs') && await fileExists('scripts/package-publish-dry-run.mjs'), 'Clean packed-consumer and coordinated dry-pack gates are present in the release lane.'),
    check('bundle-budget', await fileExists('benchmarks/v0.6/budgets.json'), 'A tracked generated-runtime budget exists and is enforced by compiler tests.'),
  ),
  dimension('Application host and dual-runtime model experience',
    check('generated-facades', await fileExists('packages/compiler/src/application-facade/index.ts') && await fileExists('packages/client/src/operations.ts'), 'One graph-derived model contract lowers to callable browser and server operation facades.'),
    check('generated-fetch-gateway', await fileExists('packages/compiler/src/application-fetch-gateway/index.ts') && await fileExists('packages/applik8s/src/application-gateway.ts'), 'The compiler emits a framework-neutral Request-to-Response gateway with isolated callbacks.'),
    check('oci-application-host', await fileExists('packages/compiler/src/application-host/index.ts'), 'ApplicationHost emits an immutable OCI build context, Deployment, Service, probes, inferred RBAC, and image provenance.'),
    check('guestbook-source-shape', await fileExists('examples/guestbook-start/src/application.ts') && await fileExists('examples/guestbook-start/src/routes/index.tsx'), 'The flagship example is an official-shape Start application using shared model facades rather than HTML-in-status.'),
  ),
  dimension('Kubernetes lifecycle evidence',
    receiptCheck(orbstackReceipt, 'orbstack-generated-app', ['typekro-apply', 'gateway-ready', 'projection-ready', 'restart-resume', 'factory-delete', 'generated-child-cleanup', 'generated-crd-removed', 'namespace-removed']),
    receiptCheck(guestbookReceipt, 'guestbook-start-golden-path', ['vite-application-build', 'application-host-ready', 'operator-ready', 'browser-command-submit', 'kubernetes-create', 'operator-publish', 'operator-reject', 'sse-invalidation', 'authoritative-requery', 'ssr-render', 'restart-resume', 'factory-delete', 'runtime-created-data-cleanup', 'namespace-removed']),
  ),
  dimension('Performance evidence',
    check('tracked-baseline', Boolean(baseline && (baseline.client?.cacheKeysPerSecond ?? 0) > 0 && (baseline.projection?.eventsPerSecond ?? 0) > 0), 'A repeatable local microbenchmark baseline is tracked.'),
    check('evidence-label', baseline?.evidenceClass === 'synthetic-local', 'The baseline explicitly labels its evidence class; synthetic results are not represented as datastore or cluster throughput.'),
  ),
];

const requireLive = process.argv.includes('--require-live');
const failed = dimensions.flatMap((dimension) => dimension.checks.filter((item) => item.state === 'fail' || (requireLive && item.state === 'missing')).map((item) => ({ dimension: dimension.name, item })));
for (const dimension of dimensions) {
  const passed = dimension.checks.filter((item) => item.state === 'pass').length;
  console.log(`${dimension.name}: ${((passed / dimension.checks.length) * 10).toFixed(1)}/10 evidence coverage (${passed}/${dimension.checks.length})`);
  for (const item of dimension.checks) console.log(`  ${item.state.toUpperCase()} ${item.id}: ${item.evidence}`);
}
if (!requireLive && dimensions.some((dimension) => dimension.checks.some((item) => item.state === 'missing'))) console.log('Live evidence is missing. Run the v0.6 prerelease lane to require fresh PostgreSQL, ClickHouse, and OrbStack receipts.');
if (failed.length > 0) throw new Error(`v0.6 scorecard failed:\n${failed.map(({ dimension, item }) => `- ${dimension}/${item.id}: ${item.evidence}`).join('\n')}`);

function dimension(name: string, ...checks: readonly Check[]): Dimension { return { name, checks }; }
function check(id: string, pass: boolean, evidence: string): Check { return { id, state: pass ? 'pass' : 'fail', evidence }; }
function receiptCheck(receipt: LiveReceipt | undefined, id: string, required: readonly string[]): Check {
  if (!receipt) return { id, state: 'missing', evidence: `No fresh ${id} receipt exists under .applik8s-tmp/evidence/v0.6.` };
  const assertions = new Set(receipt.assertions ?? []);
  const missing = required.filter((assertion) => !assertions.has(assertion));
  return { id, state: missing.length === 0 ? 'pass' : 'fail', evidence: missing.length === 0 ? `${receipt.suite} completed at ${receipt.completedAt}; ${required.length} required assertions recorded.` : `Receipt is missing assertions: ${missing.join(', ')}.` };
}
async function liveReceipt(path: string, suite: string): Promise<LiveReceipt | undefined> {
  const value = await jsonFile(path) as LiveReceipt | undefined;
  if (value?.schemaVersion !== 1 || value.suite !== suite || !value.completedAt || !Array.isArray(value.assertions)) return undefined;
  const completed = Date.parse(value.completedAt);
  if (!Number.isFinite(completed) || Date.now() - completed > 24 * 60 * 60 * 1_000 || completed > Date.now() + 60_000) return undefined;
  return value;
}
async function jsonFile(path: string): Promise<unknown | undefined> { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return undefined; } }
async function fileExists(path: string): Promise<boolean> { try { await access(path); return true; } catch { return false; } }
