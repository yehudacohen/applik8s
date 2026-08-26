/** Focused execution kernel for an already admitted schedule occurrence. */

import type {
  ApplicationScheduleAdmission,
  ApplicationScheduleAdmissionRunner,
  ApplicationScheduleHandle,
  ApplicationScheduleHandler,
  ApplicationScheduleOccurrenceReceipt,
} from './application-schedule.js';
import { applicationScheduleInvocationAdmission, applicationScheduleOccurrenceId } from './application-schedule-provider-runtime.js';
import { validateMessage } from './application-schema-runtime.js';
import { runApplicationTelemetryBoundary } from './application-telemetry-runtime.js';

export const applicationScheduleHandlerSymbol = Symbol.for('applik8s.applicationSchedule.handler');

/** Provider bootstrap seam for an already admitted occurrence. */
export async function executeApplicationScheduleAdmission<TInput extends object, TResult>(
  handle: ApplicationScheduleHandle<TInput, TResult>,
  admission: ApplicationScheduleAdmission,
  signal: AbortSignal = new AbortController().signal,
  runner?: ApplicationScheduleAdmissionRunner,
): Promise<ApplicationScheduleOccurrenceReceipt<TResult>> {
  if (admission.definitionId !== handle.definition.id) {
    throw new Error(`Schedule admission for ${admission.definitionId} cannot execute ${handle.definition.id}.`);
  }
  if (!Number.isSafeInteger(admission.attempt) || admission.attempt < 1) {
    throw new Error(`Schedule admission ${admission.definitionId}/${admission.instanceId} has an invalid attempt.`);
  }
  const scheduledAt = new Date(admission.scheduledAt);
  const admittedAt = new Date(admission.admittedAt);
  if (!Number.isFinite(scheduledAt.getTime()) || !Number.isFinite(admittedAt.getTime())) {
    throw new Error(`Schedule admission ${admission.definitionId}/${admission.instanceId} has an invalid timestamp.`);
  }
  const latenessMs = admittedAt.getTime() - scheduledAt.getTime();
  if (latenessMs < 0) {
    throw new Error(`Schedule admission ${admission.definitionId}/${admission.instanceId} precedes its scheduled time.`);
  }
  const input: TInput = handle.definition.input
    ? validateMessage(handle.definition.input, admission.input ?? {}, `${handle.definition.id}.input`)
    : {} as TInput;
  const handler = Reflect.get(handle, applicationScheduleHandlerSymbol);
  if (typeof handler !== 'function') throw new Error(`Schedule ${handle.definition.id} has no framework runtime handler.`);
  const occurrenceId = applicationScheduleOccurrenceId({
    applicationId: admission.applicationId,
    environmentId: admission.environmentId,
    definitionId: admission.definitionId,
    instanceId: admission.instanceId,
    scheduledAt: scheduledAt.toISOString(),
    ...(admission.schedulerExecutionId ? { schedulerExecutionId: admission.schedulerExecutionId } : {}),
  });
  if (latenessMs > handle.definition.retry.maximumAgeSeconds * 1_000
    || (handle.definition.misfires === 'skip'
      && latenessMs > handle.definition.maximumLatenessSeconds * 1_000)) {
    return {
      occurrenceId,
      definitionId: admission.definitionId,
      instanceId: admission.instanceId,
      scheduledAt: scheduledAt.toISOString(),
      state: 'skipped',
      attempts: admission.attempt,
    };
  }
  const startedAt = new Date().toISOString();
  const invocationAdmission = applicationScheduleInvocationAdmission({
    applicationId: admission.applicationId,
    environmentId: admission.environmentId,
    definitionId: admission.definitionId,
    instanceId: admission.instanceId,
    occurrenceId,
    admittedAt: admittedAt.toISOString(),
    maximumAgeSeconds: handle.definition.retry.maximumAgeSeconds,
    trigger: 'schedule',
  });
  try {
    const invoke = () => runApplicationTelemetryBoundary({
      kind: 'schedule',
      identity: admission.definitionId,
      attempt: admission.attempt,
      attributes: {
        'applik8s.schedule.trigger': 'schedule',
        'applik8s.schedule.occurrence_id': occurrenceId,
      },
    }, async () => (handler as ApplicationScheduleHandler<TInput, TResult>)(input, {
      definitionId: admission.definitionId,
      instanceId: admission.instanceId,
      occurrenceId,
      scheduledAt: scheduledAt.toISOString(),
      admittedAt: admittedAt.toISOString(),
      startedAt,
      attempt: admission.attempt,
      trigger: 'schedule',
      admission: invocationAdmission,
      signal,
    }));
    const result = await (runner
      ? runner.run(invocationAdmission, invoke)
      : invoke());
    return {
      occurrenceId,
      definitionId: admission.definitionId,
      instanceId: admission.instanceId,
      scheduledAt: scheduledAt.toISOString(),
      state: 'succeeded',
      attempts: admission.attempt,
      result,
    };
  } catch (error) {
    return {
      occurrenceId,
      definitionId: admission.definitionId,
      instanceId: admission.instanceId,
      scheduledAt: scheduledAt.toISOString(),
      state: 'failed',
      attempts: admission.attempt,
      error: {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
