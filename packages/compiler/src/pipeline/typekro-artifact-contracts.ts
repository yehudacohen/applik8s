import type {
  ApplicationGraphArtifactReference,
  ApplicationWorkloadAuthorityEnvelope,
  JsonObject,
} from '@applik8s/core';
import type {
  ApplicationArtifactCredentialProjection,
  ApplicationArtifactKubernetesPermission,
} from '@applik8s/deployment-contract';
import type { GeneratedApplicationAgentArtifact } from '../application-agents/index.js';
import type { GeneratedApplicationHttpArtifact } from '../application-http/index.js';
import type { GeneratedApplicationJobArtifact } from '../application-jobs/index.js';
import type { GeneratedApplicationLakehousePublisherArtifact } from '../application-lakehouse-publishers/index.js';
import type { GeneratedApplicationMcpArtifact } from '../application-mcp/index.js';
import type { GeneratedApplicationMigrationArtifact } from '../application-migrations/index.js';
import type { GeneratedApplicationProcessorArtifact } from '../application-processors/index.js';
import type { GeneratedApplicationReactiveArtifact } from '../application-reactive/index.js';
import type { GeneratedApplicationWorkflowArtifact } from '../application-workflows/index.js';

/** Public contracts for one emitted TypeKro application bundle. */
export interface TypeKroCompositionResource extends JsonObject {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: JsonObject & {
    readonly name: string;
    readonly namespace?: string;
  };
}

export interface TypeKroCompositionBundleManifest extends JsonObject {
  readonly apiVersion: 'applik8s.dev/v1alpha1';
  readonly kind: 'TypeKroCompositionBundle';
  readonly metadata: JsonObject & { readonly name: string };
  readonly spec: JsonObject & {
    readonly entrypoint: string;
    readonly exportName?: string;
    readonly resourceCount: number;
    readonly operators: readonly TypeKroCompositionOperatorArtifactReference[];
    readonly applicationGraph?: ApplicationGraphArtifactReference;
    readonly implementationPlans?: {
      readonly apiVersion: 'applik8s.implementationPlanSet/v1alpha1';
      readonly path: string;
      readonly digest: string;
      readonly count: number;
    };
    readonly operationCatalog?: {
      readonly apiVersion: 'applik8s.operationCatalog/v1alpha1';
      readonly revision: string;
      readonly path: string;
      readonly digest: string;
    };
    readonly workloadAuthority?: {
      readonly apiVersion: 'applik8s.workloadAuthoritySet/v1alpha1';
      readonly path: string;
      readonly digest: string;
      readonly count: number;
    };
    readonly migrations?: readonly TypeKroCompositionMigrationArtifactReference[];
    readonly processors?: readonly TypeKroCompositionProcessorArtifactReference[];
    readonly jobs?: readonly TypeKroCompositionJobArtifactReference[];
    readonly lakehousePublishers?: readonly TypeKroCompositionLakehousePublisherArtifactReference[];
    readonly workflows?: readonly TypeKroCompositionWorkflowArtifactReference[];
    readonly reactive?: readonly TypeKroCompositionReactiveArtifactReference[];
    readonly mcp?: readonly TypeKroCompositionMcpArtifactReference[];
    readonly agents?: readonly TypeKroCompositionAgentArtifactReference[];
    readonly http?: readonly TypeKroCompositionHttpArtifactReference[];
    readonly applicationHost?: TypeKroCompositionApplicationHostArtifactReference;
  };
}

export interface TypeKroCompositionOperatorArtifactReference extends JsonObject {
  readonly name: string;
  readonly manifest: string;
  readonly outDir: string;
}

export interface TypeKroCompositionApplicationHostArtifactReference extends JsonObject {
  readonly nodeId: string;
  readonly frameworkCredentials: readonly TypeKroCompositionFrameworkCredentialReference[];
}

export interface TypeKroCompositionProcessorArtifactReference extends JsonObject {
  readonly name: string;
  readonly nodeId: string;
  readonly executionNodeIds?: readonly string[];
  readonly manifest: string;
  readonly source: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly container: TypeKroCompositionContainerArtifactReference;
  readonly frameworkCredentials?: readonly TypeKroCompositionFrameworkCredentialReference[];
}

export interface TypeKroCompositionJobArtifactReference extends JsonObject {
  readonly name: string;
  readonly nodeId: string;
  readonly executionNodeIds?: readonly string[];
  readonly jobIds: readonly string[];
  readonly manifest: string;
  readonly source: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly container: TypeKroCompositionContainerArtifactReference;
  readonly frameworkCredentials?: readonly TypeKroCompositionFrameworkCredentialReference[];
}

export interface TypeKroCompositionLakehousePublisherArtifactReference extends JsonObject {
  readonly name: string;
  readonly nodeId: string;
  readonly executionNodeIds?: readonly string[];
  readonly manifest: string;
  readonly source: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly container: TypeKroCompositionContainerArtifactReference;
  readonly localSource: string;
  readonly localDigest: string;
  readonly localSizeBytes: number;
  readonly frameworkCredentials?: readonly TypeKroCompositionFrameworkCredentialReference[];
}

