import { createResource } from 'typekro';
import { app, namespace } from '../app';
import { moderationPolicyApiVersion, moderationPolicyKind } from '../domain/moderation';

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
}));
