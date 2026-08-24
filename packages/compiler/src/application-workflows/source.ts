// typecast-file-boundary: Workflow source generation turns validated contracts into deterministic, bundle-ready TypeScript modules.
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  ApplicationCallableProviderBinding,
  ApplicationCallableProviderRuntimeOperation,
  ApplicationCommandHandlerNode,
  ApplicationCommandNode,
  ApplicationEventNode,
  ApplicationGraph,
  ApplicationStreamNode,
  ApplicationTaskHandlerNode,
  ApplicationWorkflowHandlerNode,
} from '@applik8s/core';
import type { Plugin } from 'esbuild';
import {
  capturedApplicationInjectFacade,
  generatedCallbackFactoryModule,
} from '../application-callback-module.js';
import {
  type ApplicationRuntimeExecutionTarget,
  generatedApplicationEventLogPublisherSource,
} from '../application-event-log-runtime-source.js';
import {
  generatedApplicationTelemetryImports,
  generatedApplicationTelemetryRuntimeSource,
} from '../application-observability-runtime-source.js';
import { applicationSignalGrantPermissionId } from '../application-operations/index.js';
import { generatedApplicationProviderOperationValue } from '../application-provider-telemetry-source.js';
import {
  nestedApplicationCallbackObjectSource,
  nestedApplicationCallbackVariable,
  nestedApplicationCommandDefinition,
  nestedApplicationEventDefinition,
  requiredApplicationGraphNode,
} from '../application-nested-operation-source.js';
import { structuredGenerationSelection, type WorkflowContract, type WorkflowFunctionNativeTransactionContract, type WorkflowOperationAliasContract, type WorkflowTaskObjectContract, type WorkflowTaskProjectionContract } from './contracts.js';
import {
  privateProviderBranchVariable,
  privateProviderConstructorModuleFile,
  privateProviderMountPath,
  privateProviderRuntimeVariable,
  privateProviderValidatorModuleFile,
} from './provider-private-runtime.js';
import { jsName, kubernetesName, numberConfig, objectConfig, stringConfig, workflowObjectEnabledEnvironment } from './utilities.js';

function absoluteDependencyImports(source: string, resolveDir: string): string {
  return source
    .replace(/(\bfrom\s+['"])(\.[^'"]+)(['"])/g, (_match, prefix: string, specifier: string, suffix: string) => `${prefix}${resolve(resolveDir, specifier)}${suffix}`)
    .replace(/(^|\n)(\s*import\s+['"])(\.[^'"]+)(['"])/g, (_match, line: string, prefix: string, specifier: string, suffix: string) => `${line}${prefix}${resolve(resolveDir, specifier)}${suffix}`);
}

export function handlerModuleFile(id: string): string {
  return `handler-${createHash('sha256').update(id).digest('hex').slice(0, 12)}.generated.ts`;
}

function handlerVariable(id: string): string {
  return `handler_${createHash('sha256').update(id).digest('hex').slice(0, 12)}`;
}

export function operationPrincipalModuleFile(id: string): string {
  return `principal-${createHash('sha256').update(id).digest('hex').slice(0, 12)}.generated.ts`;
}

function operationPrincipalVariable(id: string): string {
  return `principal_${createHash('sha256').update(id).digest('hex').slice(0, 12)}`;
}

export function taskServicePrincipalInput(
  serviceIdentity: NonNullable<ApplicationTaskHandlerNode['serviceIdentity']>,
  authorizationVersion: string,
): { readonly id: string; readonly authorizationVersion: string } {
  return Object.freeze({
    // canonicalApplicationTaskServicePrincipal() accepts the authored service
    // name and constructs the application-qualified identity. Passing the
    // already-qualified identity ID double-prefixes the runtime principal and
    // makes its static grants impossible to match.
    id: serviceIdentity.subject,
    authorizationVersion,
  });
}

function workflowOperationAliasesSource(
  aliases: Readonly<Record<string, WorkflowOperationAliasContract>>,
): string {
  const entries = Object.entries(aliases).map(([alias, binding]) => {
    const projection = binding.projectionSource
      ? `, project: (${binding.projectionSource})`
      : '';
    return `${JSON.stringify(alias)}: { commandId: ${JSON.stringify(binding.commandId)}, operationId: ${JSON.stringify(binding.operationId)}, boundKeys: ${JSON.stringify(binding.boundKeys)}, envelope: ${JSON.stringify(binding.envelope)}${projection} }`;
  });
  return `{ ${entries.join(', ')} }`;
}

