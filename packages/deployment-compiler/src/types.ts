import type {
  ApplicationDeploymentTargetKind,
  ApplicationGraph,
  ApplicationProviderNode,
  ApplicationRuntimeAccessRequirement,
} from "@applik8s/core";
import type {
  ApplicationDeploymentConnectionIdentity,
  ApplicationDeploymentEdge,
  ApplicationDeploymentGraph,
  ApplicationDeploymentGraphMode,
  ApplicationDeploymentNode,
  ApplicationDeploymentStrategy,
  ApplicationRuntimeAccessBootstrapEgress,
  DeploymentJsonObject,
} from "@applik8s/deployment-contract";
import type {
  ApplicationRuntimeAccessPlan,
  ApplicationRuntimeAccessWorkloadPlacement,
} from "./runtime-access-plan.js";

export interface CompileApplicationDeploymentGraphRequest {
  readonly graph: ApplicationGraph;
  /** Workspace root used to canonicalize authored source provenance. */
  readonly workspaceRoot?: string;
  /** Explicit physical target. When omitted, legacy callers derive it from the non-secret connection provider. */
  readonly target?: ApplicationDeploymentTargetKind;
  readonly sourceGraphDigest: string;
  readonly compilerVersion: string;
  readonly identity: {
    readonly connection: ApplicationDeploymentConnectionIdentity;
    readonly application: string;
    readonly controlPlaneNamespace: string;
    readonly instance: string;
    readonly profile: string;
  };
  readonly mode?: ApplicationDeploymentGraphMode;
  readonly strategy: ApplicationDeploymentStrategy;
  readonly installationSpec: DeploymentJsonObject;
  readonly profileTransition?: DeploymentJsonObject;
  readonly artifacts: readonly ApplicationArtifactRequirement[];
  readonly materializedComposition?: {
    readonly resources: readonly DeploymentJsonObject[];
    readonly status: DeploymentJsonObject;
  };
  /**
   * Cluster-scoped APIs emitted beside the root RGD. They cannot be children
   * of one KRO instance because deleting that instance would remove the API
   * before its resources and finalizers finish. The deployment compiler lowers
   * them into ordered, retained TypeKro direct nodes instead.
   */
  readonly clusterApiPrerequisites?: readonly DeploymentJsonObject[];
  /** Generated runtime credentials whose values are created only by the operation host. */
  readonly generatedSecrets?: readonly ApplicationGeneratedSecretRequirement[];
  /** Explicit target-owned resolver/bootstrap access; never application-authored provider authority. */
  readonly runtimeAccessBootstrapEgress?: readonly ApplicationRuntimeAccessBootstrapEgress[];
  readonly contributors?: readonly ApplicationDeploymentContributor[];
}

export interface ApplicationGeneratedSecretRequirement {
  /** Stable semantic identity; must not include the concrete installation namespace. */
  readonly id?: string;
  readonly namespace: string;
  readonly name: string;
  readonly values: Readonly<Record<string, ApplicationGeneratedSecretValue>>;
  readonly consumers: readonly string[];
  /**
   * Stable-name Secrets can order the root composition without injecting an
   * Alchemy output into the TypeKro schema.
   */
  readonly referenceMode?: "staticIdentity";
}

export type ApplicationGeneratedSecretValue =
  | {
      readonly kind: "hostEnvironment";
      readonly name: string;
    }
  | {
      readonly kind: "random";
      readonly bytes: number;
      readonly encoding: "base64url";
      readonly characters?: number;
    }
  | {
      /** Private JWK material is generated only by the operation host. */
      readonly kind: "jwkSet";
      readonly algorithm: "RS256";
      readonly modulusLength: 2048 | 3072 | 4096;
      readonly keyId: string;
    }
  | {
      readonly kind: "publicLiteral";
      readonly value: string;
    };

