import type { ApplicationWorkflowInvocationMetadata } from '@applik8s/applik8s/workflow-runtime';
import type { JsonObject } from '@hatchet-dev/typescript-sdk/v1/index.js';
import { applicationMetadata } from './workflow-runtime-hatchet-metadata.js';

const protocol = 'applik8s.hatchet-workflow-input/v1alpha1';

export interface HatchetWorkflowTransportInput<TInput extends object = object> {
  readonly __applik8sWorkflow: {
    readonly protocol: typeof protocol;
    readonly metadata: Readonly<Record<string, string>>;
  };
  readonly input: TInput;
}

/** Provider-private transport wrapper; generated workers remove it before application schema validation. */
export function encodeHatchetWorkflowTransportInput<TInput extends object>(
  input: TInput,
  metadata?: ApplicationWorkflowInvocationMetadata,
): HatchetWorkflowTransportInput<TInput> & JsonObject {
  return {
    __applik8sWorkflow: {
      protocol,
      metadata: applicationMetadata(metadata),
    },
    input,
  } as HatchetWorkflowTransportInput<TInput> & JsonObject;
}

/** Accepts legacy plain inputs while validating the canonical provider carrier fail closed. */
export function decodeHatchetWorkflowTransportInput(value: unknown): {
  readonly input: object;
  readonly metadata: Readonly<Record<string, string>>;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('applik8s-hatchet-workflow-input-invalid');
  }
  const carrier = Reflect.get(value, '__applik8sWorkflow');
  if (carrier === undefined) return { input: value, metadata: Object.freeze({}) };
  const input = Reflect.get(value, 'input');
  const metadata = carrier && typeof carrier === 'object' && !Array.isArray(carrier)
    ? Reflect.get(carrier, 'metadata')
    : undefined;
  if (
    !carrier
    || typeof carrier !== 'object'
    || Array.isArray(carrier)
    || Reflect.get(carrier, 'protocol') !== protocol
    || !input
    || typeof input !== 'object'
    || Array.isArray(input)
    || !metadata
    || typeof metadata !== 'object'
    || Array.isArray(metadata)
    || Object.entries(metadata).some(([key, entry]) =>
      !key
      || typeof entry !== 'string'
      || Buffer.byteLength(key) > 256
      || Buffer.byteLength(entry) > 8_192)
  ) {
    throw new TypeError('applik8s-hatchet-workflow-input-invalid');
  }
  return {
    input,
    metadata: Object.freeze({ ...metadata }),
  };
}
