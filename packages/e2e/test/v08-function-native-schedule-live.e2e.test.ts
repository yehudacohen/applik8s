// typecast-file-boundary: Live PostgreSQL and Kubernetes responses are narrowed after bounded identity checks.
import { type ChildProcess, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';
import type { ApplicationPrincipal } from '@applik8s/core';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
	type ApplicationRuntimeModelContract,
	applicationModelMigrationSql,
} from '../../applik8s/src/application-models.js';
import { applicationRequestContextValues } from '../../applik8s/src/command-principal.js';
import { emitGeneratedApplicationReactive } from '../../compiler/src/application-reactive/index.js';
import { discoverApplicationGraphWithExports } from '../../compiler/src/pipeline/index.js';
import {
	assertExpectedKubectlContext,
	describeLive,
	docker,
	formatSettledOutput,
	kubectl,
	sleep,
} from './live-e2e-helpers.js';

const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
const namespace = `applik8s-v08-callback-schedule-${suffix}`;
const applicationId = `callback-schedule-${suffix}`;
const databaseContainer = `applik8s-v08-callback-schedule-db-${suffix}`;
const databaseEnvironment = 'APPLIK8S_DATABASE_SCHEDULE_STATE_URL';
const definitionId = 'source.poll.v1';
const instanceId = 'source-a';
const principalId = 'principal:human:schedule-live';
const internalOperationSecret = `schedule-live-${suffix}-${'a'.repeat(48)}`;
let databaseUrl = '';
let tempDir: string | undefined;
const children = new Set<ManagedProcess>();

