/** Focused generated durable stream-processor runtime. */

import type { SchemaInput } from '@applik8s/sdk';
import {
  currentApplicationManagedEffects,
  emitApplicationManagedEvent,
} from './application-managed-effects-api.js';
import type { EventDefinition } from './dsl.js';

export {
  applicationCommandPrincipalValues,
  applicationRequestContextValues,
} from './command-principal.js';
export type {
  FunctionNativePostgresModelEditExecution,
  FunctionNativePostgresNestedOperation,
  FunctionNativePostgresTransactionExecution,
} from './model-command-postgres-runtime.js';
export {
  applicationPostgresModelReadClients,
  currentFunctionNativePostgresDatabase,
  currentFunctionNativePostgresTransaction,
  executeFunctionNativePostgresModelEdit,
  executeFunctionNativePostgresTransaction,
} from './model-command-postgres-runtime.js';
export type {
  ApplicationNativeModelTransactionRequest,
  ApplicationNativeModelTransactionRuntime,
} from './native-model-execution.js';
export {
  editApplicationNativeModelObject,
  findApplicationNativeModelObjects,
  getApplicationNativeModelObject,
  requireApplicationNativeModelObject,
  withApplicationNativeModelReadClients,
  withApplicationNativeModelTransactionRuntime,
} from './native-model-execution.js';
export {
  applicationRelationalChangeScopes,
} from './relational-runtime.js';
export type {
  ApplicationStreamDeliveryAdmissionRequest,
  ApplicationStreamDeliveryAdmitter,
} from './stream-processor-runtime.js';
export { createPostgresApplicationStreamProcessorStore, runApplicationStreamBatchProcessor, runApplicationStreamProcessor } from './stream-processor-runtime.js';
export { createPostgresApplicationStream, enforcePostgresApplicationStreamRetention } from './stream-runtime-postgres.js';

/**
 * Rehydrates an inferred event emitter inside the generated worker's single
 * managed-effect module graph. Generated code must not import the authoring
 * DSL to reconstruct a second effect-scope authority.
 */
export function createApplicationFunctionNativeEventHandle<
  TPayload extends object,
>(
  id: string,
  options: { readonly payload: SchemaInput<TPayload> },
): EventDefinition<TPayload> {
  const separator = id.lastIndexOf('.');
  if (separator < 1 || separator === id.length - 1) {
    throw new Error(
      `Function-native event ${JSON.stringify(id)} must use a versioned name such as event.name.v1.`,
    );
  }
  const name = id.slice(0, separator);
  const version = id.slice(separator + 1);
  let definition: EventDefinition<TPayload>;
  const emit = (payload: TPayload) =>
    emitApplicationManagedEvent(definition, payload);
  definition = Object.freeze({
    kind: 'applik8sEvent',
    id,
    name,
    version,
    payload: options.payload,
    emit,
  });
  return definition;
}

/** Compiler-owned callable for a durable command staged by a lifecycle transaction. */
// typecast-boundary: the compiler binds each generated handle to the exact validated operation output schema represented by TOutput.
export function createApplicationFunctionNativeOperationHandle<
  TInput extends object,
  TOutput,
>(options: {
  readonly operation: {
    readonly apiVersion: 'applik8s.operation/v1alpha1';
    readonly kind: 'applicationOperation';
    readonly id: string;
    readonly model: string;
    readonly name: string;
    readonly operation: 'create' | 'update' | 'delete';
    readonly transport: 'command';
  };
  readonly command: { readonly id: string };
  readonly key: (input: TInput, context: undefined, messageId: string) => string;
  readonly idempotencyKey?: (
    input: TInput,
    context: undefined,
    messageId: string,
  ) => string;
}): (input: TInput) => Promise<TOutput> {
  const derivedCommandId = `models.${options.operation.model}.${options.operation.name}.v1`;
  if (derivedCommandId !== options.command.id) {
    throw new Error(
      `Application operation ${options.operation.id} resolves ${derivedCommandId}, but the compiled lifecycle transaction declared ${options.command.id}.`,
    );
  }
  return (input) => {
    const effects = currentApplicationManagedEffects();
    if (!effects) {
      throw new Error(
        `Application operation ${options.operation.id} escaped its compiler-inferred lifecycle transaction.`,
      );
    }
    if (!effects.invokeAtomic) {
      throw new Error(
        `Application operation ${options.operation.id} requires a compiler-owned atomic transaction envelope.`,
      );
    }
    return effects.invokeAtomic(
      options.operation,
      input,
      (messageId) => ({
        targetKey: options.key(input, undefined, messageId),
        ...(options.idempotencyKey
          ? {
              idempotencyKey: options.idempotencyKey(
                input,
                undefined,
                messageId,
              ),
            }
          : {}),
      }),
    ) as Promise<TOutput>;
  };
}
