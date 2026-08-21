// typecast-file-boundary: OAuth persistence and token payloads are schema-checked before typed runtime use.
import { createHash, randomBytes } from 'node:crypto';
import type {
  ApplicationOAuthAuthorizationFlowPrincipal,
  ApplicationPrincipal,
} from '@applik8s/core';
import { nodeKeyedDigestBase64Url } from '@applik8s/runtime/node-integrity';
import type { ApplicationIdentityFlowBinding } from './contracts.js';
import type {
  ApplicationOAuthAuthorizationFlowAdmissionContext,
  ApplicationOAuthAuthorizationFlowIssue,
  ApplicationOAuthAuthorizationFlowRecord,
  ApplicationOAuthAuthorizationFlowRuntime,
  ApplicationOAuthAuthorizationFlowStore,
  ApplicationOAuthAuthorizationProviderAdapter,
  ApplicationOAuthClient,
  ApplicationOAuthConsentDecision,
} from './oauth-contracts.js';
import { applicationOAuthProtocolVersion } from './oauth-contracts.js';

export interface ApplicationOAuthAuthorizationFlowRuntimeOptions {
  readonly store: ApplicationOAuthAuthorizationFlowStore;
  readonly providers: readonly ApplicationOAuthAuthorizationProviderAdapter[];
  readonly bindingSecret: string;
  readonly defaultLifetimeMs?: number;
  readonly maximumLifetimeMs?: number;
  readonly clock?: () => Date;
  readonly identifier?: () => string;
}

export class ApplicationOAuthAuthorizationFlowError extends Error {
  readonly code:
    | 'OAUTH_FLOW_UNAVAILABLE'
    | 'OAUTH_FLOW_BINDING_INVALID'
    | 'OAUTH_RESOURCE_OWNER_INVALID'
    | 'OAUTH_CLIENT_INVALID'
    | 'OAUTH_REQUEST_INVALID'
    | 'OAUTH_PROVIDER_DECISION_INVALID';
  readonly publicCode = 'oauth_authorization_unavailable';

  constructor(
    code: ApplicationOAuthAuthorizationFlowError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'ApplicationOAuthAuthorizationFlowError';
    this.code = code;
  }
}

