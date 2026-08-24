import {
  type ApplicationAdmissionInvocationContextV1,
  type ApplicationAuthorizationReceipt,
  type ApplicationRequestAdmission,
  applicationAdmissionInvocationView,
  createApplicationAdmissionContextV1,
  validateApplicationAdmissionContextV1,
  validateApplicationAdmissionContextV1WithoutReceipt,
  validateApplicationAuthorizationReceipt,
  withApplicationAdmissionExecutionV1,
} from '@applik8s/core';
import {
  applicationAdmissionRejectionCodeV1,
  createApplicationAdmissionObservationV1,
} from '@applik8s/core/admission';
import {
  countApplicationTelemetry,
  logApplicationTelemetry,
} from './application-telemetry-runtime.js';

/** Canonical and Release-A-compatible authority carried by one actor turn. */
export interface ApplicationActorTurnAuthority {
  /**
   * Canonical invocation admission. Optional only while Release-A readers
   * upgrade durable v0.7 alarm records that contain a complete receipt.
   */
  readonly admission?: ApplicationAdmissionInvocationContextV1;
  readonly principal: { readonly id: string };
  readonly causalPrincipal: { readonly id: string };
  readonly authorizationReceipt:
    | ApplicationAuthorizationReceipt
    | { readonly id: string; readonly authorityRevision: string };
  readonly trustedContextDigest: string;
}

export interface CreateApplicationActorTurnAuthorityOptions {
  readonly admission: ApplicationRequestAdmission;
  readonly operationId: string;
  readonly correlationId: string;
  readonly causalPrincipal: { readonly id: string };
  readonly authorizationReceipt?: ApplicationAuthorizationReceipt;
  readonly causationId?: string;
  readonly deadline?: string;
  readonly cancellation?: ApplicationAdmissionInvocationContextV1['cancellation'];
}

/** Canonical construction boundary for actor calls, turns, and durable alarms. */
export function createApplicationActorTurnAuthority(
  options: CreateApplicationActorTurnAuthorityOptions,
): ApplicationActorTurnAuthority {
  const base = createApplicationAdmissionContextV1({
    admission: options.admission,
    operation: { id: options.operationId, transport: 'actor' },
    correlationId: options.correlationId,
  });
  const admission = applicationAdmissionInvocationView(
    withApplicationAdmissionExecutionV1(base, {
      ...(options.causationId ? { causationId: options.causationId } : {}),
      ...(options.deadline ? { deadline: options.deadline } : {}),
      ...(options.cancellation ? { cancellation: options.cancellation } : {}),
      ...(options.authorizationReceipt
        ? { authorizationReceipt: options.authorizationReceipt }
        : {}),
    }),
  );
  return actorAuthorityFromAdmission(admission, options.causalPrincipal);
}

/**
 * Validates canonical authority and upgrades the released durable alarm shape.
 * A legacy value is accepted only when its complete authorization receipt can
 * reconstruct and validate the canonical principal/operation binding.
 */
export function normalizeApplicationActorTurnAuthority(
  value: ApplicationActorTurnAuthority,
  options: {
    readonly context?: 'turn' | 'alarm-delivery' | 'durable-read';
  } = {},
): ApplicationActorTurnAuthority {
  const format = value.admission ? 'canonical-v1' : 'release-a-legacy';
  const context = options.context ?? 'turn';
  try {
    const normalized = value.admission
      ? normalizeCanonicalActorAuthority(value)
      : normalizeLegacyActorAuthority(value);
    countApplicationTelemetry('applik8s.actor.authority.decode', 1, {
      format,
      context,
      outcome: 'accepted',
    });
    if (format === 'release-a-legacy') {
      countApplicationTelemetry('applik8s.actor.authority.legacy_read', 1, {
        context,
      });
    }
    if (!normalized.admission) {
      throw new Error('Normalized actor authority is missing canonical admission.');
    }
    logApplicationTelemetry('info', 'applik8s.actor.admission',
      { ...createApplicationAdmissionObservationV1({
        state: 'admitted',
        boundary: 'execution',
        admission: normalized.admission,
        compatibilityPath: format === 'release-a-legacy' ? 'legacy' : 'canonical',
      }) });
    return normalized;
  } catch (error) {
    countApplicationTelemetry('applik8s.actor.authority.decode', 1, {
      format,
      context,
      outcome: 'rejected',
    });
    logApplicationTelemetry('warn', 'applik8s.actor.admission',
      { ...createApplicationAdmissionObservationV1({
        state: 'rejected',
        boundary: 'execution',
        transport: 'actor',
        compatibilityPath: format === 'release-a-legacy' ? 'legacy' : 'canonical',
        rejectionCode: applicationAdmissionRejectionCodeV1(error),
      }) });
    throw error;
  }
}

