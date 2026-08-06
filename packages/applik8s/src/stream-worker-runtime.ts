/** Focused generated durable stream-processor runtime. */

import type { SchemaInput } from '@applik8s/sdk';
import { emitApplicationManagedEvent } from './application-managed-effects-api.js';
import type { EventDefinition } from './dsl.js';

export { createPostgresApplicationStreamProcessorStore, runApplicationStreamBatchProcessor, runApplicationStreamProcessor } from './stream-processor-runtime.js';
export { createPostgresApplicationStream, enforcePostgresApplicationStreamRetention } from './stream-runtime-postgres.js';
export type {
  ApplicationNativeModelTransactionRequest,
  ApplicationNativeModelTransactionRuntime,
} from './native-model-execution.js';
export {
  editApplicationNativeModelObject,
  findApplicationNativeModelObjects,
  getApplicationNativeModelObject,
  requireApplicationNativeModelObject,
  withApplicationNativeModelTransactionRuntime,
} from './native-model-execution.js';
export type {
  FunctionNativePostgresModelEditExecution,
} from './model-command-postgres-runtime.js';
export {
  executeFunctionNativePostgresModelEdit,
} from './model-command-postgres-runtime.js';
export {
  applicationRequestContextValues,
} from './command-principal.js';
export {
  applicationRelationalChangeScopes,
} from './relational-runtime.js';

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
