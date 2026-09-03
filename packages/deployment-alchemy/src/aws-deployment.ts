// typecast-file-boundary: the validated portable AWS plan crosses into the
// pinned Alchemy runtime here; native adapters retain their own validation.
import type { ApplicationAwsDeploymentPlan } from "@applik8s/deployment-contract";
import { validateApplicationAwsDeploymentPlan } from "@applik8s/deployment-contract";
import { deploy as deployAlchemyStack } from "alchemy/Deploy";
import { destroy as destroyAlchemyStack } from "alchemy/Destroy";
import * as Output from "alchemy/Output";
import * as Plan from "alchemy/Plan";
import * as Provider from "alchemy/Provider";
import { type Resource as AlchemyResource, Resource } from "alchemy/Resource";
import { evalStack, Stack } from "alchemy/Stack";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  applicationAwsNativeProviders,
  applicationAwsNativeResourceDeclarations,
  materializeApplicationAwsNativeResources,
} from "./aws-native-resources.js";
import type {
  ApplicationAlchemyApplyResult,
  ApplicationAlchemyDestroyResult,
  ApplicationAlchemyPlanChange,
} from "./backend.js";
import { withDeploymentLease } from "./deployment-lease.js";
import {
  type ApplicationAlchemyStackIdentity,
  applicationAlchemyStackIdentity,
} from "./identity.js";
import { runApplicationAlchemyEffect } from "./runtime.js";
import { applicationAlchemyState, applicationAlchemyStateService } from "./state.js";

export interface ApplicationAwsDeploymentOptions {
  readonly plan: ApplicationAwsDeploymentPlan;
  readonly stateRoot: string;
  readonly imageUri?: string;
  readonly artifactImageUris?: Readonly<Record<string, string>>;
  readonly endpoint?: string;
  readonly profile?: string;
  readonly owner?: string;
  readonly leaseTtlMs?: number;
  readonly dev?: boolean;
  readonly buildApplicationImage?: ApplicationAwsImageBuilder;
  readonly buildRuntimeArtifactImage?: ApplicationAwsRuntimeArtifactImageBuilder;
  readonly buildCelldWorkerImage?: ApplicationAwsCelldWorkerImageBuilder;
  /** Process environment projected only into native Secrets Manager resources. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
  /** Additional AWS tags applied to every deployment-owned native resource. */
  readonly resourceTags?: Readonly<Record<string, string>>;
}

export interface ApplicationAwsImageBuilderRequest {
  readonly repositoryUri: string;
  readonly plan: ApplicationAwsDeploymentPlan;
  readonly signal?: AbortSignal;
}

export type ApplicationAwsImageBuilder = (request: ApplicationAwsImageBuilderRequest) => Promise<string>;
export interface ApplicationAwsRuntimeArtifactImageBuilderRequest extends ApplicationAwsImageBuilderRequest {
  readonly artifact: ApplicationAwsDeploymentPlan["runtimeArtifacts"][number];
}
export type ApplicationAwsRuntimeArtifactImageBuilder = (request: ApplicationAwsRuntimeArtifactImageBuilderRequest) => Promise<string>;
export interface ApplicationAwsCelldWorkerImageBuilderRequest extends ApplicationAwsImageBuilderRequest {}
export type ApplicationAwsCelldWorkerImageBuilder = (request: ApplicationAwsCelldWorkerImageBuilderRequest) => Promise<string>;

export interface ApplicationAwsDeploymentState {
  readonly planDigest: string;
  readonly status: "ready";
  readonly ownership: "alchemy-native";
  readonly ready: true;
  readonly resources: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly directOutputs: Readonly<Record<string, Readonly<Record<string, string | number>>>>;
  readonly imageUri?: string;
  readonly artifactImageUris?: Readonly<Record<string, string>>;
}

interface ApplicationAwsImageProps {
  readonly kind: "application" | "runtime-artifact" | "celld-worker";
  readonly repositoryUri: string;
  readonly planDigest: string;
  readonly artifactId?: string;
}
interface ApplicationAwsImageState {
  readonly imageUri: string;
  readonly planDigest: string;
  readonly artifactId?: string;
}
type ApplicationAwsImageResource = AlchemyResource<
  "Applik8s.AWS.ImagePublication",
  ApplicationAwsImageProps,
  ApplicationAwsImageState
