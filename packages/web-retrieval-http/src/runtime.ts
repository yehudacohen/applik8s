// typecast-file-boundary: DNS and HTTP callback APIs are normalized and validated before entering provider-neutral source contracts.
import { lookup } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { IncomingMessage, RequestOptions } from 'node:http';
import {
  normalizeApplicationRetrievedSource,
  normalizeApplicationSourceRetrievalRequest,
  type ApplicationRetrievedSource,
  type ApplicationSourceRetrievalRequest,
} from '@applik8s/web-search';
import {
  normalizeBoundedHttpSourceRetrieverOptions,
  type BoundedHttpSourceRetrieverOptions,
} from './policy.js';

export function createBoundedHttpSourceRetriever(
  options: BoundedHttpSourceRetrieverOptions = {},
): (input: ApplicationSourceRetrievalRequest) => Promise<ApplicationRetrievedSource> {
  const policy = normalizeBoundedHttpSourceRetrieverOptions(options);
  return async (input) => {
    const request = normalizeApplicationSourceRetrievalRequest({
      ...input,
      timeoutMs: Math.min(input.timeoutMs ?? policy.timeoutMs, policy.timeoutMs),
      maximumBytes: Math.min(input.maximumBytes ?? policy.maximumBytes, policy.maximumBytes),
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Source retrieval deadline exceeded.')), request.timeoutMs);
    try {
      const response = await retrieve(new URL(request.url), request, policy, controller.signal, []);
      return normalizeApplicationRetrievedSource(response, 'bounded-http');
    } finally {
      clearTimeout(timeout);
    }
  };
}

export async function retrieveBoundedHttpSource(
  input: ApplicationSourceRetrievalRequest,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ApplicationRetrievedSource> {
  const encoded = environment.APPLIK8S_SOURCE_RETRIEVER_POLICY ?? '{}';
  let options: unknown;
  try {
    options = JSON.parse(encoded);
  } catch {
    throw new Error('APPLIK8S_SOURCE_RETRIEVER_POLICY must contain valid JSON.');
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('APPLIK8S_SOURCE_RETRIEVER_POLICY must contain a JSON object.');
  }
  return createBoundedHttpSourceRetriever(options as BoundedHttpSourceRetrieverOptions)(input);
}

async function retrieve(
  url: URL,
  input: ReturnType<typeof normalizeApplicationSourceRetrievalRequest>,
  policy: Readonly<Required<BoundedHttpSourceRetrieverOptions>>,
  signal: AbortSignal,
  redirects: readonly string[],
): Promise<ApplicationRetrievedSource> {
  assertUrlPolicy(url, policy);
  const endpoint = await resolvePublicEndpoint(url.hostname);
  const response = await pinnedRequest(url, endpoint, policy.userAgent, signal);
  const location = response.headers.location;
  if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
    response.resume();
    if (!location) throw new Error(`Source retrieval redirect from ${url} omitted Location.`);
    if (redirects.length >= policy.maximumRedirects) throw new Error('Source retrieval exceeded its redirect limit.');
    const next = new URL(location, url);
    return retrieve(next, input, policy, signal, [...redirects, url.toString()]);
  }
  if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
    response.resume();
    throw new Error(`Source retrieval returned HTTP ${response.statusCode ?? 'unknown'}.`);
  }
  const encoding = String(response.headers['content-encoding'] ?? 'identity').toLowerCase();
  if (encoding !== 'identity') {
    response.resume();
    throw new Error(`Source retrieval rejects encoded response ${encoding}; providers must return identity bytes.`);
  }
  const declaredLength = Number(response.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > input.maximumBytes) {
    response.destroy();
    throw new Error('Source retrieval response exceeds maximumBytes.');
  }
  const mediaType = String(response.headers['content-type'] ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!input.acceptedContentTypes.includes(mediaType)) {
    response.resume();
    throw new Error(`Source retrieval content type ${JSON.stringify(mediaType)} is not accepted.`);
  }
  const bytes = await boundedBody(response, input.maximumBytes, signal);
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const title = mediaType === 'text/html' || mediaType === 'application/xhtml+xml'
    ? htmlTitle(decoded)
    : undefined;
  const text = mediaType === 'text/html' || mediaType === 'application/xhtml+xml'
    ? readableHtmlText(decoded)
    : decoded.trim();
  const digest = createHash('sha256').update(bytes).digest('hex');
  return {
    requestedUrl: redirects[0] ?? url.toString(),
    canonicalUrl: url.toString(),
    mediaType,
    ...(title ? { title } : {}),
    text,
    contentDigest: `sha256:${digest}`,
    sizeBytes: bytes.byteLength,
    retrievedAt: new Date().toISOString(),
    provider: 'bounded-http',
    receipt: {
      redirects,
      networkPolicy: 'dns-pinned-public-addresses-v1',
      contentPolicy: 'identity-bounded-text-v1',
    },
  };
}

function assertUrlPolicy(url: URL, policy: Readonly<Required<BoundedHttpSourceRetrieverOptions>>): void {
  if (url.username || url.password) throw new Error('Source retrieval URL must not contain credentials.');
  if (url.protocol !== 'https:' && !(policy.allowInsecureHttp && url.protocol === 'http:')) {
    throw new Error('Source retrieval requires HTTPS unless allowInsecureHttp is explicit.');
  }
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  if (!policy.allowedPorts.includes(port)) throw new Error(`Source retrieval port ${port} is not allowed.`);
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Source retrieval rejects local hostnames.');
  }
}

