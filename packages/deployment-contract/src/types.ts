import type { ApplicationRuntimeAccessPlan } from './runtime-access.js';

/** Portable JSON accepted by the deployment graph. */
export type DeploymentJsonPrimitive = string | number | boolean | null;
export type DeploymentJsonValue =
  | DeploymentJsonPrimitive
  | DeploymentJsonObject
  | readonly DeploymentJsonValue[];
export interface DeploymentJsonObject {
  readonly [key: string]: DeploymentJsonValue;
}

export type ApplicationDeploymentGraphVersion = "applik8s.deploymentGraph/v1alpha1";
export type ApplicationDeploymentGraphMode = "fresh";
export type ApplicationDeploymentStrategy = "direct" | "kro";

export interface ApplicationDeploymentGraph {
  readonly apiVersion: ApplicationDeploymentGraphVersion;
  readonly kind: "ApplicationDeploymentGraph";
  readonly metadata: ApplicationDeploymentGraphMetadata;
  /** Canonical pre-mutation access contract that every target resource must implement. */
  readonly runtimeAccess: ApplicationRuntimeAccessPlan;
  readonly nodes: readonly ApplicationDeploymentNode[];
  readonly edges: readonly ApplicationDeploymentEdge[];
}

export interface ApplicationDeploymentGraphMetadata {
  readonly identity: ApplicationDeploymentIdentity;
  readonly mode: ApplicationDeploymentGraphMode;
  readonly strategy: ApplicationDeploymentStrategy;
  readonly sourceGraphDigest: string;
  readonly compilerVersion: string;
  readonly profileTransition?: DeploymentJsonObject;
}

export interface ApplicationDeploymentIdentity {
  readonly connection: ApplicationDeploymentConnectionIdentity;
  readonly application: string;
  readonly controlPlaneNamespace: string;
  readonly instance: string;
  readonly profile: string;
}

/**
 * A connection identity is non-secret and stable. It identifies a target, not
 * the credentials used to reach it.
 */
export interface ApplicationDeploymentConnectionIdentity {
  readonly provider: string;
  readonly cluster: string;
  readonly digest: string;
}

export type ApplicationDeploymentNodeKind =
  | "artifact"
  | "externalProvider"
  | "kubernetesComposition"
  | "kubernetesDirect"
  | "singleton"
  | "externalReference"
  | "secretReference"
  | "statusProjection";

export interface ApplicationDeploymentNodeBase<
  TKind extends ApplicationDeploymentNodeKind,
  TSpec extends DeploymentJsonObject,
> {
  readonly id: string;
  readonly kind: TKind;
  readonly contractVersion: number;
  readonly source: ApplicationDeploymentSource;
  readonly provider: ApplicationDeploymentProviderIdentity;
  readonly scope: ApplicationDeploymentNodeScope;
  readonly capabilities: ApplicationDeploymentNodeCapabilities;
  readonly configurationDigest: string;
  readonly inputs: Readonly<Record<string, ApplicationDeploymentInput>>;
  readonly outputs: readonly ApplicationDeploymentOutput[];
  readonly lifecycle: ApplicationDeploymentLifecycle;
  readonly spec: TSpec;
}

export interface ApplicationDeploymentSource {
  readonly semanticNodeId?: string;
  readonly artifactPath?: string;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
}

export interface ApplicationDeploymentProviderIdentity {
  readonly interface: string;
  readonly implementation: string;
  readonly version: string;
}

export interface ApplicationDeploymentNodeScope {
  readonly connectionDigest: string;
  readonly namespace?: string;
}

export interface ApplicationDeploymentNodeCapabilities {
  readonly strategies: readonly ApplicationDeploymentStrategy[];
  readonly alchemy: true;
}

export type ApplicationDeploymentPersistence =
  | "state"
  | "redacted"
  | "reference"
  | "ephemeral";
export type ApplicationDeploymentSensitivity = "public" | "sensitive";

export interface ApplicationDeploymentOutput {
  readonly name: string;
  readonly type: ApplicationDeploymentOutputType;
  readonly sensitivity: ApplicationDeploymentSensitivity;
  readonly persistence: ApplicationDeploymentPersistence;
}

export type ApplicationDeploymentOutputType =
  | "string"
  | "number"
  | "boolean"
  | "json"
  | "secretReference"
  | "resourceReference"
  | "artifactReference"
  | "artifactDigest";

export type ApplicationDeploymentInput =
  | ApplicationDeploymentLiteralInput
  | ApplicationDeploymentOutputInput
  | ApplicationDeploymentSecretReferenceInput;

export interface ApplicationDeploymentLiteralInput {
  readonly kind: "literal";
  readonly value: DeploymentJsonValue;
}

export interface ApplicationDeploymentOutputInput {
  readonly kind: "output";
  readonly nodeId: string;
  readonly output: string;
  readonly sensitivity: ApplicationDeploymentSensitivity;
  readonly persistence: ApplicationDeploymentPersistence;
}

export interface ApplicationDeploymentSecretReferenceInput {
  readonly kind: "secretReference";
  readonly nodeId: string;
  readonly key?: string;
}

export interface ApplicationDeploymentLifecycle {
  readonly ownership: "application" | "shared" | "external";
  readonly deletion: "delete" | "retain" | "orphan" | "none";
  readonly adoption: "createOnly" | "createOrAdoptExact" | "externalOnly";
  readonly namespaceNodeId?: string;
}

export interface ApplicationArtifactNodeSpec extends DeploymentJsonObject {
  readonly artifactType: "containerImage" | "wasmComponent" | "migration" | "generatedRuntime";
  readonly sourceDescriptor: DeploymentJsonObject;
  readonly executionNodeIds?: readonly string[];
  /** Exact non-secret Kubernetes credential identities mounted by this artifact. */
  readonly credentialProjections?: readonly ApplicationArtifactCredentialProjection[];
}