export interface ApplicationArtifactRequirement {
  readonly id: string;
  readonly artifactType:
    | "containerImage"
    | "wasmComponent"
    | "migration"
    | "generatedRuntime";
  readonly name: string;
  readonly sourceDigest: string;
  readonly sourceDescriptor: DeploymentJsonObject;
  readonly semanticNodeId?: string;
  /** Semantic execution nodes whose code is placed in this artifact. */
  readonly executionNodeIds?: readonly string[];
  readonly logicalReference?: string;
}

export interface ApplicationDeploymentPlanningContext {
  readonly graph: ApplicationGraph;
  readonly target: ApplicationDeploymentTargetKind;
  readonly connection: ApplicationDeploymentConnectionIdentity;
  readonly instance: string;
  readonly profile: string;
  readonly strategy: ApplicationDeploymentStrategy;
  readonly installationSpec: DeploymentJsonObject;
  /**
   * Compiler-authored Kubernetes resources for this exact application
   * instance. Provider contributors may inspect stable resource identities
   * and ports, but must not mutate or independently deploy these resources.
   */
  readonly materializedComposition?: {
    readonly resources: readonly DeploymentJsonObject[];
    readonly status: DeploymentJsonObject;
  };
}

export interface ApplicationDeploymentContribution {
  readonly nodes: readonly ApplicationDeploymentNode[];
  readonly edges: readonly ApplicationDeploymentEdge[];
  readonly compositionFragments: readonly ApplicationTypeKroFragmentDescriptor[];
  /** Exact private data-plane identity supplied by the lifecycle-owning provider adapter. */
  readonly runtimeAccessTargets?: readonly ApplicationDeploymentRuntimeAccessTarget[];
  /** Provider-owned execution requirements authored at the lifecycle adapter boundary. */
  readonly runtimeAccessRequirements?: readonly ApplicationRuntimeAccessRequirement[];
  /** Physical provider workloads that host semantic and/or provider-owned execution. */
  readonly runtimeAccessWorkloads?: readonly ApplicationRuntimeAccessWorkloadPlacement[];
}

export type ApplicationDeploymentRuntimeAccessTarget =
  | {
      readonly capabilityId: string;
      readonly target: 'kubernetes';
      readonly namespace: string;
      readonly serviceName: string;
      readonly podSelector: Readonly<Record<string, string>>;
      readonly protocol: 'TCP' | 'UDP';
      readonly port: number;
    }
  | {
      /**
       * Explicit provider-owned external transport. This is never inferred by
       * scanning arbitrary configuration or rendered workload environment.
       */
      readonly capabilityId: string;
      readonly target: 'external';
      readonly protocol: 'TCP' | 'UDP';
      readonly port?: number;
      readonly destination:
        | { readonly kind: 'dnsName'; readonly hostname: string }
        | { readonly kind: 'externalContract'; readonly responsibility: string };
      readonly fidelity: 'port-only' | 'not-introspectable';
    };

export interface ApplicationTypeKroFragmentDescriptor extends DeploymentJsonObject {
  readonly id: string;
  readonly sourceNodeId: string;
  readonly providerInterface?: string;
  readonly providerImplementation?: string;
  readonly contributorVersion?: number;
  readonly execution?:
    | "root-composition"
    | "direct-provider"
    | "runtime-only"
    | "external-controller";
  readonly profile?: string;
  readonly configuration?: DeploymentJsonObject;
}

export interface ApplicationDeploymentContributor {
  readonly interface: string;
  readonly implementation: string;
  readonly version: number;
  contribute(
    provider: ApplicationProviderNode,
    context: ApplicationDeploymentPlanningContext,
  ): ApplicationDeploymentContribution;
}

export interface CompileApplicationDeploymentGraphResult {
  readonly graph: ApplicationDeploymentGraph;
  readonly contributorKeys: readonly string[];
  /** Source-attributed, target-specific least-privilege grants for every managed execution. */
  readonly runtimeAccess: ApplicationRuntimeAccessPlan;
}
