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
  const adapted = await adaptApplicationDeploymentToTypeKro({
    graph: options.graph,
    root,
    direct: bindApplicationTypeKroDirectNodes(
      options.graph,
      supportingFactory,
    ),
  });
  const deployment = createApplicationAlchemyDeployment({
    ...options,
    adapted,
  });
  if (options.graph.metadata.strategy !== "kro") return deployment;
  return {
    ...deployment,
    async destroy() {
      // Alchemy does not invoke a provider delete hook for a resource whose
      // prior transaction stopped in `creating`. A live KRO instance can still
      // exist in that state, so make the TypeKro factory the authoritative
      // preflight for every destroy. This is idempotent when Alchemy already
      // holds a completed resource and guarantees that children/finalizers
      // drain before artifact, Secret, RGD, or Namespace teardown begins.
      const factory = composition.factory("kro", rootFactory);
      if (!factory.deleteInstance || !factory.dispose) {
        throw new Error(
          `TypeKro composition ${composition.name} does not expose the v0.32 deleteInstance/dispose lifecycle contract.`,
        );
      }
      try {
        const result = await factory.deleteInstance(
          options.graph.metadata.identity.instance,
          {
            ...(rootFactory.timeout !== undefined
              ? { timeout: rootFactory.timeout }
              : {}),
          },
        );
        if (result.status !== "complete") {
          throw new Error(
            `TypeKro root instance deletion is ${result.status}: ${result.blockers
              .map((blocker) => blocker.message)
              .join("; ") || "finalization has not completed"}`,
          );
        }
      } finally {
        await factory.dispose();
      }
      return deployment.destroy();
    },
  };
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
