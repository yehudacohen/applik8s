import { createResource } from 'typekro';
import { registerPortableReadinessEvaluator } from 'typekro/advanced';
import { app, namespace } from '../installation';
import { moderationPolicyApiVersion, moderationPolicyKind } from '../domain/moderation';

interface ObservedModerationPolicy {
  readonly status?: {
    readonly phase?: unknown;
    readonly message?: unknown;
  };
}

const moderationPolicyReadiness = registerPortableReadinessEvaluator(
  'chirp.readiness.moderation-policy',
  '1',
  (resource: ObservedModerationPolicy) => {
    const phase = resource.status?.phase;
    const message = typeof resource.status?.message === 'string'
      ? resource.status.message
      : 'The moderation operator has not reported a terminal phase.';
    return phase === 'Ready'
      ? { ready: true, reason: 'PolicyReady', message }
      : {
          ready: false,
          reason: phase === 'Invalid' ? 'PolicyInvalid' : 'PolicyPending',
          message,
          ...(phase === 'Invalid' ? { terminal: true } : {}),
        };
  },
);

/**
 * One low-cardinality operational policy proves the Kubernetes query authority
 * in the flagship app. Its materialization is infrastructure-specific, so the
 * domain actor remains free of TypeKro provider details.
 */
export const DefaultModerationPolicy = app.infra(() => createResource({
  apiVersion: moderationPolicyApiVersion,
  kind: moderationPolicyKind,
  metadata: { name: 'default', namespace },
  spec: { maxRisk: 0.8, blockedTerms: [] },
}).withReadinessEvaluator(moderationPolicyReadiness));
