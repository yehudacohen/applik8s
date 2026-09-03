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
});

export const v09ReleaseEvidenceSuites = Object.freeze(
  Object.keys(v09ReleaseEvidenceContract),
);

export const v09EvidenceDirectory = '.applik8s-tmp/evidence/v0.9';

export function v09EvidencePath(suite: string): string {
  return suite === 'agentic-product-starter' || suite === 'v071-deployment-migration'
    ? `${v09EvidenceDirectory}/${suite}.json`
    : v07EvidencePath(suite);
}
