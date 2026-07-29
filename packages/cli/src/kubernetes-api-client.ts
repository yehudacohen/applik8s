// typecast-file-boundary: Kubernetes client constructors have equivalent runtime call shapes that their generated overloads cannot express generically.
import * as http from 'node:http';
import * as https from 'node:https';

import type { KubeConfig } from '@kubernetes/client-node';
import type { ApiConstructor, ApiType } from '@kubernetes/client-node/dist/config.js';
import { createConfiguration } from '@kubernetes/client-node/dist/gen/configuration.js';
import {
  type RequestBody,
  type RequestContext,
  ResponseContext,
  SelfDecodingBody,
  wrapHttpLibrary,
} from '@kubernetes/client-node/dist/gen/http/http.js';
import { ServerConfiguration } from '@kubernetes/client-node/dist/gen/servers.js';

/**
 * Construct a generated Kubernetes client without losing kubeconfig TLS material under Bun.
 *
 * Bun replaces node-fetch with native fetch and currently ignores the https.Agent that
 * @kubernetes/client-node builds from kubeconfig. Node uses the upstream client unchanged;
 * Bun receives a small Node HTTP transport that preserves the agent's CA/cert/key options.
 */
export function makeKubernetesApiClient<T extends ApiType>(
  kubeConfig: KubeConfig,
  ApiClient: ApiConstructor<T>,
): T {
  if (typeof Bun === 'undefined') return kubeConfig.makeApiClient(ApiClient);
  const cluster = kubeConfig.getCurrentCluster();
  if (!cluster) throw new Error('Selected Kubernetes context has no active cluster.');
  const httpApi = wrapHttpLibrary({ send: sendKubernetesRequest });
  const configuration = createConfiguration({
    baseServer: new ServerConfiguration(cluster.server, {}),
    authMethods: { default: kubeConfig },
    httpApi,
  });
  return new ApiClient(configuration);
}

async function sendKubernetesRequest(request: RequestContext): Promise<ResponseContext> {
  const url = new URL(request.getUrl());
  const tls = url.protocol === 'https:';
  const agent = request.getAgent();
  const agentOptions = agent && 'options' in agent
    ? Reflect.get(agent, 'options') as Readonly<Record<string, unknown>>
    : {};
  const body = requestBodyBytes(request.getBody());
  const response = await new Promise<ResponseContext>((resolve, reject) => {
    const outgoing = (tls ? https : http).request({
      hostname: url.hostname,
      port: url.port || (tls ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: request.getHttpMethod(),
      agent: false,
      headers: { connection: 'close', ...request.getHeaders() },
      ...(tls ? tlsRequestOptions(agentOptions) : {}),
    }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      incoming.on('error', reject);
      incoming.on('end', () => {
        const headers = Object.fromEntries(Object.entries(incoming.headers).flatMap(([name, value]) =>
          value === undefined ? [] : [[name, Array.isArray(value) ? value.join(', ') : value]]));
        resolve(new ResponseContext(
          incoming.statusCode ?? 0,
          headers,
          new SelfDecodingBody(Promise.resolve(Buffer.concat(chunks))),
        ));
      });
    });
    outgoing.on('error', reject);
    outgoing.setTimeout(120_000, () => outgoing.destroy(new Error(`Kubernetes API request timed out: ${request.getHttpMethod()} ${url.pathname}`)));
    outgoing.on('socket', (socket) => socket.unref());
    if (body) outgoing.write(body);
    outgoing.end();
  });
  return response;
}

function requestBodyBytes(body: RequestBody): Buffer | undefined {
  if (body === undefined) return undefined;
  if (typeof body === 'string') return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  throw new Error('Bun Kubernetes transport received an unsupported streaming request body.');
}

function tlsRequestOptions(options: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return {
    rejectUnauthorized: options.rejectUnauthorized ?? true,
    ...(options.ca !== undefined ? { ca: options.ca } : {}),
    ...(options.cert !== undefined ? { cert: options.cert } : {}),
    ...(options.key !== undefined ? { key: options.key } : {}),
    ...(options.pfx !== undefined ? { pfx: options.pfx } : {}),
    ...(options.passphrase !== undefined ? { passphrase: options.passphrase } : {}),
    ...(options.servername !== undefined ? { servername: options.servername } : {}),
  };
}