>;
const ApplicationAwsImage = Resource<ApplicationAwsImageResource>(
  "Applik8s.AWS.ImagePublication",
  { defaultRemovalPolicy: "retain" },
);

export interface ApplicationAwsDeployment {
  readonly stack: ApplicationAlchemyStackIdentity;
  readonly stage: string;
  plan(): Promise<{ readonly stack: ApplicationAlchemyStackIdentity; readonly stage: string; readonly changes: readonly ApplicationAlchemyPlanChange[]; readonly deploymentEvidenceDigest: string }>;
  apply(): Promise<ApplicationAlchemyApplyResult & { readonly aws: ApplicationAwsDeploymentState }>;
  destroy(): Promise<ApplicationAlchemyDestroyResult>;
  status(): Promise<ApplicationAwsDeploymentState | undefined>;
}

export function createApplicationAwsDeployment(options: ApplicationAwsDeploymentOptions): ApplicationAwsDeployment {
  assertApplicationAwsResourceTags(options.resourceTags);
  const diagnostics = validateApplicationAwsDeploymentPlan(options.plan);
  if (diagnostics.some(({ severity }) => severity === "error")) {
    throw new Error(diagnostics.map(({ code, message }) => `${code}: ${message}`).join("\n"));
  }
  const stack = applicationAlchemyStackIdentity({
    connection: {
      provider: options.endpoint ? "aws-local" : "aws",
      cluster: `${options.plan.accountId ?? "unresolved"}/${options.plan.region}`,
      digest: targetConnectionDigest(options),
    },
    application: options.plan.application,
    controlPlaneNamespace: options.plan.region,
    instance: options.plan.environment,
    profile: options.plan.environment,
  }, "direct");
  const stage = "aws";
  const state = applicationAlchemyState({ root: options.stateRoot });
  const stateService = applicationAlchemyStateService({ root: options.stateRoot });
  // Production and AWS-local use the same deliberately bounded provider
  // collection. The endpoint changes transport, never resource ownership or
  // the semantic graph, and we avoid registering Alchemy's entire AWS catalog.
  const awsProviders = applicationAwsNativeProviders({
    accountId: options.plan.accountId ?? "000000000000",
    region: options.plan.region,
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    environment: options.environment ?? process.env,
  });
  const providers = Layer.merge(awsProviders as never, applicationAwsImageProvider(options));
  const runtime = { state, ...(options.profile ? { profile: options.profile } : {}), ...(options.dev !== undefined ? { dev: options.dev } : {}) };
  const stackEffect = () => Stack(
    stack.key,
    { providers, state } as never,
    Effect.gen(function* () {
      const foundation = yield* materializeApplicationAwsNativeResources(options.plan, {
        environment: options.environment ?? process.env,
        ...(options.resourceTags ? { resourceTags: options.resourceTags } : {}),
        phase: "foundation",
      });
      const repositoryUri = foundation.resources["foundation.registry"]?.repositoryUri;
      let imageUri: unknown = options.imageUri;
      if (!imageUri && options.buildApplicationImage && options.plan.resources.some(isApplicationHostResource)) {
        assertAlchemyStringInput(repositoryUri, "foundation.registry.repositoryUri");
        imageUri = (yield* ApplicationAwsImage("image.application", {
          kind: "application",
          repositoryUri,
          planDigest: options.plan.digest,
        })).imageUri;
      }
      const artifactImageUris: Record<string, unknown> = { ...(options.artifactImageUris ?? {}) };
      if (options.buildRuntimeArtifactImage) {
        assertAlchemyStringInput(repositoryUri, "foundation.registry.repositoryUri");
        for (const artifact of options.plan.runtimeArtifacts) {
          const artifactId = `${artifact.role}:${artifact.nodeId}`;
          if (artifactImageUris[artifactId]) continue;
          artifactImageUris[artifactId] = (yield* ApplicationAwsImage(`image.${safeId(artifactId)}`, {
            kind: "runtime-artifact",
            repositoryUri,
            planDigest: options.plan.digest,
            artifactId,
          })).imageUri;
        }
      }
      if (options.buildCelldWorkerImage && options.plan.resources.some(({ resourceType }) => resourceType === "celld-fleet")) {
        assertAlchemyStringInput(repositoryUri, "foundation.registry.repositoryUri");
        artifactImageUris["celld-worker"] = (yield* ApplicationAwsImage("image.celld-worker", { kind: "celld-worker", repositoryUri, planDigest: options.plan.digest })).imageUri;
      }
      const native = yield* materializeApplicationAwsNativeResources(options.plan, {
        environment: options.environment ?? process.env,
        ...(options.resourceTags ? { resourceTags: options.resourceTags } : {}),
        phase: "workloads",
        seedResources: foundation.resources,
        seedOutputs: foundation.outputs,
        ...(imageUri ? { imageUri } : {}),
        artifactImageUris,
        ...(artifactImageUris["celld-worker"] ? { celldWorkerImageUri: artifactImageUris["celld-worker"] } : {}),
      });
      return {
        aws: {
          planDigest: options.plan.digest,
          status: "ready" as const,
          ownership: "alchemy-native" as const,
          ready: true as const,
          resources: native.resources,
          directOutputs: native.outputs,
          ...(imageUri ? { imageUri } : {}),
          ...(Object.keys(artifactImageUris).length > 0 ? { artifactImageUris } : {}),
        },
      };
    }) as never,
  );
  const leaseOptions = { stateRoot: options.stateRoot, ...(options.owner ? { owner: options.owner } : {}), ...(options.leaseTtlMs ? { leaseTtlMs: options.leaseTtlMs } : {}) };
  const plan = () => withDeploymentLease(leaseOptions, stack, async () => {
    const planned = await runApplicationAlchemyEffect(
      evalStack(stackEffect(), (compiled) => Plan.make(compiled), { stage, ...(options.dev !== undefined ? { dev: options.dev } : {}) }),
      runtime,
    ) as Plan.Plan;
    return { stack, stage, changes: summarizePlan(planned), deploymentEvidenceDigest: options.plan.digest };
  });
  return {
    stack,
    stage,
    plan,
    apply: () => withDeploymentLease(leaseOptions, stack, async () => {
      const output = await runApplicationAlchemyEffect(
        // Alchemy plans declaration drift from persisted state. Force the
        // native providers through reconciliation on apply so out-of-band
        // AWS drift is observed and repaired without inventing a second
        // lifecycle authority in Applik8s.
        deployAlchemyStack({ stack: stackEffect(), stage, force: true, ...(options.dev !== undefined ? { dev: options.dev } : {}) }),
        runtime,
      ) as { readonly aws: ApplicationAwsDeploymentState };
      return {
        stack,
        stage,
        declarationCount: applicationAwsNativeResourceDeclarations(options.plan).length,
        deploymentEvidenceDigest: options.plan.digest,
        planIdentityDigest: options.plan.digest,
        artifacts: [],
        transaction: "applied" as const,
        aws: output.aws,
      };
    }),
    destroy: () => withDeploymentLease(leaseOptions, stack, async () => {
      await runApplicationAlchemyEffect(destroyAlchemyStack({ stack: stackEffect(), stage, ...(options.dev !== undefined ? { dev: options.dev } : {}) }), runtime);
      return { stack, stage, transaction: "destroyed" as const };
    }),
    status: async () => {
      const result = await plan();
      if (result.changes.some(({ action }) => action !== "noop")) return undefined;
      const persisted = await Effect.runPromise(stateService.getOutput({ stack: stack.key, stage }));
      return applicationAwsDeploymentState(persisted);
    },
  };
}

