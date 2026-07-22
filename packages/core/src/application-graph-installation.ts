import type { ApplicationGraphNodeBase } from './application-graph.js';

/** Compiler-visible installation metadata attached non-enumerably to an Application composition. */
export const applicationInstallationMetadataProperty = '__applik8sApplicationInstallation';

export interface ApplicationInstallationArtifactContract {
  readonly apiVersion: string;
  readonly kind: string;
  /** Legacy schema-less builders may safely emit an empty convenience instance. */
  readonly emitDefaultInstance: boolean;
  /** Namespace in which KRO instance owners live; it must remain outside an owned workload Namespace. */
  readonly controlPlaneNamespace?: string;
  /** Conventional fields hydrated by the compiler from concrete child-resource readiness evidence. */
  readonly statusProjection?: {
    readonly mode: 'standardApplicationReadiness';
    /** Domain fields projected by Applik8s. KRO exclusively owns status.conditions. */
    readonly fields: readonly (
      | 'ready'
      | 'phase'
      | 'url'
      | 'observedVersion'
      | 'artifactDigest'
      | 'providerStatus'
      | 'migrationStatus'
      | 'rolloutStatus'
      | 'backupStatus'
      | 'projectionStatus'
      | 'degradedReasons'
    )[];
  };
}

/** A child installable Application statically nested into this generated graph. */
export interface ApplicationNestedInstallationNode extends ApplicationGraphNodeBase<'installation'> {
  readonly application: {
    readonly name: string;
    readonly apiVersion: string;
    readonly kind: string;
  };
  readonly materialization: 'nestedTypeKroComposition';
}