export interface TypeKroCompositionWorkflowArtifactReference extends JsonObject {
  readonly name: string;
  readonly nodeId: string;
  readonly executionNodeIds?: readonly string[];
  readonly manifest: string;
  readonly source: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly container: TypeKroCompositionContainerArtifactReference;
  readonly runtimeEndpoints?: readonly TypeKroCompositionRuntimeEndpointReference[];
  readonly frameworkCredentials?: readonly TypeKroCompositionFrameworkCredentialReference[];
  readonly credentialProjections?: readonly ApplicationArtifactCredentialProjection[];
  readonly kubernetesPermissions?: readonly ApplicationArtifactKubernetesPermission[];
}

export interface TypeKroCompositionReactiveArtifactReference extends JsonObject {
  readonly name: string;
  readonly nodeId: string;
  readonly executionNodeIds?: readonly string[];
  readonly kind:
    | 'queryGateway'
    | 'projectionWorker'
    | 'searchProjectionWorker'
    | 'streamProcessorWorker'
    | 'scheduleControlWorker';
  readonly manifest: string;
  readonly source: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly container: TypeKroCompositionContainerArtifactReference;
  readonly frameworkCredentials?: readonly TypeKroCompositionFrameworkCredentialReference[];
  readonly credentialProjections?: readonly ApplicationArtifactCredentialProjection[];
  readonly kubernetesPermissions?: readonly ApplicationArtifactKubernetesPermission[];
}

export interface TypeKroCompositionAgentArtifactReference extends JsonObject {
  readonly name: string;
  readonly nodeId: string;
  readonly executionNodeIds?: readonly string[];
  readonly manifest: string;
  readonly source: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly container: TypeKroCompositionContainerArtifactReference;
  readonly runtimeEndpoints?: readonly TypeKroCompositionRuntimeEndpointReference[];
  readonly frameworkCredentials?: readonly TypeKroCompositionFrameworkCredentialReference[];
}

export interface TypeKroCompositionHttpArtifactReference extends JsonObject {
  readonly name: string;
  readonly serverId: string;
  readonly executionNodeIds?: readonly string[];
  readonly manifest: string;
  readonly source: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly container: TypeKroCompositionContainerArtifactReference;
  readonly frameworkCredentials?: readonly TypeKroCompositionFrameworkCredentialReference[];
}

export interface TypeKroCompositionMcpArtifactReference extends JsonObject {
  readonly name: string;
  readonly serverId: string;
  readonly executionNodeIds?: readonly string[];
  readonly manifest: string;
  readonly source: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly container: TypeKroCompositionContainerArtifactReference;
  readonly runtimeEndpoints?: readonly TypeKroCompositionRuntimeEndpointReference[];
  readonly frameworkCredentials?: readonly TypeKroCompositionFrameworkCredentialReference[];
}

export interface TypeKroCompositionFrameworkCredentialReference extends JsonObject {
  readonly kind:
    | 'agent-query-context'
    | 'context'
    | 'cursor'
    | 'http-context'
    | 'internal-operation'
    | 'local-resource'
    | 'task-operation-context'
    | 'task-query-context';
  readonly environmentName: string;
}

export interface TypeKroCompositionRuntimeEndpointReference extends JsonObject {
  readonly nodeId: string;
  readonly environmentName: string;
}

export interface TypeKroCompositionContainerArtifactReference extends JsonObject {
  readonly image: string;
  readonly imageName: string;
  readonly tag: string;
  readonly baseImage: string;
  readonly contextPath: string;
  readonly dockerfilePath: string;
  readonly entrypoint: string;
  readonly command: readonly string[];
  readonly sourceDigest: string;
}

export interface TypeKroCompositionMigrationArtifactReference extends JsonObject {
  readonly name: string;
  readonly manifest: string;
  readonly source: string;
  readonly digest: string;
  readonly container: TypeKroCompositionContainerArtifactReference;
}

export interface TypeKroCompositionArtifacts {
  readonly manifest: TypeKroCompositionBundleManifest;
  readonly resources: readonly TypeKroCompositionResource[];
  readonly manifestJsonPath: string;
  readonly resourcesJsonPath: string;
  readonly combinedYamlPath: string;
  readonly applyScriptPath: string;
  readonly resourceYamlPaths: readonly string[];
  readonly instanceYamlPaths: readonly string[];
  readonly applicationGraphJsonPath?: string;
  readonly implementationPlansJsonPath?: string;
  readonly operationCatalogJsonPath?: string;
  readonly workloadAuthorityJsonPath?: string;
  readonly workloadAuthority: readonly ApplicationWorkloadAuthorityEnvelope[];
  readonly agentArtifacts: readonly GeneratedApplicationAgentArtifact[];
  readonly httpArtifacts: readonly GeneratedApplicationHttpArtifact[];
  readonly mcpArtifacts: readonly GeneratedApplicationMcpArtifact[];
  readonly migrationArtifacts: readonly GeneratedApplicationMigrationArtifact[];
  readonly processorArtifacts: readonly GeneratedApplicationProcessorArtifact[];
  readonly jobArtifacts: readonly GeneratedApplicationJobArtifact[];
  readonly lakehousePublisherArtifacts: readonly GeneratedApplicationLakehousePublisherArtifact[];
  readonly workflowArtifacts: readonly GeneratedApplicationWorkflowArtifact[];
  readonly reactiveArtifacts: readonly GeneratedApplicationReactiveArtifact[];
  readonly operatorArtifacts: readonly TypeKroCompositionOperatorArtifacts[];
}

export interface TypeKroCompositionOperatorArtifacts {
  readonly operatorName: string;
  readonly outDir: string;
  readonly manifestJsonPath: string;
}
