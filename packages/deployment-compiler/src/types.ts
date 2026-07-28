import type { ApplicationGraph, ApplicationProviderNode } from "@applik8s/core";
import type {
  ApplicationDeploymentConnectionIdentity,
  ApplicationDeploymentEdge,
  ApplicationDeploymentGraph,
  ApplicationDeploymentGraphMode,
  ApplicationDeploymentNode,
  ApplicationDeploymentStrategy,
  DeploymentJsonObject,
} from "@applik8s/deployment-contract";

export interface CompileApplicationDeploymentGraphRequest {
  readonly graph: ApplicationGraph;
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
  readonly artifacts: readonly ApplicationArtifactRequirement[];
  readonly materializedComposition?: {
    readonly resources: readonly DeploymentJsonObject[];
    readonly status: DeploymentJsonObject;
  };
  /** Generated runtime credentials whose values are created only by the operation host. */
  readonly generatedSecrets?: readonly ApplicationGeneratedSecretRequirement[];
  readonly contributors?: readonly ApplicationDeploymentContributor[];
}

export interface ApplicationGeneratedSecretRequirement {
  /** Stable semantic identity; must not include the concrete installation namespace. */
  readonly id?: string;
  readonly namespace: string;
  readonly name: string;
  readonly values: Readonly<Record<string, ApplicationGeneratedSecretValue>>;
  readonly consumers: readonly string[];
}

export type ApplicationGeneratedSecretValue =
  | {
      readonly kind: "random";
      readonly bytes: number;
      readonly encoding: "base64url";
    }
  | {
      /** Explicitly non-sensitive metadata stored beside generated credentials. */
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
  readonly logicalReference?: string;
}

export interface ApplicationDeploymentPlanningContext {
  readonly graph: ApplicationGraph;
  readonly connection: ApplicationDeploymentConnectionIdentity;
  readonly instance: string;
  readonly profile: string;
  readonly strategy: ApplicationDeploymentStrategy;
  readonly installationSpec: DeploymentJsonObject;
}

export interface ApplicationDeploymentContribution {
  readonly nodes: readonly ApplicationDeploymentNode[];
  readonly edges: readonly ApplicationDeploymentEdge[];
  readonly compositionFragments: readonly ApplicationTypeKroFragmentDescriptor[];
}

export interface ApplicationTypeKroFragmentDescriptor extends DeploymentJsonObject {
  readonly id: string;
  readonly sourceNodeId: string;
  readonly providerInterface?: string;
  readonly providerImplementation?: string;
  readonly contributorVersion?: number;
  readonly execution?: "root-composition" | "runtime-only" | "external-controller";
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
}
