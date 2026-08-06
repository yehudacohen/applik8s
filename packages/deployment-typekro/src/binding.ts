import type {
  ApplicationDeploymentGraph,
  ApplicationDeploymentNode,
  DeploymentJsonObject,
} from "@applik8s/deployment-contract";
import type {
  KroCompatibleType,
  PublicFactoryOptions,
} from "typekro";
import type { AlchemyResourceDeclaration } from "typekro/alchemy";
import { lowerPlanValue } from "typekro/experimental/planning";
import type {
  CompositionInspection,
  DeclaredInputBinding,
  DesiredStatePlan,
  PlanOptions,
} from "typekro/experimental/planning";
import type { TypeKroCompositionBinding } from "./types.js";

export interface TypeKroArtifactRequirementBinding {
  readonly id: string;
  readonly kind: string;
  readonly descriptor: DeploymentJsonObject;
  readonly outputs: readonly string[];
}

export interface BindTypeKroCompositionOptions {
  readonly factory?: PublicFactoryOptions;
  readonly instanceNameOverride?: string;
  /**
   * Portable artifact requirements consumed by artifactOutput() calls inside
   * this composition. The adapter translates them into TypeKro's pinned
   * experimental planning input without exposing that DTO to Applik8s graphs.
   */
  readonly artifacts?: readonly TypeKroArtifactRequirementBinding[];
}

/**
 * Translate the portable artifact edges for one TypeKro deployment node into
 * the pinned planning inputs expected by bindTypeKroComposition().
 */
