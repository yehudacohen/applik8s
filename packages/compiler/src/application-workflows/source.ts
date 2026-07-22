// typecast-file-boundary: Workflow source generation turns validated contracts into deterministic, bundle-ready TypeScript modules.
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ApplicationStreamNode, ApplicationTaskHandlerNode, ApplicationWorkflowHandlerNode } from '@applik8s/core';
import type { Plugin } from 'esbuild';
import { structuredGenerationSelection, type WorkflowContract, type WorkflowTaskObjectContract, type WorkflowTaskProjectionContract } from './contracts.js';
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

export function generatedWorkerSource(contract: WorkflowContract): string {
  const handlers = [...contract.tasks.map((entry) => entry.handler), ...contract.workflows.map((entry) => entry.handler)];
  const handlerImports = handlers
    .map((handler) => `import { handler as ${handlerVariable(handler.id)} } from ${JSON.stringify(`./${handlerModuleFile(handler.id)}`)};`)
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
    const principal = handler.operationPrincipalSource ? `${operationPrincipalVariable(handler.id)}(validInput)` : 'undefined';
    return `
const ${jsName(task.id)} = hatchet.task({
  name: ${JSON.stringify(task.name)},
  retries: ${Math.max(0, (handler.retry.maxAttempts ?? 1) - 1)},
  backoff: { factor: ${Math.max(1, handler.retry.factor ?? 2)}, maxSeconds: ${Math.max(1, (handler.retry.maxDelayMs ?? 60_000) / 1_000)} },
  executionTimeout: ${JSON.stringify(`${handler.executionTimeoutSeconds}s`)},
  scheduleTimeout: ${JSON.stringify(`${handler.scheduleTimeoutSeconds}s`)},
  fn: async (input, context) => {
    const validInput = validate(${JSON.stringify(task.contract.input.jsonSchema)}, input, ${JSON.stringify(`${task.name}.input`)});
    const output = await ${handlerVariable(handler.id)}(validInput, taskContext(context, ${JSON.stringify(task.name)}, ${JSON.stringify(errors)}, ${JSON.stringify(capabilities)}, ${JSON.stringify(operations)}, ${JSON.stringify(queries)}, ${JSON.stringify(projections)}, ${JSON.stringify(objects)}, ${principal}));
    return validate(${JSON.stringify(task.contract.output.jsonSchema)}, output, ${JSON.stringify(`${task.name}.output`)});
  },
});`;
  }).join('\n');
  const workflowDeclarations = contract.workflows.map(({ handler, workflow }) => {
    const taskBindings = Object.fromEntries(handler.taskBindings.map((binding) => [binding.alias, contract.contractNames[binding.task.nodeId]]));
    const childBindings = Object.fromEntries(handler.childWorkflowBindings.map((binding) => [binding.alias, contract.contractNames[binding.workflow.nodeId]]));
    const errors = Object.fromEntries(workflow.contract.errors.map((error) => [error.name, error.schema.jsonSchema]));
    if (Object.values(taskBindings).some((value) => !value) || Object.values(childBindings).some((value) => !value)) throw new Error(`Workflow handler ${handler.id} contains an unresolved task or child-workflow binding.`);
    return `
const ${jsName(workflow.id)} = hatchet.durableTask({
  name: ${JSON.stringify(workflow.name)},
  fn: async (input, context) => {
    const validInput = validate(${JSON.stringify(workflow.contract.input.jsonSchema)}, input, ${JSON.stringify(`${workflow.name}.input`)});
    const output = await ${handlerVariable(handler.id)}(validInput, workflowContext(context, ${JSON.stringify(workflow.name)}, ${JSON.stringify(taskBindings)}, ${JSON.stringify(childBindings)}, ${JSON.stringify(errors)}, declarations));
    return validate(${JSON.stringify(workflow.contract.output.jsonSchema)}, output, ${JSON.stringify(`${workflow.name}.output`)});
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
  const operationImports = contract.operationEffects
    ? `import { createApplicationTaskOperationRuntime } from '@applik8s/applik8s/task-operation-runtime';`
    : '';
  const queryImports = contract.queryEffects
    ? `import { createApplicationTaskQueryRuntime } from '@applik8s/applik8s/task-query-runtime';`
    : '';
  const projectionImports = contract.projectionEffects
    ? `import { createPostgresApplicationProjectionSnapshotSource, createPostgresApplicationStream, createS3ApplicationObjectStorageRuntime, createValkeyOnlineProjectionStore, retireApplicationOnlineProjectionGeneration, runApplicationOnlineProjectionRebuild } from '@applik8s/applik8s/projection-worker-runtime';`
    : '';
	const objectImports = contract.objectEffects && !contract.projectionEffects
		? `import { createS3ApplicationObjectStorageRuntime } from '@applik8s/applik8s/reactive-runtime';`
		: '';
  const capabilityInitializers = generatedWorkflowCapabilities(contract);
  const operationInitializer = generatedWorkflowOperationRuntime(contract);
  const queryInitializer = generatedWorkflowQueryRuntime(contract);
  const projectionInitializer = generatedWorkflowProjectionRuntime(contract);
	const objectInitializer = generatedWorkflowObjectRuntime(contract);
  return `import { createServer } from 'node:http';
import { connect as connectTcp } from 'node:net';
import { HatchetClient } from '@hatchet-dev/typescript-sdk/v1/index.js';
import { normalizeSchema } from '@applik8s/sdk';
${capabilityImports}
${operationImports}
${queryImports}
${projectionImports}
${objectImports}
${handlerImports}

const hatchet = HatchetClient.init();
const declarations = Object.create(null);
const capabilities = Object.create(null);
${capabilityInitializers}
${operationInitializer}
${queryInitializer}
${projectionInitializer}
${objectInitializer}
let ready = false;
let stopping = false;
const server = createServer((request, response) => {
  const healthy = request.url === '/live' || (request.url === '/ready' && ready && !stopping);
  response.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ready, stopping }));
});
server.listen(${contract.worker.deployment.healthPort}, '0.0.0.0');

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
  if (!result.ok) throw new Error('applik8s-workflow-schema-invalid: ' + name + ': ' + result.error.message);
  return result.value;
}
function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error('Missing required workflow runtime environment variable ' + name);
  return value;
}