export function generatedWorkerSource(
  contract: WorkflowContract,
  executionTarget: ApplicationRuntimeExecutionTarget = 'kubernetes',
): string {
  const handlers = [...contract.tasks.map((entry) => entry.handler), ...contract.workflows.map((entry) => entry.handler)];
  const handlerImports = handlers
    .map((handler) => `import { createHandler as ${handlerVariable(handler.id)} } from ${JSON.stringify(`./${handlerModuleFile(handler.id)}`)};`)
    .concat(contract.tasks.flatMap(({ handler }) => handler.operationPrincipalSource
      ? [`import { principal as ${operationPrincipalVariable(handler.id)} } from ${JSON.stringify(`./${operationPrincipalModuleFile(handler.id)}`)};`]
      : []))
    .concat(uniqueWorkflowProjectionEffects(contract).flatMap((effect) => workflowProjectionCallbackImports(effect)))
    .concat(contract.tasks.flatMap(({ handler }) =>
      workflowTaskProviderRuntimeOperations(handler).map(
        ({ runtime, variable }) =>
          `import { ${runtime.export} as ${variable} } from ${JSON.stringify(runtime.module)};`,
      )))
    .concat((contract.privateProviderEffects?.providers ?? []).flatMap(
      (provider) => provider.branches.flatMap((branch) =>
        branch.runtime
          ? [
              `import { createConstructor as ${privateProviderBranchVariable(provider.provider.id, branch.variant, 'construct')} } from ${JSON.stringify(`./${privateProviderConstructorModuleFile(provider.provider.id, branch.variant)}`)};`,
              `import { createValidator as ${privateProviderBranchVariable(provider.provider.id, branch.variant, 'validate')} } from ${JSON.stringify(`./${privateProviderValidatorModuleFile(provider.provider.id, branch.variant)}`)};`,
            ]
          : []),
    ))
    .filter((statement, index, statements) =>
      statements.indexOf(statement) === index)
    .join('\n');
  const taskDeclarations = contract.tasks.map(({ handler, task }) => {
    const errors = Object.fromEntries(task.contract.errors.map((error) => [error.name, error.schema.jsonSchema]));
    const capabilities = (handler.capabilities ?? []).map((reference) => reference.interface);
    const operations = contract.operationEffects?.aliases[handler.id] ?? {};
    const queries = contract.queryEffects?.aliases[handler.id] ?? {};
    const projections = contract.projectionEffects?.aliases[handler.id] ?? {};
    const objects = contract.objectEffects?.aliases[handler.id] ?? {};
    const providerAccounting = contract.providerAccountingEffects?.aliases[handler.id] ?? {};
    const childBindings = Object.fromEntries(
      (handler.childWorkflowBindings ?? []).map((binding) => [
        binding.alias,
        contract.contractNames[binding.workflow.nodeId],
      ]),
    );
    const actorBindings = handler.actors ?? [];
    const actorEffects = contract.actorEffects?.actors.filter(
      (candidate) => candidate.taskHandlerId === handler.id,
    ) ?? [];
    const authorityEnvelopes = [...new Map([
      ...Object.values(operations).map((binding) => [
        binding.envelope.id,
        binding.envelope,
      ] as const),
      ...actorEffects.map((effect) => [
        effect.workloadAuthority.id,
        effect.workloadAuthority,
      ] as const),
    ]).values()];
    const capabilityBindings = (handler.capabilities ?? []).map((reference) => {
      const provider = contract.capabilities.find(
        (candidate) => candidate.id === reference.nodeId,
      );
      if (!provider) {
        throw new Error(
          `Workflow handler ${handler.id} references unavailable capability ${reference.nodeId}.`,
        );
      }
      return {
        path: provider.interface,
        value: `Object.freeze({ name: ${JSON.stringify(provider.interface)} })`,
      };
    });
    const principal = handler.serviceIdentity
      ? JSON.stringify(taskServicePrincipalInput(
          handler.serviceIdentity,
          contract.operationCatalog?.revision ?? 'canonical-authority',
        ))
      : handler.operationPrincipalSource
        ? `${operationPrincipalVariable(handler.id)}(validInput)`
        : JSON.stringify({
            id: `workflow-task:${task.name}`,
            authorizationVersion:
              contract.operationCatalog?.revision ?? 'canonical-authority',
          });
    const functionNativeTransaction = contract.functionNativeTransactions?.find(
      (transaction) => transaction.taskHandlerId === handler.id,
    );
    const providerOperationBindings = workflowTaskProviderRuntimeOperations(
      handler,
    );
    const directBindings = nestedCallbackBindingsSource([
      ...capabilityBindings,
      ...providerOperationBindings.map(({ binding, variable }) => ({
        path: binding.identifier,
        value: generatedApplicationProviderOperationValue(binding, variable),
      })),
      ...(handler.providerBindings ?? []).flatMap((binding) => {
        const value = privateProviderBindingSource(contract, binding);
        return value ? [{ path: binding.identifier, value }] : [];
      }),
      ...(handler.childWorkflowBindings ?? []).map((binding) => ({
        path: binding.alias,
        value: `(input, options) => taskWorkflowRuntime.run(${JSON.stringify(contract.contractNames[binding.workflow.nodeId])}, input, options)`,
      })),
      ...(handler.operations ?? []).map((binding) => ({
        path: binding.alias,
        value: functionNativeTransaction?.mode === 'write'
          ? `bindApplicationFunctionNativeOperationHandle(functionNativeTaskOperationHandles[${JSON.stringify(handler.id)}][${JSON.stringify(binding.alias)}], execution.operations[${JSON.stringify(binding.alias)}])`
          : `execution.operations[${JSON.stringify(binding.alias)}]`,
      })),
      ...(handler.queries ?? []).map((binding) => ({
        path: binding.alias,
        value: `execution.queries[${JSON.stringify(binding.alias)}]`,
      })),
      ...(handler.projections ?? []).map((binding) => ({
        path: binding.alias,
        value: `execution.projections[${JSON.stringify(binding.alias)}]`,
      })),
      ...(handler.objects ?? []).map((binding) => ({
        path: binding.alias,
        value: `execution.objects[${JSON.stringify(binding.alias)}]`,
      })),
      ...actorBindings.map((binding) => ({
        path: binding.alias,
        value: (() => {
          const effect = actorEffects.find((candidate) => candidate.alias === binding.alias);
          if (!effect) throw new Error(`Workflow task ${handler.id} actor ${binding.alias} has no compiled actor effect.`);
          const envelope = JSON.stringify(effect.workloadAuthority);
          return binding.memberKind === 'alarm'
            ? `(key, at, input, options) => invokeApplicationActorMember(execution, principal, ${JSON.stringify(task.name)}, ${JSON.stringify(binding.actor.nodeId.replace(/^actor\./u, ''))}, ${JSON.stringify(binding.member)}, ${JSON.stringify(binding.memberKind)}, ${envelope}, key, input, { ...options, scheduledAt: at instanceof Date ? at.toISOString() : at })`
            : `(key, input, options) => invokeApplicationActorMember(execution, principal, ${JSON.stringify(task.name)}, ${JSON.stringify(binding.actor.nodeId.replace(/^actor\./u, ''))}, ${JSON.stringify(binding.member)}, ${JSON.stringify(binding.memberKind)}, ${envelope}, key, input, options)`;
        })(),
      })),
      ...(handler.signalBindings ?? []).map((binding) => ({
        path: binding.alias,
        value: `signalDefinitions[${JSON.stringify(binding.id)}]`,
      })),
      ...((handler.signalBindings?.length ?? 0) > 0
        ? [{ path: 'workflow', value: 'workflowSignals' }]
        : []),
      ...functionNativeTaskCallbackBindingEntries(functionNativeTransaction),
    ]);
    const functionNativeRuntime = !functionNativeTransaction
      ? ''
      : functionNativeTransaction.mode === 'read'
        ? `withApplicationNativeModelReadClients(await functionNativeTaskReadClients(${JSON.stringify(handler.id)}, context), () => `
        : `withApplicationNativeModelTransactionRuntime(functionNativeTaskRuntime(${JSON.stringify(handler.id)}, context, principal), async () => withApplicationNativeModelReadClients(await functionNativeTaskReadClients(${JSON.stringify(handler.id)}, context), () => `;
    const functionNativeRuntimeClose = !functionNativeTransaction
      ? ''
      : functionNativeTransaction.mode === 'read'
        ? ')'
        : '))';
    const durableSignalTask = (handler.signalBindings?.length ?? 0) > 0;
    if (Object.values(childBindings).some((value) => !value)) {
      throw new Error(`Task handler ${handler.id} contains an unresolved child-workflow binding.`);
    }
    return `
const ${jsName(task.id)} = hatchet.${durableSignalTask ? 'durableTask' : 'task'}({
  name: ${JSON.stringify(task.name)},
  retries: ${Math.max(0, (handler.retry.maxAttempts ?? 1) - 1)},
  backoff: { factor: ${Math.max(1, handler.retry.factor ?? 2)}, maxSeconds: ${Math.max(1, (handler.retry.maxDelayMs ?? 60_000) / 1_000)} },
  // A compiler-inferred signal wait is durable orchestration even when the
  // function-native workflow was lowered through its hidden effect boundary.
  // Hatchet must be able to evict it while it waits; normal effect-only tasks
  // retain their authored bounded execution timeout.
  executionTimeout: ${JSON.stringify(durableSignalTask ? '8760h' : `${handler.executionTimeoutSeconds}s`)},
  scheduleTimeout: ${JSON.stringify(`${handler.scheduleTimeoutSeconds}s`)},
  fn: async (transportInput, context) => {
    const delivery = workflowDelivery(transportInput, context);
    return runApplicationTelemetryBoundary(
    workflowTelemetryBoundary(context, 'task', ${JSON.stringify(handler.id)}, ${JSON.stringify(task.name)}, delivery.metadata),
    async () => {
    const validInput = validate(${JSON.stringify(task.contract.input.jsonSchema)}, delivery.input, ${JSON.stringify(`${task.name}.input`)});
    const admitted = await canonicalTaskAdmission(${principal}, context, ${JSON.stringify(handler.id)}, ${JSON.stringify(task.name)}, ${JSON.stringify(authorityEnvelopes)}, ${handler.executionTimeoutSeconds}, delivery.metadata);
    const principal = admitted.principal;
    const execution = taskContext(context, ${JSON.stringify(task.name)}, ${JSON.stringify({ contractId: task.contract.name, contractVersion: task.contract.version, handlerId: handler.id, workerId: contract.worker.id })}, ${JSON.stringify(errors)}, ${JSON.stringify(capabilities)}, ${workflowOperationAliasesSource(operations)}, ${JSON.stringify(queries)}, ${JSON.stringify(projections)}, ${JSON.stringify(objects)}, ${JSON.stringify(providerAccounting)}, principal, admitted.servicePrincipal, admitted.execution, validInput);
    const taskWorkflowRuntime = directWorkflowRuntime(context, execution, {}, ${JSON.stringify(childBindings)}, declarations, true);
    const workflowSignals = workflowSignalApi(context, execution);
    const authoredHandler = ${handlerVariable(handler.id)}(${directBindings});
	    const output = await ${functionNativeRuntime}directWorkflowScope.run(taskWorkflowRuntime, () => directOperationScope.run(directApplicationRuntime(execution), () => directObjectScope.run((binding) => execution.objects[binding.name], () => directProjectionScope.run((binding) => execution.projections[binding.name], () => authoredHandler(validInput, execution)))))${functionNativeRuntimeClose};
    return validate(${JSON.stringify(task.contract.output.jsonSchema)}, output, ${JSON.stringify(`${task.name}.output`)});
    },
  );
  },
});`;
  }).join('\n');
  const workflowDeclarations = contract.workflows.map(({ handler, workflow }) => {
    const taskBindings = Object.fromEntries(handler.taskBindings.map((binding) => [binding.alias, contract.contractNames[binding.task.nodeId]]));
    const childBindings = Object.fromEntries(handler.childWorkflowBindings.map((binding) => [binding.alias, contract.contractNames[binding.workflow.nodeId]]));
    const errors = Object.fromEntries(workflow.contract.errors.map((error) => [error.name, error.schema.jsonSchema]));
    const directBindings = nestedCallbackBindingsSource([
      ...handler.taskBindings.map((binding) => ({
        path: binding.alias,
        value: `(input, options) => execution.task(${JSON.stringify(binding.alias)}, input, options)`,
      })),
      ...handler.childWorkflowBindings.map((binding) => ({
        path: binding.alias,
        value: `(input, options) => execution.child(${JSON.stringify(binding.alias)}, input, options)`,
      })),
      ...(handler.signalBindings ?? []).map((binding) => ({
        path: binding.alias,
        value: `signalDefinitions[${JSON.stringify(binding.id)}]`,
      })),
      ...((handler.signalBindings?.length ?? 0) > 0
        ? [{ path: 'workflow', value: 'workflowSignals' }]
        : []),
    ]);
    if (Object.values(taskBindings).some((value) => !value) || Object.values(childBindings).some((value) => !value)) throw new Error(`Workflow handler ${handler.id} contains an unresolved task or child-workflow binding.`);
    return `
const ${jsName(workflow.id)} = hatchet.durableTask({
  name: ${JSON.stringify(workflow.name)},
  // Durable orchestration may remain suspended on framework signals without
  // consuming a worker. Effect tasks keep their independently bounded
  // executionTimeout values; this ceiling bounds only orchestration history.
  executionTimeout: '8760h',
  fn: async (transportInput, context) => {
    const delivery = workflowDelivery(transportInput, context);
    return runApplicationTelemetryBoundary(
    workflowTelemetryBoundary(context, 'workflow', ${JSON.stringify(handler.id)}, ${JSON.stringify(workflow.name)}, delivery.metadata),
    async () => {
    const validInput = validate(${JSON.stringify(workflow.contract.input.jsonSchema)}, delivery.input, ${JSON.stringify(`${workflow.name}.input`)});
    const admitted = await canonicalWorkflowAdmission(context, ${JSON.stringify(handler.id)}, ${JSON.stringify(workflow.name)}, delivery.metadata);
    const execution = workflowContext(context, ${JSON.stringify(workflow.name)}, ${JSON.stringify(taskBindings)}, ${JSON.stringify(childBindings)}, ${JSON.stringify(errors)}, declarations, admitted.execution);
    await observeWorkflowExecution(execution, ${JSON.stringify(workflow.name)}, 'running');
    try {
      const directRuntime = directWorkflowRuntime(context, execution, ${JSON.stringify(taskBindings)}, ${JSON.stringify(childBindings)}, declarations);
      const workflowSignals = workflowSignalApi(context, execution);
      const authoredHandler = ${handlerVariable(handler.id)}(${directBindings});
      const output = await directWorkflowScope.run(directRuntime, () => authoredHandler(validInput, execution));
      const validOutput = validate(${JSON.stringify(workflow.contract.output.jsonSchema)}, output, ${JSON.stringify(`${workflow.name}.output`)});
      await observeWorkflowExecution(execution, ${JSON.stringify(workflow.name)}, 'succeeded');
      return validOutput;
    } catch (error) {
      await observeWorkflowExecution(
        execution,
        ${JSON.stringify(workflow.name)},
        'failed',
        error instanceof Error ? error.name : 'WorkflowFailure',
      );
      throw error;
    }
    },
  );
  },
});`;
  }).join('\n');
  const declarationNames = [...contract.tasks.map(({ task }) => jsName(task.id)), ...contract.workflows.map(({ workflow }) => jsName(workflow.id))];
  const declarationEntries = [
    ...contract.tasks.map(({ task }) => `${JSON.stringify(task.name)}: ${jsName(task.id)}`),
    ...contract.workflows.map(({ workflow }) => `${JSON.stringify(workflow.name)}: ${jsName(workflow.id)}`),
  ];
  const cronRegistrations = contract.workflows.flatMap(({ workflow }) => workflow.triggers.crons.map((cron) => `${jsName(workflow.id)}.cron(${JSON.stringify(cron.name)}, ${JSON.stringify(cron.expression)}, encodeHatchetWorkflowTransportInput(${JSON.stringify(cron.input)}))`));
  const structuredGenerationCapability = contract.capabilities.some(
    (provider) => provider.interface === 'StructuredGeneration',
  );
  const capabilityImports = `import { createApplicationTaskCapabilityBindings, defineApplicationTaskCapabilityFactory } from '@applik8s/applik8s/task-capability-runtime';${structuredGenerationCapability
    ? `
import { createDeterministicStructuredGenerationCapability, createHttpStructuredGenerationCapability } from '@applik8s/applik8s/structured-generation-runtime';`
    : ''}${contract.nativeAI
    ? `
import { createApplicationTanStackTaskCapability, withApplicationTanStackPersistence } from '@applik8s/ai-tanstack';
import { applicationAIConversationPrincipalScope, createApplicationTanStackConversationPersistence, createPostgresApplicationConversationStore } from '@applik8s/conversations/runtime';
import { applicationAITextAdapter } from '@applik8s/runtime-ai';`
    : ''}`;
  const eventLogPublisher = contract.operationEffects
    ? generatedApplicationEventLogPublisherSource({
        executionTarget,
        variableName: 'applicationEventLogPublisher',
        connectionName: `applik8s-workflow-${contract.worker.name}`,
      })
    : undefined;
  const operationImports = `import { canonicalApplicationTaskServicePrincipal${contract.operationEffects ? ', createApplicationTaskOperationRuntime' : ''} } from '@applik8s/applik8s/task-operation-runtime';
${contract.operationEffects || contract.signalEffects ? `import { createApplicationOperationAuthorityRuntime } from '@applik8s/operations';
	${contract.nativeAI ? '' : "import postgres from 'postgres';"}
	${eventLogPublisher?.importSource ?? ''}` : ''}
${contract.nativeAI ? "import postgres from 'postgres';" : ''}`;
  const queryImports = contract.queryEffects
    ? `import { createApplicationTaskQueryRuntime } from '@applik8s/applik8s/task-query-runtime';`
    : '';
  const projectionImports = contract.projectionEffects
    ? `import { createPostgresApplicationProjectionSnapshotSource, createPostgresApplicationStream, createValkeyOnlineProjectionWriter, retireApplicationOnlineProjectionGeneration, runApplicationOnlineProjectionRebuild } from '@applik8s/applik8s/projection-worker-runtime';`
    : '';
	const objectImports = contract.objectEffects
		? `import { createS3ApplicationObjectStorageRuntime } from '@applik8s/runtime-s3';`
		: '';
  const providerAccountingImports = contract.providerAccountingEffects
    ? `import { bindApplicationProviderCallAccounting } from '@applik8s/usage/provider-accounting-runtime';
import { createPostgresApplicationProviderCallAccounting } from '@applik8s/usage/provider-accounting-postgres-runtime';
${contract.operationEffects || contract.signalEffects || contract.nativeAI ? '' : "import postgres from 'postgres';"}`
    : '';
  const signalImports = contract.signalEffects
    ? `import { createApplicationWorkflowSignalRuntime, createPostgresApplicationSignalStore, runApplicationSignalOutboxRelay } from '@applik8s/applik8s/signal-runtime';
import { applicationOperationInputDigest } from '@applik8s/applik8s/operation-runtime';`
    : '';
  const functionNativeImports = contract.functionNativeTransactions
    ? `import { applicationCommandPrincipalValues, applicationPostgresModelReadClients, applicationRelationalChangeScopes, bindApplicationFunctionNativeOperationHandle, createApplicationFunctionNativeEventHandle, createApplicationFunctionNativeOperationHandle, editApplicationNativeModelObject, executeFunctionNativePostgresModelEdit, findApplicationNativeModelObjects, getApplicationNativeModelObject, requireApplicationNativeModelObject, withApplicationNativeModelReadClients, withApplicationNativeModelTransactionRuntime } from '@applik8s/applik8s/stream-worker-runtime';${contract.operationEffects?.operations.some(({ handler }) => Boolean(handler.beforeCommit)) ? "\nimport { runApplicationModelBeforeCommit } from '@applik8s/applik8s/processor-runtime';" : ''}`
    : '';
  const gatewayImports = contract.gatewayCallers.length > 0
    ? `import { AuthenticationV1Api, CoordinationV1Api, KubeConfig, V1MicroTime } from '@kubernetes/client-node';
import { createHatchetWorkflowRuntimeFromClient, observeHatchetWorkflowRun } from '@applik8s/runtime-hatchet';
import { createSignedEnvelopeCodec, signedEnvelopeUtf8Key, staticSignedEnvelopeKeyProvider } from '@applik8s/runtime';`
    : '';
  const privateProviderImports = contract.privateProviderEffects
    && !(contract.operationEffects || contract.signalEffects || contract.nativeAI || contract.providerAccountingEffects)
    ? `import postgres from 'postgres';`
    : '';
  const capabilityInitializers = generatedWorkflowCapabilities(contract);
  const nativeAIStateInitializer = generatedWorkflowNativeAIState(contract);
  const operationInitializer = generatedWorkflowOperationRuntime(
    contract,
    eventLogPublisher?.declarationSource,
  );
  const queryInitializer = generatedWorkflowQueryRuntime(contract);
  const projectionInitializer = generatedWorkflowProjectionRuntime(contract);
	const objectInitializer = generatedWorkflowObjectRuntime(contract);
  const providerAccountingInitializer = generatedWorkflowProviderAccountingRuntime(contract);
  const signalInitializer = generatedWorkflowSignalRuntime(contract);
  const functionNativeOperationInitializer =
    generatedWorkflowFunctionNativeOperations(contract);
  const functionNativeInitializer =
    generatedWorkflowFunctionNativeTransactions(contract);
  const gatewayInitializer = generatedWorkflowGateway(contract);
  const privateProviderInitializer = generatedWorkflowPrivateProviderRuntime(
    contract,
  );
  return `import { AsyncLocalStorage } from 'node:async_hooks';
	import { createHash, randomUUID } from 'node:crypto';
	import { createServer } from 'node:http';
	import { readFile } from 'node:fs/promises';
	import { connect as connectTcp } from 'node:net';
	import { HatchetClient } from '@hatchet-dev/typescript-sdk/v1/index.js';
	import { compactHatchetWorkflowAdmissionPage, decodeHatchetWorkflowTransportInput, encodeHatchetWorkflowTransportInput } from '@applik8s/runtime-hatchet';
	import { applicationAdmissionInvocationView, applicationCausalPrincipalContext, canonicalJsonV1String, createApplicationAdmissionContextV1, createApplicationExecutionPrincipalV1, validateApplicationAdmissionContextV1, validateApplicationAdmissionContextV1WithoutReceipt, validateApplicationTelemetryEnvelopeV1, withApplicationAdmissionExecutionV1, withApplicationAdmissionTraceV1 } from '@applik8s/core';
	import { applicationAdmissionRejectionCodeV1, createApplicationAdmissionObservationV1 } from '@applik8s/core/admission';
	import { nodeKeyedDigestHex } from '@applik8s/runtime/node-integrity';
		import { installApplicationObjectStorageRuntimeResolver, installApplicationProjectionRuntimeResolver, installApplicationWorkflowRuntimeResolver } from '@applik8s/applik8s/workflow-runtime-resolvers';
import { applicationWorkflowCausalPrincipalMetadata, applicationWorkflowProviderAdmissionMetadata, applicationWorkflowTelemetryMetadata } from '@applik8s/applik8s/workflow-runtime';
${generatedApplicationTelemetryImports({ boundaryRunner: true, carrierCapture: true, providerOperationInstrumentation: contract.tasks.some(({ handler }) => workflowTaskProviderRuntimeOperations(handler).length > 0), runtimeIntegrityObserver: contract.gatewayCallers.length > 0, runtimeImplementation: contract.observability }).join('\n')}
import { installApplicationInvocationAdmissionResolver, installApplicationOperationRuntimeResolver } from '@applik8s/client';
import { normalizeSchema } from '@applik8s/sdk';
${capabilityImports}
${operationImports}
${queryImports}
${projectionImports}
${objectImports}
${providerAccountingImports}
${signalImports}
${functionNativeImports}
${gatewayImports}
${privateProviderImports}
${handlerImports}

if (process.argv.includes('--credential-preflight')) {
  await waitForWorkflowCredential();
  process.exit(0);
}

const hatchet = HatchetClient.init();
${contract.observability ? generatedApplicationTelemetryRuntimeSource({ application: contract.graphName, service: `workflow-worker:${contract.worker.name}` }) : ''}
const declarations = Object.create(null);
	const directWorkflowScope = new AsyncLocalStorage();
	const directTaskEffectScope = new AsyncLocalStorage();
	const directOperationScope = new AsyncLocalStorage();
	const directObjectScope = new AsyncLocalStorage();
	const directProjectionScope = new AsyncLocalStorage();
	installApplicationWorkflowRuntimeResolver(() => directWorkflowScope.getStore());
	installApplicationOperationRuntimeResolver(() => directOperationScope.getStore());
	installApplicationInvocationAdmissionResolver(() => directOperationScope.getStore()?.admission);
	installApplicationObjectStorageRuntimeResolver((binding) => directObjectScope.getStore()?.(binding));
	installApplicationProjectionRuntimeResolver((binding) => directProjectionScope.getStore()?.(binding));
const capabilities = Object.create(null);
${nativeAIStateInitializer}
${privateProviderInitializer}
${capabilityInitializers}
${operationInitializer}
${queryInitializer}
${projectionInitializer}
${objectInitializer}
${providerAccountingInitializer}
${signalInitializer}
${functionNativeOperationInitializer}
${functionNativeInitializer}
let ready = false;
let stopping = false;
const server = createServer((request, response) => {
  const healthy = request.url === '/live' || (request.url === '/ready' && ready && !stopping);
  response.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ready, stopping }));
});
server.listen(${contract.worker.deployment.healthPort}, '0.0.0.0');
${gatewayInitializer}
${nativeAITaskProviderSource(contract)}

async function retryStartup(dependency, operation, timeoutMs = 600_000) {
  const startedAt = Date.now();
  let delayMs = 250;
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      if (Date.now() - startedAt >= timeoutMs) throw new Error('applik8s-workflow-startup-timeout: ' + dependency + ' was not ready after ' + attempt + ' attempts', { cause: error });
      console.error(JSON.stringify({ event: 'applik8s-workflow-startup-wait', dependency, attempt, error: error instanceof Error ? error.message : String(error) }));
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(5_000, delayMs * 2);
    }
  }
}
async function waitForWorkflowCredential(timeoutMs = 600_000) {
  const tokenFile = process.env.APPLIK8S_WORKFLOW_TOKEN_FILE;
  if (!tokenFile) throw new Error('Missing required workflow runtime environment variable APPLIK8S_WORKFLOW_TOKEN_FILE');
  const startedAt = Date.now();
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      const token = (await readFile(tokenFile, 'utf8')).trim();
      if (!token) throw new Error('empty workflow token');
      const candidate = HatchetClient.init({ token });
      await candidate.workers.list();
      return;
    } catch {
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error('applik8s-workflow-credential-timeout: Hatchet did not accept the projected worker token within ' + timeoutMs + 'ms');
      }
      console.error(JSON.stringify({ event: 'applik8s-workflow-credential-wait', attempt }));
      await new Promise((resolve) => setTimeout(resolve, Math.min(5_000, 250 * (2 ** Math.min(attempt - 1, 5)))));
    }
  }
}
function tcpTarget(value) {
  const parsed = new URL(value.includes('://') ? value : 'tcp://' + value);
  const port = Number(parsed.port);
  if (!parsed.hostname || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid endpoint ' + JSON.stringify(value));
  return { host: parsed.hostname, port };
}
async function waitForTcpEndpoint(name, value) {
  const target = tcpTarget(value);
  await retryStartup(name, () => new Promise((resolve, reject) => {
    const socket = connectTcp(target);
    const finish = (error) => {
      socket.removeAllListeners();
      socket.destroy();
      if (error) reject(error); else resolve();
    };
    socket.setTimeout(2_000, () => finish(new Error('connection timed out')));
    socket.once('error', finish);
    socket.once('connect', () => finish());
  }));
}
function validate(schema, value, name) {
  const result = normalizeSchema({ kind: 'jsonSchema', ref: { kind: 'jsonSchema', uri: 'generated:' + name }, schema }, name).validate(value);
  if (!result.ok) {
    const received = value === null
      ? 'null'
      : Array.isArray(value)
        ? 'array(length=' + value.length + ')'
        : typeof value === 'object'
          ? 'object(keys=' + Object.keys(value).sort().join(',') + ')'
          : typeof value;
    throw new Error('applik8s-workflow-schema-invalid: ' + name + ': ' + result.error.message + '; received ' + received);
  }
  return result.value;
}
function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error('Missing required workflow runtime environment variable ' + name);
  return value;
}
function runtimeEndpoint(baseUrl, environmentName, path) {
  let selected = process.env[environmentName] || baseUrl;
  while (selected.endsWith('/')) selected = selected.slice(0, -1);
  return selected + path;
}
async function observeWorkflowExecution(execution, workflowName, state, reason) {
  if (!operationAuthority) return;
  await operationAuthority.observe({
    id: 'workflow-execution:' + workflowName,
    domain: 'workflow',
    subject: workflowName,
    authority: 'provider',
    state,
    ...(reason ? { reason } : {}),
    source: 'hatchet-workflow-runtime',
    causalId: execution.correlationId ?? execution.invocationId,
    evidence: {
      workflowName,
      executionId: execution.invocationId,
      attempt: execution.attempt,
    },
    observedAt: new Date().toISOString(),
  });
}
async function observeWorkflowRuntime(state, reason) {
  if (!operationAuthority) return;
  const observedAt = new Date();
  const expiresAt = new Date(observedAt.getTime() + 90_000).toISOString();
  await Promise.all([
    operationAuthority.observe({
      id: 'workflow-engine:${contract.provider.id}',
      domain: 'workflow',
      subject: ${JSON.stringify(contract.provider.name)},
      authority: 'provider',
      state,
      ...(reason ? { reason } : {}),
      source: 'hatchet-workflow-runtime',
      evidence: { engine: ${JSON.stringify(contract.engineName)} },
      observedAt: observedAt.toISOString(),
      expiresAt,
    }),
    operationAuthority.observe({
      id: 'workflow-worker:${contract.worker.id}',
      domain: 'workflow',
      subject: ${JSON.stringify(contract.worker.name)},
      authority: 'provider',
      state,
      ...(reason ? { reason } : {}),
      source: 'hatchet-workflow-runtime',
      evidence: { worker: ${JSON.stringify(contract.worker.name)} },
      observedAt: observedAt.toISOString(),
      expiresAt,
    }),
  ]);
}

function workflowAdmissionRejectionCode(error) {
  return applicationAdmissionRejectionCodeV1(error);
}

function workflowGatewayStageError(code, cause) {
  const error = new Error(code, { cause });
  error.name = 'WorkflowGatewayStageError';
  error.code = code;
  const status = cause && typeof cause === 'object'
    ? Reflect.get(cause, 'code')
      ?? Reflect.get(cause, 'status')
      ?? Reflect.get(cause, 'statusCode')
      ?? Reflect.get(Reflect.get(cause, 'response') ?? {}, 'status')
      ?? Reflect.get(Reflect.get(cause, 'response') ?? {}, 'statusCode')
    : undefined;
  if (typeof status === 'number' && Number.isSafeInteger(status)) error.providerStatus = status;
  return error;
}

async function observeWorkflowAdmission(options, state, admission, reason) {
  const evidence = createApplicationAdmissionObservationV1({
    state,
    boundary: 'execution',
    ...(admission ? { admission } : { transport: 'workflow' }),
    ...(reason ? { rejectionCode: reason } : {}),
  });
  console.info(JSON.stringify({
    event: 'applik8s-workflow-admission',
    ...evidence,
  }));
  if (!operationAuthority) return;
  const observedAt = new Date();
  try {
    await operationAuthority.observe({
      id: 'workflow-admission:' + options.executionKind + ':' + options.handlerId,
      domain: 'workflow',
      subject: options.operationId,
      authority: 'canonical',
      state: state === 'admitted' ? 'ready' : 'failed',
      ...(reason ? { reason } : {}),
      source: 'applik8s-workflow-admission',
      evidence,
      observedAt: observedAt.toISOString(),
      expiresAt: new Date(observedAt.getTime() + 90_000).toISOString(),
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'applik8s-workflow-admission-observation-failed',
      error: workflowAdmissionRejectionCode(error),
    }));
  }
}

function canonicalTaskAdmission(principal, context, handlerId, contractName, envelopes, timeoutSeconds, transportedMetadata) {
  return canonicalManagedAdmission({
    context,
    executionKind: 'task',
    handlerId,
    operationId: 'applik8s://tasks/' + encodeURIComponent(contractName) + '/operations/execute',
    envelopes,
    principal,
    timeoutSeconds,
    transportedMetadata,
  });
}

function canonicalWorkflowAdmission(context, handlerId, contractName, transportedMetadata) {
  return canonicalManagedAdmission({
    context,
    executionKind: 'workflow',
    handlerId,
    operationId: 'applik8s://workflows/' + encodeURIComponent(contractName) + '/operations/execute',
    envelopes: [],
    timeoutSeconds: 365 * 24 * 60 * 60,
    transportedMetadata,
  });
}

async function canonicalManagedAdmission(options) {
  try {
    const admitted = await canonicalManagedAdmissionUnchecked(options);
    await observeWorkflowAdmission(
      options,
      'admitted',
      admitted.execution.admission,
    );
    return admitted;
  } catch (error) {
    await observeWorkflowAdmission(
      options,
      'rejected',
      undefined,
      workflowAdmissionRejectionCode(error),
    );
    throw error;
  }
}

async function canonicalManagedAdmissionUnchecked(options) {
  const raw = metadata(options.context, options.executionKind, options.transportedMetadata);
  const authorityRevision = operationAuthority
    ? await operationAuthority.authorityRevision()
    : ${JSON.stringify(contract.authorityManifest?.revision ?? contract.operationCatalog?.revision ?? `authority:${contract.graphName}:none`)};
  const catalogRevision = ${JSON.stringify(contract.operationCatalog?.revision ?? `catalog:${contract.graphName}:none`)};
  const authoredPrincipal = options.principal
    ? canonicalApplicationTaskServicePrincipal(options.principal, {
        application: ${JSON.stringify(contract.graphName)},
        workerId: ${JSON.stringify(contract.worker.id)},
        catalogRevision,
        authorityRevision,
        invocationId: raw.invocationId,
        contextSecret: requiredEnv('APPLIK8S_INTERNAL_OPERATION_SECRET'),
        ...(raw.causalPrincipal ? { causalPrincipal: raw.causalPrincipal } : {}),
      })
    : undefined;
  const firstEnvelope = options.envelopes[0];
  const workloadIdentity = firstEnvelope?.workloadIdentity ?? Object.freeze({
    id: 'identity:' + ${JSON.stringify(contract.graphName)} + ':workload:' + options.handlerId,
    kind: 'workload',
    issuer: 'applik8s://' + ${JSON.stringify(contract.graphName)},
    subject: options.handlerId,
  });
  const serviceIdentity = options.envelopes.length > 0
    ? firstEnvelope?.serviceIdentity
    : authoredPrincipal?.identity;
  const trustedContext = raw.trustedContext ?? Object.freeze({
    values: authoredPrincipal?.trustedContext ?? Object.freeze({}),
    digest: authoredPrincipal?.trustedContextDigest ?? nodeKeyedDigestHex({
      key: requiredEnv('APPLIK8S_INTERNAL_OPERATION_SECRET'),
      purpose: 'applik8s.workflow-trusted-context/v1',
      value: canonicalJsonV1String({}),
    }),
  });
  const causalPrincipal = raw.causalPrincipal ?? (authoredPrincipal
    ? Object.freeze({
        id: authoredPrincipal.id,
        identity: authoredPrincipal.identity,
        grantIds: Object.freeze([]),
      })
    : undefined);
  const audience = [...new Set(options.envelopes.flatMap((envelope) => envelope.audiences))];
  if (audience.length === 0) audience.push(${JSON.stringify(contract.worker.id)});
  const deadline = new Date(Date.now() + options.timeoutSeconds * 1_000).toISOString();
  const cancellationRevision = 'active:' + raw.invocationId;
  const principal = operationAuthority
    ? await operationAuthority.admitExecutionPrincipal({
        executionKind: options.executionKind,
        executionId: raw.invocationId,
        attempt: raw.attempt,
        workloadIdentity,
        ...(serviceIdentity ? { serviceIdentity } : {}),
        causalPrincipalId: causalPrincipal?.id ?? workloadIdentity.id,
        causalPrincipal: causalPrincipal?.identity ?? workloadIdentity,
        causalGrantIds: causalPrincipal?.grantIds ?? [],
        envelopes: options.envelopes,
        trustedContextDigest: trustedContext.digest,
        audience,
        deadline,
        cancellationRevision,
      })
    : createApplicationExecutionPrincipalV1({
        application: ${JSON.stringify(contract.graphName)},
        executionKind: options.executionKind,
        executionId: raw.invocationId,
        attempt: raw.attempt,
        workloadIdentity,
        ...(serviceIdentity ? { serviceIdentity } : {}),
        ...(causalPrincipal ? { causalPrincipal } : {}),
        envelopes: options.envelopes,
        trustedContextDigest: trustedContext.digest,
        audience,
        catalogRevision,
        authorityRevision,
        deadline,
        cancellationRevision,
        authenticationMethod: 'hatchet-workflow-delivery',
      });
  const base = createApplicationAdmissionContextV1({
    admission: { principal, trustedContext: trustedContext.values },
    operation: { id: options.operationId, transport: 'workflow' },
    correlationId: raw.correlationId ?? raw.invocationId,
  });
  const traced = raw.traceparent
    ? withApplicationAdmissionTraceV1(base, { traceparent: raw.traceparent })
    : base;
  const context = validateApplicationAdmissionContextV1WithoutReceipt(
    withApplicationAdmissionExecutionV1(traced, {
      ...(raw.causationId ? { causationId: raw.causationId } : {}),
      deadline,
      cancellation: { revision: cancellationRevision },
      delivery: {
        id: raw.invocationId,
        source: 'hatchet:' + ${JSON.stringify(contract.worker.id)},
      },
    }),
  );
  return Object.freeze({
    principal,
    servicePrincipal: authoredPrincipal,
    execution: Object.freeze({
      ...raw,
      executionKind: options.executionKind,
      deadline,
      cancellationRevision,
      trustedContext,
      ...(causalPrincipal ? { causalPrincipal } : {}),
      admission: applicationAdmissionInvocationView(context),
    }),
  });
}

async function invokeApplicationActorMember(execution, principal, taskName, actor, member, memberKind, workloadAuthority, key, input, options = {}) {
  if (!principal || typeof principal.id !== 'string' || !principal.trustedContextDigest) {
    throw new Error('Workflow task ' + taskName + ' has no framework-derived actor principal.');
  }
  const audience = workloadAuthority.audiences[0];
  if (!audience) throw new Error('Workflow task ' + taskName + ' actor ' + actor + '.' + member + ' has no workload-authority audience.');
  const telemetry = captureApplicationTelemetryContext();
  const endpoint = requiredEnv('APPLIK8S_ACTOR_APPLICATION_ENDPOINT').replace(/\\/+$/u, '') + '/__applik8s/v1/internal/actors/invoke';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + requiredEnv('APPLIK8S_INTERNAL_OPERATION_SECRET'),
    },
    body: JSON.stringify({
      actor,
      member,
      memberKind,
      key,
      input,
      idempotencyKey: options.idempotencyKey ?? execution.idempotencyKey,
      ...(options.scheduledAt ? { scheduledAt: options.scheduledAt } : {}),
      authority: {
        principal,
        causalPrincipal: { id: principal.causalPrincipalId ?? principal.id },
        trustedContextDigest: principal.trustedContextDigest,
        transport: 'workflow',
        audience,
        workloadAuthorityId: workloadAuthority.id,
        execution: {
          kind: 'task',
          id: execution.invocationId,
          attempt: execution.attempt,
          deadline: execution.deadline,
          cancellationRevision: execution.cancellationRevision,
        },
      },
      ...(telemetry ? { telemetry } : {}),
    }),
    signal: execution.signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('Actor ' + actor + '.' + member + ' failed with HTTP ' + response.status + ': ' + JSON.stringify(body));
  return memberKind === 'command' ? body.result : body.receipt;
}

function workflowDelivery(input, context) {
  const decoded = decodeHatchetWorkflowTransportInput(input);
  const providerMetadata = typeof context.additionalMetadata === 'function' ? context.additionalMetadata() : {};
  return Object.freeze({
    input: decoded.input,
    metadata: Object.freeze({ ...providerMetadata, ...decoded.metadata }),
  });
}

function workflowCausalPrincipal(data) {
  const serialized = data?.['applik8s.causal-principal'];
  if (!serialized) return undefined;
  let value;
  try { value = JSON.parse(serialized); } catch { throw new Error('applik8s-workflow-causal-principal-invalid'); }
  if (!value || typeof value !== 'object'
    || typeof value.id !== 'string' || !value.id.trim()
    || !value.identity || typeof value.identity !== 'object'
    || typeof value.identity.id !== 'string' || !value.identity.id.trim()
    || typeof value.identity.kind !== 'string' || !value.identity.kind.trim()
    || typeof value.identity.issuer !== 'string' || !value.identity.issuer.trim()
    || typeof value.identity.subject !== 'string' || !value.identity.subject.trim()
    || !Array.isArray(value.grantIds)
    || value.grantIds.some((grantId) => typeof grantId !== 'string' || !grantId.trim())) {
    throw new Error('applik8s-workflow-causal-principal-invalid');
  }
  return Object.freeze({
    id: value.id,
    identity: Object.freeze({
      id: value.identity.id,
      kind: value.identity.kind,
      issuer: value.identity.issuer,
      subject: value.identity.subject,
    }),
    grantIds: Object.freeze([...value.grantIds]),
  });
}

function metadata(context, executionKind = 'task', transportedMetadata) {
  const invocationId = String(executionKind === 'task'
    ? context.stepRunId?.() ?? context.workflowRunId?.() ?? 'unknown'
    : context.workflowRunId?.() ?? context.stepRunId?.() ?? 'unknown');
  const data = transportedMetadata ?? (typeof context.additionalMetadata === 'function' ? context.additionalMetadata() : {});
  let trustedContext;
  if (data?.['applik8s.trusted-context']) {
    try { trustedContext = JSON.parse(data['applik8s.trusted-context']); } catch { throw new Error('applik8s-workflow-trusted-context-invalid'); }
    if (!trustedContext || typeof trustedContext !== 'object' || !trustedContext.values || typeof trustedContext.digest !== 'string') throw new Error('applik8s-workflow-trusted-context-invalid');
  }
  const causalPrincipal = workflowCausalPrincipal(data);
  const telemetry = workflowTelemetry(data);
  return { invocationId, idempotencyKey: invocationId, attempt: Number(context.retryCount?.() ?? 0) + 1, correlationId: data?.['applik8s.correlation-id'], causationId: data?.['applik8s.causation-id'], traceparent: data?.traceparent, ...(trustedContext ? { trustedContext } : {}), ...(causalPrincipal ? { causalPrincipal } : {}), ...(telemetry ? { telemetry } : {}), signal: context.abortController?.signal ?? new AbortController().signal };
}
function workflowTelemetry(data) {
  const serialized = data?.['applik8s.telemetry'];
  if (!serialized) return undefined;
  let telemetry;
  try { telemetry = JSON.parse(serialized); } catch { throw new Error('applik8s-workflow-telemetry-invalid'); }
  try { validateApplicationTelemetryEnvelopeV1(telemetry); } catch { throw new Error('applik8s-workflow-telemetry-invalid'); }
  return Object.freeze(telemetry);
}
function workflowTelemetryBoundary(context, kind, handlerId, contractName, transportedMetadata) {
  const execution = metadata(context, kind, transportedMetadata);
  return {
    kind,
    identity: handlerId,
    execution: kind + ':' + execution.invocationId,
    definition: contractName,
    instance: execution.invocationId,
    attempt: execution.attempt,
    invocation: execution.attempt > 1 ? 'retry' : 'live',
    relationship: 'asynchronous',
    ...(execution.telemetry ? { links: [execution.telemetry] } : {}),
  };
}
function declaredFailure(contractName, errorSchemas, name, payload) {
  const schema = errorSchemas[name];
  if (!schema) throw new Error('Unknown declared durable error ' + JSON.stringify(name) + ' for ' + contractName);
  const validPayload = validate(schema, payload, contractName + '.errors.' + name);
  throw new Error('applik8s-durable-error:' + JSON.stringify({ name, payload: validPayload }));
}
function taskContext(_context, contractName, task, errorSchemas, declaredCapabilities, declaredOperations, declaredQueries, declaredProjections, declaredObjects, declaredProviderAccounting, principal, queryPrincipal, base, executionSource) {
  const capabilityBindings = createApplicationTaskCapabilityBindings(
    capabilities,
    declaredCapabilities,
    {
      task,
      invocation: {
        invocationId: base.invocationId,
        idempotencyKey: base.idempotencyKey,
        attempt: base.attempt,
        ...(base.correlationId ? { correlationId: base.correlationId } : {}),
        ...(base.causationId ? { causationId: base.causationId } : {}),
        ...(base.traceparent ? { traceparent: base.traceparent } : {}),
        ...(base.trustedContext ? { trustedContext: base.trustedContext } : {}),
        signal: base.signal,
        deadline: base.deadline,
        cancellationRevision: base.cancellationRevision,
      },
      authority: principal
        ? { kind: 'admitted-task', principal }
        : { kind: 'none' },
    },
    contractName,
  );
  return {
    ...base,
    operations: operationRuntime ? operationRuntime.bind(declaredOperations, principal, base, executionSource) : Object.freeze({}),
    queries: queryRuntime ? queryRuntime.bind(declaredQueries, queryPrincipal, base) : Object.freeze({}),
    projections: Object.freeze(Object.fromEntries(Object.entries(declaredProjections).map(([alias, id]) => {
      const runtime = projectionRuntimes[id];
      if (!runtime) throw new Error('Task ' + contractName + ' attempted to use undeclared projection ' + JSON.stringify(alias));
      return [alias, runtime];
    }))),
		objects: Object.freeze(Object.fromEntries(Object.entries(declaredObjects).map(([alias, declaration]) => {
			const runtime = objectRuntimes[declaration.store];
			if (!runtime) throw new Error('Task ' + contractName + ' attempted to use undeclared object store ' + JSON.stringify(alias));
			return [alias, Object.freeze(Object.fromEntries(declaration.operations.map((operation) => [operation, runtime[operation]])))];
		}))),
    providerAccounting: Object.freeze(Object.fromEntries(Object.entries(declaredProviderAccounting).map(([alias, id]) => {
      const store = providerAccountingStores[id];
      if (!store) throw new Error('Task ' + contractName + ' attempted to use undeclared provider accounting ' + JSON.stringify(alias));
      if (!principal) throw new Error('Task ' + contractName + ' provider accounting requires an admitted service principal.');
      return [alias, bindApplicationProviderCallAccounting(store, {
        principal,
        ...(base.trustedContext ? { trustedContext: base.trustedContext } : {}),
        now: () => new Date().toISOString(),
      })];
    }))),
    use: (token) => {
      const name = token?.name;
      if (typeof name !== 'string') throw new Error('Task ' + contractName + ' attempted to use undeclared capability ' + JSON.stringify(name));
      return capabilityBindings.use(name);
    },
    fail: (name, payload) => declaredFailure(contractName, errorSchemas, name, payload),
  };
}
function directApplicationRuntime(execution) {
  return {
    admission: execution.admission,
    execute(operation, input) {
      const invoke = execution.operations[operation.id];
      if (!invoke) throw new Error('Workflow step attempted to call undeclared operation ' + JSON.stringify(operation.id));
      return ${contract.observability
        ? `runApplicationTelemetryBoundary({
        kind: 'operation',
        identity: operation.id,
        definition: operation.id,
        relationship: 'synchronous',
      }, () => invoke(input))`
        : 'invoke(input)'};
    },
    async snapshotQuery(operation, input) {
      const invoke = execution.queries[operation.id];
      if (!invoke) throw new Error('Workflow step attempted to call undeclared query ' + JSON.stringify(operation.id));
      const value = await invoke(input);
      return {
        kind: 'snapshot',
        protocol: 'applik8s.query/v1alpha1',
        query: operation.id,
        inputKey: execution.invocationId + ':' + operation.id,
        value,
        cursor: execution.invocationId + ':' + operation.id,
        capability: 'resumableInvalidation',
        generatedAt: new Date().toISOString(),
      };
    },
  };
}

function childOptions(options) {
  // Hatchet's durable Context.spawnChild() consumes the public key option
  // and lowers it to childKey internally. Passing childKey directly is
  // overwritten by the SDK and breaks replay identity after worker recovery.
  const causalPrincipal = options?.causalPrincipal;
  const telemetry = captureApplicationTelemetryContext() ?? options?.telemetry;
  return { ...(options?.idempotencyKey ? { key: options.idempotencyKey } : {}), ...(options || telemetry ? { additionalMetadata: Object.fromEntries(Object.entries({ 'applik8s.idempotency-key': options?.idempotencyKey, 'applik8s.tenant': options?.tenant, 'applik8s.correlation-id': options?.correlationId, 'applik8s.causation-id': options?.causationId, traceparent: options?.traceparent, 'applik8s.trusted-context': options?.trustedContext ? JSON.stringify(options.trustedContext) : undefined, 'applik8s.causal-principal': causalPrincipal ? JSON.stringify(causalPrincipal) : undefined, 'applik8s.telemetry': telemetry ? JSON.stringify(telemetry) : undefined }).filter(([, value]) => typeof value === 'string')) } : {}) };
}
function childInvocationMetadata(parent, options) {
  // A parent's idempotency key identifies the parent invocation; it must not
  // collapse distinct child calls into one Hatchet run. Trace, tenancy and
  // trusted context inherit normally, while a child key is opt-in at the call
  // site. Hatchet's durable event log already gives unkeyed child calls stable
  // replay identity.
  const { idempotencyKey: _parentIdempotencyKey, ...inherited } = parent ?? {};
  return {
    ...inherited,
    ...options,
    trustedContext: options?.trustedContext ?? inherited.trustedContext,
  };
}
function spawnWorkflowChild(context, declaration, input, metadata) {
  return context.spawnChild(
    declaration,
    encodeHatchetWorkflowTransportInput(input, metadata),
    childOptions(metadata),
  );
}
function workflowContext(context, workflowName, taskBindings, childBindings, errorSchemas, registry, base) {
  return {
    ...base,
    task: (alias, input, options) => {
      const childMetadata = childInvocationMetadata(base, options);
      return spawnWorkflowChild(context, resolveDeclaration(registry, taskBindings, 'task', alias), input, childMetadata);
    },
    child: (alias, input, options) => {
      const childMetadata = childInvocationMetadata(base, options);
      return spawnWorkflowChild(context, resolveDeclaration(registry, childBindings, 'child workflow', alias), input, childMetadata);
    },
    sleep: async (duration) => { await context.sleepFor(duration); },
    waitFor: (signal, options = {}) => context.waitForEvent(workflowName + '.' + signal, options.expression, undefined, options.scope ?? base.invocationId, options.lookback),
    now: () => context.now(),
    cancelled: () => context.cancelled,
    rethrowIfCancelled: (error) => context.rethrowIfCancelled(error),
    fail: (name, payload) => declaredFailure(workflowName, errorSchemas, name, payload),
  };
}
function directWorkflowRuntime(context, execution, taskBindings, childBindings, registry, taskEffect = false) {
  const bindings = { ...taskBindings, ...childBindings };
  // Compiler-generated aliases are an internal graph detail. Direct callable
  // handles identify their dependency by the durable contract ID itself.
  for (const contract of Object.values(bindings)) bindings[contract] = contract;
  return {
    run: (contract, input, metadata) => {
      const declaration = bindings[contract];
      if (!declaration) throw new Error('Workflow attempted to call undeclared durable dependency ' + JSON.stringify(contract));
      let invocationMetadata = metadata;
      if (taskEffect) {
        const effect = directTaskEffectScope.getStore();
        if (effect && !metadata?.idempotencyKey) {
          const digest = createHash('sha256')
            .update('applik8s.task-workflow-child/v1')
            .update('\\0')
            .update(execution.idempotencyKey)
            .update('\\0')
            .update(effect.id)
            .update('\\0')
            .update(contract)
            .digest('hex');
          invocationMetadata = {
            ...metadata,
            idempotencyKey: 'task-workflow-v1-' + digest,
            causationId: metadata?.causationId ?? effect.id,
          };
        }
      }
      return spawnWorkflowChild(
        context,
        registry[declaration] ?? declaration,
        input,
        childInvocationMetadata(execution, invocationMetadata),
      );
    },
    start: async (contract) => {
      throw new Error('Workflow.start() for a direct child handle is not implemented by this WorkflowEngine adapter; use direct await until durable detached-child admission is available. Contract: ' + contract);
    },
    schedule: async (contract) => {
      throw new Error('Workflow.schedule() is unavailable inside durable orchestration. Declare a framework schedule for ' + contract + '.');
    },
    reconcileSchedule: async (contract) => {
      throw new Error('Recurring schedule reconciliation is unavailable inside durable orchestration for ' + contract + '.');
    },
    signal: async (contract) => {
      throw new Error('Legacy workflow-run signals are unavailable through direct workflow handles for ' + contract + '.');
    },
  };
}
function resolveDeclaration(registry, bindings, kind, alias) { const name = bindings[alias]; if (!name) return missing(kind, alias); return registry[name] ?? name; }
function missing(kind, alias) { throw new Error('Unknown declared workflow ' + kind + ' alias ' + JSON.stringify(alias)); }
${taskDeclarations}
${workflowDeclarations}
Object.assign(declarations, { ${declarationEntries.join(', ')} });
await Promise.all([
  waitForTcpEndpoint('Hatchet engine', process.env.HATCHET_CLIENT_HOST_PORT),
  waitForTcpEndpoint('Hatchet API', process.env.HATCHET_CLIENT_API_URL),
]);
${cronRegistrations.length > 0 ? `await retryStartup('Hatchet cron registration', () => Promise.all([${cronRegistrations.join(', ')}]));` : ''}

const worker = await retryStartup('Hatchet worker initialization', () => hatchet.worker(${JSON.stringify(contract.worker.name)}, { slots: ${contract.worker.deployment.taskSlots}, durableSlots: ${contract.worker.deployment.durableSlots}, workflows: [${declarationNames.join(', ')}], handleKill: false }));
const running = worker.start();
await worker.waitUntilReady(60_000);
ready = true;
await observeWorkflowRuntime('ready');
const workflowObservationHeartbeat = setInterval(() => {
  observeWorkflowRuntime('ready').catch((error) => console.error('Workflow observation heartbeat failed', error));
}, 30_000);
workflowObservationHeartbeat.unref?.();
async function shutdown() {
  if (stopping) return;
  stopping = true; ready = false;
  clearInterval(workflowObservationHeartbeat);
  await observeWorkflowRuntime('waiting', 'worker-stopping');
  if (signalBridgeController) signalBridgeController.abort();
  await worker.stop();
  if (signalBridgeTask) await signalBridgeTask;
  if (operationRuntime) await operationRuntime.close();
  if (operationAuthoritySql) await operationAuthoritySql.end({ timeout: 5 });
  if (nativeAIStateSql && nativeAIStateSql !== operationAuthoritySql) await nativeAIStateSql.end({ timeout: 5 });
  await Promise.all(providerPrivateSqlClients.map((sql) => sql.end({ timeout: 5 })));
  if (signalStore) await signalStore.close();
  await Promise.all(projectionSources.map((source) => source.close()));
  if (gatewayAdmissionCleanupTimer) clearInterval(gatewayAdmissionCleanupTimer);
  if (gatewayServer) await new Promise((resolve) => gatewayServer.close(resolve));
  ${contract.observability ? 'await closeApplicationTelemetryRuntime();' : ''}
  server.close();
}

process.once('SIGTERM', () => { shutdown().catch((error) => { console.error(error); process.exitCode = 1; }); });
process.once('SIGINT', () => { shutdown().catch((error) => { console.error(error); process.exitCode = 1; }); });
await running;
`;
}

