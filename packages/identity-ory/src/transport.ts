export type OryFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface OryHttpTransportOptions {
  readonly fetch?: OryFetch;
  readonly timeoutMs?: number;
  readonly maximumResponseBytes?: number;
}

export class OryAdapterError extends Error {
  readonly code:
    | 'ORY_UNAVAILABLE'
    | 'ORY_UNAUTHORIZED'
    | 'ORY_RESPONSE_INVALID'
    | 'ORY_REQUEST_REJECTED'
    | 'ORY_CANCELLED'
    | 'ORY_TIMEOUT';
  readonly status: number | undefined;

  constructor(
    code: OryAdapterError['code'],
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = 'OryAdapterError';
    this.code = code;
    this.status = status;
  }
}

export class OryHttpTransport {
  readonly #fetch: OryFetch;
  readonly #timeoutMs: number;
  readonly #maximumResponseBytes: number;

  constructor(options: OryHttpTransportOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = boundedInteger(
      options.timeoutMs ?? 10_000,
      'Ory timeoutMs',
      100,
      120_000,
    );
    this.#maximumResponseBytes = boundedInteger(
      options.maximumResponseBytes ?? 2 * 1024 * 1024,
      'Ory maximumResponseBytes',
      1024,
      20 * 1024 * 1024,
    );
  }

  async request(
    url: URL,
    init: RequestInit = {},
    expected: readonly number[] = [200],
  ): Promise<{
    readonly response: Response;
    readonly json?: Readonly<Record<string, unknown>>;
  }> {
    const controller = new AbortController();
    const abort = () => controller.abort(init.signal?.reason);
    init.signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error(`Ory request exceeded ${this.#timeoutMs}ms.`)),
      this.#timeoutMs,
    );
    let response: Response;
    let bytes: Uint8Array;
    try {
      response = await this.#fetch(url, {
        ...init,
        signal: controller.signal,
        redirect: init.redirect ?? 'manual',
      });
      bytes = await readBoundedBody(
        response,
        this.#maximumResponseBytes,
        controller.signal,
      );
    } catch (error) {
      if (controller.signal.aborted) {
        if (init.signal?.aborted) {
          throw new OryAdapterError(
            'ORY_CANCELLED',
            'Ory request was cancelled.',
          );
        }
        throw new OryAdapterError(
          'ORY_TIMEOUT',
          `Ory request exceeded ${this.#timeoutMs}ms.`,
        );
      }
      if (error instanceof OryAdapterError) throw error;
      throw new OryAdapterError(
        'ORY_UNAVAILABLE',
        error instanceof Error ? error.message : 'Ory request failed.',
      );
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener('abort', abort);
    }
    let json: Readonly<Record<string, unknown>> | undefined;
    if (bytes.byteLength > 0) {
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        try {
          const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('expected object');
          }
          json = parsed as Readonly<Record<string, unknown>>;
        } catch {
          throw new OryAdapterError(
            'ORY_RESPONSE_INVALID',
            'Ory returned malformed JSON.',
            response.status,
          );
        }
      }
    }
    if (!expected.includes(response.status)) {
      throw new OryAdapterError(
        response.status === 401 || response.status === 403
          ? 'ORY_UNAUTHORIZED'
          : response.status >= 500
            ? 'ORY_UNAVAILABLE'
            : 'ORY_REQUEST_REJECTED',
        publicOryError(response.status),
        response.status,
      );
    }
    const permitsBody =
      response.status !== 204
      && response.status !== 205
      && response.status !== 304;
    return {
      response: new Response(
        permitsBody ? Uint8Array.from(bytes).buffer : null,
        {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        },
      ),
      ...(json ? { json } : {}),
    };
  }
}

async function readBoundedBody(
  response: Response,
  maximumResponseBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const { done, value } = await readWithAbort(reader, signal);
      if (done) break;
      total += value.byteLength;
      if (total > maximumResponseBytes) {
        await reader.cancel('Ory response exceeded the configured byte limit.');
        throw new OryAdapterError(
          'ORY_RESPONSE_INVALID',
          `Ory response exceeded ${maximumResponseBytes} bytes.`,
          response.status,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<
  | { readonly done: true; readonly value?: undefined }
  | { readonly done: false; readonly value: Uint8Array }
> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => {
      void reader.cancel(signal.reason).then(
        () => reject(signal.reason),
        () => reject(signal.reason),
      );
    };
    signal.addEventListener('abort', abort, { once: true });
    reader.read().then(
      (result) => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) reject(signal.reason);
        else if (result.done) resolve({ done: true });
        else resolve({ done: false, value: result.value });
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

export function normalizedOryBaseUrl(value: string, field: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== 'https:'
    && !(url.protocol === 'http:'
      && (url.hostname === 'localhost'
        || url.hostname === '127.0.0.1'
        || url.hostname.endsWith('.svc')))
  ) {
    throw new Error(`${field} must use HTTPS outside loopback or cluster-local service DNS.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${field} must not contain credentials, query, or fragment.`);
  }
  url.pathname = `${url.pathname.replace(/\/+$/u, '')}/`;
  return url;
}

export function requiredOryString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new OryAdapterError(
      'ORY_RESPONSE_INVALID',
      `Ory response is missing ${field}.`,
    );
  }
  return value;
}

export function optionalOryString(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredOryString(value, field);
}

export function oryStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new OryAdapterError(
      'ORY_RESPONSE_INVALID',
      `Ory response ${field} must be a string array.`,
    );
  }
  return [...value] as string[];
}

function boundedInteger(
  value: number,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function publicOryError(status: number): string {
  if (status === 401 || status === 403) return 'Ory rejected the supplied credential.';
  if (status === 404 || status === 410) return 'Ory flow or session is unavailable.';
  if (status === 429) return 'Ory rate limit was exceeded.';
  if (status >= 500) return 'Ory is unavailable.';
  return 'Ory rejected the request.';
}
