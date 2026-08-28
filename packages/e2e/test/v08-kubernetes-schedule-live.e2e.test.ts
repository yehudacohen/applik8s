// typecast-file-boundary: live Kubernetes JSON is narrowed after kind and metadata assertions.
import { randomUUID } from 'node:crypto';
import { Scheduler, type } from '@applik8s/applik8s';
import { createKubernetesApplicationScheduleRuntime } from '@applik8s/runtime-kubernetes';
import { executePostgresApplicationScheduleAdmission } from '@applik8s/runtime-postgres/schedule-occurrence';
import { createPostgresApplicationScheduleStateAuthority } from '@applik8s/runtime-postgres/schedule-state';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
	assertExpectedKubectlContext,
	describeLive,
	docker,
	formatSettledOutput,
	kubectl,
	sleep,
} from './live-e2e-helpers.js';

const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
const namespace = `applik8s-v08-schedule-${suffix}`;
const applicationId = `v08-schedule-${suffix}`;
const databaseContainer = `applik8s-v08-schedule-db-${suffix}`;
let databaseUrl = '';

describeLive('v0.8 Kubernetes Scheduler lifecycle on OrbStack', () => {
	beforeAll(async () => {
		await assertExpectedKubectlContext();
		await kubectl(['create', 'namespace', namespace]);
		await docker(
			[
				'run',
				'--detach',
				'--rm',
				'--name',
				databaseContainer,
				'--publish',
				'127.0.0.1::5432',
				'--env',
				'POSTGRES_USER=applik8s',
				'--env',
				'POSTGRES_PASSWORD=applik8s-test-only',
				'--env',
				'POSTGRES_DB=schedules',
				'postgres:16-alpine',
			],
			process.cwd(),
		);
		const portOutput = (
			await docker(['port', databaseContainer, '5432/tcp'], process.cwd())
		).stdout;
		const match = /127\.0\.0\.1:(\d+)/u.exec(portOutput);
		if (!match?.[1])
			throw new Error(
				`Docker did not publish PostgreSQL on loopback: ${portOutput}`,
			);
		databaseUrl = `postgres://applik8s:applik8s-test-only@127.0.0.1:${match[1]}/schedules`;
		await waitForPostgres(databaseUrl);
	});

	afterAll(async () => {
		const results = await Promise.allSettled([
			docker(['rm', '--force', databaseContainer], process.cwd()),
			kubectl([
				'delete',
				'namespace',
				namespace,
				'--wait=true',
				'--timeout=180s',
			]),
		]);
		const failures = results.filter((result) => result.status === 'rejected');
		if (failures.length > 0) {
			throw new Error(
				`Scheduler E2E cleanup failed:\n${failures.map(formatSettledOutput).join('\n')}`,
			);
		}
	}, 200_000);

	it('recovers PostgreSQL desired state, repairs drift, updates, and deletes one dynamic schedule identity', async () => {
		if (!databaseUrl)
			throw new Error('PostgreSQL fixture was not initialized.');
		const definition = {
			id: 'workspace-digest.v1',
			configuration: 'dynamic' as const,
			timezone: 'UTC',
			overlap: 'skip' as const,
			misfires: 'latest' as const,
			maximumLatenessSeconds: 300,
			retry: { maxAttempts: 3, maximumAgeSeconds: 1_800 },
			requirements: {
				configuration: 'dynamic' as const,
				cardinality: 'bounded' as const,
				precision: 'minute' as const,
			},
		};
		const firstInstance = {
			id: 'workspace-a',
			revision: 'revision-one',
			input: { workspaceId: 'workspace-a' },
			every: '1h',
			enabled: false,
		};
		const authority = createPostgresApplicationScheduleStateAuthority({
			databaseUrl,
			applicationId,
			environmentId: 'orbstack',
		});
		try {
			await expect(
				authority.reconcile({ definition, instance: firstInstance }),
			).resolves.toMatchObject({ state: 'created' });
			expect(await authority.pending()).toHaveLength(1);
		} finally {
			await authority.close();
		}

		const runtime = await createKubernetesApplicationScheduleRuntime({
			applicationId,
			environmentId: 'orbstack',
			namespace,
			admissionEndpoint: `http://${applicationId}.${namespace}.svc.cluster.local/__applik8s/v1/internal/schedules/occurrences`,
			authorizationSecretName: `${applicationId}-internal-operation`,
			databaseUrl,
			maximumInstances: 1,
		});
		try {
			const unchanged = await runtime.reconcile({
				definition,
				instance: firstInstance,
				handler: async () => undefined,
			});
			expect(unchanged.state).toBe('unchanged');

			const resources = JSON.parse(
				(
					await kubectl([
						'get',
						'cronjob',
						'--namespace',
						namespace,
						'--output=json',
					])
				).stdout,
			) as {
				readonly items?: readonly [
					{
						readonly metadata?: {
							readonly name?: string;
							readonly uid?: string;
						};
						readonly spec?: {
							readonly schedule?: string;
							readonly suspend?: boolean;
						};
					},
				];
			};
			const live = resources.items?.[0];
			expect(live?.spec).toMatchObject({
				schedule: '0 * * * *',
				suspend: true,
			});
			const name = live?.metadata?.name;
			const uid = live?.metadata?.uid;
			if (!name || !uid)
				throw new Error(
					'Kubernetes did not return the schedule CronJob identity.',
				);

			await kubectl([
				'patch',
				'cronjob',
				name,
				'--namespace',
				namespace,
				'--type=merge',
				'--patch',
				JSON.stringify({ spec: { schedule: '*/5 * * * *' } }),
			]);
			const repaired = await runtime.reconcile({
				definition,
				instance: firstInstance,
				handler: async () => undefined,
			});
			expect(repaired.state).toBe('updated');
			expect(
				JSON.parse(
					(
						await kubectl([
							'get',
							'cronjob',
							name,
							'--namespace',
							namespace,
							'--output=json',
						])
					).stdout,
				),
			).toMatchObject({
				metadata: { uid },
				spec: { schedule: '0 * * * *', suspend: true },
			});

			const updated = await runtime.reconcile({
				definition,
				instance: { ...firstInstance, revision: 'revision-two', every: '2h' },
				handler: async () => undefined,
			});
			expect(updated.state).toBe('updated');
			expect(
				JSON.parse(
					(
						await kubectl([
							'get',
							'cronjob',
							name,
							'--namespace',
							namespace,
							'--output=json',
						])
					).stdout,
				),
			).toMatchObject({
				metadata: {
					uid,
					annotations: { 'applik8s.dev/schedule-revision': 'revision-two' },
				},
				spec: { schedule: '0 */2 * * *', suspend: true },
			});
			await expect(runtime.reconcile({
				definition,
				instance: {
					...firstInstance,
					id: 'workspace-b',
					revision: 'revision-one',
					input: { workspaceId: 'workspace-b' },
				},
				handler: async () => undefined,
			})).rejects.toThrow(/instance ceiling 1 is exhausted/u);
			const capacityResources = JSON.parse((await kubectl([
				'get', 'cronjob', '--namespace', namespace, '--output=json',
			])).stdout) as { readonly items?: readonly { readonly metadata?: { readonly uid?: string } }[] };
			expect(capacityResources.items).toHaveLength(1);
			expect(capacityResources.items?.[0]?.metadata?.uid).toBe(uid);

			expect(
				(await runtime.remove(definition.id, firstInstance.id)).state,
			).toBe('removed');
			expect(
				(await runtime.remove(definition.id, firstInstance.id)).state,
			).toBe('unchanged');
			expect(
				(
					await kubectl([
						'get',
						'cronjob',
						name,
						'--namespace',
						namespace,
						'--ignore-not-found=true',
						'--output=name',
					])
				).stdout.trim(),
			).toBe('');
		} finally {
			await runtime.close();
		}
	}, 180_000);

	it('fences overlapping provider deliveries and returns the prior durable receipt after a lost response', async () => {
		if (!databaseUrl)
			throw new Error('PostgreSQL fixture was not initialized.');
		let effects = 0;
		let releaseFirst!: () => void;
		let announceFirst!: () => void;
		const firstStarted = new Promise<void>((resolve) => { announceFirst = resolve; });
		const firstMayFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
		const handle = Scheduler.named('hosted').schedule(
			{
				id: 'provider-occurrence.v1',
				input: type({ tenantId: 'string' }),
				overlapBy: ({ tenantId }) => tenantId,
				overlap: 'skip',
			},
			async ({ tenantId }) => {
				effects += 1;
				announceFirst();
				await firstMayFinish;
				return { tenantId, effect: effects };
			},
		);
		const firstScheduledAt = new Date(Date.now() - 60_000).toISOString();
		const secondScheduledAt = new Date().toISOString();
		const admission = (schedulerExecutionId: string, scheduledAt: string) => ({
			schemaVersion: 'applik8s.scheduleAdmission/v1alpha1' as const,
			applicationId,
			environmentId: 'orbstack',
			definitionId: handle.definition.id,
			instanceId: 'tenant-a',
			input: { tenantId: 'tenant-a' },
			scheduledAt,
			admittedAt: new Date().toISOString(),
			attempt: 1,
			schedulerExecutionId,
		});
		const firstAdmission = admission('provider-run-one', firstScheduledAt);
		const first = executePostgresApplicationScheduleAdmission({
			databaseUrl,
			handle,
			admission: firstAdmission,
		});
		await firstStarted;
		await expect(executePostgresApplicationScheduleAdmission({
			databaseUrl,
			handle,
			admission: admission('provider-run-two', secondScheduledAt),
		})).resolves.toMatchObject({ state: 'skipped', attempts: 0 });
		releaseFirst();
		const completed = await first;
		expect(completed).toMatchObject({
			state: 'succeeded',
			scheduledAt: firstScheduledAt,
			result: { effect: 1 },
		});
		await expect(executePostgresApplicationScheduleAdmission({
			databaseUrl,
			handle,
			admission: firstAdmission,
		})).resolves.toEqual(completed);
		expect(effects).toBe(1);
	}, 60_000);

	it('persists the final failed attempt as a terminal receipt across provider redelivery', async () => {
		if (!databaseUrl)
			throw new Error('PostgreSQL fixture was not initialized.');
		let effects = 0;
		const handle = Scheduler.named('hosted').schedule(
			{
				id: 'terminal-provider-failure.v1',
				input: type({}),
				retry: { maxAttempts: 2, maximumAge: '1h' },
			},
			async () => {
				effects += 1;
				throw new Error('intentional terminal failure');
			},
		);
		const scheduledAt = new Date(Date.now() - 60_000).toISOString();
		const admission = {
			schemaVersion: 'applik8s.scheduleAdmission/v1alpha1' as const,
			applicationId,
			environmentId: 'orbstack',
			definitionId: handle.definition.id,
			instanceId: 'fixed',
			input: {},
			scheduledAt,
			admittedAt: new Date().toISOString(),
			attempt: 2,
			schedulerExecutionId: 'provider-final-attempt',
		};
		const failed = await executePostgresApplicationScheduleAdmission({
			databaseUrl,
			handle,
			admission,
		});
		expect(failed).toMatchObject({
			state: 'failed',
			scheduledAt,
			attempts: 2,
			error: { message: 'intentional terminal failure' },
		});
		await expect(executePostgresApplicationScheduleAdmission({
			databaseUrl,
			handle,
			admission: { ...admission, schedulerExecutionId: 'provider-redelivery' },
		})).resolves.toEqual(failed);
		expect(effects).toBe(1);
	}, 60_000);
});

async function waitForPostgres(databaseUrl: string): Promise<void> {
	const deadline = Date.now() + 30_000;
	let lastError = '';
	while (Date.now() < deadline) {
		const sql = postgres(databaseUrl, {
			max: 1,
			connect_timeout: 1,
			idle_timeout: 1,
		});
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
	throw new Error(
		`Timed out waiting for the Docker PostgreSQL fixture: ${lastError}`,
	);
}