function generatedWorkflowNativeAIState(contract: WorkflowContract): string {
  const nativeAI = contract.nativeAI;
  if (!nativeAI) return 'const nativeAIStateSql = undefined;';
  return `const nativeAIStateSql = postgres(requiredEnv(${JSON.stringify(nativeAI.state.runtime.connectionEnvName)}), { max: 6, idle_timeout: 20, connect_timeout: 10, prepare: false });`;
}

function nativeAITaskProviderSource(contract: WorkflowContract): string {
  if (!contract.nativeAI) return '';
  return `function nativeAITaskProvider(provider, model) {
  if (provider.kind === 'ai-deterministic') {
    return {
      kind: 'deterministic',
      response: typeof provider.fixture?.response === 'string' ? provider.fixture.response : undefined,
      latencyMs: provider.latencyMs,
      ...(provider.fixture?.tool ? { tool: provider.fixture.tool } : {}),
    };
  }
  if (provider.kind !== 'envoy-ai-gateway' || provider.provision === false) {
    throw new Error('Native AI task capability supports deterministic or managed Envoy AI Gateway providers.');
  }
  const route = provider.models?.[model.name];
  const backend = Array.isArray(route?.backends) ? route.backends[0] : undefined;
  if (!backend || typeof backend.name !== 'string' || typeof backend.model !== 'string') {
    throw new Error('Native AI task capability logical model ' + JSON.stringify(model.name) + ' has no valid managed route.');
  }
  const requested = new Set(model.capabilities.map((capability) => capability.name));
  const supported = new Set(Array.isArray(backend.capabilities)
    ? backend.capabilities
    : model.capabilities.map((capability) => capability.name));
  const missing = [...requested].filter((capability) => !supported.has(capability));
  if (missing.length > 0) {
    throw new Error('Native AI task capability route ' + model.name + ' lacks capabilities: ' + missing.join(', '));
  }
  const endpoint = new URL(requiredEnv('APPLIK8S_AI_GATEWAY_MANAGED_URL'));
  const path = endpoint.pathname.replace(/\\\/+$/u, '');
  if (!path.endsWith('/v1')) endpoint.pathname = (path || '') + '/v1';
  endpoint.search = '';
  endpoint.hash = '';
  return {
    kind: 'openai-compatible',
    name: backend.name,
    baseUrl: endpoint.toString().replace(/\\\/$/u, ''),
    allowInsecureHttp: true,
    model: model.name,
  };
}`;
}

