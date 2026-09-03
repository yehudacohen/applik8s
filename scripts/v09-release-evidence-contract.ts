// typecast-file-boundary: This release authority uses literal tuples so suite
// names remain closed and mechanically enumerable.
import { agenticProductEvidenceJourneys } from '../packages/e2e/browser/agentic-product-evidence-contract.js';
import {
  v07EvidencePath,
  v07ReleaseEvidenceContract,
} from './v07-release-evidence-contract.js';

const agenticProductJourneyEvidence = Object.values(
  agenticProductEvidenceJourneys,
).map(({ evidenceId }) => evidenceId);

/**
 * Exact-candidate evidence required by the v0.9 scorecard. Historical suites
 * retain their previous contracts, while v0.9-owned suites are deliberately
 * re-declared here so a broader release cannot accidentally pass against an
 * older, narrower receipt.
 */
export const v09ReleaseEvidenceContract: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
  ...v07ReleaseEvidenceContract,
  'agentic-product-starter': Object.freeze([
    'doctor',
    'migration-generation',
    'generated-consumer-gates',
    'production-build',
    'graph-backed-deploy',
    'graph-noop-redeploy',
    'deployment-status',
    'handoff-freshness',
    ...agenticProductJourneyEvidence,
    'cross-browser-product-quality',
    'visual-review-artifacts',
    'graph-backed-destroy',
  ]),
  'v071-deployment-migration': Object.freeze([
    'released-v071-state-created',
    'v071-graph-decoded',
    'stack-lease-fenced',
    'physical-uid-preserved',
    'target-ready',
    'typekro-cleanup',
  ]),
  'v09-managed-models': Object.freeze([
    'postgres-authoritative-store',
    'kubernetes-provider-parity',
    'restart-recovery',
  ]),
  'v09-query-batching': Object.freeze([
    'ordered-selection',
    'bounded-pages',
    'monotonic-frontier',
    'resume-without-duplication',
  ]),
  'v09-saga': Object.freeze([
    'deployed-workflow-provider',
    'compensation-frontier',
    'unknown-outcome-recovery',
    'provider-cleanup',
  ]),
  'v09-finite-jobs': Object.freeze([
    'raw-job-lifecycle',
    'worker-interruption-recovery',
    'authored-compiled-job',
    'durable-cancellation',
    'owned-cleanup',
  ]),
  'v09-kubernetes-cluster': Object.freeze([
    'binding-isolation',
    'bounded-list-watch',
    'uid-leased-mutation',
    'owned-cleanup',
  ]),
  'v09-research-postgres': Object.freeze([
    'append-only-evidence',
    'citation-provenance',
    'restart-persistence',
  ]),
  'v09-research-agent': Object.freeze([
    'managed-search-prerequisite',
    'openrouter-research-execution',
    'citation-backed-artifact',
    'graph-backed-destroy',
  ]),
  'v09-code-agent': Object.freeze([
    'fenced-workspace-mutation',
    'idempotent-replay',
    'provider-replacement',
    'cancellation',
    'workspace-cleanup',
  ]),
  'v09-builder': Object.freeze([
    'advisory-session',
    'reviewed-change-plan',
    'explicit-approval',
    'validation-evidence',
    'restart-recovery',
    'conflict-safe-undo',
  ]),
  'v09-chirp-aws': Object.freeze([
    'unchanged-source-production-profile',
    'native-aws-plan',
    'functional-data-plane',
    'noop-redeploy',
    'controlled-update',
    'owner-destroy',
    'exact-absence',
  ]),
  'aws-core-smoke': Object.freeze([
    'identity-verified',
    'plan-bounded',
    'apply-ready',
    'functional-data-plane',
    'required-tags',
    'noop-redeploy',
    'desired-update',
    'drift-repair',
    'owner-destroy',
    'exact-absence',
  ]),
  'v09-chirp-kubernetes': Object.freeze([
    'unchanged-source-production-profile',
    'typekro-deployment-ready',
    'stream-projection-path',
    'graph-noop-redeploy',
    'graph-backed-destroy',
  ]),
  'v09-clean-context-review': Object.freeze([
    'documentation-navigation',
    'common-path-authoring',
    'diagnostic-recovery',
    'release-claim-audit',
  ]),
});

export const v09ReleaseEvidenceSuites = Object.freeze(
  Object.keys(v09ReleaseEvidenceContract),
);

export const v09EvidenceDirectory = '.applik8s-tmp/evidence/v0.9';

export function v09EvidencePath(suite: string): string {
  return suite === 'agentic-product-starter'
    || suite === 'v071-deployment-migration'
    || suite.startsWith('v09-')
    || suite === 'aws-core-smoke'
    ? `${v09EvidenceDirectory}/${suite}.json`
    : v07EvidencePath(suite);
}

export type V09EvidenceEnvironment = 'kubernetes' | 'local' | 'aws' | 'external';

/** The environment identity each receipt must bind, independent of suite age. */
export function v09EvidenceEnvironment(suite: string): V09EvidenceEnvironment {
  if (suite === 'aws-core-smoke' || suite === 'v09-chirp-aws') return 'aws';
  if (
    suite === 'postgres'
    || suite === 'clickhouse'
    || suite === 'v09-managed-models'
    || suite === 'v09-query-batching'
    || suite === 'v09-research-postgres'
  ) return 'external';
  if (
    suite === 'v09-code-agent'
    || suite === 'v09-builder'
    || suite === 'v09-clean-context-review'
  ) return 'local';
  return 'kubernetes';
}