describeLive('v0.8 function-native schedule callback on OrbStack', () => {
	beforeAll(async () => {
		await assertExpectedKubectlContext();
		await kubectl(['create', 'namespace', namespace]);
		await docker([
			'run', '--detach', '--rm', '--name', databaseContainer,
			'--publish', '127.0.0.1::5432',
			'--env', 'POSTGRES_USER=applik8s',
			'--env', 'POSTGRES_PASSWORD=applik8s-test-only',
			'--env', 'POSTGRES_DB=schedules',
			'postgres:16-alpine',
		], process.cwd());
		const portOutput = (await docker(['port', databaseContainer, '5432/tcp'], process.cwd())).stdout;
		const match = /127\.0\.0\.1:(\d+)/u.exec(portOutput);
		if (!match?.[1]) throw new Error(`Docker did not publish PostgreSQL on loopback: ${portOutput}`);
		databaseUrl = `postgres://applik8s:applik8s-test-only@127.0.0.1:${match[1]}/schedules`;
		await waitForPostgres();
		await prepareDatabase();
		await run('bun', ['run', 'build:packages']);
	}, 180_000);

	afterAll(async () => {
		const cleanup = await Promise.allSettled([
			...[...children].map(stopProcess),
			docker(['rm', '--force', databaseContainer], process.cwd()),
			kubectl(['delete', 'namespace', namespace, '--wait=true', '--timeout=180s']),
			...(tempDir ? [rm(tempDir, { recursive: true, force: true })] : []),
		]);
		const failures = cleanup.filter((result) => result.status === 'rejected');
		if (failures.length > 0) {
			throw new Error(`Function-native schedule cleanup failed:\n${failures.map(formatSettledOutput).join('\n')}`);
		}
	}, 240_000);

	it('creates, updates, repairs, and removes a provider schedule from one canonical event callback', async () => {
		tempDir = await mkdtemp(join(process.cwd(), '.applik8s-schedule-callback-live-'));
		const entrypoint = join(tempDir, 'schedule-callback-live.ts');
		await writeFile(entrypoint, authoredApplicationSource());
		const discovered = await discoverApplicationGraphWithExports(entrypoint, 'scheduleProof');
		expect(discovered.ok, discovered.ok ? undefined : discovered.error.message).toBe(true);
		if (!discovered.ok) return;
		const artifacts = await emitGeneratedApplicationReactive({
			graph: discovered.value.graph,
			outDir: join(tempDir, 'generated'),
			entrypoint,
			executionTarget: 'kubernetes',
		});
		const control = artifacts.find((artifact) => artifact.kind === 'scheduleControlWorker');
		const processor = artifacts.find((artifact) => artifact.kind === 'streamProcessorWorker');
		if (!control || !processor) {
			throw new Error(`Expected schedule-control and stream-processor artifacts, received ${artifacts.map(({ kind }) => kind).join(', ')}.`);
		}
		const controlPort = await availablePort();
		const processorPort = await availablePort();
		let controlProcess = startProcess(control.sourcePath, {
			APPLIK8S_HTTP_PORT: String(controlPort),
			APPLIK8S_APPLICATION_NAME: applicationId,
			APPLIK8S_DEPLOYMENT_TARGET: 'kubernetes',
			APPLIK8S_ENVIRONMENT_ID: namespace,
			APPLIK8S_NAMESPACE: namespace,
			APPLIK8S_INTERNAL_OPERATION_SECRET: internalOperationSecret,
			APPLIK8S_SCHEDULE_DATABASE_URL: databaseUrl,
		});
		children.add(controlProcess);
		await waitForHttp(`http://127.0.0.1:${controlPort}/live`, controlProcess);
		await installScheduleControlRelay(control.name, controlPort);
		const processorProcess = startProcess(processor.sourcePath, {
			[databaseEnvironment]: databaseUrl,
			APPLIK8S_HEALTH_PORT: String(processorPort),
			APPLIK8S_PROCESSOR_CONCURRENCY: '1',
			APPLIK8S_PROCESSOR_MAX_ACK_PENDING: '16',
			APPLIK8S_SCHEDULE_MANAGEMENT_ENDPOINT: `http://127.0.0.1:${controlPort}/__applik8s/v1/internal/schedules/manage`,
			APPLIK8S_INTERNAL_OPERATION_SECRET: internalOperationSecret,
		});
		children.add(processorProcess);
		await waitForHttp(`http://127.0.0.1:${processorPort}/live`, processorProcess);

		await publishSourceBinding({ revision: '1', enabled: true, cadence: '1h' });
		const created = await waitForSingleCronJob({ revision: '1', schedule: '0 * * * *' }, [controlProcess, processorProcess]);
		expect(created.metadata.annotations?.['applik8s.dev/schedule-management-principal']).toBe(
			`principal:${applicationId}:execution:processor:streamProcessor.reconcile-source-polling:source-binding-1-${suffix}:1`,
		);
		await executeCronJobOccurrence(created, [controlProcess, processorProcess]);

		await publishSourceBinding({ revision: '2', enabled: true, cadence: '2h' });
		const updated = await waitForSingleCronJob({ revision: '2', schedule: '0 */2 * * *' }, [controlProcess, processorProcess]);
		expect(updated.metadata.uid).toBe(created.metadata.uid);

		await kubectl(['delete', `cronjob/${updated.metadata.name}`, '--namespace', namespace, '--wait=true', '--timeout=60s']);
		await stopProcess(controlProcess);
		children.delete(controlProcess);
		controlProcess = startProcess(control.sourcePath, {
			APPLIK8S_HTTP_PORT: String(controlPort),
			APPLIK8S_APPLICATION_NAME: applicationId,
			APPLIK8S_DEPLOYMENT_TARGET: 'kubernetes',
			APPLIK8S_ENVIRONMENT_ID: namespace,
			APPLIK8S_NAMESPACE: namespace,
			APPLIK8S_INTERNAL_OPERATION_SECRET: internalOperationSecret,
			APPLIK8S_SCHEDULE_DATABASE_URL: databaseUrl,
		});
		children.add(controlProcess);
		await waitForHttp(`http://127.0.0.1:${controlPort}/live`, controlProcess);
		const repaired = await waitForSingleCronJob({ revision: '2', schedule: '0 */2 * * *' }, [controlProcess, processorProcess]);
		expect(repaired.metadata.uid).not.toBe(updated.metadata.uid);

		await publishSourceBinding({ revision: '3', enabled: false, cadence: '2h' });
		await waitForNoCronJobs([controlProcess, processorProcess]);
	}, 240_000);
});