function generatedWorkflowGateway(contract: WorkflowContract): string {
  if (contract.gatewayCallers.length === 0) return 'const gatewayServer = undefined;\nconst gatewayAdmissionCleanupTimer = undefined;';
  const allowedContracts = [...new Set(contract.gatewayCallers.flatMap((caller) => caller.contracts))].sort();
  const inputSchemas = Object.fromEntries([
    ...contract.tasks.map(({ task }) => [task.name, task.contract.input.jsonSchema]),
    ...contract.workflows.map(({ workflow }) => [workflow.name, workflow.contract.input.jsonSchema]),
  ].filter(([id]) => allowedContracts.includes(String(id))));
  const callerContracts = new Map<string, {
    readonly operator: string;
    readonly contracts: Set<string>;
  }>();
  for (const caller of contract.gatewayCallers) {
    const namespace = caller.namespace.startsWith('${')
      ? '__APPLIK8S_RUNTIME_NAMESPACE__'
      : caller.namespace;
    const identity = `${namespace}/${caller.serviceAccount}`;
    const existing = callerContracts.get(identity);
    if (existing && existing.operator !== caller.operator) {
      throw new Error(
        `Workflow gateway service account ${identity} is assigned to both ${existing.operator} and ${caller.operator}.`,
      );
    }
    const contracts = existing?.contracts ?? new Set<string>();
    for (const declaredContract of caller.contracts) {
      contracts.add(declaredContract);
    }
    callerContracts.set(identity, { operator: caller.operator, contracts });
  }
  const callerSpecifications = [...callerContracts.entries()]
    .map(([identity, caller]) => {
      const separator = identity.indexOf('/');
      return {
        namespace: identity.slice(0, separator),
        serviceAccount: identity.slice(separator + 1),
        operator: caller.operator,
        contracts: [...caller.contracts].sort(),
      };
    })
    .sort((left, right) =>
      `${left.namespace}/${left.serviceAccount}`.localeCompare(
        `${right.namespace}/${right.serviceAccount}`,
      ));
  return `
const gatewayContracts = new Set(${JSON.stringify(allowedContracts)});
const gatewayInputSchemas = ${JSON.stringify(inputSchemas)};
const gatewayRuntimeNamespace = requiredEnv('APPLIK8S_WORKFLOW_NAMESPACE');
const gatewayCallerContracts = new Map(${JSON.stringify(callerSpecifications)}.map((caller) => [
  'system:serviceaccount:'
    + (caller.namespace === '__APPLIK8S_RUNTIME_NAMESPACE__' ? gatewayRuntimeNamespace : caller.namespace)
    + ':' + caller.serviceAccount,
  new Set(caller.contracts),
]));
const gatewayCallerOperators = new Map(${JSON.stringify(callerSpecifications)}.map((caller) => [
  'system:serviceaccount:'
    + (caller.namespace === '__APPLIK8S_RUNTIME_NAMESPACE__' ? gatewayRuntimeNamespace : caller.namespace)
    + ':' + caller.serviceAccount,
  caller.operator,
]));
const gatewayKubeConfig = new KubeConfig();
gatewayKubeConfig.loadFromCluster();
const gatewayAuthentication = gatewayKubeConfig.makeApiClient(AuthenticationV1Api);
const gatewayCoordination = gatewayKubeConfig.makeApiClient(CoordinationV1Api);
const gatewayAdmissionOwner = requiredEnv('APPLIK8S_WORKFLOW_POD_NAME') + ':' + randomUUID();
const gatewayAdmissionInFlight = new Map();
const gatewayAdmissionPolicy = Object.freeze(${JSON.stringify(contract.gatewayAdmission)});
let gatewayAdmissionCleanupCursor;
let gatewayAdmissionCleanupRunning = false;
const gatewayRuntime = createHatchetWorkflowRuntimeFromClient(hatchet);
const gatewayAdmission = createSignedEnvelopeCodec({
  purpose: 'applik8s.workflow-gateway-admission/v1',
  keys: staticSignedEnvelopeKeyProvider({
    current: {
      id: 'application-internal-operation',
      key: signedEnvelopeUtf8Key(
        requiredEnv('APPLIK8S_INTERNAL_OPERATION_SECRET'),
      ),
    },
  }),
  validatePayload: value => validateApplicationAdmissionContextV1(value),
  observe: observeApplicationRuntimeIntegrityEnvelope,
  maximumEncodedBytes: 32_768,
  maximumLifetimeMs: 60_000,
});
const gatewayRunReference = createSignedEnvelopeCodec({
  purpose: 'applik8s.workflow-run-reference/v1alpha1',
  keys: staticSignedEnvelopeKeyProvider({
    current: {
      id: 'application-internal-operation',
      key: signedEnvelopeUtf8Key(
        requiredEnv('APPLIK8S_INTERNAL_OPERATION_SECRET'),
      ),
    },
  }),
  validatePayload: value => {
    if (
      !value
      || typeof value !== 'object'
      || Array.isArray(value)
      || value.protocol !== 'applik8s.workflow-run-reference/v1alpha1'
      || typeof value.contract !== 'string'
      || typeof value.runId !== 'string'
      || typeof value.admittedAt !== 'string'
      || typeof value.caller !== 'string'
    ) throw new TypeError('invalid-reference');
    return Object.freeze({
      protocol: value.protocol,
      contract: value.contract,
      runId: value.runId,
      admittedAt: value.admittedAt,
      caller: value.caller,
    });
  },
  observe: observeApplicationRuntimeIntegrityEnvelope,
  maximumEncodedBytes: 8_192,
});

function gatewayJson(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}
async function gatewayBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_048_576) throw new Error('request-too-large');
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-request');
  return value;
}
async function authenticateGatewayRequest(request) {
  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) throw new Error('unauthorized');
  const token = authorization.slice('Bearer '.length).trim();
  if (!token) throw new Error('unauthorized');
  const review = await gatewayAuthentication.createTokenReview({
    body: {
      apiVersion: 'authentication.k8s.io/v1',
      kind: 'TokenReview',
      spec: {
        token,
        audiences: ['https://kubernetes.default.svc'],
      },
    },
  });
  const username = review.status?.authenticated === true ? review.status.user?.username : undefined;
  if (typeof username !== 'string' || !gatewayCallerContracts.has(username)) throw new Error('unauthorized');
  return username;
}
function sealGatewayReference(value) {
  return gatewayRunReference.sign({
    protocol: 'applik8s.workflow-run-reference/v1alpha1',
    ...value,
  });
}
async function openGatewayReference(reference, expectedContract, expectedCaller) {
  const value = (await gatewayRunReference.verify(reference)).payload;
  if (
    value?.protocol !== 'applik8s.workflow-run-reference/v1alpha1'
    || value.contract !== expectedContract
    || typeof value.runId !== 'string'
    || typeof value.admittedAt !== 'string'
    || value.caller !== expectedCaller
  ) throw new Error('invalid-reference');
  return value;
}
function gatewayKubernetesStatus(error) {
  for (const candidate of [
    error?.code,
    error?.statusCode,
    error?.response?.statusCode,
    error?.response?.status,
    error?.body?.code,
  ]) if (typeof candidate === 'number') return candidate;
  return undefined;
}
function gatewayAdmissionIdentity(caller, contract, idempotencyKey) {
  const digest = createHash('sha256')
    .update(canonicalJsonV1String({ caller, contract, idempotencyKey }))
    .digest('hex');
  return Object.freeze({
    id: 'sha256:' + digest,
    leaseName: 'workflow-admission-' + digest.slice(0, 40),
  });
}
function gatewayLeaseAnnotations(lease) {
  const annotations = lease?.metadata?.annotations;
  return annotations && typeof annotations === 'object' ? annotations : {};
}
async function readGatewayAdmissionLease(name) {
  try {
    return await gatewayCoordination.readNamespacedLease({
      name,
      namespace: gatewayRuntimeNamespace,
    });
  } catch (error) {
    if (gatewayKubernetesStatus(error) === 404) return undefined;
    throw error;
  }
}
async function findGatewayProviderRun(contract, admissionId, since) {
  const result = await hatchet.runs.list({
    workflowNames: [contract],
    additionalMetadata: { 'applik8s.admission-id': admissionId },
    since,
    onlyTasks: false,
    limit: 10,
  });
  const runIds = [...new Set((result.rows ?? [])
    .map(row => row.workflowRunExternalId)
    .filter(value => typeof value === 'string' && value.length > 0))];
  if (runIds.length > 1) throw new Error('WORKFLOW_ADMISSION_AMBIGUOUS');
  return runIds[0];
}
async function persistGatewayAdmission(lease, admissionId, contract, runId, admittedAt) {
  let current = lease;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const annotations = gatewayLeaseAnnotations(current);
    if (annotations['applik8s.dev/provider-run-id']) {
      if (annotations['applik8s.dev/provider-run-id'] !== runId) {
        throw new Error('WORKFLOW_ADMISSION_AMBIGUOUS');
      }
      return Object.freeze({ id: runId, admittedAt: annotations['applik8s.dev/admitted-at'] ?? admittedAt });
    }
    try {
      const updated = await gatewayCoordination.replaceNamespacedLease({
        name: current.metadata.name,
        namespace: gatewayRuntimeNamespace,
        body: {
          ...current,
          metadata: {
            ...current.metadata,
            annotations: {
              ...annotations,
              'applik8s.dev/admission-id': admissionId,
              'applik8s.dev/workflow-contract': contract,
              'applik8s.dev/provider-run-id': runId,
              'applik8s.dev/admitted-at': admittedAt,
              'applik8s.dev/admission-state': 'admitted',
            },
          },
          spec: {
            ...(current.spec ?? {}),
            holderIdentity: gatewayAdmissionOwner,
            renewTime: new V1MicroTime(),
          },
        },
      });
      return Object.freeze({
        id: runId,
        admittedAt: gatewayLeaseAnnotations(updated)['applik8s.dev/admitted-at'] ?? admittedAt,
      });
    } catch (error) {
      if (gatewayKubernetesStatus(error) !== 409) throw error;
      current = await readGatewayAdmissionLease(current.metadata.name);
      if (!current) throw new Error('WORKFLOW_ADMISSION_STATE_LOST');
    }
  }
  throw new Error('WORKFLOW_ADMISSION_STATE_CONFLICT');
}
async function createGatewayAdmissionLease(identity, contract) {
  const now = new V1MicroTime();
  try {
    const lease = await gatewayCoordination.createNamespacedLease({
      namespace: gatewayRuntimeNamespace,
      body: {
        apiVersion: 'coordination.k8s.io/v1',
        kind: 'Lease',
        metadata: {
          name: identity.leaseName,
          namespace: gatewayRuntimeNamespace,
          labels: {
            'app.kubernetes.io/managed-by': 'applik8s',
            'applik8s.dev/workflow-admission': 'true',
          },
          annotations: {
            'applik8s.dev/admission-id': identity.id,
            'applik8s.dev/workflow-contract': contract,
            'applik8s.dev/admission-state': 'starting',
          },
        },
        spec: {
          holderIdentity: gatewayAdmissionOwner,
          leaseDurationSeconds: 30,
          acquireTime: now,
          renewTime: now,
        },
      },
    });
    return Object.freeze({ lease, created: true });
  } catch (error) {
    if (gatewayKubernetesStatus(error) !== 409) throw error;
    const lease = await readGatewayAdmissionLease(identity.leaseName);
    if (!lease) throw new Error('WORKFLOW_ADMISSION_STATE_LOST');
    return Object.freeze({ lease, created: false });
  }
}
async function compactGatewayAdmissionRecords() {
  if (gatewayAdmissionCleanupRunning) return;
  gatewayAdmissionCleanupRunning = true;
  try {
    const result = await compactHatchetWorkflowAdmissionPage({
      nowMs: Date.now(),
      replayWindowSeconds: gatewayAdmissionPolicy.replayWindowSeconds,
      cleanupBatchSize: gatewayAdmissionPolicy.cleanupBatchSize,
      ...(gatewayAdmissionCleanupCursor ? { cursor: gatewayAdmissionCleanupCursor } : {}),
      listPage: async ({ cursor, limit }) => {
        try {
          const page = await gatewayCoordination.listNamespacedLease({
            namespace: gatewayRuntimeNamespace,
            labelSelector: 'applik8s.dev/workflow-admission=true',
            limit,
            ...(cursor ? { _continue: cursor } : {}),
          });
          return {
            items: page.items ?? [],
            ...(page.metadata?._continue ? { nextCursor: page.metadata._continue } : {}),
          };
        } catch (error) {
          if (gatewayKubernetesStatus(error) === 410) return { items: [] };
          throw error;
        }
      },
      runState: async providerRunId => {
        try {
          return ['COMPLETED', 'CANCELLED', 'FAILED', 'TIMED_OUT', 'TIMEDOUT'].includes(String(await hatchet.runs.get_status(providerRunId)))
            ? 'terminal'
            : 'active';
        } catch (error) {
          if (gatewayKubernetesStatus(error) === 404) return 'missing';
          throw error;
        }
      },
      deleteLease: async ({ name, uid }) => {
        try {
          await gatewayCoordination.deleteNamespacedLease({
            name,
            namespace: gatewayRuntimeNamespace,
            body: {
              apiVersion: 'v1',
              kind: 'DeleteOptions',
              preconditions: { uid },
            },
          });
          return 'deleted';
        } catch (error) {
          const status = gatewayKubernetesStatus(error);
          if (status === 404) return 'absent';
          if (status === 409) return 'conflict';
          throw error;
        }
      },
    });
    gatewayAdmissionCleanupCursor = result.nextCursor;
  } finally {
    gatewayAdmissionCleanupRunning = false;
  }
}
async function convergeGatewayAdmission(caller, contract, idempotencyKey, start) {
  const identity = gatewayAdmissionIdentity(caller, contract, idempotencyKey);
  const existing = gatewayAdmissionInFlight.get(identity.id);
  if (existing) return existing;
  const pending = (async () => {
    let leaseState;
    try {
      leaseState = await createGatewayAdmissionLease(identity, contract);
    } catch (cause) {
      throw workflowGatewayStageError('WORKFLOW_ADMISSION_LEASE_CREATE_FAILED', cause);
    }
    let { lease, created } = leaseState;
    const annotations = gatewayLeaseAnnotations(lease);
    if (
      annotations['applik8s.dev/admission-id'] !== identity.id
      || annotations['applik8s.dev/workflow-contract'] !== contract
    ) throw new Error('WORKFLOW_ADMISSION_IDENTITY_CONFLICT');
    const priorRunId = annotations['applik8s.dev/provider-run-id'];
    if (priorRunId) return Object.freeze({
      id: priorRunId,
      admittedAt: annotations['applik8s.dev/admitted-at'] ?? lease.metadata.creationTimestamp?.toISOString?.() ?? new Date().toISOString(),
    });
    if (!created && lease.spec?.holderIdentity !== gatewayAdmissionOwner) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < 30_000) {
        const recovered = await findGatewayProviderRun(
          contract,
          identity.id,
          new Date(Date.now() - 24 * 60 * 60 * 1_000),
        );
        if (recovered) return persistGatewayAdmission(lease, identity.id, contract, recovered, new Date().toISOString());
        await new Promise(resolve => setTimeout(resolve, 250));
        const refreshed = await readGatewayAdmissionLease(identity.leaseName);
        if (!refreshed) throw new Error('WORKFLOW_ADMISSION_STATE_LOST');
        lease = refreshed;
        const refreshedAnnotations = gatewayLeaseAnnotations(lease);
        if (refreshedAnnotations['applik8s.dev/provider-run-id']) return Object.freeze({
          id: refreshedAnnotations['applik8s.dev/provider-run-id'],
          admittedAt: refreshedAnnotations['applik8s.dev/admitted-at'] ?? new Date().toISOString(),
        });
      }
      const renewTime = Date.parse(String(lease.spec?.renewTime ?? lease.spec?.acquireTime ?? ''));
      if (Number.isFinite(renewTime) && Date.now() - renewTime < 30_000) {
        throw new Error('WORKFLOW_ADMISSION_IN_PROGRESS');
      }
      try {
        lease = await gatewayCoordination.replaceNamespacedLease({
          name: identity.leaseName,
          namespace: gatewayRuntimeNamespace,
          body: {
            ...lease,
            spec: {
              ...(lease.spec ?? {}),
              holderIdentity: gatewayAdmissionOwner,
              leaseDurationSeconds: 30,
              acquireTime: new V1MicroTime(),
              renewTime: new V1MicroTime(),
            },
          },
        });
      } catch (error) {
        if (gatewayKubernetesStatus(error) === 409) throw new Error('WORKFLOW_ADMISSION_IN_PROGRESS');
        throw error;
      }
    }
    let run;
    try {
      run = await start(identity.id);
    } catch (cause) {
      throw workflowGatewayStageError('WORKFLOW_ADMISSION_PROVIDER_START_FAILED', cause);
    }
    const admittedAt = new Date().toISOString();
    return persistGatewayAdmission(lease, identity.id, contract, run.id, admittedAt);
  })();
  gatewayAdmissionInFlight.set(identity.id, pending);
  try {
    return await pending;
  } finally {
    if (gatewayAdmissionInFlight.get(identity.id) === pending) gatewayAdmissionInFlight.delete(identity.id);
  }
}
function controllerGatewayAdmission(value, caller, contract) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-controller-source');
  if (value.protocol !== 'applik8s.kubernetes-reconcile/v1alpha1') throw new Error('invalid-controller-source');
  if (typeof value.reconcileId !== 'string' || !value.reconcileId.trim()) throw new Error('invalid-controller-source');
  if (!['reconcile', 'created', 'updated', 'deleted', 'finalize', 'statusChanged'].includes(value.event)) throw new Error('invalid-controller-source');
  const resource = value.resource;
  if (
    !resource
    || typeof resource !== 'object'
    || Array.isArray(resource)
    || typeof resource.apiVersion !== 'string'
    || !resource.apiVersion.trim()
    || typeof resource.kind !== 'string'
    || !resource.kind.trim()
    || typeof resource.name !== 'string'
    || !resource.name.trim()
    || (resource.namespace !== undefined && typeof resource.namespace !== 'string')
    || (resource.uid !== undefined && typeof resource.uid !== 'string')
    || (resource.generation !== undefined && (!Number.isSafeInteger(resource.generation) || resource.generation < 0))
  ) throw new Error('invalid-controller-source');
  const expectedOperator = gatewayCallerOperators.get(caller);
  const identityEnvelope = value.identityEnvelope;
  if (
    !expectedOperator
    || value.operatorName !== expectedOperator
    || !identityEnvelope
    || typeof identityEnvelope !== 'object'
    || Array.isArray(identityEnvelope)
    || identityEnvelope.apiVersion !== 'applik8s.guestHostIdentity/v1alpha1'
    || typeof identityEnvelope.application !== 'string'
    || !identityEnvelope.application.startsWith('applik8s://')
    || typeof identityEnvelope.operation !== 'string'
    || !identityEnvelope.operation.startsWith('applik8s://')
    || typeof identityEnvelope.execution !== 'string'
    || !identityEnvelope.execution.startsWith('applik8s://')
    || identityEnvelope.attempt !== value.reconcileId
  ) {
    throw new Error('invalid-controller-source');
  }
  const reconcileAttempt = identityEnvelope.telemetry?.identity?.attempt;
  if (reconcileAttempt !== undefined && (!Number.isSafeInteger(reconcileAttempt) || reconcileAttempt < 1)) {
    throw new Error('invalid-controller-source');
  }
  const serviceAccount = caller.slice('system:serviceaccount:'.length);
  const workloadIdentity = Object.freeze({
    id: 'identity:kubernetes:serviceaccount:' + serviceAccount,
    kind: 'workload',
    issuer: 'kubernetes://cluster',
    subject: serviceAccount,
  });
  const trustedValues = Object.freeze({
    resource: Object.freeze({
      apiVersion: resource.apiVersion,
      kind: resource.kind,
      name: resource.name,
      ...(resource.namespace ? { namespace: resource.namespace } : {}),
      ...(resource.uid ? { uid: resource.uid } : {}),
      ...(resource.generation !== undefined ? { generation: resource.generation } : {}),
      event: value.event,
      operation: identityEnvelope.operation,
      execution: identityEnvelope.execution,
    }),
  });
  const trustedContextDigest = nodeKeyedDigestHex({
    key: requiredEnv('APPLIK8S_INTERNAL_OPERATION_SECRET'),
    purpose: 'applik8s.kubernetes-reconcile-trusted-context/v1',
    value: canonicalJsonV1String(trustedValues),
  });
  const deadline = new Date(Date.now() + 60_000).toISOString();
  const cancellationRevision = 'active:' + value.reconcileId;
  const principal = createApplicationExecutionPrincipalV1({
    application: ${JSON.stringify(contract.graphName)},
    executionKind: 'reconcile',
    executionId: value.reconcileId,
    attempt: reconcileAttempt ?? 1,
    workloadIdentity,
    envelopes: [],
    trustedContextDigest,
    audience: [${JSON.stringify(contract.worker.id)}],
    catalogRevision: ${JSON.stringify(contract.operationCatalog?.revision ?? `catalog:${contract.graphName}:none`)},
    authorityRevision: ${JSON.stringify(contract.authorityManifest?.revision ?? contract.operationCatalog?.revision ?? `authority:${contract.graphName}:none`)},
    deadline,
    cancellationRevision,
    authenticationMethod: 'kubernetes-service-account-token-review',
  });
  const base = createApplicationAdmissionContextV1({
    admission: { principal, trustedContext: trustedValues },
    operation: {
      id: 'applik8s://workflows/' + contract + '/operations/start',
      transport: 'control-plane',
    },
    correlationId: value.reconcileId,
  });
  const traced = typeof identityEnvelope.telemetry?.traceparent === 'string'
    ? withApplicationAdmissionTraceV1(base, {
        traceparent: identityEnvelope.telemetry.traceparent,
        ...(typeof identityEnvelope.telemetry.tracestate === 'string'
          ? { tracestate: identityEnvelope.telemetry.tracestate }
          : {}),
      })
    : base;
  return validateApplicationAdmissionContextV1WithoutReceipt(
    withApplicationAdmissionExecutionV1(traced, {
      causationId: identityEnvelope.attempt,
      deadline,
      cancellation: { revision: cancellationRevision },
      delivery: {
        id: value.reconcileId,
        source: 'kubernetes-controller:' + expectedOperator,
      },
    }),
  );
}
async function handleGatewayRequest(request, response) {
  try {
    if (!ready || stopping) return gatewayJson(response, 503, { error: 'workflow-gateway-unavailable' });
    const gatewayCaller = await authenticateGatewayRequest(request);
    const url = new URL(request.url ?? '/', 'http://workflow-gateway.invalid');
    if (request.method === 'GET' && url.pathname === '/readyz') {
      return gatewayJson(response, 200, { ready: true });
    }
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts[0] !== 'v1' || parts[1] !== 'workflows' || parts[3] !== 'runs') {
      return gatewayJson(response, 404, { error: 'not-found' });
    }
    const contract = parts[2];
    if (
      !contract
      || !gatewayContracts.has(contract)
      || !gatewayCallerContracts.get(gatewayCaller)?.has(contract)
    ) return gatewayJson(response, 403, { error: 'contract-not-authorized' });
    if (request.method === 'POST' && parts.length === 4) {
      const idempotencyKey = request.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
        return gatewayJson(response, 400, { error: 'idempotency-key-required' });
      }
      const body = await gatewayBody(request);
      const input = body.input;
      if (!input || typeof input !== 'object' || Array.isArray(input)) return gatewayJson(response, 400, { error: 'invalid-input' });
      const validInput = validate(gatewayInputSchemas[contract], input, contract + '.input');
      const requestedMetadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? body.metadata
        : {};
      let sourceAdmission;
      if (typeof body.admission === 'string') {
        try {
          sourceAdmission = (await gatewayAdmission.verify(body.admission)).payload;
        } catch {
          return gatewayJson(response, 403, { error: 'admission-invalid' });
        }
        if (
          sourceAdmission.operation.transport !== 'http'
          && sourceAdmission.operation.transport !== 'webhook'
          && sourceAdmission.operation.transport !== 'schedule'
        ) {
          return gatewayJson(response, 403, { error: 'admission-transport-invalid' });
        }
      } else if (body.source !== undefined) {
        try {
          sourceAdmission = controllerGatewayAdmission(body.source, gatewayCaller, contract);
        } catch (cause) {
          throw workflowGatewayStageError('WORKFLOW_CONTROLLER_ADMISSION_INVALID', cause);
        }
      } else {
        return gatewayJson(response, 400, { error: 'admission-required' });
      }
      const causalPrincipal = applicationCausalPrincipalContext(
        sourceAdmission.principal,
      );
      let admittedRun;
      try {
        admittedRun = await convergeGatewayAdmission(
          gatewayCaller,
          contract,
          idempotencyKey,
          admissionId => gatewayRuntime.start(contract, validInput, {
            ...(typeof requestedMetadata.tenant === 'string'
              ? { tenant: requestedMetadata.tenant }
              : {}),
            ...(['low', 'medium', 'high'].includes(requestedMetadata.priority)
              ? { priority: requestedMetadata.priority }
              : {}),
            idempotencyKey,
            correlationId: sourceAdmission.correlationId,
            causationId: sourceAdmission.correlationId,
            ...(sourceAdmission.trace?.traceparent
              ? { traceparent: sourceAdmission.trace.traceparent }
              : {}),
            trustedContext: sourceAdmission.trustedContext,
            [applicationWorkflowCausalPrincipalMetadata]: causalPrincipal,
            [applicationWorkflowProviderAdmissionMetadata]: admissionId,
            ...(requestedMetadata.telemetry !== undefined
              ? (() => {
                  validateApplicationTelemetryEnvelopeV1(requestedMetadata.telemetry);
                  return { [applicationWorkflowTelemetryMetadata]: requestedMetadata.telemetry };
                })()
              : {}),
          }),
        );
      } catch (cause) {
        if (
          cause
          && typeof cause === 'object'
          && Reflect.get(cause, 'name') === 'WorkflowGatewayStageError'
        ) throw cause;
        throw workflowGatewayStageError('WORKFLOW_PROVIDER_START_FAILED', cause);
      }
      return gatewayJson(response, 202, {
        id: await sealGatewayReference({
          contract,
          runId: admittedRun.id,
          admittedAt: admittedRun.admittedAt,
          caller: gatewayCaller,
        }),
        admittedAt: admittedRun.admittedAt,
      });
    }
    if (parts.length === 5 && (request.method === 'GET' || request.method === 'DELETE')) {
      const reference = await openGatewayReference(
        parts[4],
        contract,
        gatewayCaller,
      );
      if (request.method === 'GET') {
        return gatewayJson(response, 200, await observeHatchetWorkflowRun(
          hatchet,
          reference.runId,
          reference.admittedAt,
        ));
      }
      await hatchet.runs.cancel({ ids: [reference.runId] });
      return gatewayJson(response, 200, { cancelled: true });
    }
    return gatewayJson(response, 405, { error: 'method-not-allowed' });
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === 'unauthorized';
    console.error(JSON.stringify({
      event: 'applik8s-workflow-gateway-rejected',
      error: unauthorized ? 'unauthorized' : workflowAdmissionRejectionCode(error),
      ...(error && typeof error === 'object' && typeof Reflect.get(error, 'providerStatus') === 'number'
        ? { providerStatus: Reflect.get(error, 'providerStatus') }
        : {}),
    }));
    return gatewayJson(response, unauthorized ? 401 : 400, { error: unauthorized ? 'unauthorized' : 'request-rejected' });
  }
}
const gatewayServer = createServer((request, response) => {
  void handleGatewayRequest(request, response);
});
gatewayServer.listen(${contract.worker.deployment.healthPort + 1}, '0.0.0.0');
const gatewayAdmissionCleanupTimer = setInterval(() => {
  compactGatewayAdmissionRecords().catch((error) => console.error(JSON.stringify({
    event: 'applik8s-workflow-admission-cleanup-failed',
    error: workflowAdmissionRejectionCode(error),
  })));
}, gatewayAdmissionPolicy.cleanupIntervalSeconds * 1_000);
gatewayAdmissionCleanupTimer.unref?.();
void compactGatewayAdmissionRecords().catch((error) => console.error(JSON.stringify({
  event: 'applik8s-workflow-admission-cleanup-failed',
  error: workflowAdmissionRejectionCode(error),
})));
`;
}

