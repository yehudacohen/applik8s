// typecast-file-boundary: Test fixtures intentionally construct heterogeneous provider nodes at the graph boundary.
import type { ApplicationGraph, ApplicationProviderNode, ApplicationScheduleNode } from '@applik8s/core'
import { describe, expect, it } from 'vitest'
import { applicationProviderGuaranteesForGraph, applicationScheduleProviderCompatibilityFindings, assertApplicationScheduleProviderCompatibility } from '../src/index.js'

describe('v0.8 provider guarantee manifests', () => {
  it.each([
    ['local', ['postgres', 'local-process', 'local-scheduler', 'local-otel', 'duckdb-dataset', 'duckdb-queries']],
    ['aws-local', ['rds-postgresql', 'ecs-fargate', 'eventbridge-scheduler', 'cloudwatch', 's3-dataset', 'athena-queries']],
    ['aws', ['rds-postgresql', 'ecs-fargate', 'eventbridge-scheduler', 'cloudwatch', 's3-dataset', 'athena-queries']],
    ['kubernetes', ['postgres', 'managed-application-host', 'kubernetes-cronjob-scheduler', 'clickstack']],
  ] as const)('resolves source providers to explicit %s guarantees without unsupported aliases', (target, implementations) => {
    const source = graph()
    const selected = target === 'kubernetes'
      ? { ...source, nodes: source.nodes.filter((node) => node.kind !== 'provider' || !['LakehouseDataset', 'LakehouseQuery'].includes(node.interface)) }
      : source
    const manifests = applicationProviderGuaranteesForGraph({ graph: selected, target })
    expect(manifests.map(({ capability }) => capability.implementation)).toEqual(expect.arrayContaining([...implementations]))
    expect(manifests.every(({ guarantees }) => guarantees.every(({ disposition }) => disposition !== 'unsupported'))).toBe(true)
    expect(manifests.every(({ provider, capability }) => provider.semanticKey.includes(capability.interface))).toBe(true)
    expect(manifests.every(({ guarantees }) => guarantees.some(({ id }) => id === 'runtime-access'))).toBe(true)
  })

  it('fails closed in the manifest for an unqualified implementation', () => {
    const base = graph()
    const unsupported = provider('Search', 'private-search-engine')
    const [manifest] = applicationProviderGuaranteesForGraph({ graph: { ...base, nodes: [unsupported] }, target: 'aws' })
    expect(manifest?.evidenceLevel).toBe('none')
    expect(manifest?.limitations).toEqual([expect.stringMatching(/no qualified aws lowering/u)])
    expect(manifest?.guarantees.every(({ disposition }) => disposition === 'unsupported')).toBe(true)
  })

  it.each(['aws', 'kubernetes'] as const)('records the complete qualified celld actor contract on %s', (target) => {
    const actorProvider = provider('ActorRuntime', 'celld-actors')
    const [manifest] = applicationProviderGuaranteesForGraph({
      graph: { ...graph(), nodes: [actorProvider] },
      target,
    })
    expect(manifest?.guarantees.filter(({ id }) => id.startsWith('actor-'))).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'actor-durableState', disposition: 'bounded' }),
      expect.objectContaining({ id: 'actor-serializedTurns', disposition: 'bounded' }),
      expect.objectContaining({ id: 'actor-transactionalOutbox', disposition: 'bounded' }),
      expect.objectContaining({ id: 'actor-durableAlarms', disposition: 'bounded' }),
      expect.objectContaining({ id: 'actor-realtimeConnections', disposition: 'bounded' }),
      expect.objectContaining({ id: 'actor-connectionLeases', disposition: 'bounded' }),
      expect.objectContaining({ id: 'actor-realtimeMessages', disposition: 'bounded' }),
      expect.objectContaining({ id: 'actor-realtimeBroadcast', disposition: 'bounded' }),
    ]))
  })

	it('rejects provider semantics that cannot preserve the authored schedule contract', () => {
		const source = graph()
		const scheduler = source.nodes.find((node): node is ApplicationProviderNode =>
			node.kind === 'provider' && node.interface === 'Scheduler')!
		const highCardinality = scheduleNode(scheduler.id, {
			cardinality: 'high', precision: 'second', misfires: 'all-bounded',
		})
		const incompatible = { ...source, nodes: [...source.nodes, highCardinality] }
		expect(applicationScheduleProviderCompatibilityFindings({ graph: incompatible, target: 'kubernetes' }))
			.toEqual(expect.arrayContaining([
				expect.objectContaining({ code: 'SCHEDULE_CARDINALITY_UNSUPPORTED' }),
				expect.objectContaining({ code: 'SCHEDULE_PRECISION_UNSUPPORTED' }),
				expect.objectContaining({ code: 'SCHEDULE_MISFIRE_UNSUPPORTED' }),
			]))
		expect(() => assertApplicationScheduleProviderCompatibility({ graph: incompatible, target: 'kubernetes' }))
			.toThrow(/SCHEDULE_CARDINALITY_UNSUPPORTED/u)
	})

	it('rejects Kubernetes skip windows below the controller scheduling floor', () => {
		const source = graph()
		const scheduler = source.nodes.find((node): node is ApplicationProviderNode =>
			node.kind === 'provider' && node.interface === 'Scheduler')!
		const schedule = {
			...scheduleNode(scheduler.id, { misfires: 'skip' }),
			definition: { ...scheduleNode(scheduler.id, { misfires: 'skip' }).definition, maximumLatenessSeconds: 9 },
		}
		expect(applicationScheduleProviderCompatibilityFindings({
			graph: { ...source, nodes: [...source.nodes, schedule] },
			target: 'kubernetes',
		})).toEqual(expect.arrayContaining([
			expect.objectContaining({ code: 'SCHEDULE_LATENESS_UNSUPPORTED' }),
		]))
	})

	it('records exact schedule guarantees for compatible target-selected providers', () => {
		const source = graph()
		const scheduler = source.nodes.find((node): node is ApplicationProviderNode =>
			node.kind === 'provider' && node.interface === 'Scheduler')!
		const compatible = { ...source, nodes: [...source.nodes, scheduleNode(scheduler.id)] }
		const manifests = applicationProviderGuaranteesForGraph({ graph: compatible, target: 'aws' })
		const scheduleManifest = manifests.find(({ capability }) => capability.interface === 'Scheduler')
		expect(scheduleManifest?.guarantees).toEqual(expect.arrayContaining([
			expect.objectContaining({ id: 'schedule-occurrence-identity', disposition: 'bounded' }),
			expect.objectContaining({ id: 'schedule-overlap', disposition: 'bounded' }),
			expect.objectContaining({ id: 'schedule-retry-dead-letter', disposition: 'bounded' }),
		]))
		expect(scheduleManifest?.limitations).not.toEqual(expect.arrayContaining([expect.stringMatching(/cannot preserve/u)]))
	})
})