export class ApplicationOAuthAuthorizationFlowService
  implements ApplicationOAuthAuthorizationFlowRuntime
{
  readonly #store: ApplicationOAuthAuthorizationFlowStore;
  readonly #providers: ReadonlyMap<
    string,
    ApplicationOAuthAuthorizationProviderAdapter
  >;
  readonly #bindingSecret: string;
  readonly #defaultLifetimeMs: number;
  readonly #maximumLifetimeMs: number;
  readonly #clock: () => Date;
  readonly #identifier: () => string;

  constructor(options: ApplicationOAuthAuthorizationFlowRuntimeOptions) {
    if (options.bindingSecret.length < 32) {
      throw new Error(
        'OAuth flow binding secret must contain at least 32 characters.',
      );
    }
    const providers = new Map<
      string,
      ApplicationOAuthAuthorizationProviderAdapter
    >();
    for (const provider of options.providers) {
      if (!provider.name.trim() || providers.has(provider.name)) {
        throw new Error(
          `OAuth provider adapter name ${JSON.stringify(provider.name)} must be unique and non-empty.`,
        );
      }
      providers.set(provider.name, provider);
    }
    this.#store = options.store;
    this.#providers = providers;
    this.#bindingSecret = options.bindingSecret;
    this.#defaultLifetimeMs = boundedInteger(
      options.defaultLifetimeMs ?? 10 * 60_000,
      'defaultLifetimeMs',
      60_000,
      60 * 60_000,
    );
    this.#maximumLifetimeMs = boundedInteger(
      options.maximumLifetimeMs ?? 60 * 60_000,
      'maximumLifetimeMs',
      this.#defaultLifetimeMs,
      24 * 60 * 60_000,
    );
    this.#clock = options.clock ?? (() => new Date());
    this.#identifier =
      options.identifier ?? (() => randomBytes(24).toString('base64url'));
  }

  async issue(
    input: ApplicationOAuthAuthorizationFlowIssue,
  ): Promise<ApplicationOAuthAuthorizationFlowRecord> {
    const now = this.#clock();
    assertResourceOwner(input.principal, now);
    this.#provider(input.request.provider);
    const client = normalizedClient(input.client);
    const request = normalizedRequest(input.request);
    assertRequestForClient(request, client);
    const lifetimeMs = boundedInteger(
      input.lifetimeMs ?? this.#defaultLifetimeMs,
      'lifetimeMs',
      60_000,
      this.#maximumLifetimeMs,
    );
    const flow: ApplicationOAuthAuthorizationFlowRecord = {
      apiVersion: applicationOAuthProtocolVersion,
      id: `oauth_flow_${this.#identifier()}`,
      provider: request.provider,
      providerAuthorizationRequestId: request.providerAuthorizationRequestId,
      authorizationRequestId: request.id,
      clientId: client.id,
      clientRevision: client.revision,
      redirectUri: request.redirectUri,
      scopes: request.scopes,
      resources: request.resources,
      audience: request.audience,
      ...(request.codeChallenge
        ? {
            codeChallenge: request.codeChallenge,
            codeChallengeMethod: 'S256',
          }
        : {}),
      resourceOwner: input.principal.identity,
      resourceOwnerPrincipalId: input.principal.id,
      sessionId: requiredString(input.principal.sessionId, 'principal.sessionId'),
      authenticationMethod: input.principal.authenticationMethod,
      authorityRevision: input.principal.authorityRevision,
      browserBindingDigest: this.#digest(
        'browser',
        input.binding.browserBinding,
      ),
      csrfBindingDigest: this.#digest('csrf', input.binding.csrfToken),
      state: 'active',
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + lifetimeMs).toISOString(),
      version: 1,
    };
    return this.#store.create(flow);
  }

  async admit(
    flowId: string,
    binding: ApplicationIdentityFlowBinding,
    principal: ApplicationPrincipal,
    context: ApplicationOAuthAuthorizationFlowAdmissionContext,
  ): Promise<ApplicationOAuthAuthorizationFlowPrincipal> {
    const flow = await this.#activeBoundFlow(flowId, binding, principal, context.now);
    if (
      context.authorityRevision !== principal.authorityRevision
      || context.catalogRevision !== principal.catalogRevision
      || context.trustedContextDigest !== principal.trustedContextDigest
    ) {
      throw oauthFlowError(
        'OAUTH_RESOURCE_OWNER_INVALID',
        `OAuth authorization flow ${flow.id} authority context changed.`,
      );
    }
    return {
      id: `principal:${context.application}:oauth-authorization:${flow.id}`,
      identity: {
        id: `identity:${context.application}:oauth-authorization:${flow.id}`,
        kind: 'oauth-authorization-flow',
        issuer: `applik8s://${context.application}`,
        subject: flow.id,
      },
      kind: 'oauth-authorization-flow',
      authenticationMethod: principal.authenticationMethod,
      audience: [...context.audience],
      trustedContextDigest: context.trustedContextDigest,
      catalogRevision: context.catalogRevision,
      authorityRevision: context.authorityRevision,
      admittedAt: (context.now ?? this.#clock()).toISOString(),
      expiresAt: flow.expiresAt,
      sessionId: flow.sessionId,
      flowId: flow.id,
      resourceOwner: flow.resourceOwner,
      authorizationRequestId: flow.authorizationRequestId,
      clientId: flow.clientId,
      redirectUri: flow.redirectUri,
      scopes: [...flow.scopes],
      resources: [...flow.resources],
    };
  }

  async decide(input: ApplicationOAuthConsentDecision) {
    const pendingState = input.decision === 'approve' ? 'approving' : 'denying';
    const terminalState = input.decision === 'approve' ? 'approved' : 'denied';
    let flow = await this.#boundFlow(
      input.flowId,
      input.binding,
      input.principal,
      ['active', pendingState, terminalState],
    );
    if (flow.state === 'active') {
      flow = await this.#store.replace(
        {
          ...flow,
          state: pendingState,
          version: flow.version + 1,
        },
        flow.version,
      );
    }
    const provider = this.#provider(flow.provider);
    const providerDecision = await provider.decide({
      flow,
      decision: input.decision,
      idempotencyKey: `oauth_consent_${digestValue(
        `${flow.id}\0${input.decision}`,
      )}`,
    });
    assertProviderDecision(flow, input.decision, providerDecision);
    if (flow.state === terminalState) {
      return { flow, provider: providerDecision };
    }
    const decidedAt = this.#clock().toISOString();
    const next = await this.#store.replace(
      {
        ...flow,
        state: terminalState,
        decidedAt,
        providerDecisionId: providerDecision.id,
        version: flow.version + 1,
      },
      flow.version,
    );
    return { flow: next, provider: providerDecision };
  }

  async cancel(
    flowId: string,
    binding: ApplicationIdentityFlowBinding,
    principal: ApplicationPrincipal,
  ): Promise<ApplicationOAuthAuthorizationFlowRecord> {
    const flow = await this.#activeBoundFlow(flowId, binding, principal);
    return this.#store.replace(
      {
        ...flow,
        state: 'cancelled',
        decidedAt: this.#clock().toISOString(),
        version: flow.version + 1,
      },
      flow.version,
    );
  }

  async #activeBoundFlow(
    flowId: string,
    binding: ApplicationIdentityFlowBinding,
    principal: ApplicationPrincipal,
    now = this.#clock(),
  ): Promise<ApplicationOAuthAuthorizationFlowRecord> {
    return this.#boundFlow(flowId, binding, principal, ['active'], now);
  }

  async #boundFlow(
    flowId: string,
    binding: ApplicationIdentityFlowBinding,
    principal: ApplicationPrincipal,
    allowedStates: readonly ApplicationOAuthAuthorizationFlowRecord['state'][],
    now = this.#clock(),
  ): Promise<ApplicationOAuthAuthorizationFlowRecord> {
    assertResourceOwner(principal, now);
    const flow = await this.#store.get(requiredString(flowId, 'flowId'));
    if (
      !flow
      || !allowedStates.includes(flow.state)
      || Date.parse(flow.expiresAt) <= now.getTime()
    ) {
      throw oauthFlowError(
        'OAUTH_FLOW_UNAVAILABLE',
        'OAuth authorization flow is unavailable.',
      );
    }
    if (
      !timingSafeTextEqual(
        flow.browserBindingDigest,
        this.#digest('browser', binding.browserBinding),
      )
      || !timingSafeTextEqual(
        flow.csrfBindingDigest,
        this.#digest('csrf', binding.csrfToken),
      )
    ) {
      throw oauthFlowError(
        'OAUTH_FLOW_BINDING_INVALID',
        `OAuth authorization flow ${flow.id} binding is invalid.`,
      );
    }
    if (
      principal.id !== flow.resourceOwnerPrincipalId
      || principal.identity.id !== flow.resourceOwner.id
      || principal.sessionId !== flow.sessionId
      || principal.authorityRevision !== flow.authorityRevision
    ) {
      throw oauthFlowError(
        'OAUTH_RESOURCE_OWNER_INVALID',
        `OAuth authorization flow ${flow.id} resource owner changed.`,
      );
    }
    return flow;
  }

  #provider(name: string): ApplicationOAuthAuthorizationProviderAdapter {
    const provider = this.#providers.get(name);
    if (!provider) {
      throw new Error(`OAuth provider ${name} is unavailable.`);
    }
    return provider;
  }

  #digest(kind: string, value: string): string {
    return nodeKeyedDigestBase64Url({
      key: this.#bindingSecret,
      purpose: kind,
      value: requiredString(value, `${kind} binding`),
    });
  }
}