function generatedWorkflowSignalRuntime(contract: WorkflowContract): string {
  const effects = contract.signalEffects;
  if (!effects) {
    return `const signalStore = undefined;
const signalBridgeController = undefined;
const signalBridgeTask = undefined;
const signalDefinitions = Object.freeze({});
function workflowSignalApi() {
  return Object.freeze({
    emitSignal: async () => {
      throw new Error('workflow.emitSignal(...) was not declared in this workflow dependency graph.');
    },
  });
}`;
  }
  const definitions = new Map(
    effects.signals.map(({ binding }) => [binding.id, binding]),
  );
  const operationCatalog = contract.operationCatalog;
  if (!operationCatalog) {
    throw new Error(
      `Workflow worker ${contract.worker.id} signals require the canonical operation catalog.`,
    );
  }
  const issueOperations = Object.fromEntries(
    [...definitions.values()].map((binding) => {
      const id = `applik8s://signals/${binding.id}/operations/issue`;
      const operation = operationCatalog.operations.find(
        (candidate) => candidate.id === id,
      );
      if (!operation) {
        throw new Error(
          `Workflow worker ${contract.worker.id} signal ${binding.id} has no canonical issue operation.`,
        );
      }
      return [binding.id, operation];
    }),
  );
  const grantContracts = Object.fromEntries(
    [...definitions.values()].map((binding) => {
      const operationIds = [
        `applik8s://signals/${binding.id}/operations/issuance.read`,
        ...binding.actions.map(
          (action) =>
            `applik8s://signals/${binding.id}/operations/${action.name}`,
        ),
      ].sort();
      const missing = operationIds.filter(
        (id) =>
          !operationCatalog.operations.some(
            (operation) => operation.id === id,
          ),
      );
      if (missing.length > 0) {
        throw new Error(
          `Workflow worker ${contract.worker.id} signal ${binding.id} has incomplete exact-instance operations: ${missing.join(', ')}.`,
        );
      }
      return [
        binding.id,
        {
          permissionId: applicationSignalGrantPermissionId(
            contract.graphName,
            contract.worker.id,
            binding.id,
          ),
          operationIds,
        },
      ];
    }),
  );
  const definitionSource = [...definitions.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((binding) => {
      const actions = Object.fromEntries(
        binding.actions.map((action) => [
          action.name,
          {
            kind: 'jsonSchema',
            ref: {
              kind: 'jsonSchema',
              exportName: `${binding.id}.actions.${action.name}`,
            },
            schema: action.schema.jsonSchema,
          },
        ]),
      );
      return `${JSON.stringify(binding.id)}: Object.freeze({
  kind: 'applicationSignalDefinition',
  id: ${JSON.stringify(binding.id)},
  name: ${JSON.stringify(binding.name)},
  version: ${JSON.stringify(binding.version)},
  input: ${JSON.stringify({
    kind: 'jsonSchema',
    ref: {
      kind: 'jsonSchema',
      exportName: `${binding.id}.input`,
    },
    schema: binding.input.jsonSchema,
  })},
  actions: Object.freeze(${JSON.stringify(actions)}),
})`;
    })
    .join(',\n');
  return `const signalStore = createPostgresApplicationSignalStore({
  databaseUrl: requiredEnv('APPLIK8S_SIGNAL_DATABASE_URL'),
});
const signalDefinitions = Object.freeze({
${definitionSource}
});
const signalIssueOperations = Object.freeze(${JSON.stringify(issueOperations)});
const signalGrantContracts = Object.freeze(${JSON.stringify(grantContracts)});
function signalGrantIds(signal) {
  if (signal.access.mode !== 'grant') return [];
  const subjects = Array.isArray(signal.access.subject)
    ? signal.access.subject
    : [signal.access.subject];
  return subjects.map((subject) =>
    'grant:signal:' + signal.id + ':' + subject.id);
}
async function revokeSignalGrants(signal, transaction) {
  for (const grantId of signalGrantIds(signal)) {
    await operationAuthority.revokeGrant(
      grantId,
      'Signal ' + signal.id + ' reached terminal state.',
      transaction,
    );
  }
}
async function observeSignalTerminal({ signal, terminal }, { transaction }) {
  await revokeSignalGrants(signal, transaction);
  await operationAuthority.observe({
    id: 'workflow-signal:' + signal.contract.id,
    domain: 'workflow',
    subject: signal.contract.id,
    authority: 'canonical',
    state: terminal.status === 'resolved' ? 'succeeded' : 'cancelled',
    reason: terminal.status === 'resolved' ? terminal.action : 'expired',
    source: 'application-signal-runtime',
    causalId: signal.id,
    evidence: {
      signalId: signal.id,
      contractId: signal.contract.id,
      terminalStatus: terminal.status,
      ...(terminal.status === 'resolved' ? { action: terminal.action } : {}),
    },
    observedAt: terminal.status === 'resolved' ? terminal.decidedAt : terminal.expiredAt,
  }, transaction);
}
const signalBridgeController = new AbortController();
const signalBridgeTask = runApplicationSignalOutboxRelay({
  store: signalStore,
  signal: signalBridgeController.signal,
  finalizeTerminal: observeSignalTerminal,
  publish: async (fact) => {
    if (fact.kind === 'issued') return;
    await hatchet.events.push(
      'applik8s.signal.terminal.v1',
      fact.payload,
      { scope: fact.signalId },
    );
  },
  onError: (error) => {
    if (!signalBridgeController.signal.aborted) {
      console.error(JSON.stringify({
        event: 'applik8s-signal-outbox-retry',
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  },
});
function workflowSignalApi(context, execution) {
  const occurrences = Object.create(null);
  const runtime = createApplicationWorkflowSignalRuntime({
    store: signalStore,
    signal: execution.signal,
    invocation: {
      id: execution.invocationId,
      revision: ${JSON.stringify(contract.worker.id)},
    },
    occurrence: (contractId) => {
      const next = (occurrences[contractId] ?? 0) + 1;
      occurrences[contractId] = next;
      return contractId + ':' + next;
    },
    authorizeIssue: async (request, authorityContext) => {
      if (!signalDefinitions[request.definition.id]) {
        throw new Error('Workflow attempted to issue undeclared signal ' + JSON.stringify(request.definition.id));
      }
      if (!execution.invocationId) {
        throw new Error('Signal issuance requires a durable workflow execution identity.');
      }
      if (!authorityContext.transaction) {
        throw new Error('Signal issuance requires the canonical transactional SignalStore.');
      }
      const operation = signalIssueOperations[request.definition.id];
      if (!operation) {
        throw new Error('Signal issuance has no canonical issue operation for ' + JSON.stringify(request.definition.id));
      }
      const trustedContextDigest = execution.trustedContext?.digest ?? ('workflow:' + execution.invocationId);
      if (execution.signal?.aborted) {
        throw execution.signal.reason ?? new Error('Signal issuance was cancelled.');
      }
      const principal = execution.admission?.principal;
      if (!principal || principal.kind !== 'execution'
        || principal.executionId !== execution.invocationId
        || principal.executionKind !== execution.executionKind
        || principal.cancellationRevision !== execution.cancellationRevision) {
        throw new Error('Signal issuance requires the workflow canonical execution principal.');
      }
      const envelope = {
        apiVersion: 'applik8s.workloadAuthority/v1alpha1',
        id: 'signal-issue:' + request.definition.id + ':' + authorityContext.signalId,
        workloadIdentity: principal.workloadIdentity,
        ...(principal.serviceIdentity ? { serviceIdentity: principal.serviceIdentity } : {}),
        operationId: operation.id,
        catalogRevision: ${JSON.stringify(operationCatalog.revision)},
        restrictions: {
          target: {
            kind: 'target',
            model: request.definition.id,
            identity: { signalId: authorityContext.signalId },
          },
          predicates: [],
          transport: { kind: 'transport', bindingId: request.definition.id + '.issue', transport: 'workflow' },
          audience: { kind: 'audience', audience: ${JSON.stringify(contract.worker.id)} },
        },
        inputSchemaDigest: operation.input.digest,
        audiences: [${JSON.stringify(contract.worker.id)}],
        transports: ['workflow'],
        delegation: 'forbidden',
        impersonation: 'forbidden',
      };
      return operationAuthority.withinTransaction(authorityContext.transaction, async () => {
        const authorized = await operationAuthority.authorizeExecution({
          principal,
          envelope,
          target: envelope.restrictions.target,
          audience: envelope.audiences[0],
          transport: 'workflow',
          inputDigest: applicationOperationInputDigest(request.input),
          trustedContextDigest,
          currentCancellationRevision: execution.cancellationRevision,
          applicationPolicyAllowed: true,
        });
        if (!authorized.allowed) {
          throw new Error('Signal issue authorization denied: ' + authorized.code + ': ' + authorized.message);
        }
        if (request.access.mode === 'grant') {
          const grantContract = signalGrantContracts[request.definition.id];
          if (!grantContract) {
            throw new Error('Signal issuance has no compiler-derived exact-instance grant contract for ' + JSON.stringify(request.definition.id));
          }
          const subjects = Array.isArray(request.access.subject)
            ? request.access.subject
            : [request.access.subject];
          if (subjects.length === 0) {
            throw new Error('grantAccessTo requires at least one identity.');
          }
          const authorityRevision = await operationAuthority.authorityRevision();
          const targetIdentity = Object.freeze({
            ...request.target,
            signalId: authorityContext.signalId,
          });
          for (const subject of subjects) {
            if (!subject || typeof subject !== 'object'
              || typeof subject.id !== 'string' || !subject.id.trim()
              || typeof subject.kind !== 'string' || !subject.kind.trim()
              || typeof subject.issuer !== 'string' || !subject.issuer.trim()
              || typeof subject.subject !== 'string' || !subject.subject.trim()) {
              throw new Error('grantAccessTo identities must be canonical framework identity references.');
            }
            await operationAuthority.assignGrant({
              apiVersion: 'applik8s.grant/v1alpha1',
              id: 'grant:signal:' + authorityContext.signalId + ':' + subject.id,
              origin: 'runtime',
              identity: subject,
              permissionId: grantContract.permissionId,
              operationIds: grantContract.operationIds,
              scope: {
                kind: 'target',
                model: request.definition.id,
                identity: targetIdentity,
              },
              transports: ['direct', 'event', 'http'],
              issuedBy: principal.workloadIdentity,
              lifecycleOwner: 'signal:' + authorityContext.signalId,
              reason: 'Exact-instance access created by workflow.emitSignal(..., { grantAccessTo }).',
              expiresAt: request.expiresAt,
              catalogRevision: ${JSON.stringify(operationCatalog.revision)},
              authorityRevision,
              createdAt: request.issuedAt,
            });
          }
        }
        await operationAuthority.observe({
          id: 'workflow-signal:' + request.definition.id,
          domain: 'workflow',
          subject: request.definition.id,
          authority: 'canonical',
          state: 'waiting',
          source: 'application-signal-runtime',
          causalId: execution.invocationId,
          evidence: {
            signalId: authorityContext.signalId,
            contractId: request.definition.id,
            workflowExecutionId: execution.invocationId,
          },
          observedAt: request.issuedAt,
          expiresAt: request.expiresAt,
        }, authorityContext.transaction);
        return { id: authorized.receipt.id };
      });
    },
    wait: async (reference) => {
      await context.waitForEvent(
        'applik8s.signal.terminal.v1',
        undefined,
        undefined,
        reference.issuance.id,
        '8760h',
      );
    },
  });
  return Object.freeze({
    emitSignal: (definitionOrBinding, options) => {
      const definition = definitionOrBinding?.signal ?? definitionOrBinding;
      const canonical = definition && signalDefinitions[definition.id];
      if (!canonical || canonical !== definition) {
        throw new Error('workflow.emitSignal(...) requires a statically declared signal contract from this workflow graph.');
      }
      return runtime.emit(canonical, options);
    },
  });
}`;
}

function generatedWorkflowObjectRuntime(contract: WorkflowContract): string {
	const effects = uniqueWorkflowObjectEffects(contract);
	if (effects.length === 0) return 'const objectRuntimes = Object.freeze({});';
	const initializers = effects.map((effect) => {
		const allowed = JSON.stringify(effect.store.contentTypes);
		const enabledEnvironment = workflowObjectEnabledEnvironment(effect.store.id);
		return `{
  const enabled = () => process.env[${JSON.stringify(enabledEnvironment)}] !== 'false';
  const raw = createS3ApplicationObjectStorageRuntime({ store: ${JSON.stringify(effect.store.name)}, provider: { kind: 's3', bucket: requiredEnv('APPLIK8S_TASK_OBJECT_BUCKET'), region: requiredEnv('APPLIK8S_TASK_OBJECT_REGION'), ...(process.env.APPLIK8S_TASK_OBJECT_PREFIX ? { prefix: process.env.APPLIK8S_TASK_OBJECT_PREFIX } : {}), ...(process.env.APPLIK8S_TASK_OBJECT_ENDPOINT ? { endpoint: process.env.APPLIK8S_TASK_OBJECT_ENDPOINT } : {}), forcePathStyle: process.env.APPLIK8S_TASK_OBJECT_FORCE_PATH_STYLE === 'true' } });
  const assertEnabled = () => { if (!enabled()) throw new Error('Application object store ${effect.store.name} is disabled for this installation.'); };
  const assertMetadata = (metadata) => { if (metadata.size > ${effect.store.maxObjectBytes}) throw new Error('Object exceeds the ${effect.store.maxObjectBytes}-byte ${effect.store.name} limit.'); if (!${allowed}.includes(metadata.contentType.toLowerCase())) throw new Error('Object content type is not allowed by ${effect.store.name}.'); return metadata; };
  objectRuntimes[${JSON.stringify(effect.store.id)}] = Object.freeze({
    put: async (request) => { assertEnabled(); const bytes = typeof request?.body === 'string' ? new TextEncoder().encode(request.body).byteLength : request?.body?.byteLength; if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > ${effect.store.maxObjectBytes}) throw new Error('Object body exceeds the ${effect.store.maxObjectBytes}-byte ${effect.store.name} limit.'); if (typeof request?.contentType !== 'string' || !${allowed}.includes(request.contentType.toLowerCase())) throw new Error('Object content type is not allowed by ${effect.store.name}.'); return raw.put({ ...request, ${effect.store.objectMode === 'immutable' ? 'ifAbsent: true' : 'ifAbsent: request.ifAbsent'} }); },
    head: async (key) => { assertEnabled(); const metadata = await raw.head(key); return metadata ? assertMetadata(metadata) : undefined; },
    get: async (key) => { assertEnabled(); const metadata = await raw.head(key); if (!metadata) return undefined; assertMetadata(metadata); const value = await raw.get(key); if (value && value.byteLength > ${effect.store.maxObjectBytes}) throw new Error('Object body exceeds the ${effect.store.maxObjectBytes}-byte ${effect.store.name} limit.'); return value; },
    delete: async (key, options) => { assertEnabled(); ${effect.store.deletion === 'retained' ? `throw new Error('Application object store ${effect.store.name} retains objects and rejects task deletion.');` : 'return raw.delete(key, options);'} },
  });
}`;
	}).join('\n');
	return `const objectRuntimes = Object.create(null);
${initializers}`;
}

export function uniqueWorkflowObjectEffects(contract: WorkflowContract): readonly WorkflowTaskObjectContract[] {
	const result = new Map<string, WorkflowTaskObjectContract>();
	for (const effect of contract.objectEffects?.objects ?? []) {
		const previous = result.get(effect.store.id);
		if (previous && previous.provider.id !== effect.provider.id) throw new Error(`Workflow worker ${contract.worker.id} configures object store ${effect.store.id} with conflicting providers.`);
		result.set(effect.store.id, effect);
	}
	return [...result.values()].sort((left, right) => left.store.id.localeCompare(right.store.id));
}

function generatedWorkflowProviderAccountingRuntime(contract: WorkflowContract): string {
  const bindings = contract.providerAccountingEffects?.bindings ?? [];
  if (bindings.length === 0) return 'const providerAccountingStores = Object.freeze({});';
  const byName = new Map(bindings.map((binding) => [binding.name, binding]));
  const entries = [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
  const environments = new Set(entries.map(({ callModel }) => callModel.runtime.connectionEnvName));
  if (environments.size !== 1) throw new Error(`Workflow worker ${contract.worker.id} provider accounting requires one PostgreSQL authority.`);
  const environment = entries[0]?.callModel.runtime.connectionEnvName;
  if (!environment) return 'const providerAccountingStores = Object.freeze({});';
  return `const providerAccountingSql = postgres(requiredEnv(${JSON.stringify(environment)}), { max: ${Math.max(2, contract.worker.deployment.taskSlots)} });
const providerAccountingStores = Object.freeze({
${entries.map(({ name }) => `  ${JSON.stringify(name)}: createPostgresApplicationProviderCallAccounting({ sql: providerAccountingSql }),`).join('\n')}
});`;
}

function generatedWorkflowFunctionNativeOperations(
  contract: WorkflowContract,
): string {
  const transactions = contract.functionNativeTransactions ?? [];
  const effects = contract.operationEffects;
  if (transactions.length === 0 || !effects) {
    return `const functionNativeTaskOperations = Object.freeze({});
const functionNativeTaskOperationHandles = Object.freeze({});
const functionNativeTaskCommands = Object.freeze({});`;
  }
  const nodes = new Map(contract.graph.nodes.map((node) => [node.id, node]));
  const imports = new Set<string>();
  const operationEntries: string[] = [];
  const operationHandleEntries: string[] = [];
  const commandEntries: string[] = [];
  for (const transaction of transactions) {
    const candidates = effects.operations.filter(
      (operation) => operation.taskHandlerId === transaction.taskHandlerId,
    );
    const unique = new Map<string, (typeof candidates)[number]>();
    for (const operation of candidates) {
      const existing = unique.get(operation.authority.operationId);
      if (
        existing
        && (
          existing.handler.id !== operation.handler.id
          || existing.command.id !== operation.command.id
          || existing.model.id !== operation.model.id
        )
      ) {
        throw new Error(
          `Workflow task ${transaction.taskHandlerId} resolves atomic operation ${operation.authority.operationId} ambiguously.`,
        );
      }
      unique.set(operation.authority.operationId, operation);
    }
    const operations = [...unique.values()];
    const sources = operations.map((operation) => {
      const { handler, command, model } = operation;
      if (
        model.runtime.connectionEnvName
        !== transaction.primaryModel.runtime.connectionEnvName
      ) {
        throw new Error(
          `Workflow task ${transaction.taskHandlerId} atomic operation ${operation.authority.operationId} crosses database authorities.`,
        );
      }
      const eventBindings = (handler.eventBindings ?? []).map((binding) => {
        const event = requiredApplicationGraphNode(
          nodes,
          binding.event.nodeId,
          'event',
          handler.id,
        );
        return {
          identifier: binding.identifier,
          event,
          variable: nestedApplicationCallbackVariable(binding.identifier),
        };
      });
      const commandBindings = (handler.commandBindings ?? []).map((binding) => {
        const nestedCommand = requiredApplicationGraphNode(
          nodes,
          binding.command.nodeId,
          'command',
          handler.id,
        );
        const owner = contract.graph.nodes.find(
          (candidate): candidate is ApplicationCommandHandlerNode =>
            candidate.kind === 'commandHandler'
            && candidate.command.nodeId === nestedCommand.id,
        );
        return {
          identifier: binding.identifier,
          command: nestedCommand,
          owner,
          variable: nestedApplicationCallbackVariable(binding.identifier),
        };
      });
      const modelBindings = (handler.transaction.modelBindings ?? []).map(
        (binding) => {
          const participant = requiredApplicationGraphNode(
            nodes,
            binding.model.nodeId,
            'model',
            handler.id,
          );
          if (!participant.runtime) {
            throw new Error(
              `Workflow atomic operation ${operation.authority.operationId} model binding ${binding.identifier} has no PostgreSQL runtime.`,
            );
          }
          return {
            identifier: binding.identifier,
            model: participant,
            variable: nestedApplicationCallbackVariable(binding.identifier),
          };
        },
      );
      const participantModels = handler.transaction.models.map((reference) => {
        const participant = requiredApplicationGraphNode(
          nodes,
          reference.nodeId,
          'model',
          handler.id,
        );
        if (!participant.runtime) {
          throw new Error(
            `Workflow atomic operation ${operation.authority.operationId} participant ${participant.id} has no PostgreSQL runtime.`,
          );
        }
        if (
          participant.runtime.connectionEnvName
          !== transaction.primaryModel.runtime.connectionEnvName
        ) {
          throw new Error(
            `Workflow atomic operation ${operation.authority.operationId} participant ${participant.name} crosses database authorities.`,
          );
        }
        return participant;
      });
      const eventDeclarations = eventBindings.map(({ event, variable }) =>
        `const ${variable}Contract = Object.freeze(${JSON.stringify(nestedApplicationEventDefinition(event))});
      const ${variable} = Object.freeze({ ...${variable}Contract, emit: payload => context.emit(${variable}Contract, payload) });`,
      ).join('\n      ');
      const modelDeclarations = modelBindings.map(
        ({ model: participant, variable }) =>
          `const ${variable} = Object.freeze({
        async get(identity) { const value = await context.models[${JSON.stringify(participant.name)}].get({ id: String(identity) }); return value ? { identity: value.id, value: value.spec, ...(value.revision ? { revision: value.revision } : {}) } : undefined; },
        async find(options) { const page = await context.models[${JSON.stringify(participant.name)}].query(options); return page.items.map(value => ({ identity: value.id, value: value.spec, ...(value.revision ? { revision: value.revision } : {}) })); },
      });`,
      ).join('\n      ');
      const commandDeclarations = commandBindings.map(
        ({ command: nestedCommand, owner, variable }) => {
          if (!owner) {
            return `const ${variable} = () => { throw new Error(${JSON.stringify(`Atomic operation ${operation.authority.operationId} references outbound command ${nestedCommand.id} without a local owner.`)}); };`;
          }
          return `const ${variable}Contract = Object.freeze(${JSON.stringify(nestedApplicationCommandDefinition(nestedCommand))});
      const ${variable} = Object.assign(
        input => {
          const idempotencyKey = ${owner.idempotencyKey ? `(${owner.idempotencyKey.source})(input)` : `context.id(${JSON.stringify(`nested-command:${nestedCommand.id}`)})`};
          context.send(${variable}Contract, input, { targetKey: (${owner.key.source})(input, undefined, idempotencyKey), idempotencyKey });
        },
        ${variable}Contract,
      );`;
        },
      ).join('\n      ');
      const callbackBindings = [
        ...modelBindings.map(({ identifier, variable }) => ({
          path: identifier,
          value: variable,
        })),
        ...eventBindings.map(({ identifier, variable }) => ({
          path: identifier,
          value: variable,
        })),
        ...commandBindings.map(({ identifier, variable }) => ({
          path: identifier,
          value: variable,
        })),
      ];
      let beforeCommit = '';
      if (handler.beforeCommit) {
        const suffix = createHash('sha256')
          .update(handler.id)
          .digest('hex')
          .slice(0, 12);
        imports.add(
          `import { createCallback as createWorkflowBeforeCommit_${suffix} } from './workflow-before-commit-${suffix}.generated.js';`,
        );
        beforeCommit = `const __applik8sBeforeCommit = createWorkflowBeforeCommit_${suffix}(${nestedApplicationCallbackObjectSource(callbackBindings)});`;
      }
      const outbox = handler.transaction.outbox.map((reference) =>
        nestedApplicationEventDefinition(requiredApplicationGraphNode(
          nodes,
          reference.nodeId,
          'event',
          handler.id,
        )),
      );
      const completionEvent = handler.completionEvent
        ? nestedApplicationEventDefinition(requiredApplicationGraphNode(
            nodes,
            handler.completionEvent.nodeId,
            'event',
            handler.id,
          ))
        : undefined;
      return `Object.freeze({
      operationId: ${JSON.stringify(operation.authority.operationId)},
      bindingId: ${JSON.stringify(handler.name)},
      operation: ${JSON.stringify(workflowNestedModelOperation(command, model.name))},
      command: ${JSON.stringify({ name: command.contract.name, version: command.contract.version })},
      errors: ${JSON.stringify(command.contract.errors.map(({ name }) => name))},
      schemas: ${JSON.stringify({
        input: command.contract.input.jsonSchema,
        output: command.contract.output.jsonSchema,
        errors: Object.fromEntries(command.contract.errors.map((error) => [
          error.name,
          error.schema.jsonSchema,
        ])),
        events: Object.fromEntries(eventBindings.map(({ event }) => [
          `${event.contract.name}.${event.contract.version}`,
          event.contract.payload.jsonSchema,
        ])),
        commands: Object.fromEntries(commandBindings.map(({ command: nestedCommand }) => [
          `${nestedCommand.contract.name}.${nestedCommand.contract.version}`,
          nestedCommand.contract.input.jsonSchema,
        ])),
      })},
      model: ${JSON.stringify(model.runtime)},
      models: ${JSON.stringify(participantModels.map(({ runtime }) => runtime))},
      selfRead: ${String(handler.transaction.selfRead === true)},
      historyModels: ${JSON.stringify(handler.transaction.history.map((reference) => participantModels.find(({ id }) => id === reference.nodeId)?.name).filter(Boolean))},
      retry: ${JSON.stringify(handler.retry)},
      history: ${String(handler.transaction.history.some((reference) => reference.nodeId === model.id))},
      outbox: ${JSON.stringify(outbox)},
      ${completionEvent ? `completionEvent: ${JSON.stringify(completionEvent)},` : ''}
      commands: ${JSON.stringify(commandBindings.map(({ command: nestedCommand }) => nestedApplicationCommandDefinition(nestedCommand)))},
      ordering: ${JSON.stringify(handler.ordering)},
      ${handler.missingRoute ? `missingRoute: ${JSON.stringify(handler.missingRoute)},` : ''}
      ${handler.initializeSource ? `initialize: (${handler.initializeSource}),` : ''}
      handler: async (model, input, context) => {
        ${eventDeclarations}
        ${modelDeclarations}
        ${commandDeclarations}
        ${handler.beforeCommit ? 'const __applik8sRunBeforeCommit = runApplicationModelBeforeCommit;' : ''}
        ${beforeCommit}
        return (${handler.handlerSource})(model, input, context);
      },
    })`;
    });
    operationEntries.push(
      `${JSON.stringify(transaction.taskHandlerId)}: Object.freeze([${sources.join(',\n')}])`,
    );
    const handles = candidates.map((operation) => {
      const commandId = `${operation.command.contract.name}.${operation.command.contract.version}`;
      const operationName = workflowModelOperationName(
        operation.command,
        operation.model.name,
      );
      return `${JSON.stringify(operation.alias)}: createApplicationFunctionNativeOperationHandle({
        operation: Object.freeze({ apiVersion: 'applik8s.operation/v1alpha1', kind: 'applicationOperation', id: ${JSON.stringify(operation.authority.operationId)}, model: ${JSON.stringify(operation.model.name)}, name: ${JSON.stringify(operationName)}, operation: ${JSON.stringify(workflowNestedModelOperation(operation.command, operation.model.name))}, transport: 'command' }),
        command: Object.freeze({ id: ${JSON.stringify(commandId)} }),
        key: (${operation.handler.key.source}),
        ${operation.handler.idempotencyKey ? `idempotencyKey: (${operation.handler.idempotencyKey.source}),` : ''}
      })`;
    });
    operationHandleEntries.push(
      `${JSON.stringify(transaction.taskHandlerId)}: Object.freeze({${handles.join(',\n')}})`,
    );
    commandEntries.push(
      `${JSON.stringify(transaction.taskHandlerId)}: Object.freeze(${JSON.stringify(operations.map(({ command }) => nestedApplicationCommandDefinition(command)))})`,
    );
  }
  return `${[...imports].sort().join('\n')}
const functionNativeTaskOperations = Object.freeze({
  ${operationEntries.join(',\n  ')}
});
const functionNativeTaskOperationHandles = Object.freeze({
  ${operationHandleEntries.join(',\n  ')}
});
const functionNativeTaskCommands = Object.freeze({
  ${commandEntries.join(',\n  ')}
});`;
}

function workflowModelOperationName(
  command: ApplicationCommandNode,
  modelName: string,
): string {
  const prefix = `models.${modelName}.`;
  if (!command.contract.name.startsWith(prefix)) {
    throw new Error(
      `Workflow operation command ${command.contract.name} is not owned by model ${modelName}.`,
    );
  }
  const name = command.contract.name.slice(prefix.length);
  if (!name) throw new Error(`Workflow operation for model ${modelName} has no name.`);
  return name;
}

function workflowNestedModelOperation(
  command: ApplicationCommandNode,
  modelName: string,
): 'create' | 'update' | 'delete' | 'custom' {
  const name = workflowModelOperationName(command, modelName);
  if (name === 'create' || name === 'update' || name === 'delete') return name;
  return 'custom';
}

function functionNativeTaskCallbackBindingEntries(
  transaction: WorkflowFunctionNativeTransactionContract | undefined,
): readonly { readonly path: string; readonly value: string }[] {
  if (!transaction) return [];
  return functionNativeTaskRuntimeBindingEntries(transaction).map(
    ({ identifier }) => ({
      path: identifier,
      value: `functionNativeTaskBindings(${JSON.stringify(transaction.taskHandlerId)})[${JSON.stringify(identifier)}]`,
    }),
  );
}

function functionNativeTaskRuntimeBindingEntries(
  transaction: WorkflowFunctionNativeTransactionContract,
): readonly { readonly identifier: string; readonly expression: string }[] {
  const bindings = new Map<string, { readonly target: string; readonly expression: string }>();
  for (const binding of transaction.modelBindings) {
    const segments = functionNativeTaskBindingSegments(
      binding.identifier,
      transaction.taskHandlerId,
    );
    const method = segments.at(-1);
    const runtimeMethod = method !== undefined
      && ['get', 'find', 'require', 'edit'].includes(method);
    const target = binding.model.id;
    const methods: readonly string[] = runtimeMethod && method
      ? [method]
      : ['get', 'find', 'require', 'edit'];
    for (const runtimeMethodName of methods) {
      const identifier = runtimeMethod
        ? binding.identifier
        : `${binding.identifier}.${runtimeMethodName}`;
      const existing = bindings.get(identifier);
      if (existing && existing.target !== target) {
        throw new Error(
          `Function-native workflow task ${transaction.taskHandlerId} callback identifier ${identifier} is ambiguous between ${existing.target} and ${target}.`,
        );
      }
      bindings.set(identifier, {
        target,
        expression: `functionNativeModelHandle(${JSON.stringify(binding.model.name)})[${JSON.stringify(runtimeMethodName)}]`,
      });
    }
  }
  for (const binding of transaction.eventBindings) {
    const segments = functionNativeTaskBindingSegments(
      binding.identifier,
      transaction.taskHandlerId,
    );
    const method = segments.at(-1);
    const eventHandle = `createApplicationFunctionNativeEventHandle(${JSON.stringify(`${binding.event.contract.name}.${binding.event.contract.version}`)}, { payload: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', uri: ${JSON.stringify(`generated:${binding.event.name}.payload`)} }, schema: ${JSON.stringify(binding.event.contract.payload.jsonSchema)} } })`;
    const identifier = method === 'emit'
      ? binding.identifier
      : `${binding.identifier}.emit`;
    const target = binding.event.id;
    const existing = bindings.get(identifier);
    if (existing && existing.target !== target) {
      throw new Error(
        `Function-native workflow task ${transaction.taskHandlerId} callback identifier ${identifier} is ambiguous between ${existing.target} and ${target}.`,
      );
    }
    bindings.set(identifier, {
      target,
      expression: `${eventHandle}.emit`,
    });
  }
  return [...bindings.entries()]
    .map(([identifier, value]) => ({ identifier, expression: value.expression }))
    .sort((left, right) => left.identifier.localeCompare(right.identifier));
}

function functionNativeTaskBindingSegments(
  identifier: string,
  owner: string,
): readonly string[] {
  const segments = identifier.split('.').map((segment) => segment.trim());
  if (
    segments.length === 0
    || segments.some(
      (segment) => !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment),
    )
  ) {
    throw new Error(
      `Function-native workflow task ${owner} callback binding ${JSON.stringify(identifier)} is not a serializable property path.`,
    );
  }
  return segments;
}

function generatedWorkflowFunctionNativeTransactions(
  contract: WorkflowContract,
): string {
  const transactions = contract.functionNativeTransactions ?? [];
  if (transactions.length === 0) return '';
  const entries = transactions.map((transaction) =>
    `${JSON.stringify(transaction.taskHandlerId)}: Object.freeze({
      mode: ${JSON.stringify(transaction.mode)},
      model: Object.freeze(${JSON.stringify(transaction.primaryModel.runtime)}),
      models: Object.freeze(${JSON.stringify(
        transaction.models.map((model) => model.runtime),
      )}),
      outbox: Object.freeze(${JSON.stringify(
        transaction.outbox.map((event) => functionNativeEventDefinition(event)),
      )}),
      commands: functionNativeTaskCommands[${JSON.stringify(transaction.taskHandlerId)}] ?? Object.freeze([]),
      operations: functionNativeTaskOperations[${JSON.stringify(transaction.taskHandlerId)}] ?? Object.freeze([]),
      bindings: Object.freeze({
${functionNativeTaskRuntimeBindingEntries(transaction).map((entry) => `        ${JSON.stringify(entry.identifier)}: ${entry.expression},`).join('\n')}
      }),
      databaseUrl: requiredEnv(${JSON.stringify(
        transaction.primaryModel.runtime.connectionEnvName,
      )}),
    })`
  );
  return `const functionNativeTaskTransactions = Object.freeze({
  ${entries.join(',\n  ')}
});
function functionNativeModelSnapshot(value) { return value ? { identity: value.id, value: value.spec, ...(value.revision ? { revision: value.revision } : {}) } : undefined; }
function functionNativeModelHandle(name) { return Object.freeze({
  get: async identity => functionNativeModelSnapshot(await getApplicationNativeModelObject(name, identity)),
  find: async options => (await findApplicationNativeModelObjects(name, options)).items.map(functionNativeModelSnapshot),
  require: async identity => functionNativeModelSnapshot(await requireApplicationNativeModelObject(name, identity)),
  edit: (identity, handler) => editApplicationNativeModelObject(name, identity, handler),
}); }
function functionNativeTaskBindings(handlerId) {
  const transaction = functionNativeTaskTransactions[handlerId];
  if (!transaction) throw new Error('No function-native transaction was declared for task handler ' + handlerId + '.');
  return transaction.bindings;
}
function functionNativeTaskReadClients(handlerId, context) {
  const transaction = functionNativeTaskTransactions[handlerId];
  if (!transaction) throw new Error('No function-native read scope was declared for task handler ' + handlerId + '.');
  return applicationPostgresModelReadClients(
    transaction.databaseUrl,
    transaction.models,
    metadata(context).trustedContext,
  );
}
function functionNativeTaskCommandContext(delivery, principal) {
  const inherited = delivery.trustedContext;
  if (!principal) return inherited;
  const trustedValues = inherited?.values ?? principal.trustedContext ?? {};
  const base = inherited ?? Object.freeze({
    values: trustedValues,
    digest: principal.trustedContextDigest,
    changeScopes: applicationRelationalChangeScopes({
      values: trustedValues,
      digestSecret: requiredEnv('APPLIK8S_TASK_OPERATION_CONTEXT_SECRET'),
    }),
  });
  return Object.freeze({
    ...base,
    values: Object.freeze({
      ...trustedValues,
      ...applicationCommandPrincipalValues(principal),
    }),
  });
}
function functionNativeTaskRuntime(handlerId, context, principal) {
  const transaction = functionNativeTaskTransactions[handlerId];
  if (!transaction) throw new Error('No function-native transaction was declared for task handler ' + handlerId + '.');
  const delivery = metadata(context);
  const commandContext = functionNativeTaskCommandContext(delivery, principal);
  const durableId = handlerId + ':' + delivery.invocationId;
  return Object.freeze({
    edit: request => executeFunctionNativePostgresModelEdit({
      bindingId: handlerId,
      model: transaction.model,
      models: transaction.models,
      outbox: transaction.outbox,
      commands: transaction.commands,
      atomicOperations: transaction.operations,
      databaseUrl: transaction.databaseUrl,
      delivery: {
        id: durableId,
        idempotencyKey: handlerId + ':' + delivery.idempotencyKey,
        correlationId: delivery.correlationId ?? durableId,
        causationId: delivery.causationId ?? delivery.invocationId,
        attempt: delivery.attempt,
        ...(commandContext ? { context: commandContext } : {}),
      },
    }, request),
  });
}`;
}

function functionNativeEventDefinition(
  event: WorkflowFunctionNativeTransactionContract['outbox'][number],
): object {
  return {
    kind: 'applik8sEvent',
    id: event.name,
    name: event.contract.name,
    version: event.contract.version,
    payload: {
      kind: 'jsonSchema',
      ref: {
        kind: 'jsonSchema',
        uri: `generated:${event.name}.payload`,
      },
      schema: event.contract.payload.jsonSchema,
    },
  };
}

export function generatedHandlerModule(
  handler: ApplicationTaskHandlerNode | ApplicationWorkflowHandlerNode,
  capabilityNames: readonly string[] = [],
): string {
  const providerOperations = handler.kind === 'taskHandler'
    ? workflowTaskProviderRuntimeOperations(handler)
    : [];
  const providerBindingPaths = handler.kind === 'taskHandler'
    ? (handler.providerBindings ?? []).flatMap((binding) =>
        binding.operation || binding.privateRuntime ? [binding.identifier] : [])
    : [];
  const providerBindingRoots = providerBindingPaths
    .map((identifier) => identifier.split('.')[0])
    .filter((identifier): identifier is string => Boolean(identifier));
  const injectedIdentifiers = (handler.kind === 'taskHandler'
    ? [
        ...capabilityNames,
        ...providerBindingRoots,
        ...(handler.operations ?? []).map((binding) => binding.alias),
        ...(handler.queries ?? []).map((binding) => binding.alias),
        ...(handler.projections ?? []).map((binding) => binding.alias),
        ...(handler.objects ?? []).map((binding) => binding.alias),
        ...(handler.actors ?? []).map((binding) => binding.alias),
        ...(handler.signalBindings ?? []).map((binding) => binding.alias),
        ...((handler.signalBindings?.length ?? 0) > 0 ? ['workflow'] : []),
        ...(handler.functionNativeTransaction?.modelBindings ?? []).map(
          (binding) => binding.identifier,
        ),
        ...(handler.functionNativeTransaction?.eventBindings ?? []).map(
          (binding) => binding.identifier,
        ),
      ]
    : [
        ...handler.taskBindings.map((binding) => binding.alias),
        ...handler.childWorkflowBindings.map((binding) => binding.alias),
        ...(handler.signalBindings ?? []).map((binding) => binding.alias),
        ...((handler.signalBindings?.length ?? 0) > 0 ? ['workflow'] : []),
      ])
    .map((identifier) => identifier.split('.')[0] ?? identifier)
    .filter(
      (identifier, index, values) =>
        /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(identifier)
        && values.indexOf(identifier) === index,
    );
  const replacedCapturedIdentifiers = providerBindingRoots.filter(
    (identifier, index, values) =>
      values.indexOf(identifier) === index
      && capturedApplicationInjectFacade(
        handler.handlerDependencies?.source,
        identifier,
      ),
  );
  return generatedCallbackFactoryModule({
    source: handler.handlerSource,
    ...(handler.handlerDependencies
      ? { dependencies: handler.handlerDependencies }
      : {}),
    injectedIdentifiers,
    injectedBindingPaths: [
      ...injectedIdentifiers,
      ...providerBindingPaths,
    ],
    replacedCapturedIdentifiers,
    exportName: 'createHandler',
  });
}

interface WorkflowTaskProviderRuntimeOperation {
  readonly binding: ApplicationCallableProviderBinding;
  readonly runtime: ApplicationCallableProviderRuntimeOperation;
  readonly variable: string;
}

function workflowTaskProviderRuntimeOperations(
  handler: ApplicationTaskHandlerNode,
): readonly WorkflowTaskProviderRuntimeOperation[] {
  return (handler.providerBindings ?? []).flatMap((binding) => {
    if (!binding.operation) return [];
    const runtime = binding.operation.runtime;
    if (!runtime) {
      throw new Error(
        `Workflow task ${handler.id} provider binding ${binding.identifier} has no public static runtime operation. Define the operation in the provider runtime contract; generated workflow workers never replay authoring-time provider selection.`,
      );
    }
    if (
      !/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._/-]*|[a-z0-9][a-z0-9._/-]*)$/u.test(
        runtime.module,
      )
      || runtime.module.includes('..')
      || !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(runtime.export)
    ) {
      throw new Error(
        `Workflow task ${handler.id} provider binding ${binding.identifier} has an invalid public runtime export ${runtime.module}#${runtime.export}.`,
      );
    }
    const segments = binding.identifier.split('.');
    if (
      segments.length === 0
      || segments.some(
        (segment) => !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(segment),
      )
    ) {
      throw new Error(
        `Workflow task ${handler.id} provider binding ${binding.identifier} is not a static JavaScript binding path.`,
      );
    }
    return [{
      binding,
      runtime,
      variable: `providerOperation_${createHash('sha256')
        .update(`${runtime.module}\0${runtime.export}`)
        .digest('hex')
        .slice(0, 12)}`,
    }];
  });
}

