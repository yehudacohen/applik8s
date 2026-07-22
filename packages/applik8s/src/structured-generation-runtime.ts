// typecast-file-boundary: External generation responses cross an unknown JSON boundary and are validated against the declared schema before use.
import { normalizeSchema, type SchemaInput } from '@applik8s/sdk';

export interface ApplicationStructuredGenerationRequest<TOutput extends object> {
  readonly profile: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly output: SchemaInput<TOutput>;
  readonly idempotencyKey: string;
  readonly timeoutSeconds?: number;
  readonly signal?: AbortSignal;
}

export interface ApplicationStructuredGenerationUsage {
  readonly inputUnits: number;
  readonly outputUnits: number;
  readonly costMicrounits?: number;
}

export interface ApplicationStructuredGenerationResult<TOutput extends object> {
  readonly value: TOutput;
  readonly usage: ApplicationStructuredGenerationUsage;
  readonly providerRequestId?: string;
}

export interface ApplicationStructuredGenerationCapability {
  generate<TOutput extends object>(request: ApplicationStructuredGenerationRequest<TOutput>): Promise<ApplicationStructuredGenerationResult<TOutput>>;
}

export interface HttpStructuredGenerationRuntimeOptions {
  readonly endpoint: string;
  readonly apiKey?: string;
  readonly authorization?: 'bearer' | 'x-api-key';
  readonly defaultProfile?: string;
  readonly timeoutSeconds?: number;
  readonly maxResponseBytes?: number;
  readonly allowInsecureHttp?: boolean;
  readonly fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

export interface DeterministicStructuredGenerationRuntimeOptions {
  readonly output: Readonly<Record<string, unknown>>;
  readonly inputUnits?: number;
  readonly outputUnits?: number;
}

/**
 * Provider-neutral HTTP protocol used by structured-generation adapters.
 * The endpoint receives JSON containing profile, input, outputSchema, and
 * idempotencyKey and returns { output, usage, providerRequestId? }.
 */
export function createHttpStructuredGenerationCapability(options: HttpStructuredGenerationRuntimeOptions): ApplicationStructuredGenerationCapability {
  const endpoint = validatedEndpoint(options.endpoint, options.allowInsecureHttp === true);
  const requestFetch = options.fetch ?? globalThis.fetch;
  if (typeof requestFetch !== 'function') throw new Error('applik8s-structured-generation-fetch-unavailable');
  const maxResponseBytes = boundedInteger(options.maxResponseBytes ?? 1_000_000, 1_024, 10_000_000, 'maxResponseBytes');
  const defaultTimeoutSeconds = boundedInteger(options.timeoutSeconds ?? 45, 1, 300, 'timeoutSeconds');
  return {
    async generate(request) {
      const profile = nonEmptyString(request.profile || options.defaultProfile, 'profile');
      const idempotencyKey = nonEmptyString(request.idempotencyKey, 'idempotencyKey');
      const schema = normalizeSchema(request.output, 'StructuredGeneration.output');
      const emitted = schema.emitJsonSchema();
      if (!emitted.ok) throw new Error(`applik8s-structured-generation-schema-unsupported: ${emitted.error.message}`);
      const timeoutSeconds = boundedInteger(request.timeoutSeconds ?? defaultTimeoutSeconds, 1, 300, 'request.timeoutSeconds');
      const timeout = AbortSignal.timeout(timeoutSeconds * 1_000);
      const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'application/json',
        'idempotency-key': idempotencyKey,
      };
      if (options.apiKey) {
        if ((options.authorization ?? 'bearer') === 'x-api-key') headers['x-api-key'] = options.apiKey;
        else headers.authorization = `Bearer ${options.apiKey}`;
      }
      let response: Response;
      try {
        response = await requestFetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({ profile, input: request.input, outputSchema: emitted.value.schema, idempotencyKey }),
          signal,
        });
      } catch (cause) {
        if (signal.aborted) throw new Error('applik8s-structured-generation-cancelled-or-timed-out', { cause });
        throw new Error('applik8s-structured-generation-request-failed', { cause });
      }
      if (!response.ok) {
        throw new Error(`applik8s-structured-generation-provider-rejected: HTTP ${response.status}`);
      }
      const body = await boundedResponseJson(response, maxResponseBytes);
      const output = objectField(body, 'output');
      // typecast: the transport object is JSON-parsed and the declared schema
      // is the authoritative runtime validator at this boundary.
      const validated = schema.validate(output as never);
      if (!validated.ok) throw new Error(`applik8s-structured-generation-output-invalid: ${validated.error.message}`);
      return {
        value: validated.value as never,
        usage: usageField(body.usage),
        ...(typeof body.providerRequestId === 'string' && body.providerRequestId.length > 0 ? { providerRequestId: body.providerRequestId } : {}),
      };
    },
  };
}

