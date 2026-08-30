// typecast-file-boundary: This release authority uses literal tuples so suite names remain closed and mechanically enumerable.
import { v06ReleaseEvidenceContract } from './v06-release-evidence-contract.mjs';

const v06ChirpEvidence = v06ReleaseEvidenceContract.chirp;
if (!v06ChirpEvidence) {
  throw new Error('The v0.6 evidence contract must define the Chirp suite.');
}

/**
 * Exact-candidate evidence required before the v0.7 scorecard can become a
 * release candidate. v0.6 application receipts remain useful because
 * GuestBook and Chirp are maintained acceptance applications; the v0.7
 * receipts prove the new profile, identity, and deployment-engine surfaces.
 */
export const v07ReleaseEvidenceContract: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
  ...v06ReleaseEvidenceContract,
  chirp: Object.freeze([
    ...v06ChirpEvidence,
    'frozen-microbatch-durable-receipt',
    'resource-workflow-tracking-generation-convergence',
  ]),
  'v07-lifecycle': Object.freeze([
    'direct-apply-noop-update-resume-destroy',
    'kro-apply-noop-update-destroy',
    'retained-resource-preserved',
    'retained-resource-drift-recovered',
    'external-resource-preserved',
    'owner-driven-cleanup',
  ]),
  'identity-start-starter': Object.freeze([
    'fresh-packed-application',
    'credential-free-start',
    'human-session-admission',
    'typed-operation',
    'agent-operation',
    'signal-issuance-sse-delivery',
    'signal-resolution',
    'authoritative-requery',
    'graph-backed-destroy',
  ]),
  'identity-start-dedicated': Object.freeze([
    'fresh-packed-application',
    'managed-inference-data-plane',
    'ory-human-session-admission',
    'provider-derived-role-authority',
    'production-sensitive-agent-admission',
    'durable-human-approval',
    'framework-derived-signal-actor',
    'authorization-receipt',
    'mcp-http-invocation',
    'redacted-audit-search',
    'restart-recovery',
    'graph-backed-destroy',
  ]),
  'identity-start-external': Object.freeze([
    'fresh-packed-application',
    'external-provider-readiness',
    'externally-owned-provider-adoption',
    'no-owned-provider-bootstrap',
    'typed-operation',
    'authoritative-requery',
    'destroy-preserves-external-providers',
    'provider-destroy-completes',
  ]),
  'agentic-start-starter': Object.freeze([
    'migration-generation',
    'production-build',
    'graph-backed-deploy',
    'graph-noop-redeploy',
    'browser:bootstraps a local owner and admits only server-validated workspace selection',
    'browser:calls the bounded public assistant through its generated function-native facade',
    'browser:renders provider-neutral billing and executes simulated checkout and portal calls',
    'browser:persists, reloads, renames, and archives a generated research conversation',
    'browser:runs a workspace-scoped durable review from SSE signal to immutable artifact',
    'graph-backed-destroy',
  ]),
  'agentic-product-starter': Object.freeze([
    'doctor',
    'migration-generation',
    'generated-consumer-gates',
    'production-build',
    'graph-backed-deploy',
    'graph-noop-redeploy',
    'deployment-status',
    'handoff-freshness',
    'causal-agent-note',
    'durable-specialist',
    'historical-usage-browser',
    'agent-workbench',
    'bounded-knowledge',
    'application-notification-delivery',
    'product-lifecycle-trust',
    'cross-browser-product-quality',
    'visual-review-artifacts',
    'graph-backed-destroy',
  ]),
});

export const v07ReleaseEvidenceSuites = Object.freeze([
  'postgres',
  'clickhouse',
  'orbstack',
  'guestbook-start',
  'chirp-deployment',
  'chirp',
  'chirp-browser',
  'v07-lifecycle',
  'identity-start-starter',
  'identity-start-dedicated',
  'identity-start-external',
  'agentic-start-starter',
  'agentic-product-starter',
] as const);

export const v07EvidenceDirectory = '.applik8s-tmp/evidence/v0.7';

export function v07EvidencePath(suite: string): string {
  const legacy = new Set([
    'postgres',
    'clickhouse',
    'orbstack',
    'guestbook-start',
    'chirp-deployment',
    'chirp',
    'chirp-browser',
  ]);
  return legacy.has(suite)
    ? `.applik8s-tmp/evidence/v0.6/${suite}.json`
    : `${v07EvidenceDirectory}/${suite}.json`;
}
