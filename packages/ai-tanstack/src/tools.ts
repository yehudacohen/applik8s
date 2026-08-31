// typecast-file-boundary: Standard Schema runtime validation proves the erased callable-operation schema generics restored at this adapter boundary.

import type { ApplicationAIAgentRequest } from '@applik8s/ai';
import type { ApplicationOperation, ApplicationQueryOperation } from '@applik8s/client';
import { getApplicationOperationSchemas } from '@applik8s/client';
import type { ApplicationExecutionPrincipal, JsonObject } from '@applik8s/core';
import { toRuntimeSchema } from '@applik8s/sdk/schema-runtime';
import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';
import type { ApplicationTanStackChatTranscriptPersistence } from './persistence.js';
import {
  type AnyTextAdapter,
  type AnyTool,
  isStandardSchema,
  type ModelMessage,
  type ServerTool,
  toolDefinition,
  type UIMessage,
} from '@tanstack/ai';

export interface ApplicationTanStackAIAgentRequest<TInput extends object = object>
  extends ApplicationAIAgentRequest {
  readonly messages: Array<UIMessage | ModelMessage>;
  readonly input?: TInput;
}

export type ApplicationTanStackToolOperation<TInput, TOutput> =
  | ApplicationOperation<TInput, TOutput>
  | ApplicationQueryOperation<TInput, TOutput>;

export interface ApplicationTanStackToolInvocation {
  readonly principal: ApplicationExecutionPrincipal;
  readonly invocationId: string;
  readonly attemptId: string;
  readonly providerToolCallId: string;
  readonly signal?: AbortSignal;
}

/**
 * Request-local authority supplied as TanStack AI's native runtime context.
 * Implementations must lower `invoke` to the canonical admitted
 * `context.invoke(operation, input)` path.
 */
export interface ApplicationTanStackToolExecutionContext {
  readonly principal: ApplicationExecutionPrincipal;
  readonly invocationId: string;
  readonly attemptId: string;
  invoke<TInput, TOutput>(
    operation: ApplicationTanStackToolOperation<TInput, TOutput>,
    input: TInput,
    invocation: ApplicationTanStackToolInvocation,
  ): Promise<TOutput>;
}

/**
 * Native TanStack values injected into one application.agent(...) execution.
 * Persistence is TanStack's published transcript/run contract, backed by an
 * authority-scoped application store.
 */
export interface ApplicationTanStackAgentRuntime {
  readonly adapter: AnyTextAdapter;
  readonly tools: AnyTool[];
  readonly persistence: ApplicationTanStackChatTranscriptPersistence;
  readonly execution: ApplicationTanStackToolExecutionContext;
}

export interface ApplicationTanStackToolOptions<TName extends string = string> {
  readonly name?: TName;
  readonly description?: string;
  /** Product-facing activity language retained beside the canonical operation ID. */
  readonly presentation?: {
    readonly label: string;
    readonly runningLabel?: string;
    readonly completedLabel?: string;
  };
  /**
   * Presentation only. The canonical operation runtime still authorizes every
   * invocation under the supplied ExecutionPrincipal.
   */
  readonly needsApproval?: boolean;
}

export interface ApplicationTanStackToolReference {
  readonly operation: {
    readonly id: string;
  };
}

/**
 * Select hydrated TanStack tools through stable, application-owned catalog
 * keys. Persisted agent configuration never depends on a provider tool name,
 * and a stale or unavailable selection fails before inference starts.
 */
export function selectApplicationTanStackTools(
  tools: readonly AnyTool[],
  selected: readonly string[],
): AnyTool[];
export function selectApplicationTanStackTools<
  const TCatalog extends Readonly<
    Record<string, ApplicationTanStackToolReference>
  >,
