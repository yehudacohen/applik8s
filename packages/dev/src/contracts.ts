export type DevelopmentResolution = 'exact' | 'candidate' | 'stale' | 'unresolved' | 'external';
export type DevelopmentAttachmentClass = 'visualSelection' | 'visualSnapshot' | 'source' | 'graphNode' | 'operation' | 'runtimeTrace' | 'applicationPlanNode' | 'validationEvidence';

export interface DevelopmentVisualSelection {
  readonly id: string;
  readonly capturedAtRevision: string;
  readonly route: { readonly pathname: string; readonly searchKeys: readonly string[]; readonly routeId?: string };
  readonly element?: { readonly role?: string; readonly accessibleName?: string; readonly boundedText?: string; readonly componentInstanceId?: string };
  readonly text?: { readonly boundedValue: string; readonly redaction: 'none' | 'partial' | 'withheld' };
  readonly region?: { readonly componentInstanceIds: readonly string[]; readonly boundingBox: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } };
  readonly sourceHints: readonly { readonly provenanceId: string; readonly confidence: DevelopmentResolution }[];
}

export interface DevelopmentContextAttachment {
  readonly id: string;
  readonly class: DevelopmentAttachmentClass;
  readonly digest: `sha256:${string}`;
  readonly capturedAtRevision: string;
  readonly resolution: DevelopmentResolution;
  readonly redaction: 'none' | 'partial' | 'withheld';
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface DevelopmentConversationReferent {
  readonly id: string;
  readonly label: string;
  readonly attachmentIds: readonly string[];
  readonly capturedAtRevision: string;
  readonly resolution: 'current' | 'stale' | 'partial' | 'unresolved';
}

export interface DevelopmentChangePlan {
  readonly id: string;
  readonly summary: string;
  readonly requestedOutcome: string;
  readonly contextReferents: readonly string[];
  readonly files: readonly PlannedFileChange[];
  readonly graphChanges: readonly Readonly<Record<string, unknown>>[];
  readonly schemaChanges: readonly Readonly<Record<string, unknown>>[];
  readonly authorityChanges: readonly Readonly<Record<string, unknown>>[];
  readonly infrastructureChanges: readonly Readonly<Record<string, unknown>>[];
  readonly dependencies: readonly Readonly<Record<string, unknown>>[];
  readonly risks: readonly { readonly severity: 'low' | 'medium' | 'high' | 'critical'; readonly summary: string; readonly approvalClass: DevelopmentApprovalClass }[];
  readonly validation: readonly PlannedValidation[];
  readonly rollbackBoundary: { readonly kind: 'agent-owned-hunks'; readonly files: readonly string[] };
}

export interface PlannedFileChange {
  readonly path: string;
  readonly baseDigest: `sha256:${string}` | 'absent';
  readonly nextText: string;
  readonly classification: 'create' | 'update' | 'delete';
}

export interface PlannedValidation {
  readonly id: string;
  readonly commandClass: DevelopmentCommandClass;
  readonly required: true;
  readonly timeoutMs: number;
}

export type DevelopmentCommandClass = 'format' | 'typecheck' | 'focused-test' | 'generated-artifacts' | 'applik8s-compile' | 'application-plan' | 'runtime-smoke';
export type DevelopmentApprovalClass = 'source-mutation' | 'dependency-change' | 'schema-migration' | 'secret-access' | 'public-exposure' | 'authority-change' | 'infrastructure-write' | 'destructive-reset' | 'workspace-expansion' | 'maintainer-mode';

export interface DevelopmentValidationEvidence {
  readonly id: string;
  readonly planId: string;
  readonly commandClass: DevelopmentCommandClass;
  readonly state: 'running' | 'passed' | 'failed' | 'cancelled';
  readonly revision: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly outputDigest?: `sha256:${string}`;
  readonly redactedOutput?: string;
}

export interface DevelopmentJournalEvent<T = Readonly<Record<string, unknown>>> {
  readonly sequence: number;
  readonly id: string;
  readonly kind: string;
  readonly createdAt: string;
  readonly payload: T;
  readonly previousHash: `sha256:${string}` | null;
  readonly hash: `sha256:${string}`;
}
