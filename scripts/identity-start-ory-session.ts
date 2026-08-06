import { randomBytes, randomUUID } from 'node:crypto';

export interface IdentityStartOrySession {
  readonly identityId: string;
  readonly expectedPrincipal: string;
  readonly cookie: string;
  readonly email: string;
}

export interface CreateIdentityStartOrySessionOptions {
  readonly publicUrl: string;
  readonly adminUrl: string;
  readonly roles: readonly string[];
  readonly fetch?: IdentityStartFetch;
}

export type IdentityStartFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Creates one release-run-scoped Kratos identity and authenticates it through
 * the browser flow. The returned cookie is provider-issued evidence; the
 * application never accepts a caller-authored identity or role.
 */
export async function createIdentityStartOrySession(
  options: CreateIdentityStartOrySessionOptions,
): Promise<IdentityStartOrySession> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const publicUrl = normalizedBaseUrl(options.publicUrl, 'publicUrl');
  const adminUrl = normalizedBaseUrl(options.adminUrl, 'adminUrl');
  const suffix = randomUUID();
  const email = `v07-${suffix}@identity-start.example.test`;
  // Keep the credential independent from the identifier. Kratos enables its
  // identifier-similarity check by default; deriving the password from the
  // email's UUID can create an identity whose password credential is rejected
  // even though the administrative identity request itself succeeds.
  const password = `A8!${randomBytes(24).toString('base64url')}`;
  const identity = await requestJson(
    fetcher,
    new URL('admin/identities', adminUrl),
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        schema_id: 'default',
        traits: { email },
        metadata_public: { roles: [...options.roles] },
        credentials: {
          password: { config: { password } },
        },
      }),
    },
    [201],
  );
  const identityId = requiredString(identity.json.id, 'identity.id');

  const started = await requestJson(
    fetcher,
    new URL('self-service/login/browser', publicUrl),
    { headers: { accept: 'application/json' }, redirect: 'manual' },
    [200],
  );
  const flowId = requiredString(started.json.id, 'login flow id');
  const csrfToken = loginCsrfToken(started.json);
  const flowCookies = cookieHeader(started.setCookies);

  const completed = await requestJson(
    fetcher,
    new URL(
      `self-service/login?flow=${encodeURIComponent(flowId)}`,
      publicUrl,
    ),
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(flowCookies ? { cookie: flowCookies } : {}),
      },
      body: JSON.stringify({
        method: 'password',
        identifier: email,
        password,
        ...(csrfToken ? { csrf_token: csrfToken } : {}),
      }),
      redirect: 'manual',
    },
    [200, 303],
  );
  const cookie = sessionCookie([
    ...started.setCookies,
    ...completed.setCookies,
  ]);
  return Object.freeze({
    identityId,
    expectedPrincipal: `identity:ory:${identityId}`,
    cookie,
    email,
  });
}

interface JsonResponse {
  readonly json: Readonly<Record<string, unknown>>;
  readonly setCookies: readonly string[];
}

async function requestJson(
  fetcher: IdentityStartFetch,
  url: URL,
  init: RequestInit,
  acceptedStatuses: readonly number[],
): Promise<JsonResponse> {
  const response = await fetcher(url, init);
  const text = await response.text();
  const json = text ? parseObject(text, url) : {};
  if (!acceptedStatuses.includes(response.status)) {
    throw new Error(
      `Ory request ${init.method ?? 'GET'} ${url} returned ${response.status}: ${text.slice(0, 2_000)}`,
    );
  }
  return {
    json,
    setCookies: responseCookies(response.headers),
  };
}

function parseObject(
  value: string,
  url: URL,
): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Ory response from ${url} is not an object.`);
  }
  // typecast: the runtime object guard above establishes the JSON record boundary.
  return parsed as Readonly<Record<string, unknown>>;
}

function loginCsrfToken(
  flow: Readonly<Record<string, unknown>>,
): string | undefined {
  const ui = record(flow.ui);
  const nodes = Array.isArray(ui?.nodes) ? ui.nodes : [];
  for (const node of nodes) {
    const attributes = record(record(node)?.attributes);
    if (
      attributes?.name === 'csrf_token'
      && typeof attributes.value === 'string'
      && attributes.value
    ) {
      return attributes.value;
    }
  }
  return undefined;
}

function sessionCookie(values: readonly string[]): string {
  const candidates = values
    .map((value) => value.split(';', 1)[0]?.trim())
    .filter((value): value is string => Boolean(value?.includes('=')));
  const session = candidates.find((value) =>
    /^(?:ory_kratos_session|ory_session)=/u.test(value),
  );
  if (!session) {
    throw new Error(
      `Ory browser login did not return a session cookie; received ${candidates.map(cookieName).join(', ') || 'none'}.`,
    );
  }
  return session;
}

function responseCookies(headers: Headers): readonly string[] {
  // typecast: Node extends the standard Headers surface with getSetCookie at runtime.
  const extended = headers as Headers & {
    readonly getSetCookie?: () => string[];
  };
  const values = extended.getSetCookie?.();
  if (values && values.length > 0) return values;
  const value = headers.get('set-cookie');
  return value ? [value] : [];
}

function cookieHeader(values: readonly string[]): string {
  return values
    .map((value) => value.split(';', 1)[0]?.trim())
    .filter((value): value is string => Boolean(value))
    .join('; ');
}

function cookieName(value: string): string {
  return value.slice(0, Math.max(0, value.indexOf('=')));
}

function normalizedBaseUrl(value: string, field: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Ory ${field} must be an HTTP(S) URL.`);
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Ory ${field} must be a non-empty string.`);
  }
  return value;
}

function record(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    // typecast: the object and array guards establish the JSON record boundary.
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}
