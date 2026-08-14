// typecast-file-boundary: Workflow source generation turns validated contracts into deterministic, bundle-ready TypeScript modules.
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ApplicationStreamNode, ApplicationTaskHandlerNode, ApplicationWorkflowHandlerNode } from '@applik8s/core';
import type { Plugin } from 'esbuild';
import { generatedCallbackFactoryModule } from '../application-callback-module.js';
import { applicationSignalGrantPermissionId } from '../application-operations/index.js';
import { structuredGenerationSelection, type WorkflowContract, type WorkflowFunctionNativeTransactionContract, type WorkflowOperationAliasContract, type WorkflowTaskObjectContract, type WorkflowTaskProjectionContract } from './contracts.js';
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

export function generatedWorkerSource(contract: WorkflowContract): string {
  const handlers = [...contract.tasks.map((entry) => entry.handler), ...contract.workflows.map((entry) => entry.handler)];
  const handlerImports = handlers
    .map((handler) => `import { createHandler as ${handlerVariable(handler.id)} } from ${JSON.stringify(`./${handlerModuleFile(handler.id)}`)};`)
    .concat(contract.tasks.flatMap(({ handler }) => handler.operationPrincipalSource
      ? [`import { principal as ${operationPrincipalVariable(handler.id)} } from ${JSON.stringify(`./${operationPrincipalModuleFile(handler.id)}`)};`]
      : []))
    .concat(uniqueWorkflowProjectionEffects(contract).flatMap((effect) => workflowProjectionCallbackImports(effect)))
    .join('\n');
  const taskDeclarations = contract.tasks.map(({ handler, task }) => {
    const errors = Object.fromEntries(task.contract.errors.map((error) => [error.name, error.schema.jsonSchema]));
    const capabilities = (handler.capabilities ?? []).map((reference) => reference.interface);
    const operations = contract.operationEffects?.aliases[handler.id] ?? {};
    const queries = contract.queryEffects?.aliases[handler.id] ?? {};
    const projections = contract.projectionEffects?.aliases[handler.id] ?? {};
		const objects = contract.objectEffects?.aliases[handler.id] ?? {};
    const principal = handler.serviceIdentity
      ? JSON.stringify({
          id: handler.serviceIdentity.id,
          authorizationVersion: contract.operationCatalog?.revision ?? 'canonical-authority',
        })
      : handler.operationPrincipalSource
        ? `${operationPrincipalVariable(handler.id)}(validInput)`
        : 'undefined';
    const functionNativeTransaction = contract.functionNativeTransactions?.find(
      (transaction) => transaction.taskHandlerId === handler.id,
    );
    const directBindings = nestedCallbackBindingsSource([
      ...(handler.operations ?? []).map((binding) => ({
        path: binding.alias,
        value: `execution.operations[${JSON.stringify(binding.alias)}]`,
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
        ? `withApplicationNativeModelReadClients(await functionNativeTaskReadClients(${JSON.stringify(handler.id)}), () => `
        : `withApplicationNativeModelTransactionRuntime(functionNativeTaskRuntime(${JSON.stringify(handler.id)}, context), async () => withApplicationNativeModelReadClients(await functionNativeTaskReadClients(${JSON.stringify(handler.id)}), () => `;
    const functionNativeRuntimeClose = !functionNativeTransaction
      ? ''
      : functionNativeTransaction.mode === 'read'
        ? ')'
        : '))';
    const durableSignalTask = (handler.signalBindings?.length ?? 0) > 0;
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
  fn: async (input, context) => {
    const validInput = validate(${JSON.stringify(task.contract.input.jsonSchema)}, input, ${JSON.stringify(`${task.name}.input`)});
    const principal = await canonicalTaskPrincipal(${principal}, context);
    const execution = taskContext(context, ${JSON.stringify(task.name)}, ${JSON.stringify(errors)}, ${JSON.stringify(capabilities)}, ${workflowOperationAliasesSource(operations)}, ${JSON.stringify(queries)}, ${JSON.stringify(projections)}, ${JSON.stringify(objects)}, principal, validInput, ${handler.executionTimeoutSeconds});
    const workflowSignals = workflowSignalApi(context, execution);
    const authoredHandler = ${handlerVariable(handler.id)}(${directBindings});
	    const output = await ${functionNativeRuntime}directOperationScope.run(directApplicationRuntime(execution), () => directObjectScope.run((binding) => execution.objects[binding.name], () => directProjectionScope.run((binding) => execution.projections[binding.name], () => authoredHandler(validInput, execution))))${functionNativeRuntimeClose};
    return validate(${JSON.stringify(task.contract.output.jsonSchema)}, output, ${JSON.stringify(`${task.name}.output`)});
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
  fn: async (input, context) => {
    const validInput = validate(${JSON.stringify(workflow.contract.input.jsonSchema)}, input, ${JSON.stringify(`${workflow.name}.input`)});
    const execution = workflowContext(context, ${JSON.stringify(workflow.name)}, ${JSON.stringify(taskBindings)}, ${JSON.stringify(childBindings)}, ${JSON.stringify(errors)}, declarations);
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
});`;
  }).join('\n');
  const declarationNames = [...contract.tasks.map(({ task }) => jsName(task.id)), ...contract.workflows.map(({ workflow }) => jsName(workflow.id))];
  const declarationEntries = [
    ...contract.tasks.map(({ task }) => `${JSON.stringify(task.name)}: ${jsName(task.id)}`),
    ...contract.workflows.map(({ workflow }) => `${JSON.stringify(workflow.name)}: ${jsName(workflow.id)}`),
  ];
  const cronRegistrations = contract.workflows.flatMap(({ workflow }) => workflow.triggers.crons.map((cron) => `${jsName(workflow.id)}.cron(${JSON.stringify(cron.name)}, ${JSON.stringify(cron.expression)}, ${JSON.stringify(cron.input)})`));
  const capabilityImports = contract.capabilities.length > 0
    ? `import { createDeterministicStructuredGenerationCapability, createHttpStructuredGenerationCapability } from '@applik8s/applik8s/structured-generation-runtime';`
    : '';
  const operationImports = contract.operationEffects || contract.signalEffects
    ? `${contract.operationEffects ? "import { canonicalApplicationTaskServicePrincipal, createApplicationTaskOperationRuntime } from '@applik8s/applik8s/task-operation-runtime';\n" : ''}import { createApplicationOperationAuthorityRuntime } from '@applik8s/operations';
import postgres from 'postgres';
${contract.operationEffects ? "import { createJetStreamEventLog } from '@applik8s/runtime-nats/event-log';" : ''}`
    : '';
  const queryImports = contract.queryEffects
    ? `import { createApplicationTaskQueryRuntime } from '@applik8s/applik8s/task-query-runtime';`
    : '';
  const projectionImports = contract.projectionEffects
    ? `import { createPostgresApplicationProjectionSnapshotSource, createPostgresApplicationStream, createValkeyOnlineProjectionWriter, retireApplicationOnlineProjectionGeneration, runApplicationOnlineProjectionRebuild } from '@applik8s/applik8s/projection-worker-runtime';`
    : '';
	const objectImports = contract.objectEffects
		? `import { createS3ApplicationObjectStorageRuntime } from '@applik8s/runtime-s3';`
		: '';
  const signalImports = contract.signalEffects
    ? `import { createApplicationWorkflowSignalRuntime, createPostgresApplicationSignalStore, runApplicationSignalOutboxRelay } from '@applik8s/applik8s/signal-runtime';
import { applicationOperationInputDigest } from '@applik8s/applik8s/operation-runtime';`
    : '';
  const functionNativeImports = contract.functionNativeTransactions
    ? `import { applicationPostgresModelReadClients, createApplicationFunctionNativeEventHandle, editApplicationNativeModelObject, executeFunctionNativePostgresModelEdit, findApplicationNativeModelObjects, getApplicationNativeModelObject, requireApplicationNativeModelObject, withApplicationNativeModelReadClients, withApplicationNativeModelTransactionRuntime } from '@applik8s/applik8s/stream-worker-runtime';`
    : '';
  const gatewayImports = contract.gatewayCallers.length > 0
    ? `import { createCipheriv, createDecipheriv, createHash as createNodeHash, randomBytes } from 'node:crypto';
import { AuthenticationV1Api, KubeConfig } from '@kubernetes/client-node';
import { createHatchetWorkflowRuntimeFromClient, observeHatchetWorkflowRun } from '@applik8s/runtime-hatchet';`
    : '';
  const capabilityInitializers = generatedWorkflowCapabilities(contract);
  const operationInitializer = generatedWorkflowOperationRuntime(contract);
  const queryInitializer = generatedWorkflowQueryRuntime(contract);
  const projectionInitializer = generatedWorkflowProjectionRuntime(contract);
	const objectInitializer = generatedWorkflowObjectRuntime(contract);
  const signalInitializer = generatedWorkflowSignalRuntime(contract);
  const functionNativeInitializer =
    generatedWorkflowFunctionNativeTransactions(contract);
  const gatewayInitializer = generatedWorkflowGateway(contract);
  return `import { AsyncLocalStorage } from 'node:async_hooks';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { connect as connectTcp } from 'node:net';
import { HatchetClient } from '@hatchet-dev/typescript-sdk/v1/index.js';
	import { installApplicationObjectStorageRuntimeResolver, installApplicationProjectionRuntimeResolver, installApplicationWorkflowRuntimeResolver } from '@applik8s/applik8s/workflow-runtime-resolvers';
import { applicationWorkflowCausalPrincipalMetadata } from '@applik8s/applik8s/workflow-runtime';
import { installApplicationOperationRuntimeResolver } from '@applik8s/client';
import { normalizeSchema } from '@applik8s/sdk';
${capabilityImports}
${operationImports}
${queryImports}
${projectionImports}
${objectImports}
${signalImports}
${functionNativeImports}
${gatewayImports}
${handlerImports}

if (process.argv.includes('--credential-preflight')) {
  await waitForWorkflowCredential();
  process.exit(0);
}

const hatchet = HatchetClient.init();
const declarations = Object.create(null);
	const directWorkflowScope = new AsyncLocalStorage();
	const directOperationScope = new AsyncLocalStorage();
	const directObjectScope = new AsyncLocalStorage();
	const directProjectionScope = new AsyncLocalStorage();
	installApplicationWorkflowRuntimeResolver(() => directWorkflowScope.getStore());
	installApplicationOperationRuntimeResolver(() => directOperationScope.getStore());
	installApplicationObjectStorageRuntimeResolver((binding) => directObjectScope.getStore()?.(binding));
	installApplicationProjectionRuntimeResolver((binding) => directProjectionScope.getStore()?.(binding));
const capabilities = Object.create(null);
${capabilityInitializers}
${operationInitializer}
${queryInitializer}
${projectionInitializer}
${objectInitializer}
${signalInitializer}
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

async function canonicalTaskPrincipal(principal, context) {
  if (!principal || !operationAuthority) return principal;
  const invocationId = String(context.workflowRunId?.() ?? context.stepRunId?.() ?? 'unknown');
  const authorityRevision = await operationAuthority.authorityRevision();
  const causalPrincipal = workflowCausalPrincipal(context);
  return canonicalApplicationTaskServicePrincipal(principal, {
    application: ${JSON.stringify(contract.graphName)},
    workerId: ${JSON.stringify(contract.worker.id)},
    catalogRevision: ${JSON.stringify(contract.operationCatalog?.revision ?? 'no-operation-catalog')},
    authorityRevision,
    invocationId,
    contextSecret: requiredEnv('APPLIK8S_TASK_OPERATION_CONTEXT_SECRET'),
    ...(causalPrincipal ? { causalPrincipal } : {}),
  });
}

function workflowCausalPrincipal(context) {
  const data = typeof context.additionalMetadata === 'function' ? context.additionalMetadata() : {};
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

function metadata(context) {
  const invocationId = String(context.workflowRunId?.() ?? context.stepRunId?.() ?? 'unknown');
  const data = typeof context.additionalMetadata === 'function' ? context.additionalMetadata() : {};
  let trustedContext;
  if (data?.['applik8s.trusted-context']) {
    try { trustedContext = JSON.parse(data['applik8s.trusted-context']); } catch { throw new Error('applik8s-workflow-trusted-context-invalid'); }
    if (!trustedContext || typeof trustedContext !== 'object' || !trustedContext.values || typeof trustedContext.digest !== 'string') throw new Error('applik8s-workflow-trusted-context-invalid');
  }
  const causalPrincipal = workflowCausalPrincipal(context);
  return { invocationId, idempotencyKey: invocationId, attempt: Number(context.retryCount?.() ?? 0) + 1, correlationId: data?.['applik8s.correlation-id'], causationId: data?.['applik8s.causation-id'], traceparent: data?.traceparent, ...(trustedContext ? { trustedContext } : {}), ...(causalPrincipal ? { causalPrincipal } : {}), signal: context.abortController?.signal ?? new AbortController().signal };
}
function declaredFailure(contractName, errorSchemas, name, payload) {
  const schema = errorSchemas[name];
  if (!schema) throw new Error('Unknown declared durable error ' + JSON.stringify(name) + ' for ' + contractName);
  const validPayload = validate(schema, payload, contractName + '.errors.' + name);
  throw new Error('applik8s-durable-error:' + JSON.stringify({ name, payload: validPayload }));
}
function taskContext(context, contractName, errorSchemas, declaredCapabilities, declaredOperations, declaredQueries, declaredProjections, declaredObjects, principal, executionSource, executionTimeoutSeconds) {
  const raw = metadata(context);
  const base = {
    ...raw,
    deadline: new Date(Date.now() + executionTimeoutSeconds * 1000).toISOString(),
    cancellationRevision: 'active:' + raw.invocationId,
  };
  return {
    ...base,
    operations: operationRuntime ? operationRuntime.bind(declaredOperations, principal, base, executionSource) : Object.freeze({}),
    queries: queryRuntime ? queryRuntime.bind(declaredQueries, principal, base) : Object.freeze({}),
    projections: Object.freeze(Object.fromEntries(Object.entries(declaredProjections).map(([alias, id]) => {
      const runtime = projectionRuntimes[id];
      if (!runtime) throw new Error('Task ' + contractName + ' attempted to use undeclared projection ' + JSON.stringify(alias));
      return [alias, runtime];
    }))),
		objects: Object.freeze(Object.fromEntries(Object.entries(declaredObjects).map(([alias, id]) => {
			const runtime = objectRuntimes[id];
			if (!runtime) throw new Error('Task ' + contractName + ' attempted to use undeclared object store ' + JSON.stringify(alias));
			return [alias, runtime];
		}))),
    use: (token) => {
      const name = token?.name;
      if (typeof name !== 'string' || !declaredCapabilities.includes(name)) throw new Error('Task ' + contractName + ' attempted to use undeclared capability ' + JSON.stringify(name));
      const capability = capabilities[name];
      if (!capability) throw new Error('Task ' + contractName + ' capability ' + name + ' is not configured');
      return capability;
    },
    fail: (name, payload) => declaredFailure(contractName, errorSchemas, name, payload),
  };
}
function directApplicationRuntime(execution) {
  return {
    execute(operation, input) {
      const invoke = execution.operations[operation.id];
      if (!invoke) throw new Error('Workflow step attempted to call undeclared operation ' + JSON.stringify(operation.id));
      return invoke(input);
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
  return { ...(options?.idempotencyKey ? { key: options.idempotencyKey } : {}), ...(options ? { additionalMetadata: Object.fromEntries(Object.entries({ 'applik8s.idempotency-key': options.idempotencyKey, 'applik8s.tenant': options.tenant, 'applik8s.correlation-id': options.correlationId, 'applik8s.causation-id': options.causationId, traceparent: options.traceparent, 'applik8s.trusted-context': options.trustedContext ? JSON.stringify(options.trustedContext) : undefined, 'applik8s.causal-principal': causalPrincipal ? JSON.stringify(causalPrincipal) : undefined }).filter(([, value]) => typeof value === 'string')) } : {}) };
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
function workflowContext(context, workflowName, taskBindings, childBindings, errorSchemas, registry) {
  const base = metadata(context);
  return {
    ...base,
    task: (alias, input, options) => context.spawnChild(resolveDeclaration(registry, taskBindings, 'task', alias), input, childOptions(childInvocationMetadata(base, options))),
    child: (alias, input, options) => context.spawnChild(resolveDeclaration(registry, childBindings, 'child workflow', alias), input, childOptions(childInvocationMetadata(base, options))),
    sleep: async (duration) => { await context.sleepFor(duration); },
    waitFor: (signal, options = {}) => context.waitForEvent(workflowName + '.' + signal, options.expression, undefined, options.scope ?? base.invocationId, options.lookback),
    now: () => context.now(),
    cancelled: () => context.cancelled,
    rethrowIfCancelled: (error) => context.rethrowIfCancelled(error),
    fail: (name, payload) => declaredFailure(workflowName, errorSchemas, name, payload),
  };
}
function directWorkflowRuntime(context, execution, taskBindings, childBindings, registry) {
  const bindings = { ...taskBindings, ...childBindings };
  // Compiler-generated aliases are an internal graph detail. Direct callable
  // handles identify their dependency by the durable contract ID itself.
  for (const contract of Object.values(bindings)) bindings[contract] = contract;
  return {
    run: (contract, input, metadata) => {
      const declaration = bindings[contract];
      if (!declaration) throw new Error('Workflow attempted to call undeclared durable dependency ' + JSON.stringify(contract));
      return context.spawnChild(
        registry[declaration] ?? declaration,
        input,
        childOptions(childInvocationMetadata(execution, metadata)),
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
  if (signalStore) await signalStore.close();
  await Promise.all(projectionSources.map((source) => source.close()));
  if (gatewayServer) await new Promise((resolve) => gatewayServer.close(resolve));
  server.close();
}

process.once('SIGTERM', () => { shutdown().catch((error) => { console.error(error); process.exitCode = 1; }); });
process.once('SIGINT', () => { shutdown().catch((error) => { console.error(error); process.exitCode = 1; }); });
await running;
`;
}

function generatedWorkflowGateway(contract: WorkflowContract): string {
  if (contract.gatewayCallers.length === 0) return 'const gatewayServer = undefined;';
  const allowedContracts = [...new Set(contract.gatewayCallers.flatMap((caller) => caller.contracts))].sort();
  const inputSchemas = Object.fromEntries([
    ...contract.tasks.map(({ task }) => [task.name, task.contract.input.jsonSchema]),
    ...contract.workflows.map(({ workflow }) => [workflow.name, workflow.contract.input.jsonSchema]),
  ].filter(([id]) => allowedContracts.includes(String(id))));
  const callerSpecifications = contract.gatewayCallers.map((caller) => ({
    namespace: caller.namespace.startsWith('${')
      ? '__APPLIK8S_RUNTIME_NAMESPACE__'
      : caller.namespace,
    serviceAccount: caller.serviceAccount,
  }));
  return `
const gatewayContracts = new Set(${JSON.stringify(allowedContracts)});
const gatewayInputSchemas = ${JSON.stringify(inputSchemas)};
const gatewayRuntimeNamespace = requiredEnv('APPLIK8S_WORKFLOW_NAMESPACE');
const gatewayCallers = new Set(${JSON.stringify(callerSpecifications)}.map((caller) =>
  'system:serviceaccount:'
    + (caller.namespace === '__APPLIK8S_RUNTIME_NAMESPACE__' ? gatewayRuntimeNamespace : caller.namespace)
    + ':' + caller.serviceAccount
));
const gatewayKubeConfig = new KubeConfig();
gatewayKubeConfig.loadFromCluster();
const gatewayAuthentication = gatewayKubeConfig.makeApiClient(AuthenticationV1Api);
const gatewayRuntime = createHatchetWorkflowRuntimeFromClient(hatchet);
const gatewaySealingKey = createNodeHash('sha256')
  .update('applik8s.workflow-gateway/v1alpha1\\0')
  .update(requiredEnv('HATCHET_CLIENT_TOKEN'))
  .digest();

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
    body: { apiVersion: 'authentication.k8s.io/v1', kind: 'TokenReview', spec: { token } },
  });
  const username = review.status?.authenticated === true ? review.status.user?.username : undefined;
  if (typeof username !== 'string' || !gatewayCallers.has(username)) throw new Error('unauthorized');
  return username;
}
function sealGatewayReference(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', gatewaySealingKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ protocol: 'applik8s.workflow-run-reference/v1alpha1', ...value }), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}
function openGatewayReference(reference, expectedContract) {
  const bytes = Buffer.from(reference, 'base64url');
  if (bytes.length < 29) throw new Error('invalid-reference');
  const decipher = createDecipheriv('aes-256-gcm', gatewaySealingKey, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  const value = JSON.parse(Buffer.concat([
    decipher.update(bytes.subarray(28)),
    decipher.final(),
  ]).toString('utf8'));
  if (
    value?.protocol !== 'applik8s.workflow-run-reference/v1alpha1'
    || value.contract !== expectedContract
    || typeof value.runId !== 'string'
    || typeof value.admittedAt !== 'string'
  ) throw new Error('invalid-reference');
  return value;
}
async function handleGatewayRequest(request, response) {
  try {
    if (!ready || stopping) return gatewayJson(response, 503, { error: 'workflow-gateway-unavailable' });
    const gatewayCaller = await authenticateGatewayRequest(request);
    const url = new URL(request.url ?? '/', 'http://workflow-gateway.invalid');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts[0] !== 'v1' || parts[1] !== 'workflows' || parts[3] !== 'runs') {
      return gatewayJson(response, 404, { error: 'not-found' });
    }
    const contract = parts[2];
    if (!contract || !gatewayContracts.has(contract)) return gatewayJson(response, 403, { error: 'contract-not-authorized' });
    if (request.method === 'POST' && parts.length === 4) {
      const idempotencyKey = request.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
        return gatewayJson(response, 400, { error: 'idempotency-key-required' });
      }
      const body = await gatewayBody(request);
      const input = body.input;
      if (!input || typeof input !== 'object' || Array.isArray(input)) return gatewayJson(response, 400, { error: 'invalid-input' });
      const validInput = validate(gatewayInputSchemas[contract], input, contract + '.input');
      const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? body.metadata
        : {};
      const run = await gatewayRuntime.start(contract, validInput, {
        ...metadata,
        idempotencyKey,
        [applicationWorkflowCausalPrincipalMetadata]: {
          id: gatewayCaller,
          identity: {
            id: 'identity:kubernetes:serviceaccount:' + gatewayCaller.slice('system:serviceaccount:'.length),
            kind: 'service',
            issuer: 'kubernetes',
            subject: gatewayCaller,
          },
          grantIds: [],
        },
      });
      const admittedAt = new Date().toISOString();
      return gatewayJson(response, 202, {
        id: sealGatewayReference({ contract, runId: run.id, admittedAt }),
        admittedAt,
      });
    }
    if (parts.length === 5 && (request.method === 'GET' || request.method === 'DELETE')) {
      const reference = openGatewayReference(parts[4], contract);
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
      error: unauthorized ? 'unauthorized' : error instanceof Error ? error.message.slice(0, 256) : 'unknown',
    }));
    return gatewayJson(response, unauthorized ? 401 : 400, { error: unauthorized ? 'unauthorized' : 'request-rejected' });
  }
}
const gatewayServer = createServer((request, response) => {
  void handleGatewayRequest(request, response);
});
gatewayServer.listen(${contract.worker.deployment.healthPort + 1}, '0.0.0.0');
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
  if (!contract.operationCatalog) {
    throw new Error(
      `Workflow worker ${contract.worker.id} signals require the canonical operation catalog.`,
    );
  }
  const issueOperations = Object.fromEntries(
    [...definitions.values()].map((binding) => {
      const id = `applik8s://signals/${binding.id}/operations/issue`;
      const operation = contract.operationCatalog!.operations.find(
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
          !contract.operationCatalog!.operations.some(
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
  const workloadIdentity = {
    id: `identity:${contract.graphName}:workload:${contract.worker.id}`,
    kind: 'workload',
    issuer: `applik8s://${contract.graphName}`,
    subject: contract.worker.id,
  } as const;
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
const signalWorkloadIdentity = Object.freeze(${JSON.stringify(workloadIdentity)});
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
      const envelope = {
        apiVersion: 'applik8s.workloadAuthority/v1alpha1',
        id: 'signal-issue:' + request.definition.id + ':' + authorityContext.signalId,
        workloadIdentity: signalWorkloadIdentity,
        operationId: operation.id,
        catalogRevision: ${JSON.stringify(contract.operationCatalog.revision)},
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
        const principal = await operationAuthority.admitExecutionPrincipal({
          executionKind: 'workflow',
          executionId: execution.invocationId,
          attempt: execution.attempt,
          workloadIdentity: signalWorkloadIdentity,
          causalPrincipalId:
            execution.causalPrincipal?.id ?? signalWorkloadIdentity.id,
          causalPrincipal:
            execution.causalPrincipal?.identity ?? signalWorkloadIdentity,
          causalGrantIds: execution.causalPrincipal?.grantIds ?? [],
          envelopes: [envelope],
          trustedContextDigest,
          audience: envelope.audiences,
          deadline: new Date(Date.now() + 60_000).toISOString(),
          cancellationRevision: 'active:' + execution.invocationId,
        });
        const authorized = await operationAuthority.authorizeExecution({
          principal,
          envelope,
          target: envelope.restrictions.target,
          audience: envelope.audiences[0],
          transport: 'workflow',
          inputDigest: applicationOperationInputDigest(request.input),
          trustedContextDigest,
          currentCancellationRevision: principal.cancellationRevision,
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
              issuedBy: signalWorkloadIdentity,
              lifecycleOwner: 'signal:' + authorityContext.signalId,
              reason: 'Exact-instance access created by workflow.emitSignal(..., { grantAccessTo }).',
              expiresAt: request.expiresAt,
              catalogRevision: ${JSON.stringify(contract.operationCatalog.revision)},
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
    const identifier = functionNativeTaskBindingRoot(
      binding.identifier,
      transaction.taskHandlerId,
    );
    const target = binding.model.id;
    const existing = bindings.get(identifier);
    if (existing && existing.target !== target) {
      throw new Error(
        `Function-native workflow task ${transaction.taskHandlerId} callback identifier ${identifier} is ambiguous between ${existing.target} and ${target}.`,
      );
    }
    bindings.set(identifier, {
      target,
      expression: `functionNativeModelHandle(${JSON.stringify(binding.model.name)})`,
    });
  }
  for (const binding of transaction.eventBindings) {
    const identifier = functionNativeTaskBindingRoot(
      binding.identifier,
      transaction.taskHandlerId,
    );
    const target = binding.event.id;
    const existing = bindings.get(identifier);
    if (existing && existing.target !== target) {
      throw new Error(
        `Function-native workflow task ${transaction.taskHandlerId} callback identifier ${identifier} is ambiguous between ${existing.target} and ${target}.`,
      );
    }
    bindings.set(identifier, {
      target,
      expression: `createApplicationFunctionNativeEventHandle(${JSON.stringify(`${binding.event.contract.name}.${binding.event.contract.version}`)}, { payload: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', uri: ${JSON.stringify(`generated:${binding.event.name}.payload`)} }, schema: ${JSON.stringify(binding.event.contract.payload.jsonSchema)} } })`,
    });
  }
  return [...bindings.entries()]
    .map(([identifier, value]) => ({ identifier, expression: value.expression }))
    .sort((left, right) => left.identifier.localeCompare(right.identifier));
}

function functionNativeTaskBindingRoot(
  identifier: string,
  owner: string,
): string {
  const root = identifier.split('.')[0]?.trim();
  if (!root || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(root)) {
    throw new Error(
      `Function-native workflow task ${owner} callback binding ${JSON.stringify(identifier)} does not have a serializable root identifier.`,
    );
  }
  return root;
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
function functionNativeTaskReadClients(handlerId) {
  const transaction = functionNativeTaskTransactions[handlerId];
  if (!transaction) throw new Error('No function-native read scope was declared for task handler ' + handlerId + '.');
  return applicationPostgresModelReadClients(transaction.databaseUrl, transaction.models);
}
function functionNativeTaskRuntime(handlerId, context) {
  const transaction = functionNativeTaskTransactions[handlerId];
  if (!transaction) throw new Error('No function-native transaction was declared for task handler ' + handlerId + '.');
  const delivery = metadata(context);
  const durableId = handlerId + ':' + delivery.invocationId;
  return Object.freeze({
    edit: request => executeFunctionNativePostgresModelEdit({
      bindingId: handlerId,
      model: transaction.model,
      models: transaction.models,
      outbox: transaction.outbox,
      databaseUrl: transaction.databaseUrl,
      delivery: {
        id: durableId,
        idempotencyKey: handlerId + ':' + delivery.idempotencyKey,
        correlationId: delivery.correlationId ?? durableId,
        causationId: delivery.causationId ?? delivery.invocationId,
        attempt: delivery.attempt,
        ...(delivery.trustedContext ? { context: delivery.trustedContext } : {}),
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

export function generatedHandlerModule(handler: ApplicationTaskHandlerNode | ApplicationWorkflowHandlerNode): string {
  const injectedIdentifiers = (handler.kind === 'taskHandler'
    ? [
        ...(handler.operations ?? []).map((binding) => binding.alias),
        ...(handler.queries ?? []).map((binding) => binding.alias),
        ...(handler.projections ?? []).map((binding) => binding.alias),
        ...(handler.objects ?? []).map((binding) => binding.alias),
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
  return generatedCallbackFactoryModule({
    source: handler.handlerSource,
    ...(handler.handlerDependencies
      ? { dependencies: handler.handlerDependencies }
      : {}),
    injectedIdentifiers,
    exportName: 'createHandler',
  });
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
      continue;
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
    leaf.direct = entry.value;
    roots.set(root, current);
  }

  const source = (node: BindingTree): string => {
    if (node.direct && node.children.size === 0) {
      return node.direct;
    }
    const nested = [...node.children.entries()]
      .map(
        ([property, child]) =>
          `${JSON.stringify(property)}: ${source(child)}`,
      )
      .join(', ');
    return `{ ${nested} }`;
  };
  const properties = [...roots.entries()].map(
    ([root, value]) => `${JSON.stringify(root)}: ${source(value)}`,
  );
  return `{ ${properties.join(', ')} }`;
}

export function generatedOperationPrincipalModule(handler: ApplicationTaskHandlerNode): string {
  if (!handler.operationPrincipalSource) throw new Error(`Workflow task ${handler.id} has no operation-principal source.`);
  const dependencies = handler.operationPrincipalDependencies?.source
    ? absoluteDependencyImports(handler.operationPrincipalDependencies.source, handler.operationPrincipalDependencies.resolveDir)
    : '';
  return `${dependencies}${dependencies ? '\n\n' : ''}export const principal = (${handler.operationPrincipalSource});\n`;
}

function generatedWorkflowOperationRuntime(contract: WorkflowContract): string {
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
  const authorityDatabaseEnvironment = [...databaseEnvironments][0]!;
  const commands = operations.map(({ handler, command, model }) => `{ id: ${JSON.stringify(`${command.contract.name}.${command.contract.version}`)}, bindingId: ${JSON.stringify(handler.name)}, model: ${JSON.stringify(model.name)}, inputSchema: ${JSON.stringify(command.contract.input.jsonSchema)}, databaseUrl: requiredEnv(${JSON.stringify(model.runtime.connectionEnvName)}), key: (${handler.key.source})${handler.idempotencyKey ? `, idempotencyKey: (${handler.idempotencyKey.source})` : ''} }`).join(',\n');
  return `const operationAuthoritySql = postgres(requiredEnv(${JSON.stringify(authorityDatabaseEnvironment)}), { max: 6, idle_timeout: 20, connect_timeout: 10, prepare: false });
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
  eventLogPublisher: createJetStreamEventLog({ servers: JSON.parse(requiredEnv('APPLIK8S_NATS_SERVERS')), stream: requiredEnv('APPLIK8S_NATS_STREAM'), subjectPrefix: requiredEnv('APPLIK8S_NATS_SUBJECT_PREFIX'), connectionName: ${JSON.stringify(`applik8s-workflow-${contract.worker.name}`)}, ...(process.env.APPLIK8S_NATS_TOKEN ? { token: process.env.APPLIK8S_NATS_TOKEN } : {}), ...(process.env.APPLIK8S_NATS_USER ? { user: process.env.APPLIK8S_NATS_USER, pass: process.env.APPLIK8S_NATS_PASSWORD ?? '' } : {}) }),
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
  const queries = effects.queries.map(({ query, gateway, endpoint }) => `{ id: ${JSON.stringify(query.publicId ?? `${query.name}.${query.version}`)}, audience: ${JSON.stringify(gateway.id)}, endpoint: ${JSON.stringify(endpoint)}, inputSchema: ${JSON.stringify(query.input.jsonSchema)}, outputSchema: ${JSON.stringify(query.output.jsonSchema)}, timeoutMs: ${query.budgets.timeoutMs}, maxResultBytes: ${query.budgets.maxResultBytes} }`).join(',\n');
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

function projectionCallbackModuleFile(id: string, role: string): string { return `projection-${role}-${createHash('sha256').update(id).digest('hex').slice(0, 12)}.generated.ts`; }
function projectionCallbackVariable(id: string, role: string): string { return `projection_${role}_${createHash('sha256').update(id).digest('hex').slice(0, 12)}`; }

function workflowDatabaseBindingSource(stream: ApplicationStreamNode): string {
  return `{ kind: 'applicationDatabase', name: ${JSON.stringify(stream.database.name)}, provider: { kind: 'postgres' }, schema: {} }`;
}

function generatedWorkflowCapabilities(contract: WorkflowContract): string {
  return contract.capabilities.map((provider) => {
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