function normalizeCanonicalActorAuthority(
  value: ApplicationActorTurnAuthority,
): ApplicationActorTurnAuthority {
  if (!value.admission) throw new Error('Canonical actor authority is missing admission.');
  const admission = value.admission.authorizationReceipt
    ? validateApplicationAdmissionContextV1(value.admission)
    : validateApplicationAdmissionContextV1WithoutReceipt(value.admission);
  const normalized = actorAuthorityFromAdmission(
    applicationAdmissionInvocationView(admission),
    value.causalPrincipal,
  );
  assertActorAuthorityMirrors(value, normalized);
  return normalized;
}

function normalizeLegacyActorAuthority(
  value: ApplicationActorTurnAuthority,
): ApplicationActorTurnAuthority {
  const receipt = value.authorizationReceipt;
  if (
    !('apiVersion' in receipt)
    || receipt.apiVersion !== 'applik8s.authorizationReceipt/v1alpha1'
  ) {
    throw new Error(
      'Actor authority requires canonical admission or a complete authorization receipt.',
    );
  }
  const diagnostics = validateApplicationAuthorizationReceipt(receipt);
  if (diagnostics.length > 0) {
    throw new Error(
      `Actor legacy authority receipt is invalid: ${diagnostics[0]?.message ?? 'unknown receipt error'}.`,
    );
  }
  if (
    receipt.principal.id !== value.principal.id
    || receipt.trustedContextDigest !== value.trustedContextDigest
  ) {
    throw new Error('Actor legacy authority does not match its authorization receipt.');
  }
  return createApplicationActorTurnAuthority({
    admission: {
      principal: receipt.principal,
      // Released actor authority persisted only the verified digest. The
      // context values are intentionally redacted during this compatibility
      // read; operation revalidation remains bound to the signed digest.
      trustedContext: {},
    },
    operationId: receipt.operationId,
    correlationId: `actor-receipt:${receipt.id}`,
    causalPrincipal: value.causalPrincipal,
    authorizationReceipt: receipt,
    ...(receipt.expiresAt ? { deadline: receipt.expiresAt } : {}),
  });
}

function actorAuthorityFromAdmission(
  admission: ApplicationAdmissionInvocationContextV1,
  causalPrincipal: { readonly id: string },
): ApplicationActorTurnAuthority {
  if (
    admission.principal.kind === 'execution'
    && admission.principal.executionKind === 'actor'
    && admission.cancellation?.revision !== admission.principal.cancellationRevision
  ) {
    throw new Error(
      'Actor execution admission does not match its cancellation fence revision.',
    );
  }
  const receipt = admission.authorizationReceipt;
  return Object.freeze({
    admission,
    principal: Object.freeze({ id: admission.principal.id }),
    causalPrincipal: Object.freeze({ id: causalPrincipal.id }),
    authorizationReceipt: receipt ?? Object.freeze({
      id: `internal:${admission.correlationId}`,
      authorityRevision: admission.authorityRevision,
    }),
    trustedContextDigest: admission.trustedContext.digest,
  });
}

function assertActorAuthorityMirrors(
  value: ApplicationActorTurnAuthority,
  normalized: ApplicationActorTurnAuthority,
): void {
  if (
    value.principal.id !== normalized.principal.id
    || value.causalPrincipal.id !== normalized.causalPrincipal.id
    || value.authorizationReceipt.id !== normalized.authorizationReceipt.id
    || value.authorizationReceipt.authorityRevision
      !== normalized.authorizationReceipt.authorityRevision
    || value.trustedContextDigest !== normalized.trustedContextDigest
  ) {
    throw new Error('Actor authority compatibility fields do not match canonical admission.');
  }
}