export async function writeWorkflowPrivateProviderModules(
  directory: string,
  contract: WorkflowContract,
): Promise<void> {
  await Promise.all(
    (contract.privateProviderEffects?.providers ?? []).flatMap((provider) =>
      provider.branches.flatMap((branch) => {
        if (!branch.runtime) return [];
        return [
          writeFile(
            join(
              directory,
              privateProviderConstructorModuleFile(
                provider.provider.id,
                branch.variant,
              ),
            ),
            generatedCallbackFactoryModule({
              source: branch.runtime.construct.source,
              ...(branch.runtime.construct.dependencies
                ? { dependencies: branch.runtime.construct.dependencies }
                : {}),
              injectedIdentifiers: [],
              exportName: 'createConstructor',
            }),
          ),
          writeFile(
            join(
              directory,
              privateProviderValidatorModuleFile(
                provider.provider.id,
                branch.variant,
              ),
            ),
            generatedCallbackFactoryModule({
              source: branch.runtime.validate.source,
              ...(branch.runtime.validate.dependencies
                ? { dependencies: branch.runtime.validate.dependencies }
                : {}),
              injectedIdentifiers: [],
              exportName: 'createValidator',
            }),
          ),
        ];
      }),
    ),
  );
}

export function nestedCallbackBindingsSource(
  entries: readonly { readonly path: string; readonly value: string }[],
): string {
  interface BindingTree {
    direct?: string;
    readonly children: Map<string, BindingTree>;
  }
  const roots = new Map<string, BindingTree>();
  for (const entry of entries) {
    const segments = entry.path.split('.');
    if (
      segments.length === 0
      || segments.some(
        (segment) => !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment),
      )
    ) {
      throw new Error(
        `Generated callback binding path ${JSON.stringify(entry.path)} is not a static JavaScript binding path.`,
      );
    }
    const [root, ...rest] = segments;
    if (!root) continue;
    const current = roots.get(root) ?? {
      children: new Map<string, BindingTree>(),
    };
    let leaf = current;
    for (const segment of rest) {
      const child = leaf.children.get(segment) ?? {
        children: new Map<string, BindingTree>(),
      };
      leaf.children.set(segment, child);
      leaf = child;
    }
    if (leaf.direct !== undefined && leaf.direct !== entry.value) {
      throw new Error(
        `Generated callback binding ${entry.path} resolves to multiple runtime values.`,
      );
    }
    leaf.direct = entry.value;
    roots.set(root, current);
  }

  const source = (node: BindingTree): string => {
    if (node.direct && node.children.size === 0) {
      return node.direct;
    }
    const nested = [...node.children.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([property, child]) =>
          `${JSON.stringify(property)}: ${source(child)}`,
      )
      .join(', ');
    return `{ ${node.direct ? `...(${node.direct}), ` : ''}${nested} }`;
  };
  const properties = [...roots.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([root, value]) => `${JSON.stringify(root)}: ${source(value)}`);
  return `{ ${properties.join(', ')} }`;
}