interface ManagedProcess {
	readonly child: ChildProcess;
	readonly output: () => string;
}

interface LiveCronJob {
	readonly metadata: {
		readonly name: string;
		readonly uid: string;
		readonly annotations?: Readonly<Record<string, string>>;
	};
	readonly spec?: { readonly schedule?: string };
}

async function installScheduleControlRelay(serviceName: string, targetPort: number): Promise<void> {
	if (!tempDir) throw new Error('Schedule callback temporary directory is unavailable.');
	const relayName = `${serviceName}-relay`;
	const relaySource = `import net from 'node:net';net.createServer((socket)=>{const upstream=net.connect(Number(process.env.TARGET_PORT),'host.docker.internal');socket.pipe(upstream);upstream.pipe(socket);const close=()=>{socket.destroy();upstream.destroy();};socket.on('error',close);upstream.on('error',close);}).listen(8080,'0.0.0.0');`;
	const manifest = {
		apiVersion: 'v1',
		kind: 'List',
		items: [
			{ apiVersion: 'v1', kind: 'ServiceAccount', metadata: { name: serviceName, namespace } },
			{
				apiVersion: 'v1', kind: 'Secret', metadata: { name: `${applicationId}-internal-operation`, namespace },
				type: 'Opaque', stringData: { key: internalOperationSecret },
			},
			{
				apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role', metadata: { name: serviceName, namespace },
				rules: [{ apiGroups: ['batch'], resources: ['jobs'], verbs: ['get'] }],
			},
			{
				apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'RoleBinding', metadata: { name: serviceName, namespace },
				subjects: [{ kind: 'ServiceAccount', name: serviceName, namespace }],
				roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: serviceName },
			},
			{
				apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: relayName, namespace },
				data: { 'relay.mjs': relaySource },
			},
			{
				apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: relayName, namespace },
				spec: {
					replicas: 1,
					selector: { matchLabels: { app: relayName } },
					template: {
						metadata: { labels: { app: relayName } },
							spec: { containers: [{
								name: 'relay', image: 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2',
								command: ['node', '/app/relay.mjs'], env: [{ name: 'TARGET_PORT', value: String(targetPort) }],
								ports: [{ name: 'http', containerPort: 8080 }],
								readinessProbe: { httpGet: { path: '/live', port: 'http' }, periodSeconds: 1, timeoutSeconds: 1 },
								volumeMounts: [{ name: 'source', mountPath: '/app', readOnly: true }],
						}], volumes: [{ name: 'source', configMap: { name: relayName } }] },
					},
				},
			},
			{
				apiVersion: 'v1', kind: 'Service', metadata: { name: serviceName, namespace },
				spec: { selector: { app: relayName }, ports: [{ name: 'http', port: 8080, targetPort: 'http' }] },
			},
		],
	};
	const path = join(tempDir, 'schedule-control-relay.json');
	await writeFile(path, JSON.stringify(manifest));
	await kubectl(['apply', '--filename', path]);
	await kubectl(['rollout', 'status', `deployment/${relayName}`, '--namespace', namespace, '--timeout=120s']);
	let lastError: unknown;
	for (let attempt = 0; attempt < 30; attempt += 1) {
		try {
			await kubectl([
				'exec', `deployment/${relayName}`, '--namespace', namespace, '--',
				'node', '--input-type=module', '--eval',
				`const response=await fetch('http://${serviceName}.${namespace}.svc:8080/live');if(!response.ok)process.exit(1);`,
			]);
			return;
		} catch (error) {
			lastError = error;
			await sleep(500);
		}
	}
	throw lastError;
}