export function typeKroArtifactRequirements(
  graph: ApplicationDeploymentGraph,
  deploymentNodeId: string,
): readonly TypeKroArtifactRequirementBinding[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const outputs = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (
      edge.relationship !== "requiresOutput" ||
      edge.to !== deploymentNodeId ||
      !edge.output
    ) {
      continue;
    }
    const producer = nodes.get(edge.from);
    if (!producer || !isTypeKroArtifactProducer(producer)) continue;
    const names = outputs.get(producer.id) ?? new Set<string>();
    names.add(edge.output);
    outputs.set(producer.id, names);
  }
  return [...outputs.entries()]
    .map(([nodeId, names]) => {
      const node = nodes.get(nodeId);
      if (!node || !isTypeKroArtifactProducer(node)) {
        throw new Error(`Deployment artifact ${nodeId} is missing.`);
      }
      return {
        id: node.id,
        kind: typeKroArtifactKind(node),
        descriptor:
          node.kind === "artifact"
            ? node.spec.sourceDescriptor
            : node.kind === "kubernetesDirect"
              ? {
                  compositionId: node.spec.compositionId,
                  configurationDigest: node.configurationDigest,
                }
              : {
                resourceType: node.spec.resourceType,
                provider: node.provider.implementation,
                configurationDigest: node.configurationDigest,
              },
        outputs: [...names].sort(),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function typeKroArtifactKind(
  node:
    | Extract<ApplicationDeploymentNode, { readonly kind: "artifact" }>
    | Extract<ApplicationDeploymentNode, { readonly kind: "externalProvider" }>
    | Extract<ApplicationDeploymentNode, { readonly kind: "kubernetesDirect" }>,
): string {
  if (node.kind === "kubernetesDirect") return "typekro-composition";
  if (node.kind === "externalProvider") {
    return "kubernetes-secret-reference";
  }
  return node.spec.artifactType === "wasmComponent"
    ? "wasm-component"
    : "container-image";
}

function isTypeKroArtifactProducer(
  node: ApplicationDeploymentNode,
): node is
  | Extract<ApplicationDeploymentNode, { readonly kind: "artifact" }>
  | Extract<ApplicationDeploymentNode, { readonly kind: "externalProvider" }>
  | Extract<ApplicationDeploymentNode, { readonly kind: "kubernetesDirect" }> {
  return (
    node.kind === "artifact" ||
    node.kind === "kubernetesDirect" ||
    (node.kind === "externalProvider" &&
      node.provider.interface === "Secret" &&
      node.provider.implementation ===
        "alchemy-kubernetes-generated-secret" &&
      node.spec.resourceType === "kubernetesGeneratedSecret")
  );
}

export interface TypeKroPlannableComposition<TSpec extends KroCompatibleType> {
  readonly name: string;
  inspect?(): CompositionInspection;
  plan?(spec: TSpec, options?: PlanOptions): DesiredStatePlan;
  factory(
    mode: "direct" | "kro",
    options?: PublicFactoryOptions,
  ): {
    toAlchemyResources(
      spec: TSpec,
      options?: { readonly instanceNameOverride?: string },
    ): Promise<AlchemyResourceDeclaration[]>;
    deleteInstance?(
      name: string,
      options?: { readonly timeout?: number },
    ): Promise<{
      readonly status: string;
      readonly blockers: readonly { readonly message: string }[];
    }>;
    dispose?(): Promise<void>;
  };
}

/**
 * Binds a concrete installation spec to a TypeKro composition without
 * materializing or deploying it. The resulting adapter boundary deliberately
 * hides TypeKro's experimental planning DTOs from the portable deployment IR.
 */
export function bindTypeKroComposition<
  TSpec extends KroCompatibleType,
>(
  composition: TypeKroPlannableComposition<TSpec>,
  spec: TSpec,
  options: BindTypeKroCompositionOptions = {},
): TypeKroCompositionBinding {
  const plan = planOptions(options);
  return {
    compositionId: composition.name,
    inspect() {
      if (!composition.inspect) {
        throw new Error(
          `TypeKro composition ${composition.name} does not expose semantic inspection. Applik8s requires TypeKro 0.33.5.`,
        );
      }
      return composition.inspect();
    },
    plan() {
      if (!composition.plan) {
        throw new Error(
          `TypeKro composition ${composition.name} does not expose semantic planning. Applik8s requires TypeKro 0.33.5.`,
        );
      }
      return composition.plan(spec, plan);
    },
    async declarations(strategy) {
      const factory = composition.factory(strategy, {
        ...options.factory,
        plan,
      });
      return factory.toAlchemyResources(spec, {
        ...(options.instanceNameOverride
          ? { instanceNameOverride: options.instanceNameOverride }
          : {}),
      });
    },
  };
}

/**
 * Preserve TypeKro-owned singleton/supporting declarations from the authored
 * composition while replacing its application root with the compiler's
 * authoritative generated composition.
 *
 * TypeKro 0.31 declaration ids are the stable join key. The authored and
 * generated roots intentionally share ids; declarations unique to the
 * authored set are supporting infrastructure.
 */
export function bindTypeKroCompositionWithSupportingDeclarations(
  primary: TypeKroCompositionBinding,
  authored: TypeKroCompositionBinding,
): TypeKroCompositionBinding {
  if (primary.compositionId !== authored.compositionId) {
    throw new Error(
      `Cannot combine TypeKro compositions ${primary.compositionId} and ${authored.compositionId}.`,
    );
  }
  return {
    compositionId: primary.compositionId,
    inspect: () => primary.inspect(),
    plan: () => primary.plan(),
    async declarations(strategy) {
      const authoredDeclarations = await authored.declarations(strategy);
      const primaryDeclarations = await primary.declarations(strategy);
      const primaryIds = new Set(
        primaryDeclarations.map((declaration) => declaration.id),
      );
      const supporting = authoredDeclarations.filter(
        (declaration) => !primaryIds.has(declaration.id),
      );
      if (supporting.length === 0) return primaryDeclarations;
      const supportingIds = new Set(
        supporting.map((declaration) => declaration.id),
      );
      const dependedOn = new Set(
        supporting.flatMap((declaration) =>
          [
            ...declaration.dependsOn,
            ...(declaration.schedulingDependsOn ?? []),
          ].filter((id) => supportingIds.has(id)),
        ),
      );
      const terminals = supporting
        .map((declaration) => declaration.id)
        .filter((id) => !dependedOn.has(id))
        .sort();
      return [
        ...supporting,
        ...primaryDeclarations.map((declaration) => {
          const hasPrimaryDependency = declaration.dependsOn.some((id) =>
            primaryIds.has(id),
          );
          if (hasPrimaryDependency) return declaration;
          return {
            ...declaration,
            orderingOnlyDependsOn: [
              ...new Set([
                ...(declaration.orderingOnlyDependsOn ?? []),
                ...terminals,
              ]),
            ].sort(),
          };
        }),
      ];
    },
  };
}

function planOptions(options: BindTypeKroCompositionOptions): PlanOptions {
  const inputs: Record<string, DeclaredInputBinding> = {
    ...(options.factory?.plan?.inputs ?? {}),
  };
  for (const artifact of options.artifacts ?? []) {
    if (!artifact.id.trim() || !artifact.kind.trim()) {
      throw new Error("TypeKro artifact requirements require non-empty ids and kinds.");
    }
    if (
      artifact.outputs.length === 0 ||
      artifact.outputs.some((output) => !output.trim())
    ) {
      throw new Error(
        `TypeKro artifact requirement ${artifact.id} must declare non-empty outputs.`,
      );
    }
    if (Object.hasOwn(inputs, artifact.id)) {
      throw new Error(
        `TypeKro planning input ${artifact.id} collides with an artifact requirement.`,
      );
    }
    const descriptor = lowerPlanValue(artifact.descriptor, { strict: true });
    const descriptorErrors = descriptor.diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error",
    );
    if (descriptorErrors.length > 0) {
      throw new Error(
        `TypeKro artifact requirement ${artifact.id} has an invalid descriptor:\n${descriptorErrors
          .map((diagnostic) => `- [${diagnostic.code}] ${diagnostic.message}`)
          .join("\n")}`,
      );
    }
    inputs[artifact.id] = {
      kind: "artifact",
      requirement: {
        id: artifact.id,
        kind: artifact.kind,
        descriptor: descriptor.value,
        outputs: [...new Set(artifact.outputs)].sort(),
      },
    };
  }
  return {
    ...(options.factory?.plan ?? {}),
    strict: true,
    ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
  };
}
