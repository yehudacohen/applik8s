// typecast-file-boundary: AWS CLI JSON and Alchemy Output values are validated
// before crossing the canonical target-deployment contract.
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  ApplicationAwsDeploymentPlan,
  ApplicationAwsPlanResource,
} from "@applik8s/deployment-contract";
import { validateApplicationAwsDeploymentPlan } from "@applik8s/deployment-contract";
import { deploy as deployAlchemyStack } from "alchemy/Deploy";
import { destroy as destroyAlchemyStack } from "alchemy/Destroy";
import * as Plan from "alchemy/Plan";
import * as Provider from "alchemy/Provider";
import { Resource, type Resource as AlchemyResource } from "alchemy/Resource";
import { evalStack, Stack } from "alchemy/Stack";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  applicationAwsOutputKey,
  applicationAwsStackName,
  directAwsResource,
  synthesizeApplicationAwsCloudFormationTemplate,
  type ApplicationAwsCloudFormationTemplate,
} from "./aws-cloudformation.js";
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
import { applicationAlchemyState } from "./state.js";

export interface ApplicationAwsDeploymentOptions {
  readonly plan: ApplicationAwsDeploymentPlan;
  readonly stateRoot: string;
  /** Immutable application image built from the compiler-owned host recipe. */
  readonly imageUri?: string;
  /** Explicit immutable images keyed by compiler runtime artifact identity. */
  readonly artifactImageUris?: Readonly<Record<string, string>>;
  /** AWS endpoint override. Used by the pinned MiniStack target only. */
  readonly endpoint?: string;
  readonly profile?: string;
  readonly owner?: string;
  readonly leaseTtlMs?: number;
  readonly dev?: boolean;
  readonly driver?: ApplicationAwsTargetDriver;
  /** Publishes the compiler-owned host context after the ECR foundation exists. */
  readonly buildApplicationImage?: ApplicationAwsImageBuilder;
  /** Publishes each compiler-owned background-runtime container after ECR exists. */
  readonly buildRuntimeArtifactImage?: ApplicationAwsRuntimeArtifactImageBuilder;
  /** Publishes the compiler-owned one-shot celld Worker deployment image. */
  readonly buildCelldWorkerImage?: ApplicationAwsCelldWorkerImageBuilder;
}

export interface ApplicationAwsImageBuilderRequest {
  readonly repositoryUri: string;
  readonly plan: ApplicationAwsDeploymentPlan;
  readonly signal?: AbortSignal;
}

export type ApplicationAwsImageBuilder = (request: ApplicationAwsImageBuilderRequest) => Promise<string>;

export interface ApplicationAwsRuntimeArtifactImageBuilderRequest extends ApplicationAwsImageBuilderRequest {
  readonly artifact: ApplicationAwsDeploymentPlan['runtimeArtifacts'][number];
}

export type ApplicationAwsRuntimeArtifactImageBuilder = (request: ApplicationAwsRuntimeArtifactImageBuilderRequest) => Promise<string>;

export interface ApplicationAwsCelldWorkerImageBuilderRequest {
  readonly plan: ApplicationAwsDeploymentPlan;
  readonly repositoryUri: string;
  readonly signal?: AbortSignal;
}

export type ApplicationAwsCelldWorkerImageBuilder = (request: ApplicationAwsCelldWorkerImageBuilderRequest) => Promise<string>;

export interface ApplicationAwsTargetState {
  readonly stackId: string;
  readonly stackName: string;
  readonly status: string;
  readonly planDigest: string;
  readonly outputs: Readonly<Record<string, string>>;
  readonly directOutputs: Readonly<Record<string, Readonly<Record<string, string | number>>>>;
  readonly ownership: "managed";
  readonly ready: true;
  readonly imageUri?: string;
  readonly artifactImageUris?: Readonly<Record<string, string>>;
}

interface ApplicationAwsTargetProps {
  readonly plan: ApplicationAwsDeploymentPlan;
  readonly imageUri?: string;
  readonly artifactImageUris?: Readonly<Record<string, string>>;
  readonly endpoint?: string;
}

type ApplicationAwsTargetResource = AlchemyResource<
  "Applik8s.AwsTarget",
  ApplicationAwsTargetProps,
  ApplicationAwsTargetState
>;

export const ApplicationAwsTarget = Resource<ApplicationAwsTargetResource>(
  "Applik8s.AwsTarget",
  { defaultRemovalPolicy: "destroy" },
);

export interface ApplicationAwsTargetDriver {
  read(props: ApplicationAwsTargetProps, prior?: ApplicationAwsTargetState): Promise<ApplicationAwsTargetState | undefined>;
  reconcile(props: ApplicationAwsTargetProps, prior?: ApplicationAwsTargetState, signal?: AbortSignal): Promise<ApplicationAwsTargetState>;
  delete(props: ApplicationAwsTargetProps, output: ApplicationAwsTargetState, signal?: AbortSignal): Promise<void>;
}

export interface ApplicationAwsDeployment {
  readonly stack: ApplicationAlchemyStackIdentity;
  readonly stage: string;
  plan(): Promise<{ readonly stack: ApplicationAlchemyStackIdentity; readonly stage: string; readonly changes: readonly ApplicationAlchemyPlanChange[]; readonly deploymentEvidenceDigest: string }>;
  apply(): Promise<ApplicationAlchemyApplyResult & { readonly aws: ApplicationAwsTargetState }>;
  destroy(): Promise<ApplicationAlchemyDestroyResult>;
  status(): Promise<ApplicationAwsTargetState | undefined>;
}