>(
  tools: readonly AnyTool[],
  catalog: TCatalog,
  selected: readonly (keyof TCatalog & string)[] | readonly string[],
): AnyTool[];
export function selectApplicationTanStackTools(
  tools: readonly AnyTool[],
  catalogOrSelected:
    | Readonly<Record<string, ApplicationTanStackToolReference>>
    | readonly string[],
  explicitSelected?: readonly string[],
): AnyTool[] {
  const operationByKey = Array.isArray(catalogOrSelected)
    ? inferredApplicationTanStackToolCatalog(tools)
    : new Map(
        Object.entries(catalogOrSelected).map(([key, operation]) => [
          key,
          operation.operation.id,
        ]),
      );
  const selected = explicitSelected ?? catalogOrSelected as readonly string[];
  const selectedOperations = new Set<string>();
  for (const key of selected) {
    const operationId = operationByKey.get(key);
    if (!operationId) {
      throw new Error(
        `Agent tool catalog does not declare selected tool ${JSON.stringify(key)}.`,
      );
    }
    if (selectedOperations.has(operationId)) {
      throw new Error(
        `Agent tool catalog selects operation ${operationId} more than once.`,
      );
    }
    selectedOperations.add(operationId);
  }
  const hydrated = new Map<string, AnyTool>();
  for (const tool of tools) {
    const operationId = applicationTanStackToolOperationId(tool);
    if (!operationId || !selectedOperations.has(operationId)) continue;
    if (hydrated.has(operationId)) {
      throw new Error(
        `TanStack runtime hydrated application operation ${operationId} more than once.`,
      );
    }
    hydrated.set(operationId, tool);
  }
  const missing = [...selectedOperations].filter(
    operationId => !hydrated.has(operationId),
  );
  if (missing.length > 0) {
    throw new Error(
      `TanStack runtime did not hydrate selected application tools: ${missing.join(', ')}.`,
    );
  }
  return [...selectedOperations].map((operationId) => {
    const tool = hydrated.get(operationId);
    if (!tool) {
      throw new Error(
        `TanStack runtime lost hydrated application tool ${operationId} after validation.`,
      );
    }
    return tool;
  });
}

function inferredApplicationTanStackToolCatalog(
  tools: readonly AnyTool[],
): ReadonlyMap<string, string> {
  const catalog = new Map<string, string>();
  for (const tool of tools) {
    const operationId = applicationTanStackToolOperationId(tool);
    if (!operationId) continue;
    const key = applicationTanStackToolStableKey(operationId);
    const existing = catalog.get(key);
    if (existing && existing !== operationId) {
      throw new Error(
        `Application tool key ${JSON.stringify(key)} is ambiguous between ${existing} and ${operationId}. Pass an explicit application-owned catalog to disambiguate it.`,
      );
    }
    catalog.set(key, operationId);
  }
  return catalog;
}

function applicationTanStackToolStableKey(operationId: string): string {
  const match = /^applik8s:\/\/[^/]+\/([^/]+)\/operations\/([^/]+)$/u.exec(
    operationId,
  );
  if (!match?.[1] || !match[2]) {
    throw new Error(
      `Application operation ${operationId} cannot be represented by the inferred Owner.operation tool catalog. Pass an explicit application-owned catalog.`,
    );
  }
  return `${match[1]}.${match[2]}`;
}

function applicationTanStackToolOperationId(tool: AnyTool): string | undefined {
  const metadata = Reflect.get(tool, 'metadata');
  if (!metadata || typeof metadata !== 'object') return undefined;
  const applik8s = Reflect.get(metadata, 'applik8s');
  if (!applik8s || typeof applik8s !== 'object') return undefined;
  const operationId = Reflect.get(applik8s, 'operationId');
  return typeof operationId === 'string' && operationId.trim()
    ? operationId
    : undefined;
}

/**
 * Rehydrates one compiler-normalized operation schema as a native Standard
 * Schema value. The JSON Schema remains the single serialized contract; this
 * adapter adds only the protocol methods TanStack AI expects at runtime.
 */
export function applicationTanStackStandardSchema<TValue>(
  schema: JsonObject,
  name: string,
): StandardSchemaV1<TValue, TValue> & StandardJSONSchemaV1<TValue, TValue> {
  const runtime = toRuntimeSchema<TValue & object>({
    kind: 'jsonSchema',
    ref: { kind: 'jsonSchema', moduleSpecifier: `generated:ai-tool:${name}` },
    schema,
  });
  return Object.freeze({
    '~standard': {
      version: 1 as const,
      vendor: 'applik8s',
      validate(value: unknown) {
        // typecast: the runtime schema validator owns the unknown-to-JSON
        // boundary and returns TValue only after structural validation.
        const result = runtime.validate(value as never);
        return result.ok
          ? { value: result.value as TValue }
          : { issues: [{ message: result.error.message }] };
      },
      jsonSchema: {
        input: () => structuredClone(schema),
        output: () => structuredClone(schema),
      },
    },
  });
}

