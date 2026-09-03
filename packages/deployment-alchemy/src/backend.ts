// typecast-file-boundary: Alchemy Output values are converted only at this backend adapter boundary.
import {
  digestApplicationDeploymentGraph,
  type ApplicationDeploymentGraph,
} from "@applik8s/deployment-contract";
import {
  ApplicationHarborProject,
  type ApplicationHarborProjectAttributes,
  type ApplicationHarborProjectProviderOptions,
  applicationHarborProjectProvider,
} from "@applik8s/deployment-provider-harbor";
import {
  ApplicationGeneratedSecret,
  type ApplicationGeneratedSecretAttributes,
  applicationGeneratedSecretProvider,
} from "@applik8s/deployment-provider-kubernetes";
import {
  ApplicationContainerArtifact,
  type ApplicationContainerArtifactAttributes,
  type ApplicationContainerArtifactProviderOptions,
  type ApplicationContainerArtifactRegistry,
  applicationContainerArtifactProvider,
} from "@applik8s/deployment-provider-oci";
import type { AdaptedTypeKroDeployment } from "@applik8s/deployment-typekro";
import { deploy as deployAlchemyStack } from "alchemy/Deploy";
import { destroy as destroyAlchemyStack } from "alchemy/Destroy";
import * as Output from "alchemy/Output";
import * as Plan from "alchemy/Plan";
import {
  destroy as destroyAlchemyResource,
  retain as retainAlchemyResource,
} from "alchemy/RemovalPolicy";
import { evalStack, Stack } from "alchemy/Stack";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  type AlchemyArtifactBinding,
  KroResource,
  kroProvider,
  materializeAlchemyResources,
} from "typekro/alchemy";
import {
  artifactBaseId,
  artifactNodes,
  artifactPrerequisites,
  artifactProps,
} from "./artifact-resources.js";
import {
  assertGeneratedSecretHostEnvironmentAvailable,
  generatedSecretNodes,
  generatedSecretProps,
} from "./generated-secrets.js";
import { assertExecutableGraphCoverage } from "./graph-coverage.js";
import {
  harborProjectNodes,
  harborProjectProps,
} from "./harbor-resources.js";
import {
  type ApplicationAlchemyStackIdentity,
  applicationAlchemyStackIdentity,
} from "./identity.js";
import { claimApplicationAlchemyStackIdentity } from "./identity-registry.js";
import type { ApplicationAlchemyLease } from "./lease.js";
import { withDeploymentLease } from "./deployment-lease.js";
import { assertApplicationAlchemyDestroyCompleted } from "./destroy-state.js";
import { runApplicationAlchemyEffect } from "./runtime.js";
import { applicationAlchemyState } from "./state.js";
import {
  orderedTypeKroGroups,
  typeKroGroupPrerequisites,
  withOrderingOnlyPrerequisites,
} from "./typekro-ordering.js";
import { typeKroMaterializationComponents } from "./typekro-components.js";
import { typeKroCompositionOutputBinding } from "./typekro-output-binding.js";

export interface ApplicationAlchemyDeploymentOptions {
  readonly graph: ApplicationDeploymentGraph;
  readonly adapted: AdaptedTypeKroDeployment;
  readonly stateRoot: string;
  readonly stage?: string;
  readonly owner?: string;
  readonly leaseTtlMs?: number;
  /** @internal Operation-wide lease supplied by deployment migration. */
  readonly lease?: ApplicationAlchemyLease;
  readonly profile?: string;
  readonly adopt?: boolean;
  readonly dev?: boolean;
  readonly artifactRegistry?: ApplicationContainerArtifactRegistry;
  readonly artifactProvider?: ApplicationContainerArtifactProviderOptions;
  readonly harborProvider?: ApplicationHarborProjectProviderOptions;
}

export interface ApplicationAlchemyPlanChange {
  readonly id: string;
  readonly type: string;
  readonly action: "create" | "update" | "replace" | "noop" | "delete";
}

export interface ApplicationAlchemyPlanResult {
  readonly stack: ApplicationAlchemyStackIdentity;
  readonly stage: string;
  readonly changes: readonly ApplicationAlchemyPlanChange[];
  readonly declarationCount: number;
  readonly deploymentEvidenceDigest: string;
  readonly planIdentityDigest: string;
}

export interface ApplicationAlchemyApplyResult {
  readonly stack: ApplicationAlchemyStackIdentity;
  readonly stage: string;
  readonly declarationCount: number;
  readonly deploymentEvidenceDigest: string;
  readonly planIdentityDigest: string;
  readonly artifacts: readonly ApplicationContainerArtifactAttributes[];
  /**
   * Alchemy transaction completion is intentionally distinct from live
   * Kubernetes/Application readiness.
   */
  readonly transaction: "applied";
}

