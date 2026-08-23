// typecast-file-boundary: Canonical JSON records are identity- and schema-validated before provider-neutral schedule contracts are rehydrated.
import type { JsonObject } from '@applik8s/core';
import {
	canonicalJsonCompatibleV1Policy,
	canonicalJsonV1String,
} from '@applik8s/core';
import { sha256Hex } from '@applik8s/deployment-contract';
import type {
	ApplicationScheduleDefinitionContract,
	ApplicationScheduleInstance,
	ApplicationScheduleProjectedDesiredState,
	ApplicationScheduleStateRecord,
} from './application-schedule.js';

export type {
	ApplicationScheduleConvergenceResult,
	ApplicationScheduleDefinitionContract,
	ApplicationScheduleInstance,
	ApplicationScheduleManagementReceipt,
	ApplicationScheduleProjectedDesiredState,
	ApplicationScheduleStateAuthority,
	ApplicationScheduleStateRecord,
} from './application-schedule.js';

/** Portable provider-independent record for one desired schedule instance. */
export function applicationScheduleDesiredStateRecord<TInput extends object>(
	definition: ApplicationScheduleDefinitionContract<TInput>,
	instance: ApplicationScheduleInstance<TInput>,
): JsonObject {
	const overlapKey = definition.overlapBy
		? nonEmptyString(
				String(definition.overlapBy(instance.input)),
				`${definition.id} overlap key`,
			)
		: instance.id;
	if (overlapKey.length > 512) {
		throw new Error(
			`Schedule ${definition.id} overlap key exceeds the portable 512-character limit.`,
		);
	}
	return {
		schemaVersion: 'applik8s.scheduleDesiredState/v1alpha1',
		overlapKey,
		definition: {
			id: definition.id,
			configuration: definition.configuration,
			...(definition.cron ? { cron: definition.cron } : {}),
			...(definition.every ? { every: definition.every } : {}),
			...(definition.at ? { at: definition.at } : {}),
			timezone: definition.timezone,
			overlap: definition.overlap,
			misfires: definition.misfires,
			maximumLatenessSeconds: definition.maximumLatenessSeconds,
			...(definition.maximumCatchUp !== undefined
				? { maximumCatchUp: definition.maximumCatchUp }
				: {}),
			retry: definition.retry,
			requirements: definition.requirements,
		},
		instance: instance as unknown as JsonObject,
	};
}

/**
 * Rehydrates the provider projection subset from canonical desired state. It
 * deliberately does not reconstruct authoring schemas or callback functions.
 */
export function applicationScheduleProjectedDesiredState(
	record: ApplicationScheduleStateRecord,
): ApplicationScheduleProjectedDesiredState {
	if (record.state !== 'active' || !record.desired) {
		throw new Error(
			`Schedule ${record.definitionId}:${record.instanceId} has no active desired state to project.`,
		);
	}
	if (stableDigest(record.desired) !== record.digest) {
		throw new Error(
			`Schedule ${record.definitionId}:${record.instanceId} desired-state digest is invalid.`,
		);
	}
	if (
		record.desired.schemaVersion !==
		'applik8s.scheduleDesiredState/v1alpha1'
	) {
		throw new Error(
			`Schedule ${record.definitionId}:${record.instanceId} has an unsupported desired-state schema.`,
		);
	}
	const definition = jsonObjectValue(
		record.desired.definition,
		'schedule definition',
	);
	const instance = jsonObjectValue(
		record.desired.instance,
		'schedule instance',
	);
	if (
		definition.id !== record.definitionId ||
		instance.id !== record.instanceId ||
		instance.revision !== record.revision
	) {
		throw new Error(
			`Schedule ${record.definitionId}:${record.instanceId} desired-state identity does not match its authority row.`,
		);
	}
	const overlapKey = nonEmptyString(
		String(record.desired.overlapKey ?? ''),
		`${record.definitionId} overlap key`,
	);
	return Object.freeze({
		definition:
			definition as unknown as ApplicationScheduleDefinitionContract<object>,
		instance: instance as unknown as ApplicationScheduleInstance<object>,
		overlapKey,
		...(record.management ? { management: record.management } : {}),
	});
}

/** Stable provider-independent digest for one desired schedule instance. */
export function applicationScheduleDesiredStateDigest<TInput extends object>(
	definition: ApplicationScheduleDefinitionContract<TInput>,
	instance: ApplicationScheduleInstance<TInput>,
): string {
	return stableDigest(
		applicationScheduleDesiredStateRecord(definition, instance),
	);
}

function jsonObjectValue(value: unknown, label: string): JsonObject {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} must be a JSON object.`);
	}
	return value as JsonObject;
}

function nonEmptyString(value: string, label: string): string {
	if (!value.trim()) throw new Error(`${label} must be a non-empty string.`);
	return value;
}

function stableDigest(value: unknown): string {
	return sha256Hex(
		canonicalJsonV1String(value, canonicalJsonCompatibleV1Policy),
	);
}