async function executeCronJobOccurrence(
	cronJob: LiveCronJob,
	processes: readonly ManagedProcess[],
): Promise<void> {
	if (!tempDir) throw new Error('Schedule callback temporary directory is unavailable.');
	for (const process of processes) assertRunning(process);
	const jobName = `schedule-receipt-${suffix}`;
	const scheduledAt = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
	const rendered = JSON.parse((await kubectl([
		'create', 'job', jobName, `--from=cronjob/${cronJob.metadata.name}`,
		'--namespace', namespace, '--dry-run=client', '--output=json',
	])).stdout) as {
		metadata?: { annotations?: Record<string, string> };
	};
	rendered.metadata ??= {};
	rendered.metadata.annotations = {
		...rendered.metadata.annotations,
		'batch.kubernetes.io/cronjob-scheduled-timestamp': scheduledAt,
	};
	const path = join(tempDir, `${jobName}.json`);
	await writeFile(path, JSON.stringify(rendered));
	await kubectl(['create', '--filename', path]);
	try {
		await kubectl(['wait', `job/${jobName}`, '--namespace', namespace, '--for=condition=Complete', '--timeout=30s']);
	} catch (error) {
		const [description, podDescription, logs] = await Promise.allSettled([
			kubectl(['describe', `job/${jobName}`, '--namespace', namespace]),
			kubectl(['describe', 'pod', '--selector', `job-name=${jobName}`, '--namespace', namespace]),
			kubectl(['logs', `job/${jobName}`, '--namespace', namespace, '--all-containers=true', '--tail=200']),
		]);
		throw new Error([
			error instanceof Error ? error.message : String(error),
			`Job description:\n${formatSettledOutput(description)}`,
			`Pod description:\n${formatSettledOutput(podDescription)}`,
			`Job logs:\n${formatSettledOutput(logs)}`,
		].join('\n\n'));
	}
	const sql = postgres(databaseUrl, { max: 1, prepare: false });
	try {
		const rows = await sql.unsafe(
			`SELECT state, receipt
			 FROM applik8s_schedule_occurrences
			 WHERE definition_id = $1
			 ORDER BY updated_at DESC
			 LIMIT 1`,
			[definitionId],
		) as readonly { readonly state: string; readonly receipt: { readonly scheduledAt?: string } }[];
		expect(rows[0]).toMatchObject({ state: 'succeeded' });
		expect(rows[0]?.receipt.scheduledAt).toBe(scheduledAt);
	} finally {
		await sql.end({ timeout: 1 });
	}
}

function authoredApplicationSource(): string {
	return `
import { app, event, Scheduler, type } from '@applik8s/applik8s';

const platform = app(${JSON.stringify(applicationId)}, {
  namespace: ${JSON.stringify(namespace)},
  status: type({ ready: 'boolean?' }),
});
platform.provide(Scheduler, Scheduler.cronJob({ maximumDefinitions: 10 }));
const scheduleState = platform.database.postgres('schedule-state', {
  schema: {},
  provision: false,
  namespace: ${JSON.stringify(namespace)},
  connectionSecret: { apiVersion: 'v1', kind: 'Secret', name: 'schedule-state-app', namespace: ${JSON.stringify(namespace)} },
});
export const PollSource = Scheduler.schedule({
  id: ${JSON.stringify(definitionId)},
  input: type({ sourceBindingId: 'string' }),
  overlapBy: ({ sourceBindingId }) => sourceBindingId,
  requirements: { configuration: 'dynamic', cardinality: 'bounded', precision: 'minute' },
}, async ({ sourceBindingId }, context) => ({ sourceBindingId, occurrenceId: context.occurrenceId }));
const SourceBindingChanged = event('source-binding.changed.v1', {
  payload: type({ sourceBindingId: 'string', revision: 'string', enabled: 'boolean', cadence: 'string' }),
});
const sourceBindings = platform.stream(SourceBindingChanged, {
  database: scheduleState,
  retention: { maxAgeSeconds: 86400 },
  partitionBy: ({ sourceBindingId }) => sourceBindingId,
  authorize: () => false,
});
sourceBindings.onEvent(async function reconcileSourcePolling(binding) {
  if (binding.enabled) {
    await PollSource.schedule({
      id: binding.sourceBindingId,
      revision: binding.revision,
      every: binding.cadence,
      input: { sourceBindingId: binding.sourceBindingId },
    });
    return;
  }
  await PollSource.unschedule(binding.sourceBindingId);
});
export const scheduleProof = platform.composition;
`.trimStart();
}