function privateProviderBindingSource(
  contract: WorkflowContract,
  binding: NonNullable<ApplicationTaskHandlerNode['providerBindings']>[number],
): string | undefined {
  if (!binding.privateRuntime) return undefined;
  const provider = contract.privateProviderEffects?.providers.find(
    (candidate) => candidate.provider.id === binding.provider.nodeId,
  );
  if (!provider) {
    throw new Error(
      `Workflow task provider binding ${binding.identifier} has no managed private runtime for ${binding.provider.nodeId}.`,
    );
  }
  const implementation = privateProviderRuntimeVariable(provider.provider.id);
  if (binding.projection === 'implementation') return implementation;
  if (binding.projection === 'binding') {
    return `Object.freeze({ kind: 'applicationProvider', implementation: ${implementation} })`;
  }
  throw new Error(
    `Workflow task provider binding ${binding.identifier} must capture the provider implementation or binding.`,
  );
}

export function generatedOperationPrincipalModule(handler: ApplicationTaskHandlerNode): string {
  if (!handler.operationPrincipalSource) throw new Error(`Workflow task ${handler.id} has no operation-principal source.`);
  const dependencies = handler.operationPrincipalDependencies?.source
    ? absoluteDependencyImports(handler.operationPrincipalDependencies.source, handler.operationPrincipalDependencies.resolveDir)
    : '';
  return `${dependencies}${dependencies ? '\n\n' : ''}export const principal = (${handler.operationPrincipalSource});\n`;
}

function generatedWorkflowPrivateProviderRuntime(
  contract: WorkflowContract,
): string {
  const providers = contract.privateProviderEffects?.providers ?? [];
  if (providers.length === 0) {
    return 'const providerPrivateSqlClients = [];';
  }
  const declarations = providers.map((provider) => {
    const branches = provider.branches.map((branch) => {
      if (!branch.runtime) {
        return `case ${JSON.stringify(branch.variant)}: return undefined;`;
      }
      const credentials = branch.runtime.credentials.map((credential) =>
        `${JSON.stringify(credential.alias)}: await requiredPrivateProviderFile(${JSON.stringify(privateProviderMountPath(provider.provider.id, 'credentials', credential.alias))}, ${JSON.stringify(`${provider.provider.id}.${branch.variant} credential ${credential.alias}`)})`).join(', ');
      const postgresBindings = branch.postgres.map((dependency) => {
        const path = privateProviderMountPath(
          provider.provider.id,
          'postgres',
          dependency.alias,
        );
        return `${JSON.stringify(dependency.alias)}: await createPrivateProviderPostgres(${JSON.stringify(path)}, ${JSON.stringify(dependency.database)}, ${JSON.stringify(`${provider.provider.id}.${branch.variant} PostgreSQL ${dependency.alias}`)})`;
      }).join(', ');
      const construct = privateProviderBranchVariable(
        provider.provider.id,
        branch.variant,
        'construct',
      );
      const validate = privateProviderBranchVariable(
        provider.provider.id,
        branch.variant,
        'validate',
      );
      return `case ${JSON.stringify(branch.variant)}: {
        const runtime = Object.freeze({
          credentials: Object.freeze({ ${credentials} }),
          postgres: Object.freeze({ ${postgresBindings} }),
        });
        let implementation;
        try { implementation = await ${construct}()(runtime); }
        catch (cause) { throw new Error(${JSON.stringify(`Provider ${provider.provider.id}.${branch.variant} private runtime construction failed.`)}, { cause }); }
        if (!${validate}()(implementation)) {
          throw new Error(${JSON.stringify(`Provider ${provider.provider.id}.${branch.variant} runtime constructor returned an implementation that violates its versioned contract.`)});
        }
        return Object.freeze(implementation);
      }`;
    }).join('\n');
    return `const ${privateProviderRuntimeVariable(provider.provider.id)} = await (async () => {
      const variant = requiredEnv('APPLIK8S_PROFILE_VARIANT');
      switch (variant) {
        ${branches}
        default: throw new Error(${JSON.stringify(`Provider ${provider.provider.id} has no runtime branch for the selected profile variant `)} + JSON.stringify(variant));
      }
    })();`;
  }).join('\n');
  return `const providerPrivateSqlClients = [];
async function requiredPrivateProviderFile(path, label) {
  let value;
  try { value = await readFile(path, 'utf8'); }
  catch (cause) { throw new Error('Missing provider-private ' + label + '.', { cause }); }
  if (!value) throw new Error('Provider-private ' + label + ' must not be empty.');
  return value;
}
async function createPrivateProviderPostgres(path, database, label) {
  const connectionString = (await requiredPrivateProviderFile(path, label)).trim();
  if (!connectionString) throw new Error('Provider-private ' + label + ' must not be blank.');
  const client = postgres(connectionString, { max: ${Math.max(2, contract.worker.deployment.taskSlots)} });
  providerPrivateSqlClients.push(client);
  const sql = Object.freeze({
    unsafe: (query, parameters) => client.unsafe(query, parameters),
    begin: (operation) => client.begin((transaction) => operation(Object.freeze({
      unsafe: (query, parameters) => transaction.unsafe(query, parameters),
      json: (value) => transaction.json(value),
    }))),
  });
  return Object.freeze({ sql, database });
}
${declarations}`;
}

function generatedWorkflowOperationRuntime(
  contract: WorkflowContract,
  eventLogPublisherSource?: string,
): string {
  const effects = contract.operationEffects;
  if (!effects && !contract.signalEffects) {
    return 'const operationRuntime = undefined;\nconst operationAuthoritySql = undefined;\nconst operationAuthority = undefined;';
  }
  if (!contract.operationCatalog) {
    throw new Error(`Workflow worker ${contract.worker.id} declares protected operations or signals without an operation catalog.`);
  }
  const signalDatabaseEnvironment =
    contract.signalEffects?.database.connectionEnvName;
  if (!effects) {
    if (!signalDatabaseEnvironment) {
      throw new Error(
        `Workflow worker ${contract.worker.id} signal authority has no canonical database.`,
      );
    }
    return `const operationAuthoritySql = postgres(requiredEnv(${JSON.stringify(signalDatabaseEnvironment)}), { max: 6, idle_timeout: 20, connect_timeout: 10, prepare: false });
const operationAuthority = createApplicationOperationAuthorityRuntime({
  sql: operationAuthoritySql,
  application: ${JSON.stringify(contract.graphName)},
  catalog: ${JSON.stringify(contract.operationCatalog)},
  ${contract.authorityManifest ? `authorityManifest: ${JSON.stringify(contract.authorityManifest)},` : ''}
});
await operationAuthority.prepare();
const operationRuntime = undefined;`;
  }
  const operationsByContract = new Map<string, (typeof effects.operations)[number]>();
  for (const operation of effects.operations) {
    const contractId = `${operation.command.contract.name}.${operation.command.contract.version}`;
    const previous = operationsByContract.get(contractId);
    if (previous) {
      const previousIdentity = JSON.stringify({
        bindingId: previous.handler.name,
        model: previous.model.name,
        inputSchema: previous.command.contract.input.jsonSchema,
        database: previous.model.runtime.connectionEnvName,
        key: previous.handler.key.source,
        idempotencyKey: previous.handler.idempotencyKey?.source,
      });
      const nextIdentity = JSON.stringify({
        bindingId: operation.handler.name,
        model: operation.model.name,
        inputSchema: operation.command.contract.input.jsonSchema,
        database: operation.model.runtime.connectionEnvName,
        key: operation.handler.key.source,
        idempotencyKey: operation.handler.idempotencyKey?.source,
      });
      if (previousIdentity !== nextIdentity) {
        throw new Error(
          `Workflow worker ${contract.worker.id} resolves command ${contractId} through conflicting operation contracts.`,
        );
      }
      continue;
    }
    operationsByContract.set(contractId, operation);
  }
  const operations = [...operationsByContract.values()];
  const databaseEnvironments = new Set(operations.map(({ model }) => model.runtime.connectionEnvName));
  if (signalDatabaseEnvironment) databaseEnvironments.add(signalDatabaseEnvironment);
  if (databaseEnvironments.size !== 1) {
    throw new Error(`Workflow worker ${contract.worker.id} protected operations and signals span multiple authority databases.`);
  }
  if (!eventLogPublisherSource) {
    throw new Error(
      `Workflow worker ${contract.worker.id} operations have no target-native event-log publisher.`,
    );
  }
  const authorityDatabaseEnvironment = [...databaseEnvironments][0]!;
  const commands = operations.map(({ handler, command, model }) => `{ id: ${JSON.stringify(`${command.contract.name}.${command.contract.version}`)}, bindingId: ${JSON.stringify(handler.name)}, model: ${JSON.stringify(model.name)}, inputSchema: ${JSON.stringify(command.contract.input.jsonSchema)}, databaseUrl: requiredEnv(${JSON.stringify(model.runtime.connectionEnvName)}), key: (${handler.key.source})${handler.idempotencyKey ? `, idempotencyKey: (${handler.idempotencyKey.source})` : ''} }`).join(',\n');
  return `${eventLogPublisherSource}
const operationAuthoritySql = postgres(requiredEnv(${JSON.stringify(authorityDatabaseEnvironment)}), { max: 6, idle_timeout: 20, connect_timeout: 10, prepare: false });
const operationAuthority = createApplicationOperationAuthorityRuntime({
  sql: operationAuthoritySql,
  application: ${JSON.stringify(contract.graphName)},
  catalog: ${JSON.stringify(contract.operationCatalog)},
  ${contract.authorityManifest ? `authorityManifest: ${JSON.stringify(contract.authorityManifest)},` : ''}
});
await operationAuthority.prepare();
const operationRuntime = createApplicationTaskOperationRuntime({
  commands: [${commands}],
  cursorSecret: requiredEnv('APPLIK8S_TASK_OPERATION_CONTEXT_SECRET'),
  eventLogPublisher: applicationEventLogPublisher,
  admitExecution: ({ principal, invocation, envelopes, trustedContextDigest }) => {
    const envelope = envelopes[0];
    if (!envelope) throw new Error('Application task execution has no workload authority envelope.');
    return operationAuthority.admitExecutionPrincipal({
      executionKind: 'task',
      executionId: invocation.invocationId,
      attempt: invocation.attempt,
      workloadIdentity: envelope.workloadIdentity,
      ...(envelope.serviceIdentity ? { serviceIdentity: envelope.serviceIdentity } : {}),
      causalPrincipalId: principal.causalPrincipalId ?? principal.id,
      causalPrincipal: principal.causalPrincipal ?? principal.identity,
      causalGrantIds: principal.causalGrantIds ?? [],
      envelopes,
      trustedContextDigest,
      audience: [...new Set(envelopes.flatMap((candidate) => candidate.audiences))],
      deadline: invocation.deadline ?? new Date(Date.now() + 60_000).toISOString(),
      cancellationRevision: invocation.cancellationRevision ?? ('active:' + invocation.invocationId),
    });
  },
  authorizeExecution: ({ cancellationRevision, ...request }) => operationAuthority.authorizeExecution({
    ...request,
    audience: request.envelope.audiences[0] ?? request.envelope.workloadIdentity.id,
    // The command is delivered over the event log as an internal
    // implementation detail, but the authorized caller is the durable
    // workflow. Binding this to "event" rejects workflow-only model
    // operations even when the task declared their workload authority.
    transport: 'workflow',
    currentCancellationRevision: cancellationRevision,
    // The compiler-owned workload envelope admits the bounded attempt. The
    // model's beforeCommit policy remains the authoritative transactional
    // decision when the command processor applies the mutation.
    applicationPolicyAllowed: true,
  }),
});`;
}

