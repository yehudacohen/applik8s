interface IdentityOptions {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export async function authenticateWithHelpers(request: Request, options: IdentityOptions = {}) {
  return fetchIdentity(options.fetch ?? fetch, new URL(request.url), options.timeoutMs ?? 3_000);
}

async function fetchIdentity(requestFetch: typeof fetch, endpoint: URL, timeoutMs: number) {
  const response = await requestFetch(endpoint, { signal: AbortSignal.timeout(timeoutMs) });
  return normalizeIdentity(await response.json());
}

function normalizeIdentity(value: unknown) {
  return value && typeof value === 'object' ? value : {};
}