export interface ApplicationArtifactCredentialProjection extends DeploymentJsonObject {
  readonly target: "kubernetes";
  readonly namespace: string;
  readonly name: string;
  readonly keys: readonly string[];
}

export interface ApplicationExternalProviderNodeSpec extends DeploymentJsonObject {
  readonly resourceType: string;
  readonly controller?: string;
  readonly configuration?: DeploymentJsonObject;
}

export interface ApplicationKubernetesCompositionNodeSpec extends DeploymentJsonObject {
  readonly compositionId: string;
  readonly fragmentIds: readonly string[];
  readonly namespaceNodeIds?: readonly string[];
  readonly materialized?: {
    readonly resources: readonly DeploymentJsonObject[];
    readonly status: DeploymentJsonObject;
  };
}

export interface ApplicationKubernetesDirectNodeSpec extends DeploymentJsonObject {
  readonly compositionId: string;
  readonly reason: string;
  /**
   * Concrete, non-secret TypeKro composition input. Secret values remain
   * references and are resolved only by the operation host/provider.
   */
  readonly configuration?: DeploymentJsonObject;
}

export interface ApplicationSingletonNodeSpec extends DeploymentJsonObject {
  readonly singletonKey: string;
}

export interface ApplicationExternalReferenceNodeSpec extends DeploymentJsonObject {
  readonly referenceType: string;
  readonly reference: DeploymentJsonObject;
}

export interface ApplicationSecretReferenceNodeSpec extends DeploymentJsonObject {
  readonly source: "kubernetesSecret" | "hostBinding";
  readonly name: string;
  readonly namespace?: string;
  readonly key?: string;
}

export interface ApplicationStatusProjectionNodeSpec extends DeploymentJsonObject {
  readonly field: string;
  readonly sourceNodeId: string;
  readonly sourcePath: string;
  readonly classification: "live" | "desired" | "static";
}

export type ApplicationArtifactDeploymentNode = ApplicationDeploymentNodeBase<
  "artifact",
  ApplicationArtifactNodeSpec
>;
export type ApplicationExternalProviderDeploymentNode = ApplicationDeploymentNodeBase<
  "externalProvider",
  ApplicationExternalProviderNodeSpec
>;
export type ApplicationKubernetesCompositionDeploymentNode =
  ApplicationDeploymentNodeBase<
    "kubernetesComposition",
    ApplicationKubernetesCompositionNodeSpec
  >;
export type ApplicationKubernetesDirectDeploymentNode = ApplicationDeploymentNodeBase<
  "kubernetesDirect",
  ApplicationKubernetesDirectNodeSpec
>;
export type ApplicationSingletonDeploymentNode = ApplicationDeploymentNodeBase<
  "singleton",
  ApplicationSingletonNodeSpec
>;
export type ApplicationExternalReferenceDeploymentNode =
  ApplicationDeploymentNodeBase<
    "externalReference",
    ApplicationExternalReferenceNodeSpec
  >;
export type ApplicationSecretReferenceDeploymentNode =
  ApplicationDeploymentNodeBase<
    "secretReference",
    ApplicationSecretReferenceNodeSpec
  >;
export type ApplicationStatusProjectionDeploymentNode =
  ApplicationDeploymentNodeBase<
    "statusProjection",
    ApplicationStatusProjectionNodeSpec
  >;
export type ApplicationDeploymentNode =
  | ApplicationArtifactDeploymentNode
  | ApplicationExternalProviderDeploymentNode
  | ApplicationKubernetesCompositionDeploymentNode
  | ApplicationKubernetesDirectDeploymentNode
  | ApplicationSingletonDeploymentNode
  | ApplicationExternalReferenceDeploymentNode
  | ApplicationSecretReferenceDeploymentNode
  | ApplicationStatusProjectionDeploymentNode;

export type ApplicationDeploymentEdgeKind =
  | "requiresOutput"
  | "requiresReady"
  | "installsApi"
  | "owns"
  | "retains"
  | "publishes"
  | "projectsStatus";

export interface ApplicationDeploymentEdge {
  readonly from: string;
  readonly to: string;
  readonly relationship: ApplicationDeploymentEdgeKind;
  readonly output?: string;
}

export interface ApplicationDeploymentDiagnostic {
  readonly severity: "error" | "warning";
  readonly code: ApplicationDeploymentDiagnosticCode;
  readonly message: string;
  readonly nodeId?: string;
  readonly edge?: ApplicationDeploymentEdge;
  readonly source?: ApplicationDeploymentSource;
}

export type ApplicationDeploymentDiagnosticCode =
  | "DEPLOYMENT_GRAPH_INVALID"
  | "DEPLOYMENT_IDENTITY_INVALID"
  | "DEPLOYMENT_NODE_DUPLICATE"
  | "DEPLOYMENT_NODE_INVALID"
  | "DEPLOYMENT_EDGE_INVALID"
  | "DEPLOYMENT_EDGE_CYCLE"
  | "DEPLOYMENT_OUTPUT_INVALID"
  | "DEPLOYMENT_SECRET_UNSAFE"
  | "DEPLOYMENT_CONNECTION_UNSAFE"
  | "DEPLOYMENT_LIFECYCLE_UNSAFE"
  | "DEPLOYMENT_STRATEGY_UNSUPPORTED"
  | "DEPLOYMENT_SINGLETON_DRIFT"
  | "DEPLOYMENT_STATUS_INVALID";

export interface ApplicationDeploymentValidationResult {
  readonly valid: boolean;
  readonly diagnostics: readonly ApplicationDeploymentDiagnostic[];
}