export function createApplicationAwsDeployment(options: ApplicationAwsDeploymentOptions): ApplicationAwsDeployment {
  const diagnostics = validateApplicationAwsDeploymentPlan(options.plan);
  if (diagnostics.some(({ severity }) => severity === "error")) {
    throw new Error(diagnostics.map(({ code, message }) => `${code}: ${message}`).join("\n"));
  }
  const stack = applicationAlchemyStackIdentity({
    connection: {
      provider: options.endpoint ? "aws-local" : "aws",
      cluster: `${options.plan.accountId ?? "unresolved"}/${options.plan.region}`,
      // The Alchemy stack identifies the target installation, not one
      // revision of its plan. Keeping this stable lets plan updates reconcile
      // the same state instead of silently creating a second deployment.
      digest: targetConnectionDigest(options),
    },
    application: options.plan.application,
    controlPlaneNamespace: options.plan.region,
    instance: options.plan.environment,
    profile: options.plan.environment,
  }, "direct");
  const stage = "aws";
  const state = applicationAlchemyState({ root: options.stateRoot });
  const driver = options.driver ?? createAwsCliTargetDriver({
    region: options.plan.region,
    ...(options.plan.accountId ? { accountId: options.plan.accountId } : {}),
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    ...(options.profile ? { profile: options.profile } : {}),
    ...(options.buildApplicationImage ? { buildApplicationImage: options.buildApplicationImage } : {}),
    ...(options.buildRuntimeArtifactImage ? { buildRuntimeArtifactImage: options.buildRuntimeArtifactImage } : {}),
    ...(options.buildCelldWorkerImage ? { buildCelldWorkerImage: options.buildCelldWorkerImage } : {}),
  });
  const providers = applicationAwsTargetProvider(driver);
  const runtime = { state, ...(options.profile ? { profile: options.profile } : {}), ...(options.dev !== undefined ? { dev: options.dev } : {}) };
  const props: ApplicationAwsTargetProps = {
    plan: options.plan,
    ...(options.imageUri ? { imageUri: options.imageUri } : {}),
    ...(options.artifactImageUris ? { artifactImageUris: options.artifactImageUris } : {}),
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
  };
  const stackEffect = () => Stack(
    stack.key,
    { providers, state } as never,
    Effect.gen(function* () {
      const aws = yield* ApplicationAwsTarget("target", props);
      return { aws };
    }) as never,
  );
  const leaseOptions = { stateRoot: options.stateRoot, ...(options.owner ? { owner: options.owner } : {}), ...(options.leaseTtlMs ? { leaseTtlMs: options.leaseTtlMs } : {}) };
  return {
    stack,
    stage,
    plan: () => withDeploymentLease(leaseOptions, stack, async () => {
      const planned = await runApplicationAlchemyEffect(
        evalStack(stackEffect(), (compiled) => Plan.make(compiled), { stage, ...(options.dev !== undefined ? { dev: options.dev } : {}) }),
        runtime,
      ) as Plan.Plan;
      return { stack, stage, changes: summarizePlan(planned), deploymentEvidenceDigest: options.plan.digest };
    }),
    apply: () => withDeploymentLease(leaseOptions, stack, async () => {
      const output = await runApplicationAlchemyEffect(deployAlchemyStack({ stack: stackEffect(), stage, ...(options.dev !== undefined ? { dev: options.dev } : {}) }), runtime) as { readonly aws: ApplicationAwsTargetState };
      return {
        stack,
        stage,
        declarationCount: options.plan.resources.length,
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
    status: () => driver.read(props),
  };
}

function applicationAwsTargetProvider(driver: ApplicationAwsTargetDriver) {
  return Provider.succeed(ApplicationAwsTarget, {
    version: 2,
    read: ({ olds, output }) => Effect.tryPromise({
      try: () => {
        assertAwsTargetProps(olds);
        return driver.read(olds, output);
      },
      catch: toError,
    }),
    list: () => Effect.succeed([]),
    diff: ({ olds, news, output }) => Effect.tryPromise({
      try: async (): Promise<{ action: "update" } | undefined> => {
        assertAwsTargetProps(olds);
        assertAwsTargetProps(news);
        if (olds.plan.digest !== news.plan.digest || olds.imageUri !== news.imageUri || stableJson(olds.artifactImageUris) !== stableJson(news.artifactImageUris) || olds.endpoint !== news.endpoint) return { action: "update" };
        const live = await driver.read(news, output);
        return live?.ready && live.planDigest === news.plan.digest ? undefined : { action: "update" };
      },
      catch: toError,
    }),
    reconcile: ({ news, output }) => Effect.tryPromise({
      try: (signal) => {
        assertAwsTargetProps(news);
        return driver.reconcile(news, output, signal);
      },
      catch: toError,
    }),
    delete: ({ olds, output }) => Effect.tryPromise({
      try: (signal) => {
        assertAwsTargetProps(olds);
        return driver.delete(olds, output, signal);
      },
      catch: toError,
    }),
  });
}

export interface AwsCliTargetDriverOptions {
  readonly region: string;
  readonly accountId?: string;
  readonly endpoint?: string;
  readonly profile?: string;
  readonly cwd?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly command?: (args: readonly string[], signal?: AbortSignal) => Promise<string>;
  /** Defaults on for the real AWS CLI. Test doubles opt in explicitly. */
  readonly detectDrift?: boolean;
  readonly buildApplicationImage?: ApplicationAwsImageBuilder;
  readonly buildRuntimeArtifactImage?: ApplicationAwsRuntimeArtifactImageBuilder;
  readonly buildCelldWorkerImage?: ApplicationAwsCelldWorkerImageBuilder;
}

export function createAwsCliTargetDriver(options: AwsCliTargetDriverOptions): ApplicationAwsTargetDriver {
  const command = options.command ?? awsCommand(options);
  const detectDrift = options.detectDrift ?? options.command === undefined;
  return {
    async read(props, prior) {
      const stackName = applicationAwsStackName(props.plan);
      const described = await describeStack(command, stackName);
      if (!described) return undefined;
      assertManagedStack(props.plan, described);
      if (detectDrift && await stackDriftStatus(command, stackName, props.plan, Boolean(options.endpoint)) === 'DRIFTED') return undefined;
      const directOutputs = await readDirectResources(command, props.plan);
      if (!directOutputs) return undefined;
      return stateFromStack(props.plan, described, directOutputs);
    },
    async reconcile(props, prior, signal) {
      signal?.throwIfAborted();
      const stackName = applicationAwsStackName(props.plan);
      const directory = resolve(options.cwd ?? process.cwd(), ".applik8s", "aws", "templates");
      await mkdir(directory, { recursive: true });
      const foundationPath = join(directory, `${stackName}.foundation.${randomUUID()}.json`);
      const completePath = join(directory, `${stackName}.complete.${randomUUID()}.json`);
      try {
        const liveBefore = await describeStack(command, stackName);
        const drifted = detectDrift && liveBefore
          ? await stackDriftStatus(command, stackName, props.plan, Boolean(options.endpoint), signal) === 'DRIFTED'
          : false;
        const repairPlan = drifted ? planWithReconciliationDigest(props.plan) : props.plan;
        const desiredFoundation = synthesizeApplicationAwsCloudFormationTemplate(repairPlan, { phase: "foundation", ...(props.imageUri ? { imageUri: props.imageUri } : {}) });
        // CloudFormation deploy replaces the complete stack template. Updating
        // an existing target with a reduced foundation-only template would
        // therefore delete every running workload before its new image and
        // direct-resource bindings were ready. Preserve the currently managed
        // template during this expansion phase; the final canonical template
        // remains authoritative and removes obsolete resources atomically.
        const foundation = liveBefore
          ? mergeAwsFoundationWithLiveTemplate(
              await readStackTemplate(command, stackName, signal),
              desiredFoundation,
            )
          : desiredFoundation;
        await writeFile(foundationPath, `${JSON.stringify(foundation, null, 2)}\n`, { mode: 0o600 });
        await deployStack(command, stackName, foundationPath, props.plan, signal);
        const foundationStack = await describeStack(command, stackName);
        if (!foundationStack) throw new Error(`AWS foundation stack ${stackName} disappeared before direct-resource reconciliation.`);
        const foundationOutputs = stackOutputRecord(foundationStack);
        const directOutputs = await reconcileDirectResources(command, props.plan, foundationOutputs, signal);
        const imageUri = await resolveApplicationImage(props, foundationOutputs, options.buildApplicationImage, signal);
        const artifactImageUris = await resolveRuntimeArtifactImages(props, foundationOutputs, options.buildRuntimeArtifactImage, signal);
        const celldWorkerImageUri = await resolveCelldWorkerImage(props.plan, foundationOutputs, options.buildCelldWorkerImage, signal);
        const requiresHatchetBootstrap = props.plan.resources.some(({ service, resourceType }) => service === 'ecs' && resourceType === 'hatchet-service');
        if (celldWorkerImageUri || requiresHatchetBootstrap) {
          const bootstrap = synthesizeApplicationAwsCloudFormationTemplate(props.plan, { phase: "bootstrap", ...(imageUri ? { imageUri } : {}), artifactImageUris, ...(celldWorkerImageUri ? { celldWorkerImageUri } : {}), directOutputs });
          await writeFile(completePath, `${JSON.stringify(bootstrap, null, 2)}\n`, { mode: 0o600 });
          await deployStack(command, stackName, completePath, props.plan, signal);
          const bootstrapStack = await describeStack(command, stackName);
          if (!bootstrapStack) throw new Error(`AWS bootstrap stack ${stackName} disappeared before provider initialization.`);
          const bootstrapOutputs = stackOutputRecord(bootstrapStack);
          if (celldWorkerImageUri) await runCelldWorkerDeploymentTask(command, props.plan, bootstrapOutputs, signal);
          if (requiresHatchetBootstrap) await runHatchetWorkerTokenBootstrapTask(command, props.plan, bootstrapOutputs, signal);
        }
        const complete = synthesizeApplicationAwsCloudFormationTemplate(props.plan, { phase: "complete", ...(imageUri ? { imageUri } : {}), artifactImageUris, ...(celldWorkerImageUri ? { celldWorkerImageUri } : {}), directOutputs });
        await writeFile(completePath, `${JSON.stringify(complete, null, 2)}\n`, { mode: 0o600 });
        await deployStack(command, stackName, completePath, props.plan, signal);
        if (options.endpoint) await reconcileAwsLocalCompatibility(command, props.plan, signal);
        const described = await describeStack(command, stackName);
        if (!described) throw new Error(`AWS stack ${stackName} disappeared after a successful deployment.`);
        assertManagedStack(props.plan, described);
        return stateFromStack(props.plan, described, directOutputs, imageUri, artifactImageUris);
      } catch (cause) {
        signal?.throwIfAborted();
        throw new Error(`AWS deployment ${stackName} failed: ${errorMessage(cause)}`, { cause });
      } finally {
        await Promise.all([rm(foundationPath, { force: true }), rm(completePath, { force: true })]);
      }
    },
    async delete(props, output, signal) {
      signal?.throwIfAborted();
      // Direct resources depend on networking and security groups owned by
      // the stack. Retire them first so CloudFormation can safely remove the
      // foundation without orphaning an unreachable cache or catalog.
      await deleteDirectResources(command, props.plan, signal);
      const described = await describeStack(command, output.stackName);
      if (described) {
        assertManagedStack(props.plan, described);
        await command(["cloudformation", "delete-stack", "--stack-name", output.stackName], signal);
        await command(["cloudformation", "wait", "stack-delete-complete", "--stack-name", output.stackName], signal);
      }
    },
  };
}

async function reconcileAwsLocalCompatibility(
  command: AwsCommand,
  plan: ApplicationAwsDeploymentPlan,
  signal?: AbortSignal,
): Promise<void> {
  for (const entry of plan.resources) {
    signal?.throwIfAborted();
    if (entry.service === 's3' && (entry.resourceType === 'bucket' || entry.resourceType === 'lakehouse-dataset')) {
      await command([
        's3api',
        'put-bucket-versioning',
        '--bucket',
        entry.physicalName,
        '--versioning-configuration',
        JSON.stringify({ Status: entry.configuration.versioning === false ? 'Suspended' : 'Enabled' }),
      ], signal);
      await command([
        's3api',
        'put-bucket-encryption',
        '--bucket',
        entry.physicalName,
        '--server-side-encryption-configuration',
        JSON.stringify({ Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] }),
      ], signal);
      await command([
        's3api',
        'put-public-access-block',
        '--bucket',
        entry.physicalName,
        '--public-access-block-configuration',
        JSON.stringify({ BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true }),
      ], signal);
    }
    if (entry.service === 'sqs' && entry.resourceType === 'queue') {
      const queue = parseJson(await command(['sqs', 'get-queue-url', '--queue-name', entry.physicalName], signal));
      await command([
        'sqs',
        'set-queue-attributes',
        '--queue-url',
        stringField(queue, 'QueueUrl'),
        '--attributes',
        JSON.stringify({
          VisibilityTimeout: String(numberValue(entry.configuration.visibilityTimeoutSeconds, 300)),
          SqsManagedSseEnabled: String(entry.configuration.encrypted !== false).toLowerCase(),
        }),
      ], signal);
    }
    if (entry.service === 'kinesis' && entry.resourceType === 'stream' && entry.configuration.encrypted !== false) {
      const response = parseJson(await command(['kinesis', 'describe-stream-summary', '--stream-name', entry.physicalName], signal));
      const summary = objectValue(response.StreamDescriptionSummary);
      if (summary?.EncryptionType !== 'KMS') {
        await command([
          'kinesis',
          'start-stream-encryption',
          '--stream-name',
          entry.physicalName,
          '--encryption-type',
          'KMS',
          '--key-id',
          'alias/aws/kinesis',
        ], signal);
      }
    }
  }
}

async function resolveApplicationImage(
  props: ApplicationAwsTargetProps,
  outputs: Readonly<Record<string, string>>,
  builder: ApplicationAwsImageBuilder | undefined,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (props.imageUri) return props.imageUri;
  if (!props.plan.resources.some(({ resourceType }) => resourceType === 'fargate-service')) return undefined;
  if (!builder) throw new Error('AWS ApplicationHost requires an immutable image or the compiler-artifact image builder.');
  const repositoryUri = outputs[applicationAwsOutputKey('foundation.registry', 'repositoryUri')];
  if (!repositoryUri) throw new Error('AWS foundation did not expose the managed ECR repository URI required for ApplicationHost publication.');
  const imageUri = await builder({ repositoryUri, plan: props.plan, ...(signal ? { signal } : {}) });
  if (!/^[^\s@]+@sha256:[a-f0-9]{64}$/u.test(imageUri)) throw new Error(`AWS image builder returned mutable or malformed artifact identity ${imageUri}.`);
  return imageUri;
}

async function resolveRuntimeArtifactImages(
  props: ApplicationAwsTargetProps,
  outputs: Readonly<Record<string, string>>,
  builder: ApplicationAwsRuntimeArtifactImageBuilder | undefined,
  signal?: AbortSignal,
): Promise<Readonly<Record<string, string>>> {
  const deployedArtifactIds = new Set(props.plan.resources
    .filter(({ service, resourceType }) => service === 'ecs'
      && (resourceType === 'fargate-worker' || resourceType === 'fargate-runtime-service'))
    .map(({ configuration }) => configuration.artifactId)
    .filter((value): value is string => typeof value === 'string'));
  if (deployedArtifactIds.size === 0) return {};
  const repositoryUri = outputs[applicationAwsOutputKey('foundation.registry', 'repositoryUri')];
  if (!repositoryUri) throw new Error('AWS foundation did not expose the managed ECR repository URI required for runtime artifact publication.');
  const result: Record<string, string> = {};
  for (const artifact of props.plan.runtimeArtifacts) {
    const id = `${artifact.role}:${artifact.nodeId}`;
    if (!deployedArtifactIds.has(id)) continue;
    const supplied = props.artifactImageUris?.[id];
    const image = supplied ?? await builder?.({ repositoryUri, plan: props.plan, artifact, ...(signal ? { signal } : {}) });
    if (!image) throw new Error(`AWS runtime artifact ${id} requires an immutable image or compiler-artifact image builder.`);
    if (!/^[^\s@]+@sha256:[a-f0-9]{64}$/u.test(image)) throw new Error(`AWS runtime artifact ${id} resolved mutable or malformed image ${image}.`);
    result[id] = image;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

async function resolveCelldWorkerImage(
  plan: ApplicationAwsDeploymentPlan,
  outputs: Readonly<Record<string, string>>,
  builder: ApplicationAwsCelldWorkerImageBuilder | undefined,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (!plan.resources.some(({ service, resourceType }) => service === 'ecs' && resourceType === 'celld-fleet')) return undefined;
  if (!builder) throw new Error('AWS celld ActorRuntime requires the compiler-owned Worker deployment image builder.');
  const repositoryUri = outputs[applicationAwsOutputKey('foundation.registry', 'repositoryUri')];
  if (!repositoryUri) throw new Error('AWS foundation did not expose the managed ECR repository required for the celld Worker deployment artifact.');
  const imageUri = await builder({ repositoryUri, plan, ...(signal ? { signal } : {}) });
  if (!/^[^\s@]+@sha256:[a-f0-9]{64}$/u.test(imageUri)) throw new Error(`AWS celld Worker image builder returned mutable or malformed artifact identity ${imageUri}.`);
  return imageUri;
}

async function runCelldWorkerDeploymentTask(
  command: AwsCommand,
  plan: ApplicationAwsDeploymentPlan,
  outputs: Readonly<Record<string, string>>,
  signal?: AbortSignal,
): Promise<void> {
  const fleet = plan.resources.find(({ service, resourceType }) => service === 'ecs' && resourceType === 'celld-fleet');
  if (!fleet) return;
  const taskDefinition = outputs[applicationAwsOutputKey(fleet.id, 'deploymentTaskDefinitionArn')];
  const cluster = outputs[applicationAwsOutputKey('foundation.compute', 'clusterArn')];
  const securityGroup = outputs[applicationAwsOutputKey(fleet.id, 'deploymentSecurityGroupId')];
  const subnets = [1, 2].map((index) => outputs[applicationAwsOutputKey(`foundation.subnet.private.${index}`, 'subnetId')]).filter((value): value is string => Boolean(value));
  if (!taskDefinition || !cluster || !securityGroup || subnets.length < 2) throw new Error(`AWS celld bootstrap outputs for ${fleet.id} are incomplete.`);
  const networkConfiguration = JSON.stringify({ awsvpcConfiguration: { subnets, securityGroups: [securityGroup], assignPublicIp: 'DISABLED' } });
  const started = parseJson(await command(['ecs', 'run-task', '--cluster', cluster, '--task-definition', taskDefinition, '--launch-type', 'FARGATE', '--network-configuration', networkConfiguration, '--count', '1'], signal));
  const failures = arrayValue(started.failures ?? started.Failures);
  if (failures.length > 0) throw new Error(`AWS rejected the celld Worker deployment task: ${JSON.stringify(failures)}.`);
  const task = objectValue(arrayValue(started.tasks ?? started.Tasks)[0]);
  const taskArn = typeof task?.taskArn === 'string' ? task.taskArn : typeof task?.TaskArn === 'string' ? task.TaskArn : undefined;
  if (!taskArn) throw new Error('AWS ECS did not return the celld Worker deployment task ARN.');
  await command(['ecs', 'wait', 'tasks-stopped', '--cluster', cluster, '--tasks', taskArn], signal);
  const described = parseJson(await command(['ecs', 'describe-tasks', '--cluster', cluster, '--tasks', taskArn], signal));
  const stopped = objectValue(arrayValue(described.tasks ?? described.Tasks)[0]);
  const container = objectValue(arrayValue(stopped?.containers ?? stopped?.Containers)[0]);
  const exitCode = typeof container?.exitCode === 'number' ? container.exitCode : typeof container?.ExitCode === 'number' ? container.ExitCode : undefined;
  if (exitCode !== 0) {
    const reason = String(container?.reason ?? container?.Reason ?? stopped?.stoppedReason ?? stopped?.StoppedReason ?? 'unknown failure');
    throw new Error(`celld Worker deployment task ${taskArn} failed with exit code ${String(exitCode)}: ${reason}.`);
  }
}

async function runHatchetWorkerTokenBootstrapTask(
  command: AwsCommand,
  plan: ApplicationAwsDeploymentPlan,
  outputs: Readonly<Record<string, string>>,
  signal?: AbortSignal,
): Promise<void> {
  const engines = plan.resources.filter(({ service, resourceType }) => service === 'ecs' && resourceType === 'hatchet-service');
  const cluster = outputs[applicationAwsOutputKey('foundation.compute', 'clusterArn')];
  const subnets = [1, 2].map((index) => outputs[applicationAwsOutputKey(`foundation.subnet.private.${index}`, 'subnetId')]).filter((value): value is string => Boolean(value));
  if (!cluster || subnets.length < 2) throw new Error('AWS Hatchet bootstrap requires the ECS cluster and two private subnet outputs.');
  for (const engine of engines) {
    const taskDefinition = outputs[applicationAwsOutputKey(engine.id, 'workerTokenTaskDefinitionArn')];
    const securityGroup = outputs[applicationAwsOutputKey(engine.id, 'workerTokenSecurityGroupId')];
    if (!taskDefinition || !securityGroup) throw new Error(`AWS Hatchet bootstrap outputs for ${engine.id} are incomplete.`);
    const networkConfiguration = JSON.stringify({ awsvpcConfiguration: { subnets, securityGroups: [securityGroup], assignPublicIp: 'DISABLED' } });
    const started = parseJson(await command(['ecs', 'run-task', '--cluster', cluster, '--task-definition', taskDefinition, '--launch-type', 'FARGATE', '--network-configuration', networkConfiguration, '--count', '1'], signal));
    const failures = arrayValue(started.failures ?? started.Failures);
    if (failures.length > 0) throw new Error(`AWS rejected the Hatchet worker-token task for ${engine.id}: ${JSON.stringify(failures)}.`);
    const task = objectValue(arrayValue(started.tasks ?? started.Tasks)[0]);
    const taskArn = typeof task?.taskArn === 'string' ? task.taskArn : typeof task?.TaskArn === 'string' ? task.TaskArn : undefined;
    if (!taskArn) throw new Error(`AWS ECS did not return the Hatchet worker-token task ARN for ${engine.id}.`);
    await command(['ecs', 'wait', 'tasks-stopped', '--cluster', cluster, '--tasks', taskArn], signal);
    const described = parseJson(await command(['ecs', 'describe-tasks', '--cluster', cluster, '--tasks', taskArn], signal));
    const stopped = objectValue(arrayValue(described.tasks ?? described.Tasks)[0]);
    const failed = arrayValue(stopped?.containers ?? stopped?.Containers)
      .map(objectValue)
      .filter((container) => {
        const code = typeof container?.exitCode === 'number' ? container.exitCode : typeof container?.ExitCode === 'number' ? container.ExitCode : undefined;
        return code !== 0;
      });
    if (failed.length > 0) {
      const evidence = failed.map((container) => ({
        name: container?.name ?? container?.Name,
        exitCode: container?.exitCode ?? container?.ExitCode,
        reason: container?.reason ?? container?.Reason,
      }));
      throw new Error(`Hatchet worker-token task ${taskArn} failed without exposing credential output: ${JSON.stringify(evidence)}.`);
    }
  }
}

function assertAwsTargetProps(value: unknown): asserts value is ApplicationAwsTargetProps {
  if (!value || typeof value !== "object" || !("plan" in value)) {
    throw new Error("AWS target properties were not resolved before provider execution.");
  }
  validateApplicationAwsDeploymentPlan((value as ApplicationAwsTargetProps).plan);
}

function targetConnectionDigest(options: ApplicationAwsDeploymentOptions): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify({
      provider: options.endpoint ? "aws-local" : "aws",
      accountId: options.plan.accountId ?? "unresolved",
      region: options.plan.region,
      endpoint: options.endpoint ?? null,
    }))
    .digest("hex")}`;
}

interface AwsStackDescription {
  readonly StackId: string;
  readonly StackName: string;
  readonly StackStatus: string;
  readonly Tags?: readonly { readonly Key?: string; readonly Value?: string }[];
  readonly Outputs?: readonly { readonly OutputKey?: string; readonly OutputValue?: string }[];
}

async function describeStack(command: (args: readonly string[], signal?: AbortSignal) => Promise<string>, stackName: string): Promise<AwsStackDescription | undefined> {
  try {
    const response = parseJson(await command(["cloudformation", "describe-stacks", "--stack-name", stackName]));
    const stacks = arrayValue(response.Stacks);
    const first = stacks[0];
    return first && typeof first === "object" && !Array.isArray(first) ? first as AwsStackDescription : undefined;
  } catch (cause) {
    if (/does not exist|not found|ValidationError/iu.test(errorMessage(cause))) return undefined;
    throw cause;
  }
}

async function readStackTemplate(
  command: AwsCommand,
  stackName: string,
  signal?: AbortSignal,
): Promise<ApplicationAwsCloudFormationTemplate> {
  const response = parseJson(await command([
    "cloudformation",
    "get-template",
    "--stack-name",
    stackName,
    "--template-stage",
    "Original",
  ], signal));
  const rawBody = typeof response.TemplateBody === "string"
    ? parseJson(response.TemplateBody)
    : objectValue(response.TemplateBody);
  if (!rawBody) {
    throw new Error(`CloudFormation did not return the managed template for ${stackName}; foundation expansion is refused.`);
  }
  const resources = objectValue(rawBody.Resources);
  const outputs = objectValue(rawBody.Outputs);
  if (!resources || !outputs) {
    throw new Error(`CloudFormation returned an invalid managed template for ${stackName}; foundation expansion is refused.`);
  }
  return {
    AWSTemplateFormatVersion: "2010-09-09",
    Description: typeof rawBody.Description === "string"
      ? rawBody.Description
      : `Existing Applik8s target ${stackName}`,
    Resources: resources as ApplicationAwsCloudFormationTemplate["Resources"],
    Outputs: outputs as ApplicationAwsCloudFormationTemplate["Outputs"],
  };
}

function mergeAwsFoundationWithLiveTemplate(
  live: ApplicationAwsCloudFormationTemplate,
  foundation: ApplicationAwsCloudFormationTemplate,
): ApplicationAwsCloudFormationTemplate {
  return {
    ...foundation,
    Resources: { ...live.Resources, ...foundation.Resources },
    Outputs: { ...live.Outputs, ...foundation.Outputs },
  };
}

async function stackDriftStatus(
  command: AwsCommand,
  stackName: string,
  plan: ApplicationAwsDeploymentPlan,
  allowAwsLocalFallback: boolean,
  signal?: AbortSignal,
): Promise<'IN_SYNC' | 'DRIFTED'> {
  signal?.throwIfAborted();
  let started: Readonly<Record<string, unknown>>;
  try {
    started = parseJson(await command(['cloudformation', 'detect-stack-drift', '--stack-name', stackName], signal));
  } catch (cause) {
    if (allowAwsLocalFallback && /InvalidAction|Unknown action:\s*DetectStackDrift/iu.test(errorMessage(cause))) {
      return await awsLocalPlanDriftStatus(command, plan, signal);
    }
    throw cause;
  }
  const detectionId = stringField(started, 'StackDriftDetectionId');
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const described = parseJson(await command([
      'cloudformation',
      'describe-stack-drift-detection-status',
      '--stack-drift-detection-id',
      detectionId,
    ], signal));
    const detectionStatus = stringField(described, 'DetectionStatus');
    if (detectionStatus === 'DETECTION_FAILED') {
      throw new Error(`CloudFormation drift detection failed for ${stackName}: ${String(described.DetectionStatusReason ?? 'unknown reason')}.`);
    }
    if (detectionStatus === 'DETECTION_COMPLETE') {
      return described.StackDriftStatus === 'DRIFTED' ? 'DRIFTED' : 'IN_SYNC';
    }
    await abortableDelay(250, signal);
  }
  throw new Error(`CloudFormation drift detection for ${stackName} did not complete within 60 seconds.`);
}

async function awsLocalPlanDriftStatus(
  command: AwsCommand,
  plan: ApplicationAwsDeploymentPlan,
  signal?: AbortSignal,
): Promise<'IN_SYNC' | 'DRIFTED'> {
  for (const entry of plan.resources.filter((resource) => !directAwsResource(resource))) {
    signal?.throwIfAborted();
    if (!await awsLocalResourceMatches(command, entry, signal)) {
      if (process.env.APPLIK8S_AWS_DRIFT_DIAGNOSTICS === '1') {
        console.warn(`[applik8s] AWS-local drift detected for ${entry.id} (${entry.service}/${entry.resourceType}).`);
      }
      return 'DRIFTED';
    }
  }
  return 'IN_SYNC';
}

async function awsLocalResourceMatches(
  command: AwsCommand,
  entry: ApplicationAwsPlanResource,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    if (entry.service === 'ecr' && entry.resourceType === 'repository') {
      const response = parseJson(await command(['ecr', 'describe-repositories', '--repository-names', entry.physicalName], signal));
      const repository = objectValue(arrayValue(response.repositories)[0]);
      return repository?.repositoryName === entry.physicalName
        && repository.imageTagMutability === String(entry.configuration.imageTagMutability ?? 'IMMUTABLE');
    }
    if (entry.service === 'ecs' && entry.resourceType === 'cluster') {
      const response = parseJson(await command(['ecs', 'describe-clusters', '--clusters', entry.physicalName, '--include', 'SETTINGS'], signal));
      const cluster = objectValue(arrayValue(response.clusters)[0]);
      const settings = arrayValue(cluster?.settings).map(objectValue);
      const expectedInsights = entry.configuration.containerInsights === false ? 'disabled' : 'enabled';
      return cluster?.status === 'ACTIVE'
        && settings.some((setting) => setting?.name === 'containerInsights' && setting.value === expectedInsights);
    }
    if (entry.service === 'cloudwatch' && entry.resourceType === 'log-group') {
      const response = parseJson(await command(['logs', 'describe-log-groups', '--log-group-name-prefix', entry.physicalName], signal));
      const logGroup = arrayValue(response.logGroups).map(objectValue).find((candidate) => candidate?.logGroupName === entry.physicalName);
      return logGroup?.retentionInDays === numberValue(entry.configuration.retentionDays, 30);
    }
    if (entry.service === 's3' && (entry.resourceType === 'bucket' || entry.resourceType === 'lakehouse-dataset')) {
      await command(['s3api', 'head-bucket', '--bucket', entry.physicalName], signal);
      const versioning = parseJson(await command(['s3api', 'get-bucket-versioning', '--bucket', entry.physicalName], signal));
      const encryption = parseJson(await command(['s3api', 'get-bucket-encryption', '--bucket', entry.physicalName], signal));
      const publicAccess = parseJson(await command(['s3api', 'get-public-access-block', '--bucket', entry.physicalName], signal));
      const block = objectValue(publicAccess.PublicAccessBlockConfiguration);
      const matches = versioning.Status === (entry.configuration.versioning === false ? 'Suspended' : 'Enabled')
        && JSON.stringify(encryption).includes('AES256')
        && block?.BlockPublicAcls === true
        && block.BlockPublicPolicy === true
        && block.IgnorePublicAcls === true
        && block.RestrictPublicBuckets === true;
      if (!matches && process.env.APPLIK8S_AWS_DRIFT_DIAGNOSTICS === '1') {
        console.warn(`[applik8s] AWS-local S3 state: ${JSON.stringify({ versioning, encryption, publicAccess })}.`);
      }
      return matches;
    }
    if (entry.service === 'sqs' && entry.resourceType === 'queue') {
      const queue = parseJson(await command(['sqs', 'get-queue-url', '--queue-name', entry.physicalName], signal));
      const queueUrl = stringField(queue, 'QueueUrl');
      const response = parseJson(await command(['sqs', 'get-queue-attributes', '--queue-url', queueUrl, '--attribute-names', 'All'], signal));
      const attributes = objectValue(response.Attributes);
      return attributes?.VisibilityTimeout === String(numberValue(entry.configuration.visibilityTimeoutSeconds, 300))
        && attributes.SqsManagedSseEnabled === String(entry.configuration.encrypted !== false).toLowerCase();
    }
    if (entry.service === 'kinesis' && entry.resourceType === 'stream') {
      const response = parseJson(await command(['kinesis', 'describe-stream-summary', '--stream-name', entry.physicalName], signal));
      const summary = objectValue(response.StreamDescriptionSummary);
      const mode = objectValue(summary?.StreamModeDetails);
      const matches = summary?.StreamStatus === 'ACTIVE'
        && summary.RetentionPeriodHours === numberValue(entry.configuration.retentionHours, 24)
        && mode?.StreamMode === String(entry.configuration.mode ?? 'ON_DEMAND')
        && (entry.configuration.encrypted === false || summary.EncryptionType === 'KMS');
      if (!matches && process.env.APPLIK8S_AWS_DRIFT_DIAGNOSTICS === '1') {
        console.warn(`[applik8s] AWS-local Kinesis state: ${JSON.stringify(summary)}.`);
      }
      return matches;
    }
    throw new Error(`AWS-local drift inspection does not support ${entry.service}/${entry.resourceType} (${entry.id}); no-op planning is refused.`);
  } catch (cause) {
    if (notFound(cause)) {
      if (process.env.APPLIK8S_AWS_DRIFT_DIAGNOSTICS === '1') {
        console.warn(`[applik8s] AWS-local resource read failed for ${entry.id}: ${errorMessage(cause)}`);
      }
      return false;
    }
    throw cause;
  }
}

function planWithReconciliationDigest(plan: ApplicationAwsDeploymentPlan): ApplicationAwsDeploymentPlan {
  const digest = `sha256:${createHash('sha256').update(`${plan.digest}:${randomUUID()}`).digest('hex')}` as const;
  return { ...plan, digest };
}

async function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolveDelay, rejectDelay) => {
    const onAbort = () => {
      clearTimeout(timer);
      rejectDelay(new Error('AWS drift detection was cancelled.'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolveDelay();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function deployStack(command: (args: readonly string[], signal?: AbortSignal) => Promise<string>, stackName: string, templatePath: string, plan: ApplicationAwsDeploymentPlan, signal?: AbortSignal): Promise<void> {
  await command([
    "cloudformation", "deploy", "--stack-name", stackName, "--template-file", templatePath,
    "--capabilities", "CAPABILITY_NAMED_IAM", "--no-fail-on-empty-changeset",
    "--tags", `applik8s.dev/application=${plan.application}`, `applik8s.dev/environment=${plan.environment}`, `applik8s.dev/plan-digest=${plan.digest}`,
  ], signal);
}

async function reconcileDirectResources(command: (args: readonly string[], signal?: AbortSignal) => Promise<string>, plan: ApplicationAwsDeploymentPlan, foundationOutputs: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<Readonly<Record<string, Readonly<Record<string, string | number>>>>> {
  const outputs: Record<string, Readonly<Record<string, string | number>>> = {};
  for (const entry of plan.resources.filter(directAwsResource).sort((left, right) => left.id.localeCompare(right.id))) {
    if (entry.service === "glue") outputs[entry.id] = await reconcileGlue(command, plan, entry, signal);
    else if (entry.service === "athena") outputs[entry.id] = await reconcileAthena(command, plan, entry, signal);
    else outputs[entry.id] = await reconcileElastiCache(command, plan, entry, foundationOutputs, signal);
  }
  return outputs;
}

async function reconcileGlue(command: AwsCommand, plan: ApplicationAwsDeploymentPlan, entry: ApplicationAwsPlanResource, signal?: AbortSignal): Promise<Readonly<Record<string, string>>> {
  const exists = await command(["glue", "get-database", "--name", entry.physicalName], signal).then(() => true).catch((cause) => notFound(cause) ? false : Promise.reject(cause));
  const input = JSON.stringify({ Name: entry.physicalName, Description: `Applik8s ${entry.id}` });
  await command(["glue", exists ? "update-database" : "create-database", ...(exists ? ["--name", entry.physicalName] : []), "--database-input", input], signal);
  return { databaseName: entry.physicalName, databaseArn: `arn:aws:glue:${plan.region}:${plan.accountId ?? "000000000000"}:database/${entry.physicalName}` };
}

async function reconcileAthena(command: AwsCommand, plan: ApplicationAwsDeploymentPlan, entry: ApplicationAwsPlanResource, signal?: AbortSignal): Promise<Readonly<Record<string, string>>> {
  const exists = await command(["athena", "get-work-group", "--work-group", entry.physicalName], signal).then(() => true).catch((cause) => notFound(cause) ? false : Promise.reject(cause));
  const resultBucketId = stringValue(entry.configuration.resultBucketResourceId);
  const resultBucket = plan.resources.find(({ id }) => id === resultBucketId);
  if (!resultBucket || resultBucket.service !== "s3") throw new Error(`Athena workgroup ${entry.id} requires its exact S3 result bucket.`);
  const configuration = JSON.stringify({
    EnforceWorkGroupConfiguration: true,
    PublishCloudWatchMetricsEnabled: true,
    BytesScannedCutoffPerQuery: numberValue(entry.configuration.bytesScannedCutoffPerQuery, 10_000_000_000),
    ResultConfiguration: { OutputLocation: `s3://${resultBucket.physicalName}/results/`, EncryptionConfiguration: { EncryptionOption: "SSE_S3" } },
  });
  await command(["athena", exists ? "update-work-group" : "create-work-group", exists ? "--work-group" : "--name", entry.physicalName, "--configuration", configuration], signal);
  return { workgroupName: entry.physicalName, workgroupArn: `arn:aws:athena:${plan.region}:${plan.accountId ?? "000000000000"}:workgroup/${entry.physicalName}` };
}