export interface ApplicationAlchemyDestroyResult {
  readonly stack: ApplicationAlchemyStackIdentity;
  readonly stage: string;
  readonly transaction: "destroyed";
}

export interface ApplicationAlchemyDeployment {
  readonly stack: ApplicationAlchemyStackIdentity;
  readonly stage: string;
  plan(): Promise<ApplicationAlchemyPlanResult>;
  apply(): Promise<ApplicationAlchemyApplyResult>;
  destroy(): Promise<ApplicationAlchemyDestroyResult>;
}

export function createApplicationAlchemyDeployment(
  options: ApplicationAlchemyDeploymentOptions,
): ApplicationAlchemyDeployment {
  assertExecutableGraphCoverage(options.graph);
  if (
    options.graph.metadata.identity.application !==
    options.adapted.root.semanticPlan.composition
  ) {
    throw new Error(
      `Alchemy deployment graph application ${options.graph.metadata.identity.application} does not match TypeKro composition ${options.adapted.root.semanticPlan.composition}.`,
    );
  }
  const stack = applicationAlchemyStackIdentity(
    options.graph.metadata.identity,
    options.graph.metadata.strategy,
  );
  const stage = safeStage(options.stage ?? "installation");
  const planIdentityDigest = digestApplicationDeploymentGraph(options.graph);
  const state = applicationAlchemyState({ root: options.stateRoot });
  const runtime = {
    state,
    ...(options.profile ? { profile: options.profile } : {}),
    ...(options.adopt !== undefined ? { adopt: options.adopt } : {}),
    ...(options.dev !== undefined ? { dev: options.dev } : {}),
  };
  const artifacts = artifactNodes(options.graph);
  const harborProjects = harborProjectNodes(options.graph);
  const generatedSecrets = generatedSecretNodes(options.graph);
  if (artifacts.length > 0 && !options.artifactRegistry) {
    throw new Error(
      `Application deployment contains ${artifacts.length} artifact node(s), but no artifactRegistry was configured.`,
    );
  }
  const providers = Layer.mergeAll(
    kroProvider,
    applicationContainerArtifactProvider(options.artifactProvider),
    applicationGeneratedSecretProvider(),
    applicationHarborProjectProvider(
      options.harborProvider ?? {
        resolveCredential: async (reference) => {
          throw new Error(
            `Harbor credential ${reference.namespace}/${reference.name} has no runtime resolver.`,
          );
        },
      },
    ),
  );
  const stackEffect = () =>
    Stack(
      stack.key,
      // typecast: TypeKro's materializer currently exposes an
      // typecast: kroProvider closes TypeKro's currently unknown Effect requirement.
      { providers, state } as never,
      // typecast: Stack's pinned Effect environment is closed by the providers above.
      Effect.gen(function* () {
        const bindings: Record<string, AlchemyArtifactBinding> = {};
        const artifactOutputs: ApplicationContainerArtifactAttributes[] = [];
        const artifactResources = new Map<
          string,
          ApplicationContainerArtifactAttributes
        >();
        const harborOutputs = new Map<
          string,
          ApplicationHarborProjectAttributes
        >();
        const namespaceDeclarationIds = new Set(
          options.adapted.direct
            .filter((group) => {
              const node = options.graph.nodes.find(
                (candidate) => candidate.id === group.deploymentNodeId,
              );
              return (
                node?.kind === "kubernetesDirect" &&
                node.spec.compositionId === "applik8s-namespace"
              );
            })
            .flatMap((group) =>
              group.declarations.map((declaration) => declaration.id),
            ),
        );
        const namespaceDeclarations = options.adapted.declarations.filter(
          (declaration) => namespaceDeclarationIds.has(declaration.id),
        );
        const namespaceResources =
          namespaceDeclarations.length > 0
            ? yield* materializeAlchemyResources(
                KroResource,
                namespaceDeclarations,
                { artifacts: bindings },
              )
            : {};
        const namespaceHandles = Object.values(namespaceResources);
        const groupResources = new Map<string, readonly unknown[]>();
        for (const group of options.adapted.direct) {
          if (
            group.declarations.some((declaration) =>
              namespaceDeclarationIds.has(declaration.id),
            )
          ) {
            groupResources.set(
              group.deploymentNodeId,
              group.declarations
                .map((declaration) => namespaceResources[declaration.id])
                .filter((resource) => resource !== undefined),
            );
          }
        }
        const generatedSecretOutputs = new Map<
          string,
          ApplicationGeneratedSecretAttributes
        >();
        for (const secret of generatedSecrets) {
          const props = generatedSecretProps(
            secret,
            options.graph,
            namespaceHandles,
          );
          const declaration = ApplicationGeneratedSecret(secret.id, props);
          const resource = yield* (
            props.deletionPolicy === "delete"
              ? destroyAlchemyResource()(declaration)
              : retainAlchemyResource()(declaration)
          );
          bindings[secret.id] = {
            resource,
            outputs: {
              name: resource.name,
              namespace: resource.namespace,
            },
          };
          generatedSecretOutputs.set(
            secret.id,
            resource as unknown as ApplicationGeneratedSecretAttributes,
          );
        }
        for (const project of harborProjects) {
          const resource = yield* ApplicationHarborProject(
            project.id,
            harborProjectProps(
              project,
              options.graph,
              options.artifactRegistry,
            ),
          );
          // typecast: Alchemy resolves resource Outputs before returning from
          // typecast: deploy; the map is used only to create dependency inputs.
          harborOutputs.set(
            project.id,
            resource as unknown as ApplicationHarborProjectAttributes,
          );
        }
        for (const artifact of artifacts) {
          const baseArtifactId = artifactBaseId(artifact);
          const baseArtifact = baseArtifactId
            ? artifactResources.get(baseArtifactId)
            : undefined;
          if (baseArtifactId && !baseArtifact) {
            throw new Error(
              `Artifact ${artifact.id} requires base artifact ${baseArtifactId}, but it has not been materialized.`,
            );
          }
          const publishedBaseImage = baseArtifact
            ? compatiblePublishedBuildReference(baseArtifact)
            : undefined;
          const resource = yield* ApplicationContainerArtifact(
            artifact.id,
            {
              ...artifactProps(
                artifact,
                options.artifactRegistry,
                // typecast: artifactProps creates the provider's resolved
                // typecast: props shape; Alchemy evaluates this Output before
                // typecast: the provider receives its string build argument.
                publishedBaseImage as unknown as string | undefined,
              ),
              prerequisites: artifactPrerequisites(
                options.graph,
                artifact.id,
                harborOutputs,
                artifactResources,
              ),
            },
          );
          artifactResources.set(
            artifact.id,
            resource as unknown as ApplicationContainerArtifactAttributes,
          );
          bindings[artifact.id] = {
            resource,
            outputs: {
              immutableReference: resource.immutableReference,
              taggedReference: resource.taggedReference,
              digest: resource.digest,
            },
          };
          // typecast: inside a Stack, Alchemy represents resource attributes as
          // typecast: Outputs; deployAlchemyStack resolves them before returning.
          artifactOutputs.push(
            resource as unknown as ApplicationContainerArtifactAttributes,
          );
        }
        const kubernetes: Record<string, unknown> = {
          ...namespaceResources,
        };
        for (const group of orderedTypeKroGroups(
          options.graph,
          options.adapted,
        )) {
          if (groupResources.has(group.deploymentNodeId)) continue;
          const prerequisiteHandles = typeKroGroupPrerequisites(
            options.graph,
            group.deploymentNodeId,
          ).flatMap((nodeId) => {
            const groupHandles = groupResources.get(nodeId);
            if (groupHandles) return groupHandles;
            const binding = bindings[nodeId];
            return binding ? [binding.resource] : [];
          });
          const resources: Record<string, unknown> = {};
          for (const component of typeKroMaterializationComponents(
            group.declarations,
          )) {
            const componentPrerequisites = [
              ...prerequisiteHandles,
              ...component.orderingOnlyDeclarationIds.map((id) => {
                const resource = resources[id];
                if (!resource) {
                  throw new Error(
                    `TypeKro ordering-only dependency ${id} was not materialized before its consumer component.`,
                  );
                }
                return resource;
              }),
            ];
            const declarations = withOrderingOnlyPrerequisites(
              component.declarations,
              componentPrerequisites,
            );
            const componentResources = yield* materializeAlchemyResources(
              KroResource,
              declarations,
              { artifacts: bindings },
            );
            Object.assign(resources, componentResources);
          }
          Object.assign(kubernetes, resources);
          groupResources.set(
            group.deploymentNodeId,
            Object.values(resources),
          );
          const outputBinding = typeKroCompositionOutputBinding(
            options.graph,
            group,
            resources,
            bindings,
          );
          if (outputBinding) {
            bindings[group.deploymentNodeId] = outputBinding;
          }
        }
        return {
          artifacts: artifactOutputs,
          generatedSecrets: [...generatedSecretOutputs.values()],
          namespaces: namespaceResources,
          kubernetes,
        };
      }) as never,
    );
  return {
    stack,
    stage,
    plan: () =>
      withDeploymentLease(options, stack, async () => {
        await claimApplicationAlchemyStackIdentity(options.stateRoot, stack);
        // typecast: evalStack's generic output is erased by the
        // typecast: the pinned runtime erases evalStack output; this callback returns Plan.Plan.
        const plan = (await runApplicationAlchemyEffect(
          evalStack(
            stackEffect(),
            (compiled) => Plan.make(compiled),
            {
              stage,
              ...(options.dev !== undefined ? { dev: options.dev } : {}),
            },
          ),
          runtime,
        )) as Plan.Plan;
        return {
          stack,
          stage,
          changes: summarizePlan(plan),
          declarationCount: options.adapted.declarationCount,
          deploymentEvidenceDigest: options.adapted.evidenceDigest,
          planIdentityDigest,
        };
      }),
    apply: () =>
      withDeploymentLease(options, stack, async () => {
        assertGeneratedSecretHostEnvironmentAvailable(generatedSecrets);
        await claimApplicationAlchemyStackIdentity(options.stateRoot, stack);
        const output = (await runApplicationAlchemyEffect(
          deployAlchemyStack({
            stack: stackEffect(),
            stage,
            ...(options.dev !== undefined ? { dev: options.dev } : {}),
          }),
          runtime,
        )) as {
          readonly artifacts: readonly ApplicationContainerArtifactAttributes[];
        };
        return {
          stack,
          stage,
          declarationCount: options.adapted.declarationCount,
          deploymentEvidenceDigest: options.adapted.evidenceDigest,
          planIdentityDigest,
          artifacts: output.artifacts,
          transaction: "applied",
        };
      }),
    destroy: () =>
      withDeploymentLease(options, stack, async () => {
        await claimApplicationAlchemyStackIdentity(options.stateRoot, stack);
        await runApplicationAlchemyEffect(
          destroyAlchemyStack({
            stack: stackEffect(),
            stage,
            ...(options.dev !== undefined ? { dev: options.dev } : {}),
          }),
          runtime,
        );
        await assertApplicationAlchemyDestroyCompleted({
          stateRoot: options.stateRoot,
          stack: stack.key,
          stage,
        });
        return { stack, stage, transaction: "destroyed" };
      }),
  };
}

