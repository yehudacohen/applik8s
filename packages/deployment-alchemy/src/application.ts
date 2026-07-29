import type { ApplicationDeploymentGraph } from "@applik8s/deployment-contract";
import {
  type ApplicationTypeKroCompositionSource,
  adaptApplicationDeploymentToTypeKro,
  assembleApplicationTypeKroComposition,
  bindApplicationTypeKroDirectNodes,
  bindTypeKroComposition,
  bindTypeKroCompositionWithSupportingDeclarations,
  typeKroArtifactRequirements,
} from "@applik8s/deployment-typekro";
import type {
  KroCompatibleType,
  PublicFactoryOptions,
} from "typekro";
import {
  type ApplicationAlchemyDeployment,
  type ApplicationAlchemyDeploymentOptions,
  createApplicationAlchemyDeployment,
} from "./backend.js";

export interface ApplicationAlchemyGraphDeploymentOptions<
  TSpec extends KroCompatibleType,
  TStatus extends KroCompatibleType,
> extends Omit<ApplicationAlchemyDeploymentOptions, "graph" | "adapted"> {
  readonly graph: ApplicationDeploymentGraph;
  readonly source: ApplicationTypeKroCompositionSource<TSpec, TStatus>;
  readonly spec: TSpec;
  readonly factory?: PublicFactoryOptions;
}

/**
 * Complete graph -> generated TypeKro composition -> Alchemy adapter boundary.
 * Ordinary CLI code supplies portable deployment data and connection policy;
 * it never sequences TypeKro declarations itself.
 */
export async function createApplicationAlchemyGraphDeployment<
  TSpec extends KroCompatibleType,
  TStatus extends KroCompatibleType,
>(
  options: ApplicationAlchemyGraphDeploymentOptions<TSpec, TStatus>,
): Promise<ApplicationAlchemyDeployment> {
  const rootFactory: PublicFactoryOptions = {
    ...(options.factory ? options.factory : {}),
    // The compiler-owned application composition is authoritative desired
    // state. A merge patch cannot remove fields that disappear from a
    // generated RGD, and TypeKro's canonical comparison deliberately ignores
    // unspecified live fields. Server-side apply gives the generated root a
    // stable field owner, prunes stale compiler output, and makes interrupted
    // update recovery convergent.
    applyPolicy: options.factory?.applyPolicy ?? {
      strategy: "server-side-apply",
      fieldManager: "applik8s-typekro",
      fieldConflictPolicy: "force-owned-fields",
      immutableFieldPolicy: "fail",
    },
  };
  const composition = assembleApplicationTypeKroComposition(
    options.graph,
    options.source,
  );
  const rootNodeId = "kubernetes.application";
  const primary = bindTypeKroComposition(composition, options.spec, {
    factory: rootFactory,
    instanceNameOverride: options.graph.metadata.identity.instance,
    artifacts: typeKroArtifactRequirements(options.graph, rootNodeId),
  });
  const root =
    options.graph.metadata.strategy === "kro"
      ? bindTypeKroCompositionWithSupportingDeclarations(
          primary,
          bindTypeKroComposition(
            options.source.composition ?? options.source,
            options.spec,
            {
              factory: rootFactory,
              instanceNameOverride: options.graph.metadata.identity.instance,
            },
          ),
        )
      : primary;
  const adapted = await adaptApplicationDeploymentToTypeKro({
    graph: options.graph,
    root,
    direct: bindApplicationTypeKroDirectNodes(
      options.graph,
      options.factory,
    ),
  });
  return createApplicationAlchemyDeployment({
    ...options,
    adapted,
  });
}
