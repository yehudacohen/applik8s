/** Focused provider-safe schedule identity and admission surface. */

import type {
  ApplicationAdmissionInvocationContextV1,
  ApplicationRequestAdmission,
} from '@applik8s/core';
import {
  applicationAdmissionInvocationView,
  canonicalJsonCompatibleV1Policy,
  canonicalJsonV1String,
  createApplicationAdmissionContextV1,
  validateApplicationAdmissionContextV1WithoutReceipt,
  withApplicationAdmissionExecutionV1,
  withApplicationAdmissionTraceV1,
} from '@applik8s/core';
import { sha256Hex } from '@applik8s/deployment-contract';

export type { ApplicationHatchetSchedulerProvider } from './application-providers.js';
export type {
  ApplicationScheduleAdmission,
  ApplicationScheduleAdmissionRunner,
  ApplicationScheduleConvergenceResult,
  ApplicationScheduleDefinitionContract,
  ApplicationScheduleHandle,
  ApplicationScheduleHandler,
  ApplicationScheduleInstance,
  ApplicationScheduleManagementReceipt,
  ApplicationScheduleOccurrenceReceipt,
  ApplicationScheduleRuntime,
  ApplicationScheduleStateAuthority,
} from './application-schedule.js';
export type {
  ApplicationScheduleProjectedDesiredState,
} from './application-schedule-state-runtime.js';
export {
  applicationScheduleProjectedDesiredState,
} from './application-schedule-state-runtime.js';

/**
 * Constructs the canonical, bounded service admission for one verified
 * provider delivery. The configuring user's authority is never replayed.
 */
export function applicationScheduleInvocationAdmission(options: {
  readonly applicationId: string;
  readonly environmentId: string;
  readonly definitionId: string;
  readonly instanceId: string;
  readonly occurrenceId: string;
  readonly admittedAt: string;
  readonly maximumAgeSeconds: number;
  readonly trigger: 'schedule' | 'immediate';
}): ApplicationAdmissionInvocationContextV1 {
  const admittedAt = new Date(options.admittedAt);
  if (!Number.isFinite(admittedAt.getTime())) throw new Error('Schedule admission time is invalid.');
  if (!Number.isSafeInteger(options.maximumAgeSeconds) || options.maximumAgeSeconds < 1) {
    throw new Error('Schedule admission maximum age must be a positive safe integer.');
  }
  const operationId = `applik8s://schedules/${encodeURIComponent(options.definitionId)}/instances/${encodeURIComponent(options.instanceId)}/operations/invoke`;
  const trustedContext = Object.freeze({});
  const trustedContextDigest = `sha256:${scheduleStableDigest(trustedContext)}`;
  const deadline = new Date(admittedAt.getTime() + options.maximumAgeSeconds * 1_000).toISOString();
  const schedulerIdentity = Object.freeze({
    id: `identity:${options.applicationId}:scheduler`,
    kind: 'service' as const,
    issuer: 'applik8s://scheduler',
    subject: `${options.applicationId}/${options.environmentId}`,
  });
  const admission: ApplicationRequestAdmission = {
    principal: Object.freeze({
      id: `principal:${options.applicationId}:scheduler:${options.environmentId}`,
      identity: schedulerIdentity,
      kind: 'service',
      authenticationMethod: options.trigger === 'schedule' ? 'verified-scheduler-delivery' : 'framework-direct',
      audience: Object.freeze([operationId]),
      trustedContextDigest,
      catalogRevision: `schedule-catalog:${scheduleStableDigest({ applicationId: options.applicationId, definitionId: options.definitionId })}`,
      authorityRevision: 'schedule-authority:v1',
      admittedAt: admittedAt.toISOString(),
      expiresAt: deadline,
    }),
    trustedContext,
  };
  const context = withApplicationAdmissionExecutionV1(
    createApplicationAdmissionContextV1({
      admission,
      operation: { id: operationId, transport: options.trigger === 'schedule' ? 'schedule' : 'direct' },
      correlationId: options.occurrenceId,
    }),
    {
      deadline,
      delivery: {
        id: options.occurrenceId,
        source: `applik8s://schedulers/${encodeURIComponent(options.applicationId)}/${encodeURIComponent(options.environmentId)}`,
      },
    },
  );
  return applicationAdmissionInvocationView(validateApplicationAdmissionContextV1WithoutReceipt(context, {
    now: admittedAt.getTime(),
  }));
}

/** Preserves the current admitted caller for an immediate callable schedule. */
export function applicationScheduleImmediateInvocationAdmission(options: {
  readonly caller: ApplicationAdmissionInvocationContextV1;
  readonly definitionId: string;
  readonly instanceId: string;
  readonly occurrenceId: string;
  readonly admittedAt: string;
  readonly maximumAgeSeconds: number;
}): ApplicationAdmissionInvocationContextV1 {
  const admittedAt = new Date(options.admittedAt);
  if (!Number.isFinite(admittedAt.getTime())) throw new Error('Schedule admission time is invalid.');
  if (!Number.isSafeInteger(options.maximumAgeSeconds) || options.maximumAgeSeconds < 1) {
    throw new Error('Schedule admission maximum age must be a positive safe integer.');
  }
  const operationId = `applik8s://schedules/${encodeURIComponent(options.definitionId)}/instances/${encodeURIComponent(options.instanceId)}/operations/invoke`;
  const maximumDeadline = admittedAt.getTime() + options.maximumAgeSeconds * 1_000;
  const callerDeadline = options.caller.deadline
    ? Date.parse(options.caller.deadline)
    : Number.POSITIVE_INFINITY;
  const deadline = new Date(Math.min(maximumDeadline, callerDeadline)).toISOString();
  const base = createApplicationAdmissionContextV1({
    admission: {
      principal: options.caller.principal,
      trustedContext: options.caller.trustedContext.values,
    },
    operation: { id: operationId, transport: 'direct' },
    correlationId: options.occurrenceId,
  });
  const traced = options.caller.trace
    ? withApplicationAdmissionTraceV1(base, options.caller.trace)
    : base;
  return applicationAdmissionInvocationView(validateApplicationAdmissionContextV1WithoutReceipt(
    withApplicationAdmissionExecutionV1(traced, {
      causationId: options.caller.correlationId,
      deadline,
      ...(options.caller.cancellation
        ? { cancellation: options.caller.cancellation }
        : {}),
    }),
    { now: admittedAt.getTime() },
  ));
}

/** Provider execution IDs are intentionally excluded from logical identity. */
export function applicationScheduleOccurrenceId(options: {
  readonly applicationId: string;
  readonly environmentId: string;
  readonly definitionId: string;
  readonly instanceId: string;
  readonly scheduledAt: string;
  readonly schedulerExecutionId?: string;
}): string {
  return `occ_${sha256Hex(`${options.applicationId}\0${options.environmentId}\0${options.definitionId}\0${options.instanceId}\0${options.scheduledAt}`)}`;
}

function scheduleStableDigest(value: unknown): string {
  return sha256Hex(
    canonicalJsonV1String(value, canonicalJsonCompatibleV1Policy),
  );
}