function generatedWorkflowQueryRuntime(contract: WorkflowContract): string {
  const effects = contract.queryEffects;
  if (!effects) return 'const queryRuntime = undefined;';
  const queries = effects.queries.map(({ query, gateway, endpointBaseUrl, endpointPath, endpointEnvironmentName }) => `{ id: ${JSON.stringify(query.publicId ?? `${query.name}.${query.version}`)}, audience: ${JSON.stringify(gateway.id)}, endpoint: runtimeEndpoint(${JSON.stringify(endpointBaseUrl)}, ${JSON.stringify(endpointEnvironmentName)}, ${JSON.stringify(endpointPath)}), inputSchema: ${JSON.stringify(query.input.jsonSchema)}, outputSchema: ${JSON.stringify(query.output.jsonSchema)}, timeoutMs: ${query.budgets.timeoutMs}, maxResultBytes: ${query.budgets.maxResultBytes} }`).join(',\n');
  return `const queryRuntime = createApplicationTaskQueryRuntime({
  queries: [${queries}],
  cursorSecret: requiredEnv('APPLIK8S_TASK_QUERY_CONTEXT_SECRET'),
});`;
}

function generatedWorkflowProjectionRuntime(contract: WorkflowContract): string {
  const effects = uniqueWorkflowProjectionEffects(contract);
  if (effects.length === 0) return 'const projectionRuntimes = Object.freeze({});\nconst projectionSources = [];';
  const initializers = effects.map((effect) => {
    const projection = effect.projection;
    const online = projection.online;
    const stream = effect.stream;
    const removeWhen = online.removeSource ? projectionCallbackVariable(projection.id, 'remove') : 'undefined';
    const snapshotSource = effect.rebuildModel ? `
  const snapshot = createPostgresApplicationProjectionSnapshotSource({
    databaseUrl: requiredEnv(${JSON.stringify(effect.rebuildModel.runtime.connectionEnvName)}),
    model: ${JSON.stringify({ name: effect.rebuildModel.runtime.name, tableName: effect.rebuildModel.runtime.tableName, nativeRelational: effect.rebuildModel.runtime.nativeRelational })},
    stream: ${JSON.stringify({ name: stream.name, version: stream.version })},
    payload: runtimeSchema(${JSON.stringify(stream.payload.jsonSchema)}, ${JSON.stringify(`${stream.name}.${stream.version}.snapshot-payload`)}),
    map: ${projectionCallbackVariable(projection.id, 'snapshot')},
  });
  projectionSources.push(snapshot);` : '';
    const snapshotOptions = effect.rebuildModel
      ? `, snapshot, snapshotPartition: ${projectionCallbackVariable(projection.id, 'snapshotPartition')}`
      : '';
    return `{
  const stream = { kind: 'applicationStream', definition: { kind: 'stream', id: ${JSON.stringify(`${stream.name}.${stream.version}`)}, name: ${JSON.stringify(stream.name)}, version: ${JSON.stringify(stream.version)}, payload: runtimeSchema(${JSON.stringify(stream.payload.jsonSchema)}, ${JSON.stringify(`${stream.name}.${stream.version}.payload`)}) }, retention: ${JSON.stringify(stream.retention)}, authority: 'postgres-outbox', replay: 'supported', database: ${workflowDatabaseBindingSource(stream)}, partition: () => { throw new Error('Projection rebuild replay never repartitions persisted events.'); }, authorize: async () => false };
  const source = createPostgresApplicationStream({ stream, databaseUrl: requiredEnv(${JSON.stringify(stream.database.connectionEnvName)}), principal: { id: ${JSON.stringify(`applik8s:projection:${projection.name}`)} }, internalConsumer: { kind: 'projection', name: ${JSON.stringify(projection.name)} } });
  projectionSources.push(source);
  ${snapshotSource}
  const store = createValkeyOnlineProjectionWriter({ host: requiredEnv('APPLIK8S_REBUILD_VALKEY_HOST'), port: Number(requiredEnv('APPLIK8S_REBUILD_VALKEY_PORT')), ...(process.env.APPLIK8S_REBUILD_VALKEY_PASSWORD ? { password: process.env.APPLIK8S_REBUILD_VALKEY_PASSWORD } : {}), prefix: ${JSON.stringify(kubernetesName(contract.graphName))}, projection: ${JSON.stringify(projection.name)}, stream: ${JSON.stringify(`${stream.name}.${stream.version}`)}, valueSchema: runtimeSchema(${JSON.stringify(projection.output.jsonSchema)}, ${JSON.stringify(`${projection.name}.output`)}), partitionBy: ${projectionCallbackVariable(projection.id, 'partition')}, key: ${projectionCallbackVariable(projection.id, 'key')}, score: ${projectionCallbackVariable(projection.id, 'score')}, scoreUnit: ${JSON.stringify(online.scoreUnit)}, value: ${projectionCallbackVariable(projection.id, 'value')}, ...(${removeWhen} ? { removeWhen: ${removeWhen} } : {}), retention: ${JSON.stringify(online.retention)}, initialGeneration: 'live' });
  const artifacts = createS3ApplicationObjectStorageRuntime({ store: ${JSON.stringify(effect.artifacts.name)}, provider: { kind: 's3', bucket: requiredEnv('APPLIK8S_REBUILD_OBJECT_BUCKET'), region: requiredEnv('APPLIK8S_REBUILD_OBJECT_REGION'), ...(process.env.APPLIK8S_REBUILD_OBJECT_PREFIX ? { prefix: process.env.APPLIK8S_REBUILD_OBJECT_PREFIX } : {}), ...(process.env.APPLIK8S_REBUILD_OBJECT_ENDPOINT ? { endpoint: process.env.APPLIK8S_REBUILD_OBJECT_ENDPOINT } : {}), forcePathStyle: process.env.APPLIK8S_REBUILD_OBJECT_FORCE_PATH_STYLE === 'true' } });
  projectionRuntimes[${JSON.stringify(projection.id)}] = Object.freeze({
    rebuild: (input) => {
      if (process.env.APPLIK8S_REBUILD_OBJECT_ENABLED === 'false') throw new Error('Projection rebuild object storage is disabled for this installation.');
      return runApplicationOnlineProjectionRebuild({ projection: ${JSON.stringify(projection.name)}, streamName: ${JSON.stringify(`${stream.name}.${stream.version}`)}, generation: requiredProjectionGeneration(input?.generation), source, store, artifacts, project: ${projectionCallbackVariable(projection.id, 'project')}${snapshotOptions}, artifactPrefix: input?.artifactPrefix, ...${JSON.stringify(effect.bounds)} });
    },
    retire: (input) => retireApplicationOnlineProjectionGeneration({ projection: ${JSON.stringify(effect.projection.name)}, generation: requiredProjectionGeneration(input?.generation), store, artifacts, references: Array.isArray(input?.references) ? input.references : [] }),
  });
}`;
  }).join('\n');
  return `const projectionRuntimes = Object.create(null);
const projectionSources = [];
function runtimeSchema(json, name) { return { kind: 'jsonSchema', ref: { kind: 'jsonSchema', uri: 'generated:' + name }, schema: json }; }
function requiredProjectionGeneration(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) throw new Error('Projection generation is invalid.'); return value; }
${initializers}`;
}

export function uniqueWorkflowProjectionEffects(contract: WorkflowContract): readonly WorkflowTaskProjectionContract[] {
  const result = new Map<string, WorkflowTaskProjectionContract>();
  for (const effect of contract.projectionEffects?.projections ?? []) {
    const previous = result.get(effect.projection.id);
    if (previous && JSON.stringify({ artifacts: previous.artifacts.id, bounds: previous.bounds }) !== JSON.stringify({ artifacts: effect.artifacts.id, bounds: effect.bounds })) {
      throw new Error(`Workflow worker ${contract.worker.id} configures projection ${effect.projection.id} with conflicting artifact stores or rebuild bounds.`);
    }
    result.set(effect.projection.id, effect);
  }
  return [...result.values()].sort((left, right) => left.projection.id.localeCompare(right.projection.id));
}

function workflowProjectionCallbackImports(effect: WorkflowTaskProjectionContract): readonly string[] {
  const roles = ['project', 'partition', 'key', 'score', 'value', ...(effect.projection.online.removeSource ? ['remove'] : []), ...(effect.rebuildModel ? ['snapshot', 'snapshotPartition'] : [])];
  return roles.map((role) => `import { callback as ${projectionCallbackVariable(effect.projection.id, role)} } from ${JSON.stringify(`./${projectionCallbackModuleFile(effect.projection.id, role)}`)};`);
}

export async function writeWorkflowProjectionCallbackModules(directory: string, effect: WorkflowTaskProjectionContract): Promise<void> {
  const online = effect.projection.online;
  const callbacks = [
    ['project', effect.projection.handlerSource, effect.projection.handlerDependencies],
    ['partition', online.partitionSource, online.partitionDependencies],
    ['key', online.keySource, online.keyDependencies],
    ['score', online.scoreSource, online.scoreDependencies],
    ['value', online.valueSource, online.valueDependencies],
    ...(online.removeSource ? [['remove', online.removeSource, online.removeDependencies] as const] : []),
    ...(effect.rebuildModel ? [
      ['snapshot', online.rebuild.mapSource as string, online.rebuild.mapDependencies] as const,
      ['snapshotPartition', effect.stream.partitionSource, effect.stream.partitionDependencies] as const,
    ] : []),
  ] as const;
  for (const [role, source, dependencies] of callbacks) {
    const dependencySource = dependencies?.source ? absoluteDependencyImports(dependencies.source, dependencies.resolveDir) : '';
    await writeFile(join(directory, projectionCallbackModuleFile(effect.projection.id, role)), `${dependencySource}${dependencySource ? '\n\n' : ''}export const callback = (${source});\n`);
  }
}

export async function writeWorkflowFunctionNativeOperationCallbackModules(
  directory: string,
  contract: WorkflowContract,
): Promise<void> {
  const transactionHandlers = new Set(
    (contract.functionNativeTransactions ?? []).map(
      ({ taskHandlerId }) => taskHandlerId,
    ),
  );
  const handlers = new Map<string, ApplicationCommandHandlerNode>();
  for (const operation of contract.operationEffects?.operations ?? []) {
    if (
      transactionHandlers.has(operation.taskHandlerId)
      && operation.handler.beforeCommit
    ) {
      handlers.set(operation.handler.id, operation.handler);
    }
  }
  await Promise.all([...handlers.values()].map(async (handler) => {
    if (!handler.beforeCommit) return;
    const suffix = createHash('sha256')
      .update(handler.id)
      .digest('hex')
      .slice(0, 12);
    const injectedIdentifiers = [
      ...(handler.transaction.modelBindings ?? []).map(
        ({ identifier }) => identifier,
      ),
      ...(handler.eventBindings ?? []).map(({ identifier }) => identifier),
      ...(handler.commandBindings ?? []).map(({ identifier }) => identifier),
    ]
      .map((identifier) => identifier.split('.')[0] ?? identifier)
      .filter(
        (identifier, index, values) =>
          /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(identifier)
          && values.indexOf(identifier) === index,
      );
    await writeFile(
      join(directory, `workflow-before-commit-${suffix}.generated.ts`),
      generatedCallbackFactoryModule({
        source: handler.beforeCommit.source,
        ...(handler.beforeCommit.dependencies
          ? { dependencies: handler.beforeCommit.dependencies }
          : {}),
        injectedIdentifiers,
        exportName: 'createCallback',
      }),
    );
  }));
}

function projectionCallbackModuleFile(id: string, role: string): string { return `projection-${role}-${createHash('sha256').update(id).digest('hex').slice(0, 12)}.generated.ts`; }
function projectionCallbackVariable(id: string, role: string): string { return `projection_${role}_${createHash('sha256').update(id).digest('hex').slice(0, 12)}`; }

function workflowDatabaseBindingSource(stream: ApplicationStreamNode): string {
  return `{ kind: 'applicationDatabase', name: ${JSON.stringify(stream.database.name)}, provider: { kind: 'postgres' }, schema: {} }`;
}

function generatedWorkflowCapabilities(contract: WorkflowContract): string {
  return contract.capabilities.map((provider) => {
    if (provider.interface === 'AI') {
      const nativeAI = contract.nativeAI;
      if (!nativeAI) {
        throw new Error(`Workflow worker ${contract.worker.id} AI capability has no native runtime contract.`);
      }
      const access = nativeAI.conversationAccess;
      return `{
  const configuredProvider = ${JSON.stringify(nativeAI.providerConfig)};
  const selectedProvider = configuredProvider.kind === 'application-provider-selection'
    ? configuredProvider.cases?.[requiredEnv('APPLIK8S_NATIVE_AI_SELECTION')] ?? configuredProvider.default
    : configuredProvider;
  if (!selectedProvider || typeof selectedProvider !== 'object') {
    throw new Error('Native AI task capability has no selected provider.');
  }
  if (!nativeAIStateSql) throw new Error('Native AI task capability requires durable conversation storage.');
  const nativeAIConversationStore = createPostgresApplicationConversationStore({
    sql: nativeAIStateSql,
    ${access ? `access: { setting: ${JSON.stringify(access.setting)} },` : ''}
  });
  capabilities.AI = defineApplicationTaskCapabilityFactory((binding) => {
    if (binding.authority.kind !== 'admitted-task') {
      throw new Error('Native AI task capability requires compiler-admitted task authority.');
    }
    const trustedContext = binding.invocation.trustedContext?.values ?? {};
    const persistence = createApplicationTanStackConversationPersistence({
      store: nativeAIConversationStore,
      principalScope: applicationAIConversationPrincipalScope(binding.authority.principal, trustedContext),
    });
    return createApplicationTanStackTaskCapability({
      persistenceMiddleware: withApplicationTanStackPersistence(persistence),
      execution: {
        operationId: binding.task.contractId + '@' + binding.task.contractVersion,
        invocationId: binding.invocation.invocationId,
        idempotencyKey: binding.invocation.idempotencyKey,
        attempt: binding.invocation.attempt,
        ...(binding.invocation.correlationId ? { correlationId: binding.invocation.correlationId } : {}),
        ...(binding.invocation.causationId ? { causationId: binding.invocation.causationId } : {}),
        ...(binding.invocation.traceparent ? { traceparent: binding.invocation.traceparent } : {}),
        signal: binding.invocation.signal,
      },
      runTaskEffect: (effect, invoke) => directTaskEffectScope.run(effect, invoke),
      adapter: (model) => applicationAITextAdapter(nativeAITaskProvider(selectedProvider, model)),
    });
  });
}`;
    }
    if (provider.interface !== 'StructuredGeneration') throw new Error(`Workflow worker ${contract.worker.id} has no runtime adapter for capability ${provider.interface}.`);
    const config = provider.config ?? {};
    const selection = structuredGenerationSelection(config);
    if (selection) {
      const candidates = JSON.stringify({ cases: selection.cases, default: selection.default });
      return `{
  const selection = ${candidates};
  const selector = requiredEnv('APPLIK8S_STRUCTURED_GENERATION_SELECTION');
  const selected = Object.prototype.hasOwnProperty.call(selection.cases, selector) ? selection.cases[selector] : selection.default;
  if (selected.kind === 'structured-generation-deterministic') {
    capabilities.StructuredGeneration = createDeterministicStructuredGenerationCapability({ output: selected.output, inputUnits: selected.inputUnits, outputUnits: selected.outputUnits });
  } else if (selected.kind === 'structured-generation-http') {
    const credentialRequired = Boolean(selected.credentialSecret);
    const apiKey = credentialRequired ? requiredEnv('APPLIK8S_STRUCTURED_GENERATION_API_KEY') : process.env.APPLIK8S_STRUCTURED_GENERATION_API_KEY;
    capabilities.StructuredGeneration = createHttpStructuredGenerationCapability({ endpoint: requiredEnv('APPLIK8S_STRUCTURED_GENERATION_ENDPOINT'), ...(apiKey ? { apiKey } : {}), authorization: process.env.APPLIK8S_STRUCTURED_GENERATION_AUTHORIZATION ?? selected.authorization ?? 'bearer', defaultProfile: process.env.APPLIK8S_STRUCTURED_GENERATION_DEFAULT_PROFILE || selected.defaultProfile, timeoutSeconds: selected.timeoutSeconds ?? 45, maxResponseBytes: selected.maxResponseBytes ?? 1000000, allowInsecureHttp: selected.allowInsecureHttp === true });
  } else {
    throw new Error('Unsupported selected StructuredGeneration provider ' + JSON.stringify(selected?.kind));
  }
}`;
    }
    if (provider.implementation === 'structured-generation-deterministic') {
      return `capabilities.StructuredGeneration = createDeterministicStructuredGenerationCapability(${JSON.stringify({
        output: objectConfig(config.output),
        inputUnits: numberConfig(config.inputUnits),
        outputUnits: numberConfig(config.outputUnits),
      })});`;
    }
    if (provider.implementation !== 'structured-generation-http') throw new Error(`StructuredGeneration provider ${provider.id} has unsupported implementation ${provider.implementation}.`);
    return `capabilities.StructuredGeneration = createHttpStructuredGenerationCapability({ endpoint: requiredEnv('APPLIK8S_STRUCTURED_GENERATION_ENDPOINT'), ...(process.env.APPLIK8S_STRUCTURED_GENERATION_API_KEY ? { apiKey: process.env.APPLIK8S_STRUCTURED_GENERATION_API_KEY } : {}), authorization: process.env.APPLIK8S_STRUCTURED_GENERATION_AUTHORIZATION ?? ${JSON.stringify(stringConfig(config.authorization) || 'bearer')}, defaultProfile: process.env.APPLIK8S_STRUCTURED_GENERATION_DEFAULT_PROFILE || ${JSON.stringify(stringConfig(config.defaultProfile))}, timeoutSeconds: ${numberConfig(config.timeoutSeconds) || 45}, maxResponseBytes: ${numberConfig(config.maxResponseBytes) || 1_000_000}, allowInsecureHttp: ${String(config.allowInsecureHttp === true)} });`;
  }).join('\n');
}

export function hatchetSingleFileHeartbeatPlugin(): Plugin {
  const namespace = 'applik8s-hatchet-heartbeat';
  return {
    name: 'applik8s-hatchet-single-file-heartbeat',
    setup(context) {
      context.onResolve({ filter: /heartbeat\/heartbeat-controller(?:\.js)?$/ }, () => ({ path: 'heartbeat-controller', namespace }));
      context.onLoad({ filter: /.*/, namespace }, () => ({
        loader: 'js',
        contents: `
export const STOP_HEARTBEAT = 'stop';
export class Heartbeat {
  constructor(client, workerId) {
    this.client = client.client;
    this.workerId = workerId;
    this.logger = client.config.logger('HeartbeatController', client.config.log_level);
    this.running = false;
  }
  async beat() {
    if (this.running) return;
    this.running = true;
    try {
      await this.client.heartbeat({ workerId: this.workerId, heartbeatAt: new Date() });
    } catch (error) {
      this.logger.error('Heartbeat failed: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      this.running = false;
    }
  }
  async start() {
    if (this.timer) return;
    await this.beat();
    this.timer = setInterval(() => { void this.beat(); }, 4000);
    this.timer.unref?.();
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
`,
      }));
    },
  };
}