async function prepareDatabase(): Promise<void> {
	const sql = postgres(databaseUrl, { max: 1, prepare: false });
	const model: ApplicationRuntimeModelContract = {
		name: 'ScheduleEvidence',
		tableName: `schedule_evidence_${suffix}`,
		provider: 'postgres',
		database: 'schedules',
		clusterName: 'schedule-live',
		secretName: 'schedule-state-app',
		secretKey: 'uri',
		connectionEnvName: databaseEnvironment,
		constraints: [],
		indexes: [],
		retention: { mode: 'retain' },
	};
	try {
		await sql.unsafe(applicationModelMigrationSql(model));
		await sql.unsafe(`CREATE TABLE IF NOT EXISTS applik8s_public_stream_retention_floors (
			contract_name text NOT NULL,
			contract_version text NOT NULL,
			context_digest text NOT NULL,
			deleted_through bigint NOT NULL CHECK (deleted_through >= 0),
			updated_at timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (contract_name, contract_version, context_digest)
		)`);
	} finally {
		await sql.end({ timeout: 1 });
	}
}

async function publishSourceBinding(input: { readonly revision: string; readonly enabled: boolean; readonly cadence: string }): Promise<void> {
	const sql = postgres(databaseUrl, { max: 1, prepare: false });
	const recordedAt = new Date().toISOString();
	const principal: ApplicationPrincipal = Object.freeze({
		id: principalId,
		identity: Object.freeze({
			id: 'identity:human:schedule-live',
			kind: 'human',
			issuer: 'https://identity.example.test',
			subject: 'schedule-live',
		}),
		kind: 'human',
		authenticationMethod: 'oidc',
		audience: [applicationId],
		trustedContextDigest: 'a'.repeat(64),
		catalogRevision: 'catalog-1',
		authorityRevision: 'authority-1',
		admittedAt: recordedAt,
	});
	const values = applicationRequestContextValues(principal, principal.authorityRevision, {});
	const contextDigest = createHash('sha256').update(JSON.stringify(values)).digest('hex');
	const payload = { sourceBindingId: instanceId, ...input };
	const id = `source-binding-${input.revision}-${suffix}`;
	try {
		await sql.unsafe(
			`INSERT INTO applik8s_public_stream_events
			 (id, contract_name, contract_version, partition_key, envelope, payload, context_digest, recorded_at)
			 VALUES ($1, 'source-binding.changed', 'v1', $2, $3::jsonb, $4::jsonb, $5, $6::timestamptz)`,
			[
				id,
				instanceId,
				sql.json({
					id,
					contract: { name: 'source-binding.changed', version: 'v1' },
					payload,
					partitionKey: instanceId,
					recordedAt,
					trustedContext: { values, digest: contextDigest },
				}),
				sql.json(payload),
				contextDigest,
				recordedAt,
			],
		);
	} finally {
		await sql.end({ timeout: 1 });
	}
}

function startProcess(sourcePath: string, environment: Readonly<Record<string, string>>): ManagedProcess {
	let output = '';
	const child = spawn(process.execPath, [sourcePath], {
		cwd: process.cwd(),
		env: { ...process.env, ...environment },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	child.stdout?.on('data', (chunk) => { output += String(chunk); });
	child.stderr?.on('data', (chunk) => { output += String(chunk); });
	return { child, output: () => output };
}

async function stopProcess(process: ManagedProcess): Promise<void> {
	if (process.child.exitCode !== null || process.child.signalCode !== null) return;
	process.child.kill('SIGTERM');
	const stopped = await Promise.race([
		new Promise<boolean>((resolve) => process.child.once('exit', () => resolve(true))),
		new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10_000)),
	]);
	if (stopped || process.child.exitCode !== null || process.child.signalCode !== null) return;
	process.child.kill('SIGKILL');
	await new Promise<void>((resolve) => process.child.once('exit', () => resolve()));
}