export function createApplicationOAuthAuthorizationFlowRuntime(
  options: ApplicationOAuthAuthorizationFlowRuntimeOptions,
): ApplicationOAuthAuthorizationFlowRuntime {
  return new ApplicationOAuthAuthorizationFlowService(options);
}

function normalizedClient(client: ApplicationOAuthClient): ApplicationOAuthClient {
  if (
    client.apiVersion !== applicationOAuthProtocolVersion
    || !client.id.trim()
    || !client.revision.trim()
    || client.state !== 'active'
  ) {
    throw oauthFlowError('OAUTH_CLIENT_INVALID', 'OAuth client is unavailable.');
  }
  const redirectUris = unique(client.redirectUris.map(normalizedRedirectUri));
  const allowedScopes = unique(client.allowedScopes);
  const allowedResources = unique(
    client.allowedResources.map(normalizedResource),
  );
  const allowedAudience = unique(client.allowedAudience);
  const grantTypes = unique(client.grantTypes);
  if (
    !grantTypes.includes('authorization_code')
    || (client.type === 'public' && !client.requirePkce)
  ) {
    throw oauthFlowError(
      'OAUTH_CLIENT_INVALID',
      `OAuth client ${client.id} does not satisfy authorization-code security requirements.`,
    );
  }
  return {
    ...client,
    redirectUris,
    allowedScopes,
    allowedResources,
    allowedAudience,
    grantTypes,
  };
}

function normalizedRequest(
  request: ApplicationOAuthAuthorizationFlowIssue['request'],
) {
  if (
    request.responseType !== 'code'
    || !request.id.trim()
    || !request.provider.trim()
    || !request.providerAuthorizationRequestId.trim()
    || !request.clientId.trim()
  ) {
    throw oauthFlowError(
      'OAUTH_REQUEST_INVALID',
      'OAuth authorization request is invalid.',
    );
  }
  return {
    ...request,
    redirectUri: normalizedRedirectUri(request.redirectUri),
    scopes: unique(request.scopes),
    resources: unique(request.resources.map(normalizedResource)),
    audience: unique(request.audience),
  };
}

