// typecast-file-boundary: RESP arrays are recursively shape-checked before their decoded protocol union is exposed.
import { createConnection } from 'node:net';

export type ValkeyArgument = string | number;
export type ValkeyResponse = string | number | null | readonly ValkeyResponse[];
export type ApplicationValkeyCommand = (parts: readonly ValkeyArgument[]) => Promise<ValkeyResponse>;

export interface ApplicationValkeyClientOptions {
  readonly host: string;
  readonly port?: number;
  readonly password?: string;
  readonly timeoutMs?: number;
  readonly maxRedirects?: number;
}

interface ValkeyEndpoint { readonly host: string; readonly port: number }

/** Small cluster-aware RESP2 client used by generated workers without a process-wide Redis dependency. */
export function createApplicationValkeyCommand(options: ApplicationValkeyClientOptions): ApplicationValkeyCommand {
  if (!options.host.trim()) throw new Error('Valkey host must not be empty.');
  const port = options.port ?? 6379;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maxRedirects = options.maxRedirects ?? 5;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Valkey port must be between 1 and 65535.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('Valkey timeoutMs must be between 1 and 120000.');
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 16) throw new Error('Valkey maxRedirects must be between 0 and 16.');
  const origin = { host: options.host, port };
  const slotEndpoints = new Map<number, ValkeyEndpoint>();
  return async (parts) => {
    if (parts.length === 0) throw new Error('Valkey command must contain an operation.');
    const slot = commandSlot(parts);
    let endpoint = slot === undefined ? origin : slotEndpoints.get(slot) ?? origin;
    let asking = false;
    for (let attempt = 0; attempt <= maxRedirects; attempt += 1) {
      try {
        return await sendValkeyCommand(endpoint, parts, options.password, timeoutMs, asking);
      } catch (error) {
        const redirect = valkeyRedirect(error);
        if (!redirect || attempt === maxRedirects) throw error;
        endpoint = redirect.endpoint;
        asking = redirect.kind === 'ASK';
        if (redirect.kind === 'MOVED') slotEndpoints.set(redirect.slot, redirect.endpoint);
      }
    }
    throw new Error('Valkey redirect retry bound was exhausted.');
  };
}

async function sendValkeyCommand(
  endpoint: ValkeyEndpoint,
  parts: readonly ValkeyArgument[],
  password: string | undefined,
  timeoutMs: number,
  asking: boolean,
): Promise<ValkeyResponse> {
  const commands = [
    ...(password ? [encodeResp(['AUTH', password])] : []),
    ...(asking ? [encodeResp(['ASKING'])] : []),
    encodeResp(parts),
  ];
  return new Promise<ValkeyResponse>((resolve, reject) => {
      const socket = createConnection(endpoint);
      let buffer = Buffer.alloc(0);
      let expectedResponses = commands.length;
      let lastResponse: ValkeyResponse = null;
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Valkey command timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      const finish = (callback: () => void) => {
        clearTimeout(timeout);
        socket.removeAllListeners();
        callback();
      };
      socket.once('connect', () => socket.write(Buffer.concat(commands)));
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        try {
          while (expectedResponses > 0) {
            const parsed = parseResp(buffer);
            lastResponse = parsed.value;
            buffer = buffer.subarray(parsed.offset);
            expectedResponses -= 1;
          }
          socket.end();
          finish(() => resolve(lastResponse));
        } catch (error) {
          if (!(error instanceof IncompleteRespError)) {
            socket.destroy();
            finish(() => reject(error));
          }
        }
      });
      socket.once('error', (error) => finish(() => reject(error)));
  });
}

export function encodeResp(parts: readonly ValkeyArgument[]): Buffer {
  const chunks: Buffer[] = [Buffer.from(`*${parts.length}\r\n`)];
  for (const part of parts) {
    const value = Buffer.from(String(part));
    chunks.push(Buffer.from(`$${value.byteLength}\r\n`), value, Buffer.from('\r\n'));
  }
  return Buffer.concat(chunks);
}

export function parseResp(input: Buffer, offset = 0): { readonly value: ValkeyResponse; readonly offset: number } {
  if (offset >= input.length) throw new IncompleteRespError();
  const type = input[offset];
  const lineEnd = input.indexOf('\r\n', offset);
  if (lineEnd < 0) throw new IncompleteRespError();
  const line = input.subarray(offset + 1, lineEnd).toString('utf8');
  const next = lineEnd + 2;
  if (type === 43) return { value: line, offset: next };
  if (type === 58) return { value: parseInteger(line), offset: next };
  if (type === 45) throw new ValkeyServerError(line);
  if (type === 36) {
    const length = parseInteger(line);
    if (length === -1) return { value: null, offset: next };
    if (length < -1) throw new Error(`Valkey returned invalid bulk-string length ${length}.`);
    const end = next + length;
    if (input.length < end + 2) throw new IncompleteRespError();
    return { value: input.subarray(next, end).toString('utf8'), offset: end + 2 };
  }
  if (type === 42) {
    const count = parseInteger(line);
    if (count === -1) return { value: null, offset: next };
    if (count < -1) throw new Error(`Valkey returned invalid array length ${count}.`);
    const values: ValkeyResponse[] = [];
    let current = next;
    for (let index = 0; index < count; index += 1) {
      const parsed = parseResp(input, current);
      values.push(parsed.value);
      current = parsed.offset;
    }
    return { value: values, offset: current };
  }
  throw new Error(`Valkey returned unsupported RESP2 type byte ${String(type)}.`);
}

export class ValkeyServerError extends Error {
  constructor(readonly reply: string) {
    super(`Valkey error: ${reply}`);
    this.name = 'ValkeyServerError';
  }
}

class IncompleteRespError extends Error {
  constructor() {
    super('Incomplete Valkey RESP2 response.');
    this.name = 'IncompleteRespError';
  }
}

function parseInteger(value: string): number {
  if (!/^-?\d+$/.test(value)) throw new Error(`Valkey returned invalid integer ${JSON.stringify(value)}.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Valkey returned unsafe integer ${JSON.stringify(value)}.`);
  return parsed;
}

function valkeyRedirect(error: unknown): { readonly kind: 'MOVED' | 'ASK'; readonly slot: number; readonly endpoint: ValkeyEndpoint } | undefined {
  if (!(error instanceof ValkeyServerError)) return undefined;
  const match = /^(MOVED|ASK) (\d{1,5}) (\[[^\]]+\]|[^: ]+):(\d{1,5})$/.exec(error.reply);
  if (!match) return undefined;
  const slot = Number(match[2]);
  const port = Number(match[4]);
  if (!Number.isInteger(slot) || slot < 0 || slot >= 16_384 || !Number.isInteger(port) || port < 1 || port > 65_535) return undefined;
  const rawHost = match[3] ?? '';
  const host = rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;
  if (!host) return undefined;
  return { kind: match[1] as 'MOVED' | 'ASK', slot, endpoint: { host, port } };
}

function commandSlot(parts: readonly ValkeyArgument[]): number | undefined {
  const operation = String(parts[0] ?? '').toUpperCase();
  const raw = operation === 'EVAL' ? parts[3] : parts[1];
  if (raw === undefined || ['AUTH', 'ASKING', 'PING', 'INFO', 'CLUSTER'].includes(operation)) return undefined;
  return redisSlot(String(raw));
}

function redisSlot(key: string): number {
  const tagged = key.match(/\{([^{}]+)\}/)?.[1] ?? key;
  let crc = 0;
  for (const byte of Buffer.from(tagged)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc % 16_384;
}
