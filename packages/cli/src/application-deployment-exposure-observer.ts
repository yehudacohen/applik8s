import type { ResolvedApplicationContainerRegistry } from '@applik8s/applik8s/deployment-registry';
import { makeKubernetesApiClient } from './kubernetes-api-client.js';

export interface ApplicationEndpointVerificationOptions {
  readonly timeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

interface ApplicationDeploymentOutput {
  stdout(message: string): void;
}

/** Verify the public URL projected by the authoritative Application status. */
export async function waitForApplicationEndpoint(
  url: string,
  io: ApplicationDeploymentOutput,
  options: ApplicationEndpointVerificationOptions = {},
): Promise<void> {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new Error(`Application status URL ${url} must use http or https.`);
  }
  const timeoutMs = options.timeoutMs ?? 2 * 60_000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const fetchEndpoint = options.fetch ?? fetch;
  const startedAt = Date.now();
  let lastFailure = 'no request completed';
  let lastReport = 0;
  while (Date.now() - startedAt < timeoutMs) {
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    const controller = new AbortController();
    const requestTimeout = setTimeout(
      () => controller.abort(new Error(`request exceeded ${Math.min(requestTimeoutMs, remainingMs)}ms`)),
      Math.min(requestTimeoutMs, remainingMs),
    );
    try {
      const response = await fetchEndpoint(endpoint, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      });
      if (response.status >= 200 && response.status < 400) return;
      lastFailure = `HTTP ${response.status}`;
    } catch (cause) {
      lastFailure = cause instanceof Error ? cause.message : String(cause);
    } finally {
      clearTimeout(requestTimeout);
    }
    if (Date.now() - lastReport >= 15_000) {
      io.stdout(`Waiting for public endpoint ${endpoint.toString()}: ${lastFailure}`);
      lastReport = Date.now();
    }
    if (Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, timeoutMs - (Date.now() - startedAt))));
    }
  }
  throw new Error(`Timed out after ${timeoutMs}ms reaching ${endpoint.toString()}; last result: ${lastFailure}.`);
}

export async function verifyApplicationRegistryPullSecret(
  registry: ResolvedApplicationContainerRegistry,
  context: string,
): Promise<void> {
  if (!registry.remote || !registry.pullSecret) {
    if (registry.remote && registry.provider.kind !== 'orbstack-container-registry' && registry.provider.pushCredentials) {
      throw new Error('Authenticated remote ContainerRegistry deployments require a namespace-scoped pullSecret before authored workloads can be applied.');
    }
    return;
  }
  // static-import-exception: Kubernetes observation belongs only in the Node deployment host.
  const kubernetes = await import('@kubernetes/client-node');
  const kubeConfig = new kubernetes.KubeConfig();
  kubeConfig.loadFromDefault();
  kubeConfig.setCurrentContext(context);
  const secret = await makeKubernetesApiClient(kubeConfig, kubernetes.CoreV1Api).readNamespacedSecret({
    name: registry.pullSecret.name,
    namespace: registry.pullSecret.namespace,
  }).catch((cause: unknown) => {
    if (kubernetesStatusCode(cause) === 404) {
      throw new Error(`ContainerRegistry pull Secret ${registry.pullSecret?.namespace}/${registry.pullSecret?.name} does not exist after registry provisioning.`);
    }
    throw cause;
  });
  if (secret.type !== 'kubernetes.io/dockerconfigjson' || !secret.data?.['.dockerconfigjson']) {
    throw new Error(`ContainerRegistry pull Secret ${registry.pullSecret.namespace}/${registry.pullSecret.name} must be type kubernetes.io/dockerconfigjson with .dockerconfigjson data.`);
  }
}

export function kubernetesStatusCode(cause: unknown): number | undefined {
  if (!cause || typeof cause !== 'object') return undefined;
  const response = Reflect.get(cause, 'response');
  const responseStatus = response && typeof response === 'object' ? Reflect.get(response, 'statusCode') ?? Reflect.get(response, 'status') : undefined;
  const direct = Reflect.get(cause, 'statusCode') ?? Reflect.get(cause, 'status');
  const value = responseStatus ?? direct;
  if (typeof value === 'number') return value;
  const body = Reflect.get(cause, 'body');
  const parsedBody = typeof body === 'string'
    ? (() => {
        try {
          return JSON.parse(body) as unknown;
        } catch {
          return undefined;
        }
      })()
    : body;
  if (parsedBody && typeof parsedBody === 'object') {
    const bodyCode = Reflect.get(parsedBody, 'code');
    if (typeof bodyCode === 'number') return bodyCode;
  }
  const message = Reflect.get(cause, 'message');
  if (typeof message === 'string') {
    const match = message.match(/(?:HTTP-Code|status(?:Code)?):\s*(\d{3})\b/i);
    if (match?.[1]) return Number(match[1]);
  }
  return undefined;
}