export function createDeterministicStructuredGenerationCapability(options: DeterministicStructuredGenerationRuntimeOptions): ApplicationStructuredGenerationCapability {
  const fixture = structuredClone(options.output);
  const usage = {
    inputUnits: nonNegativeInteger(options.inputUnits ?? 0, 'inputUnits'),
    outputUnits: nonNegativeInteger(options.outputUnits ?? 0, 'outputUnits'),
  };
  return {
    async generate(request) {
      if (request.signal?.aborted) throw new Error('applik8s-structured-generation-cancelled-or-timed-out');
      nonEmptyString(request.profile, 'profile');
      nonEmptyString(request.idempotencyKey, 'idempotencyKey');
      const schema = normalizeSchema(request.output, 'StructuredGeneration.output');
      const validated = schema.validate(structuredClone(fixture) as never);
      if (!validated.ok) throw new Error(`applik8s-structured-generation-output-invalid: ${validated.error.message}`);
      return { value: validated.value as never, usage };
    },
  };
}

async function boundedResponseJson(response: Response, maxBytes: number): Promise<Readonly<Record<string, unknown>>> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error('applik8s-structured-generation-response-too-large');
  if (!response.body) throw new Error('applik8s-structured-generation-response-empty');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error('applik8s-structured-generation-response-too-large');
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)); }
  catch (cause) { throw new Error('applik8s-structured-generation-response-invalid-json', { cause }); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('applik8s-structured-generation-response-invalid');
  return parsed as Readonly<Record<string, unknown>>;
}

function usageField(value: unknown): ApplicationStructuredGenerationUsage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('applik8s-structured-generation-usage-missing');
  const inputUnits = nonNegativeInteger(Reflect.get(value, 'inputUnits'), 'usage.inputUnits');
  const outputUnits = nonNegativeInteger(Reflect.get(value, 'outputUnits'), 'usage.outputUnits');
  const cost = Reflect.get(value, 'costMicrounits');
  return { inputUnits, outputUnits, ...(cost === undefined ? {} : { costMicrounits: nonNegativeInteger(cost, 'usage.costMicrounits') }) };
}

function objectField(value: Readonly<Record<string, unknown>>, field: string): Readonly<Record<string, unknown>> {
  const selected = value[field];
  if (!selected || typeof selected !== 'object' || Array.isArray(selected)) throw new Error(`applik8s-structured-generation-${field}-missing`);
  return selected as Readonly<Record<string, unknown>>;
}

function validatedEndpoint(value: string, allowInsecureHttp: boolean): string {
  const endpoint = new URL(nonEmptyString(value, 'endpoint'));
  if (endpoint.protocol !== 'https:' && !(allowInsecureHttp && endpoint.protocol === 'http:')) {
    throw new Error('applik8s-structured-generation-endpoint-insecure');
  }
  return endpoint.toString();
}

function nonEmptyString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`applik8s-structured-generation-${name}-invalid`);
  return value;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new Error(`applik8s-structured-generation-${name}-invalid`);
  return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
  return boundedInteger(value, 0, Number.MAX_SAFE_INTEGER, name);
}
