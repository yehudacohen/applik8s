import type { ApplicationDeploymentGraph } from "@applik8s/deployment-contract";
import {
  type ApplicationTypeKroCompositionSource,
  type AdaptedTypeKroDeployment,
  type TypeKroCompositionBinding,
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
import { orderedTypeKroGroups } from "./typekro-ordering.js";

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
  const supportingFactory = supportingFactoryOptions(rootFactory);
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
              factory: supportingFactory,
              instanceNameOverride: options.graph.metadata.identity.instance,
            },
          ),
        )
      : primary;
  const direct = bindApplicationTypeKroDirectNodes(
    options.graph,
    supportingFactory,
  );
  const adapted = await adaptApplicationDeploymentToTypeKro({
    graph: options.graph,
    root,
    direct,
  });
  const deployment = createApplicationAlchemyDeployment({
    ...options,
    adapted,
  });
  return {
    ...deployment,
    async destroy() {
      // An interrupted Alchemy transaction can leave a live Kubernetes object
      // while its declaration is still `creating`; Alchemy then has no
      // committed provider state from which to invoke delete. TypeKro remains
      // the lifecycle authority, so converge every composition instance to
      // absence first, in reverse dependency order, and let Alchemy remove the
      // remaining external resources and durable state afterward.
      await deleteApplicationTypeKroInstances(
        options.graph,
        adapted,
        root,
        direct,
      );
      return deployment.destroy();
    },
  };
}

/** @internal Exported from this module only for lifecycle contract tests. */
export async function deleteApplicationTypeKroInstances(
  graph: ApplicationDeploymentGraph,
  adapted: AdaptedTypeKroDeployment,
  root: TypeKroCompositionBinding,
  direct: Readonly<Record<string, TypeKroCompositionBinding>>,
): Promise<void> {
  const bindings = new Map([
    ["kubernetes.application", root] as const,
    ...Object.entries(direct),
  ]);
  const ordered = [...orderedTypeKroGroups(graph, adapted)].reverse();
  for (const group of ordered) {
    const binding = bindings.get(group.deploymentNodeId);
    if (!binding) {
      throw new Error(
        `TypeKro lifecycle binding ${group.deploymentNodeId} is missing during application teardown.`,
      );
    }
    await binding.deleteInstance(group.strategy);
  }
}

/**
 * Aspects are authored against the compiler-materialized application root.
 * Reapplying them to prerequisite and source-schema compositions would repeat
 * cardinality checks against unrelated graphs and could mutate shared
 * infrastructure accidentally.
 */
function supportingFactoryOptions(
  root: PublicFactoryOptions,
): PublicFactoryOptions {
  const supporting = { ...root };
  delete supporting.aspects;
  return supporting;
}