function assertApplicationAwsResourceTags(tags: Readonly<Record<string, string>> | undefined): void {
  if (!tags) return;
  if (Object.keys(tags).length > 46) {
    throw new Error("AWS deployment resourceTags may contain at most 46 entries; four framework ownership tags are reserved.");
  }
  for (const [key, value] of Object.entries(tags)) {
    if (!key || key.length > 128 || key.startsWith("aws:") || key.startsWith("applik8s.dev/")) {
      throw new Error(`AWS deployment resource tag ${JSON.stringify(key)} is invalid or reserved.`);
    }
    if (value.length > 256) {
      throw new Error(`AWS deployment resource tag ${JSON.stringify(key)} exceeds 256 characters.`);
    }
  }
}

function applicationAwsImageProvider(options: ApplicationAwsDeploymentOptions) {
  return Provider.succeed(ApplicationAwsImage, {
    version: 1,
    read: ({ output }) => Effect.succeed(output),
    list: () => Effect.succeed([]),
    diff: ({ olds, news }) => {
      const previous = olds as ApplicationAwsImageProps;
      const next = news as ApplicationAwsImageProps;
      return Effect.succeed(
      previous.planDigest === next.planDigest && previous.repositoryUri === next.repositoryUri && previous.kind === next.kind && previous.artifactId === next.artifactId
        ? undefined
        : { action: "replace", deleteFirst: false } as const,
      );
    },
    reconcile: ({ news }) => Effect.tryPromise({
      try: async (signal) => {
        const builder = news.kind === "application" ? options.buildApplicationImage : news.kind === "celld-worker" ? options.buildCelldWorkerImage : options.buildRuntimeArtifactImage;
        if (!builder) throw new Error(`AWS image publication ${news.kind} has no configured builder.`);
        const artifact = news.artifactId ? options.plan.runtimeArtifacts.find((candidate) => `${candidate.role}:${candidate.nodeId}` === news.artifactId) : undefined;
        const imageUri = news.kind === "runtime-artifact"
          ? await (builder as ApplicationAwsRuntimeArtifactImageBuilder)({ repositoryUri: news.repositoryUri, plan: options.plan, signal, artifact: artifact ?? fail(`AWS runtime artifact ${news.artifactId ?? "<missing>"} was not found.`) })
          : await (builder as ApplicationAwsImageBuilder)({ repositoryUri: news.repositoryUri, plan: options.plan, signal });
        if (!/^[^\s@]+@sha256:[a-f0-9]{64}$/u.test(imageUri)) throw new Error(`AWS image builder returned mutable or invalid image ${imageUri}.`);
        return { imageUri, planDigest: news.planDigest, ...(news.artifactId ? { artifactId: news.artifactId } : {}) };
      },
      catch: toError,
    }),
    delete: () => Effect.void,
  });
}

