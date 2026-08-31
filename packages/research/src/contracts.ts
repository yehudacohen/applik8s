// typecast-file-boundary: research protocol constructors validate immutable evidence and terminal discriminants before restoring narrowed public contracts.
import type { JsonObject } from '@applik8s/core';

export interface ApplicationResearchArtifactReference {
  readonly id: string;
}

export type ApplicationResearchAgentResult<TOutput extends object> =
  | {
      readonly status: 'completed';
      readonly value: TOutput;
      readonly artifact: ApplicationResearchArtifactReference;
      readonly evidenceIds: readonly string[];
    }
  | {
      readonly status: 'partial';
      readonly value?: TOutput;
      readonly artifact?: ApplicationResearchArtifactReference;
      readonly evidenceIds: readonly string[];
      readonly unresolvedClaims: readonly string[];
      readonly reason: string;
    }
  | {
      readonly status: 'failed';
      readonly evidenceIds: readonly string[];
      readonly reason: string;
    };

export const applicationResearchEvidenceProtocol = 'applik8s.researchEvidence/v1alpha1' as const;

export type ApplicationResearchSnapshotPolicy =
  | 'digest-only'
  | 'licensed-reference'
  | 'retained-snapshot';

export interface ApplicationResearchCitationSpan {
  readonly start: number;
  readonly end: number;
  readonly quote?: string;
  readonly claim?: string;
}

export interface ApplicationResearchEvidenceCommit {
  readonly principalScope: string;
  readonly runId: string;
  readonly queryId: string;
  readonly retrievalId: string;
  readonly canonicalUrl: string;
  readonly searchReceipt: JsonObject;
  readonly retrievedAt: string;
  readonly contentDigest: `sha256:${string}`;
  readonly snapshotPolicy: ApplicationResearchSnapshotPolicy;
  readonly snapshotArtifactId?: string;
  readonly citations: readonly ApplicationResearchCitationSpan[];
  readonly visibility: JsonObject;
  readonly causalArtifactIds?: readonly string[];
}

export interface ApplicationResearchEvidenceRecord extends ApplicationResearchEvidenceCommit {
  readonly apiVersion: typeof applicationResearchEvidenceProtocol;
  readonly id: string;
  readonly version: number;
  readonly committedAt: string;
}

export interface ApplicationResearchArtifactLinkInput {
  readonly principalScope: string;
  readonly runId: string;
  readonly artifactId: string;
  readonly evidenceIds: readonly string[];
  readonly claims: readonly {
    readonly claim: string;
    readonly evidenceIds: readonly string[];
  }[];
}

export interface ApplicationResearchArtifactLink {
  readonly apiVersion: 'applik8s.researchArtifactEvidence/v1alpha1';
  readonly id: string;
  readonly principalScope: string;
  readonly runId: string;
  readonly artifactId: string;
  readonly evidenceIds: readonly string[];
  readonly claims: readonly {
    readonly claim: string;
    readonly evidenceIds: readonly string[];
  }[];
  readonly linkedAt: string;
}

export interface ApplicationResearchEvidenceListInput {
  readonly principalScope: string;
  readonly runId: string;
  readonly afterVersion?: number;
  readonly limit?: number;
}

export interface ApplicationResearchEvidencePage {
  readonly values: readonly ApplicationResearchEvidenceRecord[];
  readonly nextVersion?: number;
}

export interface ApplicationResearchEvidenceProvider {
  readonly provider: string;
  readonly kind: string;
  readonly mode: 'deterministic' | 'durable';
  readonly storeIdentity: string;
  commit(input: ApplicationResearchEvidenceCommit): Promise<ApplicationResearchEvidenceRecord>;
  list(input: ApplicationResearchEvidenceListInput): Promise<ApplicationResearchEvidencePage>;
  linkArtifact(input: ApplicationResearchArtifactLinkInput): Promise<ApplicationResearchArtifactLink>;
}

export class ApplicationResearchEvidenceConflictError extends Error {
  readonly code = 'RESEARCH_EVIDENCE_CONFLICT';

  constructor(message: string) {
    super(message);
    this.name = 'ApplicationResearchEvidenceConflictError';
  }
}
