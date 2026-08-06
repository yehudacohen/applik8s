import type { GeneratedApplicationContainerArtifact } from '../application-containers/index.js';

export interface GeneratedApplicationWorkflowArtifact {
  readonly name: string;
  readonly sourcePath: string;
  readonly sourceMapPath: string;
  readonly manifestPath: string;
  readonly metafilePath: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly container: GeneratedApplicationContainerArtifact;
  readonly resources: readonly GeneratedApplicationWorkflowResource[];
}

export interface GeneratedApplicationWorkflowResource {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly data?: Readonly<Record<string, string>>;
  readonly binaryData?: Readonly<Record<string, string>>;
  readonly spec?: Readonly<Record<string, unknown>>;
  readonly automountServiceAccountToken?: boolean;
  readonly rules?: readonly Readonly<Record<string, unknown>>[];
  readonly roleRef?: Readonly<Record<string, unknown>>;
  readonly subjects?: readonly Readonly<Record<string, unknown>>[];
}