async function reconcileElastiCache(command: AwsCommand, plan: ApplicationAwsDeploymentPlan, entry: ApplicationAwsPlanResource, foundationOutputs: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<Readonly<Record<string, string | number>>> {
  const subnetGroup = `${entry.physicalName}-subnets`;
  const subnetIds = [1, 2].map((index) => foundationOutputs[applicationAwsOutputKey(`foundation.subnet.private.${index}`, "subnetId")]).filter((value): value is string => Boolean(value));
  const securityGroupId = foundationOutputs[applicationAwsOutputKey("foundation.security-group.application", "securityGroupId")];
  if (subnetIds.length < 2 || !securityGroupId) throw new Error(`ElastiCache ${entry.physicalName} requires the two private subnet outputs and application security group.`);
  const subnetExists = await command(["elasticache", "describe-cache-subnet-groups", "--cache-subnet-group-name", subnetGroup], signal).then(() => true).catch((cause) => notFound(cause) ? false : Promise.reject(cause));
  if (subnetExists) {
    await command(["elasticache", "modify-cache-subnet-group", "--cache-subnet-group-name", subnetGroup, "--subnet-ids", ...subnetIds], signal);
  } else {
    await command(["elasticache", "create-cache-subnet-group", "--cache-subnet-group-name", subnetGroup, "--cache-subnet-group-description", `Applik8s ${entry.id}`, "--subnet-ids", ...subnetIds], signal);
  }
  const secretName = `${entry.physicalName}-auth`;
  let secretArn: string;
  try {
    const describedSecret = parseJson(await command(["secretsmanager", "describe-secret", "--secret-id", secretName], signal));
    secretArn = stringField(describedSecret, "ARN");
  } catch (cause) {
    if (!notFound(cause)) throw cause;
    const password = stringField(parseJson(await command(["secretsmanager", "get-random-password", "--password-length", "48", "--exclude-punctuation"], signal)), "RandomPassword");
    const created = parseJson(await command([
      "secretsmanager", "create-secret", "--name", secretName, "--description", `Applik8s auth material for ${entry.id}`,
      "--secret-string", password,
      "--tags", ...directTags(plan, entry),
    ], signal));
    secretArn = stringField(created, "ARN");
  }
  const authToken = stringField(parseJson(await command(["secretsmanager", "get-secret-value", "--secret-id", secretName], signal)), "SecretString");
  let response: Readonly<Record<string, unknown>> | undefined;
  try {
    response = parseJson(await command(["elasticache", "describe-replication-groups", "--replication-group-id", entry.physicalName], signal));
  } catch (cause) {
    if (!notFound(cause)) throw cause;
  }
  if (!response) {
    await command([
      "elasticache", "create-replication-group", "--replication-group-id", entry.physicalName,
      "--replication-group-description", `Applik8s ${entry.id}`, "--engine", "redis",
      "--cache-node-type", "cache.t3.micro", "--num-cache-clusters", String(numberValue(entry.configuration.replicas, 1) + 1),
      "--cache-subnet-group-name", subnetGroup, "--security-group-ids", securityGroupId,
      "--transit-encryption-enabled", "--at-rest-encryption-enabled", "--auth-token", authToken,
      "--tags", ...directTags(plan, entry),
    ], signal);
    await command(["elasticache", "wait", "replication-group-available", "--replication-group-id", entry.physicalName], signal).catch(() => undefined);
    response = parseJson(await command(["elasticache", "describe-replication-groups", "--replication-group-id", entry.physicalName], signal));
  }
  const group = objectValue(arrayValue(response.ReplicationGroups)[0]);
  const endpoint = objectValue(group?.NodeGroups ? objectValue(arrayValue(group.NodeGroups)[0])?.PrimaryEndpoint : undefined);
  if (!endpoint || typeof endpoint.Address !== "string" || typeof endpoint.Port !== "number") throw new Error(`ElastiCache ${entry.physicalName} did not publish a primary endpoint.`);
  return { endpoint: endpoint.Address, port: endpoint.Port, secretArn };
}

async function readDirectResources(command: AwsCommand, plan: ApplicationAwsDeploymentPlan): Promise<Readonly<Record<string, Readonly<Record<string, string | number>>>> | undefined> {
  const outputs: Record<string, Readonly<Record<string, string | number>>> = {};
  for (const entry of plan.resources.filter(directAwsResource).sort((left, right) => left.id.localeCompare(right.id))) {
    try {
      if (entry.service === "glue") {
        await command(["glue", "get-database", "--name", entry.physicalName]);
        outputs[entry.id] = { databaseName: entry.physicalName, databaseArn: `arn:aws:glue:${plan.region}:${plan.accountId ?? "000000000000"}:database/${entry.physicalName}` };
      } else if (entry.service === "athena") {
        await command(["athena", "get-work-group", "--work-group", entry.physicalName]);
        outputs[entry.id] = { workgroupName: entry.physicalName, workgroupArn: `arn:aws:athena:${plan.region}:${plan.accountId ?? "000000000000"}:workgroup/${entry.physicalName}` };
      } else {
        const response = parseJson(await command(["elasticache", "describe-replication-groups", "--replication-group-id", entry.physicalName]));
        const group = objectValue(arrayValue(response.ReplicationGroups)[0]);
        const endpoint = objectValue(group?.NodeGroups ? objectValue(arrayValue(group.NodeGroups)[0])?.PrimaryEndpoint : undefined);
        if (!endpoint || typeof endpoint.Address !== "string" || typeof endpoint.Port !== "number") return undefined;
        const secret = parseJson(await command(["secretsmanager", "describe-secret", "--secret-id", `${entry.physicalName}-auth`]));
        outputs[entry.id] = { endpoint: endpoint.Address, port: endpoint.Port, secretArn: stringField(secret, "ARN") };
      }
    } catch (cause) {
      if (notFound(cause)) return undefined;
      throw cause;
    }
  }
  return outputs;
}

async function deleteDirectResources(command: AwsCommand, plan: ApplicationAwsDeploymentPlan, signal?: AbortSignal): Promise<void> {
  for (const entry of plan.resources.filter(directAwsResource).sort((left, right) => right.id.localeCompare(left.id))) {
    if (entry.lifecycle.deletion !== "delete") continue;
    try {
      if (entry.service === "glue") await command(["glue", "delete-database", "--name", entry.physicalName], signal);
      else if (entry.service === "athena") await command(["athena", "delete-work-group", "--work-group", entry.physicalName, "--recursive-delete-option"], signal);
      else {
        await command(["elasticache", "delete-replication-group", "--replication-group-id", entry.physicalName, "--no-retain-primary-cluster"], signal);
        await command(["elasticache", "wait", "replication-group-deleted", "--replication-group-id", entry.physicalName], signal);
        await command(["elasticache", "delete-cache-subnet-group", "--cache-subnet-group-name", `${entry.physicalName}-subnets`], signal);
        await command(["secretsmanager", "delete-secret", "--secret-id", `${entry.physicalName}-auth`, "--force-delete-without-recovery"], signal);
      }
    } catch (cause) {
      if (!notFound(cause)) throw cause;
    }
  }
}

function stateFromStack(
  plan: ApplicationAwsDeploymentPlan,
  stack: AwsStackDescription,
  directOutputs: ApplicationAwsTargetState["directOutputs"],
  imageUri?: string,
  artifactImageUris?: Readonly<Record<string, string>>,
): ApplicationAwsTargetState {
  if (!/_(?:COMPLETE)$/u.test(stack.StackStatus) && stack.StackStatus !== "CREATE_COMPLETE" && stack.StackStatus !== "UPDATE_COMPLETE") {
    throw new Error(`AWS stack ${stack.StackName} is not authoritatively ready (${stack.StackStatus}).`);
  }
  const outputs = Object.fromEntries((stack.Outputs ?? []).flatMap((output) => output.OutputKey && output.OutputValue ? [[output.OutputKey, output.OutputValue]] : []));
  const hydratedArtifactImages = artifactImageUris ?? Object.fromEntries(plan.resources
    .filter(({ service, resourceType }) => service === 'ecs' && resourceType === 'fargate-worker')
    .flatMap((resource) => {
      const artifactId = resource.configuration.artifactId;
      const value = outputs[applicationAwsOutputKey(resource.id, 'imageUri')];
      return typeof artifactId === 'string' && value ? [[artifactId, value] as const] : [];
    }));
  return {
    stackId: stack.StackId,
    stackName: stack.StackName,
    status: stack.StackStatus,
    planDigest: tagValue(stack, "applik8s.dev/plan-digest") ?? plan.digest,
    outputs,
    directOutputs,
    ownership: "managed",
    ready: true,
    ...(imageUri ? { imageUri } : {}),
    ...(Object.keys(hydratedArtifactImages).length > 0 ? { artifactImageUris: hydratedArtifactImages } : {}),
  };
}

function stackOutputRecord(stack: AwsStackDescription): Readonly<Record<string, string>> {
  return Object.fromEntries((stack.Outputs ?? []).flatMap((output) => output.OutputKey && output.OutputValue ? [[output.OutputKey, output.OutputValue]] : []));
}

function directTags(plan: ApplicationAwsDeploymentPlan, entry: ApplicationAwsPlanResource): readonly string[] {
  return [
    `Key=applik8s.dev/application,Value=${plan.application}`,
    `Key=applik8s.dev/environment,Value=${plan.environment}`,
    `Key=applik8s.dev/resource-id,Value=${entry.id}`,
    `Key=applik8s.dev/plan-digest,Value=${plan.digest}`,
  ];
}

function assertManagedStack(plan: ApplicationAwsDeploymentPlan, stack: AwsStackDescription): void {
  if (tagValue(stack, "applik8s.dev/application") !== plan.application || tagValue(stack, "applik8s.dev/environment") !== plan.environment) {
    throw new Error(`AWS stack ${stack.StackName} exists without exact Applik8s ownership for ${plan.application}/${plan.environment}; adoption is refused.`);
  }
}

type AwsCommand = (args: readonly string[], signal?: AbortSignal) => Promise<string>;
function awsCommand(options: AwsCliTargetDriverOptions): AwsCommand {
  const run = promisify(execFile);
  return async (args, signal) => {
    const common = ["--region", options.region, "--output", "json", ...(options.endpoint ? ["--endpoint-url", options.endpoint] : []), ...(options.profile ? ["--profile", options.profile] : [])];
    const environment = { ...process.env, ...options.environment, ...(options.accountId ? { AWS_ACCOUNT_ID: options.accountId } : {}), ...(options.endpoint ? { AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? "test", AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? "test" } : {}) };
    try {
      const { stdout } = await run("aws", [...args, ...common], { cwd: options.cwd ?? process.cwd(), env: environment, signal, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
      return stdout;
    } catch (cause) {
      signal?.throwIfAborted();
      const stderr = cause && typeof cause === "object" ? String(Reflect.get(cause, "stderr") ?? "") : "";
      throw new Error(`aws ${args.slice(0, 2).join(" ")} failed: ${stderr.trim() || errorMessage(cause)}`, { cause });
    }
  };
}

function summarizePlan(plan: Plan.Plan): readonly ApplicationAlchemyPlanChange[] {
  const changes: ApplicationAlchemyPlanChange[] = [];
  for (const [id, node] of Object.entries(plan.resources)) changes.push({ id, type: node.resource.Type, action: node.action });
  for (const [id, node] of Object.entries(plan.deletions)) if (node) changes.push({ id, type: node.resource.Type, action: "delete" });
  return changes.sort((left, right) => left.id.localeCompare(right.id));
}

function tagValue(stack: AwsStackDescription, key: string): string | undefined { return stack.Tags?.find((tag) => tag.Key === key)?.Value; }
function notFound(cause: unknown): boolean { return /not found|does not exist|ResourceNotFound|ReplicationGroupNotFound|InvalidRequestException/iu.test(errorMessage(cause)); }
function parseJson(value: string): Readonly<Record<string, unknown>> { const parsed = JSON.parse(value || "{}") as unknown; if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("AWS CLI returned a non-object JSON response."); return parsed as Readonly<Record<string, unknown>>; }
function arrayValue(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : []; }
function objectValue(value: unknown): Readonly<Record<string, unknown>> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : undefined; }
function numberValue(value: unknown, fallback: number): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function stringValue(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value : undefined; }
function stringField(value: Readonly<Record<string, unknown>>, key: string): string { const field = value[key]; if (typeof field !== "string" || !field) throw new Error(`AWS CLI response did not contain required string field ${key}.`); return field; }
function stableJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value as Readonly<Record<string, unknown>>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
}
function toError(cause: unknown): Error { return cause instanceof Error ? cause : new Error(String(cause)); }
function errorMessage(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