function compatiblePublishedBuildReference(
  artifact: ApplicationContainerArtifactAttributes,
) {
  // Deployment references and Dockerfile FROM references have subtly
  // different requirements on a local engine. Kubernetes can run an OrbStack
  // image by its digest-only image ID, but BuildKit interprets that same value
  // as docker.io/library/sha256:<digest>. Resolve all aliases inside Alchemy and
  // retain the tag solely as the build address when the immutable identity is
  // local-only. The resulting child artifact is still deployed by its own
  // immutable output.
  return Output.map(
    Output.all(
      Output.asOutput(artifact.publishedImmutableReference),
      Output.asOutput(artifact.publishedTaggedReference),
      Output.asOutput(artifact.immutableReference),
      Output.asOutput(artifact.taggedReference),
    ),
    ([publishedImmutable, publishedTagged, immutable, tagged]) =>
      selectPublishedBuildReference(
        publishedImmutable,
        publishedTagged,
        immutable,
        tagged,
      ),
  );
}

export function selectPublishedBuildReference(
  publishedImmutable: unknown,
  publishedTagged: unknown,
  immutable: unknown,
  tagged: unknown,
): string {
  const preferredImmutable = firstNonEmptyString(
    publishedImmutable,
    immutable,
  );
  if (preferredImmutable && !isLocalImageId(preferredImmutable)) {
    return preferredImmutable;
  }
  const buildAddress = firstNonEmptyString(publishedTagged, tagged);
  if (buildAddress) return buildAddress;
  if (preferredImmutable) {
    throw new Error(
      `Local immutable image identity ${preferredImmutable} has no tagged build address.`,
    );
  }
  throw new Error(
    "Container artifact has neither a published nor deployment build reference.",
  );
}

