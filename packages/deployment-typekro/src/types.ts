import type { ApplicationDeploymentGraph } from "@applik8s/deployment-contract";
import type { AlchemyResourceDeclaration } from "typekro/alchemy";
import type {
  CompositionInspection,
  DesiredStatePlan,
  PlanDiagnostic,
} from "typekro/experimental/planning";

/**
 * A canonical TypeKro declaration plus host-only scheduling edges.
 *
 * `dependsOn` belongs exclusively to TypeKro's artifact bundle and may never
 * be rewritten by Applik8s. These ids let Alchemy order independently compiled
 * declaration components without presenting those host edges to TypeKro as
 * resource/reference dependencies.
 */
export interface ApplicationTypeKroDeclaration
  extends AlchemyResourceDeclaration {
  readonly orderingOnlyDependsOn?: readonly string[];
}

export interface TypeKroCompositionBinding {
  readonly compositionId: string;
  inspect(): CompositionInspection;
  plan(): DesiredStatePlan;
  declarations(
    strategy: "direct" | "kro",
  ): Promise<readonly ApplicationTypeKroDeclaration[]>;
}

export interface AdaptApplicationDeploymentToTypeKroRequest {
  readonly graph: ApplicationDeploymentGraph;
  readonly root: TypeKroCompositionBinding;
  readonly direct?: Readonly<Record<string, TypeKroCompositionBinding>>;
}

export interface TypeKroSemanticPlanEvidence {
  readonly version: 1;
  readonly composition: string;
  readonly inputDigest: string;
  readonly semanticContentDigest: string;
  readonly planIdentityDigest: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly diagnostics: readonly TypeKroAdapterDiagnostic[];
}

export interface TypeKroAdapterDiagnostic {
  readonly code: string;
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
  readonly path?: string;
}

export interface TypeKroDeclarationGroup {
  readonly deploymentNodeId: string;
  readonly strategy: "direct" | "kro";
  readonly declarations: readonly ApplicationTypeKroDeclaration[];
  readonly declarationDigest: string;
  readonly semanticPlan: TypeKroSemanticPlanEvidence;
}

export interface AdaptedTypeKroDeployment {
  readonly adapter: {
    readonly typekro: "0.31.1";
    readonly semanticPlanVersion: 1;
    readonly artifactPlanVersion: 1;
  };
  readonly root: TypeKroDeclarationGroup;
  readonly direct: readonly TypeKroDeclarationGroup[];
  /**
   * One topologically ordered declaration list for Alchemy materialization.
   * TypeKro's canonical per-composition dependencies are preserved exactly.
   * Graph-level, cross-composition ordering is lowered by the Alchemy adapter
   * as ordering-only Inputs so it cannot corrupt TypeKro execution records.
   */
  readonly declarations: readonly ApplicationTypeKroDeclaration[];
  readonly declarationCount: number;
  readonly materializationDigest: string;
  readonly evidenceDigest: string;
}

export function normalizeTypeKroDiagnostic(
  diagnostic: PlanDiagnostic,
): TypeKroAdapterDiagnostic {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    ...(diagnostic.path ? { path: diagnostic.path } : {}),
  };
}