function graph(): ApplicationGraph {
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1',
    kind: 'ApplicationGraph',
    metadata: { name: 'portable-proof' },
    nodes: [
      provider('TransactionalDatabase', 'postgres'),
      provider('ApplicationHost', 'managed-application-host'),
      provider('Scheduler', 'target-selected'),
      provider('Observability', 'clickstack'),
      provider('LakehouseDataset', 'duckdb-dataset'),
      provider('LakehouseQuery', 'duckdb-queries'),
    ],
    edges: [],
    providerRequirements: [],
    providerBindings: [],
    compatibility: { stablePublicApis: [], documentedInternalContracts: [], experimentalSurfaces: [], postV3Surfaces: [], labels: [] },
  }
}

function provider(providerInterface: string, implementation: string): ApplicationProviderNode {
  return {
    id: `provider.${providerInterface}`,
    kind: 'provider',
    name: providerInterface,
    stability: 'stable',
    interface: providerInterface,
    implementation,
  }
}

function scheduleNode(
	providerId: string,
	overrides: {
		readonly cardinality?: 'bounded' | 'high'
		readonly precision?: 'minute' | 'second'
		readonly misfires?: 'skip' | 'latest' | 'all-bounded'
	} = {},
): ApplicationScheduleNode {
	return {
		id: 'schedule.test.v1',
		kind: 'schedule',
		name: 'test.v1',
		stability: 'stable',
		definition: {
			id: 'test.v1',
			configuration: 'fixed',
			cron: '* * * * *',
			timezone: 'UTC',
			overlap: 'skip',
			misfires: overrides.misfires ?? 'latest',
			maximumLatenessSeconds: 300,
			...(overrides.misfires === 'all-bounded' ? { maximumCatchUp: 3 } : {}),
			retry: { maxAttempts: 4, maximumAgeSeconds: 3_600 },
			requirements: {
				configuration: 'fixed',
				cardinality: overrides.cardinality ?? 'bounded',
				precision: overrides.precision ?? 'minute',
			},
		},
		scheduler: { interface: 'Scheduler', nodeId: providerId },
		handler: { source: 'async () => undefined' },
		functionNative: true,
	}
}