function assertRequestForClient(
  request: ReturnType<typeof normalizedRequest>,
  client: ApplicationOAuthClient,
): void {
  const subsets = [
    [request.scopes, client.allowedScopes],
    [request.resources, client.allowedResources],
    [request.audience, client.allowedAudience],
  ] as const;
  if (
    request.clientId !== client.id
    || !client.redirectUris.includes(request.redirectUri)
    || subsets.some(([requested, allowed]) =>
      requested.some((value) => !allowed.includes(value)))
    || (client.requirePkce
      && (!request.codeChallenge || request.codeChallengeMethod !== 'S256'))
  ) {
    throw oauthFlowError(
      'OAUTH_REQUEST_INVALID',
      `OAuth authorization request ${request.id} exceeds client ${client.id}.`,
    );
  }
}

function assertResourceOwner(
  principal: ApplicationPrincipal,
  now: Date,
): void {
  if (
    principal.kind !== 'human'
    || principal.identity.kind !== 'human'
    || !principal.sessionId
    || (principal.expiresAt !== undefined
      && Date.parse(principal.expiresAt) <= now.getTime())
  ) {
    throw oauthFlowError(
      'OAUTH_RESOURCE_OWNER_INVALID',
      'OAuth consent requires an authenticated human resource owner.',
    );
  }
}

function assertProviderDecision(
  flow: ApplicationOAuthAuthorizationFlowRecord,
  decision: ApplicationOAuthConsentDecision['decision'],
  provider: Awaited<
    ReturnType<ApplicationOAuthAuthorizationProviderAdapter['decide']>
  >,
): void {
  if (
    !provider.id.trim()
    || provider.providerAuthorizationRequestId
      !== flow.providerAuthorizationRequestId
    || provider.accepted !== (decision === 'approve')
    || !normalizedProviderContinuation(provider.continuationUri)
  ) {
    throw oauthFlowError(
      'OAUTH_PROVIDER_DECISION_INVALID',
      `OAuth provider decision for flow ${flow.id} changed its bound request.`,
    );
  }
}

function normalizedProviderContinuation(value: string): string {
  const url = new URL(requiredString(value, 'provider continuation URI'));
  if (
    url.protocol !== 'https:'
    && !(url.protocol === 'http:'
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))
  ) {
    throw oauthFlowError(
      'OAUTH_PROVIDER_DECISION_INVALID',
      'OAuth provider continuation must use HTTPS outside loopback.',
    );
  }
  if (url.username || url.password) {
    throw oauthFlowError(
      'OAUTH_PROVIDER_DECISION_INVALID',
      'OAuth provider continuation must not contain credentials.',
    );
  }
  return url.toString();
}

function normalizedRedirectUri(value: string): string {
  const url = new URL(requiredString(value, 'redirectUri'));
  if (
    url.protocol !== 'https:'
    && !(url.protocol === 'http:'
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))
  ) {
    throw oauthFlowError(
      'OAUTH_REQUEST_INVALID',
      'OAuth redirect URI must use HTTPS outside loopback.',
    );
  }
  if (url.username || url.password || url.hash) {
    throw oauthFlowError(
      'OAUTH_REQUEST_INVALID',
      'OAuth redirect URI must not contain credentials or a fragment.',
    );
  }
  return url.toString();
}

function normalizedResource(value: string): string {
  const url = new URL(requiredString(value, 'resource'));
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw oauthFlowError(
      'OAUTH_REQUEST_INVALID',
      'OAuth resource must be a canonical HTTPS URI.',
    );
  }
  return url.toString();
}

function unique<T extends string>(values: readonly T[]): T[] {
  const normalized = values.map((value) => requiredString(value, 'OAuth value'));
  if (new Set(normalized).size !== normalized.length) {
    throw oauthFlowError(
      'OAUTH_REQUEST_INVALID',
      'OAuth request values must not contain duplicates.',
    );
  }
  return normalized as T[];
}

function requiredString(
  value: string | undefined,
  field: string,
): string {
  if (!value?.trim()) throw new Error(`${field} must not be empty.`);
  return value;
}

function boundedInteger(
  value: number,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${field} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function digestValue(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function timingSafeTextEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return leftDigest.equals(rightDigest);
}

function oauthFlowError(
  code: ApplicationOAuthAuthorizationFlowError['code'],
  message: string,
): ApplicationOAuthAuthorizationFlowError {
  return new ApplicationOAuthAuthorizationFlowError(code, message);
}