function metadata(context) {
  const invocationId = String(context.workflowRunId?.() ?? context.stepRunId?.() ?? 'unknown');
  const data = typeof context.additionalMetadata === 'function' ? context.additionalMetadata() : {};
  let trustedContext;
  if (data?.['applik8s.trusted-context']) {
    try { trustedContext = JSON.parse(data['applik8s.trusted-context']); } catch { throw new Error('applik8s-workflow-trusted-context-invalid'); }
    if (!trustedContext || typeof trustedContext !== 'object' || !trustedContext.values || typeof trustedContext.digest !== 'string') throw new Error('applik8s-workflow-trusted-context-invalid');
  }
  return { invocationId, idempotencyKey: invocationId, attempt: Number(context.retryCount?.() ?? 0) + 1, correlationId: data?.['applik8s.correlation-id'], causationId: data?.['applik8s.causation-id'], traceparent: data?.traceparent, ...(trustedContext ? { trustedContext } : {}), signal: context.abortController?.signal ?? new AbortController().signal };
}
function declaredFailure(contractName, errorSchemas, name, payload) {
  const schema = errorSchemas[name];
  if (!schema) throw new Error('Unknown declared durable error ' + JSON.stringify(name) + ' for ' + contractName);
  const validPayload = validate(schema, payload, contractName + '.errors.' + name);
  throw new Error('applik8s-durable-error:' + JSON.stringify({ name, payload: validPayload }));
}
function taskContext(context, contractName, errorSchemas, declaredCapabilities, declaredOperations, declaredQueries, declaredProjections, declaredObjects, principal) {
  const base = metadata(context);
  return {
    ...base,
    operations: operationRuntime ? operationRuntime.bind(declaredOperations, principal, base) : Object.freeze({}),
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

function childOptions(options) {
  return { ...(options?.idempotencyKey ? { childKey: options.idempotencyKey } : {}), ...(options ? { additionalMetadata: Object.fromEntries(Object.entries({ 'applik8s.idempotency-key': options.idempotencyKey, 'applik8s.tenant': options.tenant, 'applik8s.correlation-id': options.correlationId, 'applik8s.causation-id': options.causationId, traceparent: options.traceparent, 'applik8s.trusted-context': options.trustedContext ? JSON.stringify(options.trustedContext) : undefined }).filter(([, value]) => typeof value === 'string')) } : {}) };
}
function workflowContext(context, workflowName, taskBindings, childBindings, errorSchemas, registry) {
  const base = metadata(context);
  return {
    ...base,
    task: (alias, input, options) => context.spawnChild(resolveDeclaration(registry, taskBindings, 'task', alias), input, childOptions({ ...base, ...options, trustedContext: options?.trustedContext ?? base.trustedContext })),
    child: (alias, input, options) => context.spawnChild(resolveDeclaration(registry, childBindings, 'child workflow', alias), input, childOptions({ ...base, ...options, trustedContext: options?.trustedContext ?? base.trustedContext })),
    sleep: async (duration) => { await context.sleepFor(duration); },
    waitFor: (signal, options = {}) => context.waitForEvent(workflowName + '.' + signal, options.expression, undefined, options.scope ?? base.invocationId, options.lookback),
    now: () => context.now(),
    cancelled: () => context.cancelled,
    rethrowIfCancelled: (error) => context.rethrowIfCancelled(error),
    fail: (name, payload) => declaredFailure(workflowName, errorSchemas, name, payload),
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
async function shutdown() {
  if (stopping) return;
  stopping = true; ready = false;
  await worker.stop();
  if (operationRuntime) await operationRuntime.close();
  await Promise.all(projectionSources.map((source) => source.close()));
  server.close();
}
process.once('SIGTERM', () => { shutdown().catch((error) => { console.error(error); process.exitCode = 1; }); });
process.once('SIGINT', () => { shutdown().catch((error) => { console.error(error); process.exitCode = 1; }); });
await running;
`;
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

export function generatedHandlerModule(handler: ApplicationTaskHandlerNode | ApplicationWorkflowHandlerNode): string {
  const dependencies = handler.handlerDependencies?.source
    ? absoluteDependencyImports(handler.handlerDependencies.source, handler.handlerDependencies.resolveDir)
    : '';
  return `${dependencies}${dependencies ? '\n\n' : ''}export const handler = (${handler.handlerSource});\n`;
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
  if (!effects) return 'const operationRuntime = undefined;';
  const config = effects.eventLog.config ?? {};
  const commands = effects.operations.map(({ handler, command, model }) => `{ id: ${JSON.stringify(`${command.contract.name}.${command.contract.version}`)}, bindingId: ${JSON.stringify(handler.name)}, model: ${JSON.stringify(model.name)}, inputSchema: ${JSON.stringify(command.contract.input.jsonSchema)}, databaseUrl: requiredEnv(${JSON.stringify(model.runtime.connectionEnvName)}), key: (${handler.key.source})${handler.idempotencyKey ? `, idempotencyKey: (${handler.idempotencyKey.source})` : ''} }`).join(',\n');
  return `const operationRuntime = createApplicationTaskOperationRuntime({
  commands: [${commands}],
  cursorSecret: requiredEnv('APPLIK8S_TASK_OPERATION_CONTEXT_SECRET'),
  eventLog: { servers: JSON.parse(requiredEnv('APPLIK8S_NATS_SERVERS')), stream: ${JSON.stringify(stringConfig(config.stream) || 'APPLIK8S_EVENTS')}, subjectPrefix: ${JSON.stringify(stringConfig(config.subjectPrefix) || 'applik8s')}, connectionName: ${JSON.stringify(`applik8s-workflow-${contract.worker.name}`)}, ...(process.env.APPLIK8S_NATS_TOKEN ? { token: process.env.APPLIK8S_NATS_TOKEN } : {}), ...(process.env.APPLIK8S_NATS_USER ? { user: process.env.APPLIK8S_NATS_USER, pass: process.env.APPLIK8S_NATS_PASSWORD ?? '' } : {}) },
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
  const store = createValkeyOnlineProjectionStore({ host: requiredEnv('APPLIK8S_REBUILD_VALKEY_HOST'), port: Number(requiredEnv('APPLIK8S_REBUILD_VALKEY_PORT')), ...(process.env.APPLIK8S_REBUILD_VALKEY_PASSWORD ? { password: process.env.APPLIK8S_REBUILD_VALKEY_PASSWORD } : {}), prefix: ${JSON.stringify(kubernetesName(contract.graphName))}, projection: ${JSON.stringify(projection.name)}, stream: ${JSON.stringify(`${stream.name}.${stream.version}`)}, valueSchema: runtimeSchema(${JSON.stringify(projection.output.jsonSchema)}, ${JSON.stringify(`${projection.name}.output`)}), partitionBy: ${projectionCallbackVariable(projection.id, 'partition')}, key: ${projectionCallbackVariable(projection.id, 'key')}, score: ${projectionCallbackVariable(projection.id, 'score')}, scoreUnit: ${JSON.stringify(online.scoreUnit)}, value: ${projectionCallbackVariable(projection.id, 'value')}, ...(${removeWhen} ? { removeWhen: ${removeWhen} } : {}), retention: ${JSON.stringify(online.retention)}, initialGeneration: 'live' });
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
