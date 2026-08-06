import type { CoreV1Api, V1Secret } from "@kubernetes/client-node";

export async function generatedSecretClient(
  context: string,
): Promise<CoreV1Api> {
  // static-import-exception: keep the provider declaration/state surface portable.
  const kubernetes = await import("@kubernetes/client-node");
  const config = new kubernetes.KubeConfig();
  config.loadFromDefault();
  config.setCurrentContext(context);
  return config.makeApiClient(kubernetes.CoreV1Api);
}

export async function readGeneratedSecret(
  core: CoreV1Api,
  namespace: string,
  name: string,
): Promise<V1Secret | undefined> {
  return core
    .readNamespacedSecret({ namespace, name })
    .catch((cause: unknown) => {
      if (statusCode(cause) === 404) return undefined;
      throw cause;
    });
}

function statusCode(cause: unknown): number | undefined {
  if (!cause || typeof cause !== "object") return undefined;
  const direct = Reflect.get(cause, "statusCode") ?? Reflect.get(cause, "code");
  if (typeof direct === "number") return direct;
  const response = Reflect.get(cause, "response");
  if (!response || typeof response !== "object") return undefined;
  const responseStatus = Reflect.get(response, "statusCode");
  return typeof responseStatus === "number" ? responseStatus : undefined;
}