async function resolvePublicEndpoint(hostname: string): Promise<{ readonly address: string; readonly family: 4 | 6 }> {
  const normalizedHostname = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  const literalFamily = isIP(normalizedHostname);
  const candidates = literalFamily
    ? [{ address: normalizedHostname, family: literalFamily as 4 | 6 }]
    : await lookup(normalizedHostname, { all: true, verbatim: true });
  if (candidates.length === 0) throw new Error(`Source retrieval could not resolve ${normalizedHostname}.`);
  for (const candidate of candidates) {
    if (!isPublicAddress(candidate.address)) {
      throw new Error(`Source retrieval rejects non-public address ${candidate.address}.`);
    }
  }
  const selected = candidates[0]!;
  return { address: selected.address, family: selected.family as 4 | 6 };
}

function pinnedRequest(
  url: URL,
  endpoint: { readonly address: string; readonly family: 4 | 6 },
  userAgent: string,
  signal: AbortSignal,
): Promise<IncomingMessage> {
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const options: RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      ...(url.port ? { port: url.port } : {}),
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        accept: 'text/html, application/xhtml+xml, text/plain;q=0.9',
        'accept-encoding': 'identity',
        'user-agent': userAgent,
      },
      lookup: (_hostname, _options, callback) => callback(null, endpoint.address, endpoint.family),
      signal,
    };
    const outgoing = request(options, resolve);
    outgoing.once('error', reject);
    outgoing.end();
  });
}

async function boundedBody(response: IncomingMessage, maximumBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response) {
    if (signal.aborted) throw signal.reason;
    const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
    size += bytes.byteLength;
    if (size > maximumBytes) {
      response.destroy();
      throw new Error('Source retrieval response exceeds maximumBytes.');
    }
    chunks.push(bytes);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function htmlTitle(value: string): string | undefined {
  const match = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/iu.exec(value);
  const title = match?.[1] ? decodeEntities(stripTags(match[1])).replace(/\s+/gu, ' ').trim() : '';
  return title ? title.slice(0, 1_000) : undefined;
}

function readableHtmlText(value: string): string {
  return decodeEntities(stripTags(value
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/<(?:script|style|noscript|template)(?:\s[^>]*)?>[\s\S]*?<\/(?:script|style|noscript|template)>/giu, ' ')))
    .replace(/\s+/gu, ' ')
    .trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/gu, ' ');
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'");
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const parts = address.split('.').map(Number);
    const [a = 0, b = 0] = parts;
    return !(
      a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0 && parts[2] === 2)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && parts[2] === 100)
      || (a === 203 && b === 0 && parts[2] === 113)
      || a >= 224
    );
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith('::ffff:')) return isPublicAddress(normalized.slice(7));
    return !(
      normalized === '::'
      || normalized === '::1'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || /^fe[89ab]/u.test(normalized)
      || normalized.startsWith('ff')
      || normalized.startsWith('2001:db8:')
    );
  }
  return false;
}