function summarizePlan(plan: Plan.Plan): readonly ApplicationAlchemyPlanChange[] {
  const changes = [...Object.values(plan.resources), ...Object.values(plan.deletions).filter(Boolean)];
  return changes.map((change) => {
    const record = change as unknown as Readonly<Record<string, unknown>>;
    const operation = typeof record.action === "string" ? record.action : typeof record.operation === "string" ? record.operation : "update";
    return {
      id: typeof record.id === "string" ? record.id : "unknown",
      type: typeof record.type === "string" ? record.type : "unknown",
      action: operation === "create" || operation === "delete" || operation === "replace" || operation === "noop" ? operation : "update",
    };
  });
}

function targetConnectionDigest(options: ApplicationAwsDeploymentOptions): `sha256:${string}` {
  const suffix = options.endpoint ? `/${new URL(options.endpoint).host}` : "";
  return `sha256:${Buffer.from(`${options.plan.accountId ?? "unresolved"}/${options.plan.region}${suffix}`).toString("hex").padEnd(64, "0").slice(0, 64)}`;
}

function safeId(value: string): string { return value.replace(/[^A-Za-z0-9_.-]+/gu, "-"); }
function fail(message: string): never { throw new Error(message); }
function toError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }

function assertAlchemyStringInput(value: unknown, label: string): asserts value is string | Output.Output<string> {
  if (typeof value !== "string" && !Output.isOutput(value)) {
    throw new Error(`AWS native Alchemy graph did not expose ${label} as a dependency-carrying string input.`);
  }
}

function isApplicationHostResource(resource: ApplicationAwsDeploymentPlan["resources"][number]): boolean {
  return resource.service === "ecs" && resource.resourceType === "fargate-service";
}

function applicationAwsDeploymentState(value: unknown): ApplicationAwsDeploymentState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = Reflect.get(value, "aws");
  if (!candidate || typeof candidate !== "object") return undefined;
  if (
    Reflect.get(candidate, "status") !== "ready"
    || Reflect.get(candidate, "ownership") !== "alchemy-native"
    || Reflect.get(candidate, "ready") !== true
    || typeof Reflect.get(candidate, "planDigest") !== "string"
  ) return undefined;
  return candidate as ApplicationAwsDeploymentState;
}
