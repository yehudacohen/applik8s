// typecast-file-boundary: Standard Schema runtime validation proves the erased callable-operation schema generics restored at this adapter boundary.

import type { ApplicationAIAgentRequest } from '@applik8s/ai';
import type { ApplicationOperation, ApplicationQueryOperation } from '@applik8s/client';
import { getApplicationOperationSchemas } from '@applik8s/client';
import type { ApplicationExecutionPrincipal, JsonObject } from '@applik8s/core';
import { toRuntimeSchema } from '@applik8s/sdk/schema-runtime';
import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';
import {
  type AnyTextAdapter,
  type AnyTool,
  isStandardSchema,
  type ModelMessage,
  type ServerTool,
  toolDefinition,
  type UIMessage,
} from '@tanstack/ai';

export interface ApplicationTanStackAIAgentRequest
  extends ApplicationAIAgentRequest {
  readonly messages: Array<UIMessage | ModelMessage>;
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
 * Persistence stays opaque until TanStack publishes its server-side contract;
 * compatibility gates reject unsupported substitutes.
 */
export interface ApplicationTanStackAgentRuntime {
  readonly adapter: AnyTextAdapter;
  readonly tools: AnyTool[];
  readonly persistence: unknown;
  readonly execution: ApplicationTanStackToolExecutionContext;
}

export interface ApplicationTanStackToolOptions<TName extends string = string> {
  readonly name?: TName;
  readonly description?: string;
  /**
   * Presentation only. The canonical operation runtime still authorizes every
   * invocation under the supplied ExecutionPrincipal.
   */
  readonly needsApproval?: boolean;
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
  ApplicationTanStackToolExecutionContext
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
  const name = (options.name ?? applicationTanStackToolName(operation.operation.id)) as TName;
  validateToolName(name);
  const inputSchema = schemas.input as StandardSchemaV1<TInput, TInput>;
  const outputSchema = schemas.output as StandardSchemaV1<TOutput, TOutput>;
  const needsApproval = options.needsApproval ?? operation.authority.grantable;
  return toolDefinition({
    name,
    description: options.description ?? `Invoke the ${operation.operation.id} application operation.`,
    inputSchema,
    outputSchema,
    needsApproval,
    metadata: {
      applik8s: {
        operationId: operation.operation.id,
        operationVersion: operation.operation.version ?? 'unversioned',
        transport: operation.operation.transport,
        approvalPresentationOnly: true,
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

export function applicationTanStackToolName(operationId: string): string {
  const normalized = operationId
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