async function waitForHttp(url: string, process: ManagedProcess): Promise<void> {
	const deadline = Date.now() + 45_000;
	while (Date.now() < deadline) {
		assertRunning(process);
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
			if (response.ok) return;
		} catch {
			// The generated boundary is still starting.
		}
		await sleep(200);
	}
	throw new Error(`Timed out waiting for ${url}.\n${process.output()}`);
}

async function waitForSingleCronJob(
	expected: { readonly revision: string; readonly schedule: string },
	processes: readonly ManagedProcess[],
): Promise<LiveCronJob> {
	const deadline = Date.now() + 60_000;
	let last = '';
	while (Date.now() < deadline) {
		for (const process of processes) assertRunning(process);
		last = (await kubectl(['get', 'cronjob', '--namespace', namespace, '--output=json'])).stdout;
		const decoded = JSON.parse(last) as { readonly items?: readonly LiveCronJob[] };
		const items = decoded.items ?? [];
		if (items.length === 1
			&& items[0]?.metadata.annotations?.['applik8s.dev/schedule-revision'] === expected.revision
			&& items[0]?.spec?.schedule === expected.schedule) {
			return items[0];
		}
		await sleep(250);
	}
	const sql = postgres(databaseUrl, { max: 1, prepare: false });
	let databaseState: unknown = 'unavailable';
	try {
		databaseState = await sql.unsafe(
			`SELECT definition_id, instance_id, revision, state, projection_state, desired, management
			 FROM applik8s_schedule_instances
			 ORDER BY definition_id, instance_id`,
		);
	} catch (error) {
		databaseState = error instanceof Error ? error.message : String(error);
	} finally {
		await sql.end({ timeout: 1 }).catch(() => undefined);
	}
	throw new Error(`Timed out waiting for schedule ${expected.revision}: ${last}\nSchedule authority: ${JSON.stringify(databaseState, undefined, 2)}\n${processes.map(({ output }) => output()).join('\n')}`);
}

async function waitForNoCronJobs(processes: readonly ManagedProcess[]): Promise<void> {
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		for (const process of processes) assertRunning(process);
		const decoded = JSON.parse((await kubectl(['get', 'cronjob', '--namespace', namespace, '--output=json'])).stdout) as { readonly items?: readonly unknown[] };
		if ((decoded.items ?? []).length === 0) return;
		await sleep(250);
	}
	throw new Error('Timed out waiting for the callback to remove its provider schedule.');
}

function assertRunning(process: ManagedProcess): void {
	if (process.child.exitCode !== null || process.child.signalCode !== null) {
		throw new Error(`Generated process exited unexpectedly.\n${process.output()}`);
	}
}

async function availablePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createNetServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') {
				server.close(() => reject(new Error('Could not reserve a local port.')));
				return;
			}
			server.close((error) => error ? reject(error) : resolve(address.port));
		});
	});
}

async function waitForPostgres(): Promise<void> {
	const deadline = Date.now() + 30_000;
	let lastError = '';
	while (Date.now() < deadline) {
		const sql = postgres(databaseUrl, { max: 1, connect_timeout: 1, idle_timeout: 1 });
		try {
			await sql`SELECT 1`;
			await sql.end({ timeout: 1 });
			return;
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
			await sql.end({ timeout: 1 }).catch(() => undefined);
			await sleep(200);
		}
	}
	throw new Error(`Timed out waiting for PostgreSQL: ${lastError}`);
}

async function run(command: string, args: readonly string[]): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, [...args], { cwd: process.cwd(), stdio: 'inherit' });
		child.once('error', reject);
		child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}.`)));
	});
}
