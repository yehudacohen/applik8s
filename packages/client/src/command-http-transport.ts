import type { ApplicationCommandProgress, ApplicationCommandSubmission, ApplicationCommandTransport } from './protocol.js';
import { boundFetch } from './bound-fetch.js';

export interface HttpApplicationCommandTransportOptions {
  readonly baseUrl?: string;
  readonly credentials?: RequestCredentials;
  readonly headers?: Readonly<Record<string, string>> | (() => Readonly<Record<string, string>> | Promise<Readonly<Record<string, string>>>);
  readonly fetch?: typeof globalThis.fetch;
  readonly maxResponseBytes?: number;
}

// typecast-boundary: bounded JSON responses are validated against the versioned command protocol before exposure to callers.
export function createHttpApplicationCommandTransport(options: HttpApplicationCommandTransportOptions = {}): ApplicationCommandTransport {
  const request = boundFetch(options.fetch);
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
  const maxResponseBytes = options.maxResponseBytes ?? 256 * 1024;
  const send = async (command: string, operation: 'submit' | 'progress', body: unknown, signal?: AbortSignal): Promise<ApplicationCommandProgress> => {
    const response = await request(`${baseUrl}/commands/${encodeURIComponent(command)}/${operation}`, { method: 'POST', credentials: options.credentials ?? 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json', ...await resolvedHeaders(options.headers) }, body: JSON.stringify(body), ...(signal ? { signal } : {}) });
    if (!response.ok) throw await responseError(response, `Command ${operation} for ${command} failed`, maxResponseBytes);
    const progress = JSON.parse(await boundedText(response, maxResponseBytes)) as ApplicationCommandProgress;
    validateProgress(progress, command);
    return progress;
  };
  return {
    async submit(command, input, requestOptions) {
      const progress = await send(command, 'submit', { input, commandId: requestOptions.commandId, idempotencyKey: requestOptions.idempotencyKey, ...(requestOptions.expectedRevision ? { expectedRevision: requestOptions.expectedRevision } : {}) }, requestOptions.signal);
      if (progress.transport !== 'acknowledged' || !progress.progressCursor || (progress.durableResult !== 'pending' && progress.durableResult !== 'unknown')) throw new Error(`Command submission for ${command} violates the Applik8s command protocol.`);
      return progress as ApplicationCommandSubmission;
    },
    progress(command, cursor, requestOptions = {}) { return send(command, 'progress', { cursor }, requestOptions.signal); },
  };
}

function validateProgress(progress: ApplicationCommandProgress, command: string): void {
  if (progress.protocol !== 'applik8s.command/v1alpha1' || progress.command !== command || !progress.commandId || !progress.correlationId || !['idle', 'submitting', 'acknowledged', 'failed'].includes(progress.transport) || !['unknown', 'pending', 'succeeded', 'rejected', 'failed'].includes(progress.durableResult)) throw new Error(`Command response for ${command} violates the Applik8s command protocol.`);
  if (progress.durableResult === 'rejected' && !progress.rejection) throw new Error(`Rejected command response for ${command} omits its declared rejection.`);
  if (progress.durableResult === 'failed' && progress.failure?.code !== 'processing_failed') throw new Error(`Failed command response for ${command} omits its safe terminal failure.`);
}

async function resolvedHeaders(headers: HttpApplicationCommandTransportOptions['headers']): Promise<Readonly<Record<string, string>>> { if (!headers) return {}; return typeof headers === 'function' ? headers() : headers; }
async function boundedText(response: Response, maxBytes: number): Promise<string> { const text = await response.text(); if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error(`HTTP response exceeded the ${maxBytes}-byte Applik8s command-client limit.`); return text; }
async function responseError(response: Response, prefix: string, maxBytes: number): Promise<Error> { const text = await boundedText(response, Math.min(maxBytes, 16 * 1024)).catch(() => 'response body exceeded diagnostic limit'); return new Error(`${prefix}: HTTP ${response.status}${text ? `: ${text}` : ''}`); }