export function selectPublishedImmutableReference(
  published: unknown,
  immutable: unknown,
): string {
  if (typeof published === "string" && published.trim()) return published;
  if (typeof immutable === "string" && immutable.trim()) return immutable;
  throw new Error(
    "Container artifact has neither a published nor deployment immutable reference.",
  );
}

function firstNonEmptyString(...values: readonly unknown[]): string | undefined {
  return values.find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
}

function isLocalImageId(reference: string): boolean {
  return /^sha256:[a-f0-9]{64}$/.test(reference);
}

function summarizePlan(plan: Plan.Plan): readonly ApplicationAlchemyPlanChange[] {
  const changes: ApplicationAlchemyPlanChange[] = [];
  for (const [id, node] of Object.entries(plan.resources)) {
    changes.push({
      id,
      type: node.resource.Type,
      action: node.action,
    });
  }
  for (const [id, node] of Object.entries(plan.deletions)) {
    if (!node) continue;
    changes.push({
      id,
      type: node.resource.Type,
      action: "delete",
    });
  }
  return changes.sort(
    (left, right) =>
      left.id.localeCompare(right.id) || left.action.localeCompare(right.action),
  );
}

function safeStage(value: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(value) || value === "." || value === "..") {
    throw new Error(`Alchemy stage ${value} is invalid.`);
  }
  return value;
}