export type ApplicationTanStackServerTool<
  TInput,
  TOutput,
  TName extends string = string,
> = ServerTool<
  StandardSchemaV1<TInput, TInput>,
  StandardSchemaV1<TOutput, TOutput>,
  TName,
  ApplicationTanStackToolExecutionContext,
  boolean
>;

/**
 * Adapt one existing callable operation into a native TanStack server tool.
 * No handler, schema, authority decision, or idempotency protocol is copied.
 */
export function asTool<
  TInput,
  TOutput,
  const TName extends string = string,
>(
  operation: ApplicationTanStackToolOperation<TInput, TOutput>,
  options: ApplicationTanStackToolOptions<TName> = {},
): ApplicationTanStackServerTool<TInput, TOutput, TName> {
  const schemas = getApplicationOperationSchemas(operation);
  if (!schemas) {
    throw new Error(
      `Application operation ${operation.operation.id} cannot be adapted as a TanStack tool because its authored input/output schemas are unavailable.`,
    );
  }
  if (!isStandardSchema(schemas.input) || !isStandardSchema(schemas.output)) {
    throw new Error(
      `Application operation ${operation.operation.id} cannot be adapted as a TanStack tool because both authored schemas must implement Standard Schema.`,
    );
  }
  const name = (options.name ?? applicationTanStackToolName(
    operation.operation.id,
    options.presentation?.label,
  )) as TName;
  validateToolName(name);
  const inputSchema = schemas.input as StandardSchemaV1<TInput, TInput>;
  const outputSchema = schemas.output as StandardSchemaV1<TOutput, TOutput>;
  const needsApproval = options.needsApproval ?? operation.authority.grantable;
  return toolDefinition({
    name,
    description: options.description
      ?? (options.presentation
        ? options.presentation.label
        : `Invoke the ${operation.operation.id} application operation.`),
    inputSchema,
    outputSchema,
    needsApproval,
    metadata: {
      applik8s: {
        operationId: operation.operation.id,
        operationVersion: operation.operation.version ?? 'unversioned',
        transport: operation.operation.transport,
        approvalPresentationOnly: true,
        ...(options.presentation
          ? { presentation: Object.freeze({ ...options.presentation }) }
          : {}),
      },
    },
  }).server<ApplicationTanStackToolExecutionContext>(
    async (input, toolContext) => {
      const providerToolCallId = toolContext.toolCallId?.trim();
      if (!providerToolCallId) {
        throw new Error(
          `TanStack tool ${name} requires a provider tool-call ID. Pass context.tanstack.execution to chat({ context }) so durable proposal identity is preserved.`,
        );
      }
      const execution = toolContext.context;
      return execution.invoke(operation, input, {
        principal: execution.principal,
        invocationId: execution.invocationId,
        attemptId: execution.attemptId,
        providerToolCallId,
        ...(toolContext.abortSignal ? { signal: toolContext.abortSignal } : {}),
      });
    },
  );
}

export function applicationTanStackToolName(
  operationId: string,
  label?: string,
): string {
  const normalized = (label?.trim() || operationId)
    .replace(/^applik8s:\/\//u, '')
    .replace(/[^A-Za-z0-9_-]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    || 'operation';
  const digest = portableHash(operationId);
  const prefix = 'applik8s_';
  const suffix = `_${digest}`;
  return `${prefix}${normalized.slice(0, 64 - prefix.length - suffix.length)}${suffix}`;
}

function validateToolName(name: string): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(name)) {
    throw new Error(
      `TanStack tool name ${JSON.stringify(name)} must contain 1-64 letters, digits, underscores, or hyphens.`,
    );
  }
}

function portableHash(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36).padStart(7, '0').slice(-7);
}
