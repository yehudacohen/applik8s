import type { Condition, ConditionStatus, ConditionedStatus, ExternalEffectPhase, ExternalEffectRecord, ExternalEffectState, Sha256Digest, Timestamp } from '@applik8s/core';

export interface ConditionInput {
  readonly type: string;
  readonly status: ConditionStatus;
  readonly reason: string;
  readonly message: string;
  readonly observedGeneration?: number;
  readonly lastTransitionTime?: Timestamp;
}

export interface SetConditionOptions {
  readonly now?: Timestamp;
}

export interface ExternalEffectRecordInput {
  readonly capabilityName: string;
  readonly phase: ExternalEffectPhase;
  readonly idempotencyKey: string;
  readonly requestDigest: Sha256Digest;
  readonly responseDigest?: Sha256Digest;
  readonly condition?: Condition;
  readonly observedAt?: Timestamp;
}

export interface SetExternalEffectOptions {
  readonly now?: Timestamp;
}

export function condition(input: ConditionInput): Condition {
  return {
    type: input.type,
    status: input.status,
    reason: input.reason,
    message: input.message,
    ...(input.observedGeneration === undefined ? {} : { observedGeneration: input.observedGeneration }),
    ...(input.lastTransitionTime === undefined ? {} : { lastTransitionTime: input.lastTransitionTime }),
  };
}

export function setCondition<TStatus extends object>(
  status: TStatus & Partial<ConditionedStatus>,
  input: ConditionInput,
  options?: SetConditionOptions
): TStatus & ConditionedStatus {
  const previous = status.conditions?.find((candidate) => candidate.type === input.type);
  const lastTransitionTime = input.lastTransitionTime
    ?? (previous?.status === input.status ? previous.lastTransitionTime : options?.now)
    ?? new Date().toISOString();
  const next = condition({ ...input, lastTransitionTime });
  const conditions = [...(status.conditions ?? []).filter((candidate) => candidate.type !== input.type), next];
  const observedGeneration = input.observedGeneration ?? status.observedGeneration;

  // typecast: the returned object preserves caller status fields while ensuring the standard conditioned status fields are present.
  return {
    ...status,
    ...(observedGeneration === undefined ? {} : { observedGeneration }),
    conditions,
  } as TStatus & ConditionedStatus;
}

export function readyCondition(status: ConditionStatus, reason: string, message: string, observedGeneration?: number): Condition {
  return condition({ type: 'Ready', status, reason, message, ...(observedGeneration === undefined ? {} : { observedGeneration }) });
}

export function externalEffectRecord(input: ExternalEffectRecordInput, options?: SetExternalEffectOptions): ExternalEffectRecord {
  return {
    capabilityName: input.capabilityName,
    phase: input.phase,
    idempotencyKey: input.idempotencyKey,
    requestDigest: input.requestDigest,
    ...(input.responseDigest === undefined ? {} : { responseDigest: input.responseDigest }),
    ...(input.condition === undefined ? {} : { condition: input.condition }),
    observedAt: input.observedAt ?? options?.now ?? new Date().toISOString(),
  };
}

export function setExternalEffect<TStatus extends object>(
  status: TStatus & Partial<ExternalEffectState>,
  input: ExternalEffectRecordInput,
  options?: SetExternalEffectOptions
): TStatus & ExternalEffectState {
  const next = externalEffectRecord(input, options);
  const effects = [
    ...(status.effects ?? []).filter((effect) => effect.capabilityName !== next.capabilityName || effect.idempotencyKey !== next.idempotencyKey),
    next,
  ];

  // typecast: the returned object preserves caller status fields while ensuring durable external effect records are present.
  return { ...status, effects } as TStatus & ExternalEffectState;
}
