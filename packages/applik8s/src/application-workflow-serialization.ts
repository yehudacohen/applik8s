// typecast-file-boundary: Workflow schema and callback serialization converts validated authoring-time contracts into portable graph metadata.
import type { ApplicationExpressionContract, ApplicationMessageContractSchema } from '@applik8s/core';
import { normalizeSchema, type SchemaInput } from '@applik8s/sdk';
import { instrumentedApplicationCallbackSource } from './application-callback.js';
import {
  analyzeApplicationServerRouteSource,
  applicationRouteSourceDependencies,
  extractApplicationCallArgumentSource,
  normalizeSerializableFunctionSource,
  serializedCallbackClosureMessage,
  transpileApplicationCallbackExpression,
  unsupportedRouteFreeIdentifiers,
} from './application-route-source.js';
import type { TaskDefinition, WorkflowDefinition } from './dsl.js';

const workflowHandlerSerializationCache = new WeakMap<(...args: never[]) => unknown, Map<string, {
	readonly source: string;
	readonly dependencies?: { readonly source: string; readonly resolveDir: string };
	readonly location?: { readonly file: string; readonly line: number; readonly column: number };
}>>();

export function durableContract<TInput extends object, TOutput extends object>(
  definition: TaskDefinition<TInput, TOutput> | WorkflowDefinition<TInput, TOutput>,
): {
  readonly name: string;
  readonly version: string;
  readonly input: ApplicationMessageContractSchema;
  readonly output: ApplicationMessageContractSchema;
  readonly errors: readonly { readonly name: string; readonly schema: ApplicationMessageContractSchema }[];
} {
  return {
    name: definition.name,
    version: definition.version,
    input: declaredSchema(definition.input, `${definition.id}.input`),
    output: declaredSchema(definition.output, `${definition.id}.output`),
    errors: Object.keys(definition.errors).sort().map((name) => ({ name, schema: declaredSchema(requiredSchema(schemaRecord(definition.errors), name, `${definition.id}.errors`), `${definition.id}.errors.${name}`) })),
  };
}

export function declaredSchema<T extends object>(input: SchemaInput<T>, name: string): ApplicationMessageContractSchema {
  const emitted = normalizeSchema(input, name).emitJsonSchema();
  if (!emitted.ok) throw new Error(`applik8s-workflow-schema-unsupported: ${name}: ${emitted.error.message}`);
  return { kind: 'declared', runtime: 'arktype', jsonSchema: emitted.value.schema };
}

export function validateMessage<T extends object>(schema: SchemaInput<T>, value: unknown, name: string): T {
  // typecast: the schema adapter accepts JSON-like unknown input and performs the authoritative runtime validation below.
  const validated = normalizeSchema(schema, name).validate(value as never);
  if (!validated.ok) throw new Error(`applik8s-workflow-schema-invalid: ${name}: ${validated.error.message}`);
  // typecast: successful schema validation is the runtime proof of the generic message type.
  return validated.value as T;
}

export function workflowHandlerSerialization(
  kind: 'task' | 'workflow',
  id: string,
  handler: (...args: never[]) => unknown,
  orchestrationOnly: boolean,
): {
  readonly source: string;
  readonly dependencies?: { readonly source: string; readonly resolveDir: string };
  readonly location?: { readonly file: string; readonly line: number; readonly column: number };
} {
	const cacheKey = `${kind}:${id}:${orchestrationOnly ? 'orchestration' : 'task'}`;
	const cached = workflowHandlerSerializationCache.get(handler)?.get(cacheKey);
	if (cached) return cached;
  const instrumented = instrumentedApplicationCallbackSource(handler);
  const extracted = instrumented
    ? { source: instrumented.source ? transpileApplicationCallbackExpression(instrumented.source) : Function.prototype.toString.call(handler), location: { file: instrumented.file, line: instrumented.line, column: instrumented.column } }
    : extractApplicationCallArgumentSource(kind, 2);
  const source = serializableHandlerSource(kind, id, extracted?.source ?? Function.prototype.toString.call(handler), orchestrationOnly);
  const unsupported = unsupportedRouteFreeIdentifiers(analyzeApplicationServerRouteSource(source), new Set());
  const dependencies = applicationRouteSourceDependencies({ id, method: 'POST', path: `/${kind}/${id}`, handlerSource: source, handlerSourceKind: extracted ? 'source' : 'functionToString', ...(extracted ? { handlerSourceLocation: extracted.location } : {}) }, unsupported, new Set());
  if (unsupported.length > 0 && !dependencies) {
    throw new Error(serializedCallbackClosureMessage({ label: `app.${kind} ${id}`, identifiers: unsupported, ...(extracted ? { sourceLocation: extracted.location } : {}), guidance: 'Move reusable helpers and imports to module scope so Applik8s can include them in the generated worker, or pass dynamic data through the task/workflow input.' }));
  }
  if (orchestrationOnly && dependencies?.source) assertWorkflowOrchestrationSource(id, dependencies.source);
	const serialized = { source, ...(dependencies ? { dependencies } : {}), ...(extracted ? { location: extracted.location } : {}) };
	const entries = workflowHandlerSerializationCache.get(handler) ?? new Map();
	entries.set(cacheKey, serialized);
	workflowHandlerSerializationCache.set(handler, entries);
	return serialized;
}

function serializableHandlerSource(kind: 'task' | 'workflow', id: string, rawSource: string, orchestrationOnly: boolean): string {
  const source = normalizeSerializableFunctionSource(rawSource.trim());
  if (!source || source.includes('[native code]')) throw new Error(`${kind} ${id} handler must be a serializable JavaScript function.`);
  try {
    Function(`return (${source});`);
  } catch (cause) {
    throw new Error(`${kind} ${id} handler cannot be serialized: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (orchestrationOnly) assertWorkflowOrchestrationSource(id, source);
  return source;
}

function assertWorkflowOrchestrationSource(id: string, source: string): void {
  const forbidden = [
    ['fetch', /\bfetch\s*\(/], ['database clients', /\b(?:postgres|drizzle|database|db)\b/], ['Kubernetes clients', /\b(?:KubeConfig|kubernetes|kubectl)\b/],
    ['filesystem access', /\b(?:readFile|writeFile|node:fs)\b/], ['process state', /\bprocess\s*\./], ['wall clock', /\b(?:new\s+Date|Date\s*\.|Date\s*\()/],
    ['randomness', /\b(?:Math\.random|crypto\.randomUUID)\s*\(/], ['ambient timers', /\bsetTimeout\s*\(/],
  ] as const;
  const violations = forbidden.filter(([, pattern]) => pattern.test(source)).map(([name]) => name);
  if (violations.length > 0) throw new Error(`workflow ${id} orchestration uses ${violations.join(', ')}, which is not durable orchestration. Move external effects into declared app.task(...) handlers and use context.now()/context.sleep().`);
}

export function functionExpression(fn: (...args: never[]) => unknown, name: string): ApplicationExpressionContract {
  const source = Function.prototype.toString.call(fn).trim();
  if (!source || source.includes('[native code]')) throw new Error(`${name} must be serializable.`);
  return { kind: 'function', source };
}

export function schemaRecord(value: object): Readonly<Record<string, SchemaInput<object>>> {
  // typecast: mapped schema records are erased to their common schema-input value for deterministic graph serialization.
  return value as Readonly<Record<string, SchemaInput<object>>>;
}

export function requiredSchema(record: Readonly<Record<string, SchemaInput<object>>>, key: string, name: string): SchemaInput<object> {
  const schema = record[key];
  if (!schema) throw new Error(`Missing declared schema ${name}.${key}.`);
  return schema;
}
