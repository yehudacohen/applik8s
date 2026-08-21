// typecast-file-boundary: Identity storage and signed payloads are validated before typed runtime contracts are reconstructed.
import { createHash, randomBytes } from 'node:crypto';
import type {
  ApplicationPreAuthenticationFlowPrincipal,
  ApplicationPrincipal,
} from '@applik8s/core';
import { nodeKeyedDigestBase64Url } from '@applik8s/runtime/node-integrity';
import type {
  ApplicationIdentityAdmissionReceipt,
  ApplicationIdentityFlowAdmissionContext,
  ApplicationIdentityFlowBinding,
  ApplicationIdentityFlowStore,
  ApplicationIdentityPrincipalAdmitter,
  ApplicationIdentityProviderAdapter,
  ApplicationOrphanedProviderSession,
  ApplicationPreAuthenticationFlowIssue,
  ApplicationPreAuthenticationFlowRecord,
  ApplicationPreAuthenticationFlowRuntime,
  ApplicationPreAuthenticationTransition,
  ApplicationProviderCompletionAdmission,
} from './contracts.js';
import { applicationIdentityProtocolVersion } from './contracts.js';

export interface ApplicationPreAuthenticationFlowRuntimeOptions {
  readonly store: ApplicationIdentityFlowStore;
  readonly providers: readonly ApplicationIdentityProviderAdapter[];
  readonly admitPrincipal: ApplicationIdentityPrincipalAdmitter;
  readonly bindingSecret: string;
  readonly defaultLifetimeMs?: number;
  readonly maximumLifetimeMs?: number;
  readonly defaultMaximumAttempts?: number;
  readonly clock?: () => Date;
  readonly identifier?: () => string;
}

export class ApplicationIdentityFlowError extends Error {
  readonly code:
    | 'FLOW_UNAVAILABLE'
    | 'FLOW_BINDING_INVALID'
    | 'FLOW_TRANSITION_INVALID'
    | 'FLOW_RATE_LIMITED'
    | 'PROVIDER_CONTINUITY_INVALID'
    | 'PROVIDER_COMPLETION_INVALID'
    | 'PROVIDER_SESSION_ORPHANED';
  readonly publicCode = 'identity_flow_unavailable';

  constructor(
    code: ApplicationIdentityFlowError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'ApplicationIdentityFlowError';
    this.code = code;
  }
}

export class ApplicationPreAuthenticationFlowService
  implements ApplicationPreAuthenticationFlowRuntime
{
  readonly #store: ApplicationIdentityFlowStore;
  readonly #providers: ReadonlyMap<string, ApplicationIdentityProviderAdapter>;
  readonly #admitPrincipal: ApplicationIdentityPrincipalAdmitter;
  readonly #bindingSecret: string;
  readonly #defaultLifetimeMs: number;
  readonly #maximumLifetimeMs: number;
  readonly #defaultMaximumAttempts: number;
  readonly #clock: () => Date;
  readonly #identifier: () => string;

  constructor(options: ApplicationPreAuthenticationFlowRuntimeOptions) {
    if (options.bindingSecret.length < 32) {
      throw new Error(
        'Identity flow binding secret must contain at least 32 characters.',
      );
    }
    const providers = new Map<string, ApplicationIdentityProviderAdapter>();
    for (const provider of options.providers) {
      if (!provider.name.trim() || providers.has(provider.name)) {
        throw new Error(
          `Identity provider adapter name ${JSON.stringify(provider.name)} must be unique and non-empty.`,
        );
      }
      providers.set(provider.name, provider);
    }
    this.#store = options.store;
    this.#providers = providers;
    this.#admitPrincipal = options.admitPrincipal;
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
    this.#defaultMaximumAttempts = boundedInteger(
      options.defaultMaximumAttempts ?? 8,
      'defaultMaximumAttempts',
      1,
      100,
    );
    this.#clock = options.clock ?? (() => new Date());
    this.#identifier =
      options.identifier ?? (() => randomBytes(24).toString('base64url'));
  }

  async issue(
    input: ApplicationPreAuthenticationFlowIssue,
  ): Promise<ApplicationPreAuthenticationFlowRecord> {
    const provider = this.#provider(input.provider);
    void provider;
    const now = this.#clock();
    const lifetimeMs = boundedInteger(
      input.lifetimeMs ?? this.#defaultLifetimeMs,
      'lifetimeMs',
      60_000,
      this.#maximumLifetimeMs,
    );
    const maximumAttempts = boundedInteger(
      input.maximumAttempts ?? this.#defaultMaximumAttempts,
      'maximumAttempts',
      1,
      100,
    );
    const allowedTransitions = normalizedUniqueStrings(
      input.allowedTransitions,
      'allowedTransitions',
    );
    if (allowedTransitions.length === 0) {
      throw new Error(
        'Identity flow must admit at least one explicit transition.',
      );
    }
    assertOAuthContinuation(input.oauth);
    const id = `identity_flow_${this.#identifier()}`;
    const flow: ApplicationPreAuthenticationFlowRecord = {
      apiVersion: applicationIdentityProtocolVersion,
      id,
      kind: input.kind,
      provider: input.provider,
      providerFlowId: requiredString(input.providerFlowId, 'providerFlowId'),
      browserBindingDigest: this.#digest(
        'browser',
        input.binding.browserBinding,
      ),
      csrfBindingDigest: this.#digest('csrf', input.binding.csrfToken),
      providerContinuityDigest: this.#digest(
        'provider-continuity',
        input.binding.providerContinuity,
      ),
      ...(input.subjectHint
        ? { subjectHintDigest: this.#digest('subject', input.subjectHint) }
        : {}),
      ...(input.binding.networkBinding
        ? {
            networkBindingDigest: this.#digest(
              'network',
              input.binding.networkBinding,
            ),
          }
        : {}),
      ...(input.oauth ? { oauth: normalizedOAuthContinuation(input.oauth) } : {}),
      allowedTransitions,
      completedTransitions: [],
      state: 'active',
      attempts: 0,
      maximumAttempts,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + lifetimeMs).toISOString(),
      version: 1,
    };
    return this.#store.createFlow(flow);
  }

  async admit(
    flowId: string,
    binding: ApplicationIdentityFlowBinding,
    context: ApplicationIdentityFlowAdmissionContext,
  ): Promise<ApplicationPreAuthenticationFlowPrincipal> {
    const flow = await this.#activeBoundFlow(flowId, binding, context.now);
    return {
      id: `principal:${context.application}:pre-authentication:${flow.id}`,
      identity: {
        id: `identity:${context.application}:pre-authentication:${flow.id}`,
        kind: 'pre-authentication-flow',
        issuer: `applik8s://${context.application}`,
        subject: flow.id,
      },
      kind: 'pre-authentication-flow',
      authenticationMethod: 'bounded-pre-authentication-flow',
      audience: [...context.audience],
      trustedContextDigest: requiredString(
        context.trustedContextDigest,
        'trustedContextDigest',
      ),
      catalogRevision: requiredString(
        context.catalogRevision,
        'catalogRevision',
      ),
      authorityRevision: requiredString(
        context.authorityRevision,
        'authorityRevision',
      ),
      admittedAt: (context.now ?? this.#clock()).toISOString(),
      expiresAt: flow.expiresAt,
      flowId: flow.id,
      browserBindingDigest: flow.browserBindingDigest,
      csrfBindingDigest: flow.csrfBindingDigest,
      allowedTransitions: [...flow.allowedTransitions],
    };
  }

  async transition(
    input: ApplicationPreAuthenticationTransition,
  ): Promise<ApplicationPreAuthenticationFlowRecord> {
    const flow = await this.#activeBoundFlow(input.flowId, input.binding);
    if (!flow.allowedTransitions.includes(input.transition)) {
      throw identityFlowError(
        'FLOW_TRANSITION_INVALID',
        `Identity flow ${flow.id} does not admit transition ${input.transition}.`,
      );
    }
    if (flow.completedTransitions.includes(input.transition)) return flow;
    if (flow.attempts >= flow.maximumAttempts) {
      throw identityFlowError(
        'FLOW_RATE_LIMITED',
        `Identity flow ${flow.id} exhausted its attempt budget.`,
      );
    }
    return this.#store.replaceFlow(
      {
        ...flow,
        completedTransitions: [
          ...flow.completedTransitions,
          input.transition,
        ],
        attempts: flow.attempts + 1,
        version: flow.version + 1,
      },
      flow.version,
    );
  }

  async complete(
    input: ApplicationProviderCompletionAdmission,
  ): Promise<ApplicationIdentityAdmissionReceipt> {
    const completionKey = providerCompletionKey(input.completion);
    const replay = await this.#store.getAdmissionReceipt(completionKey);
    if (replay) {
      if (replay.flowId !== input.flowId) {
        throw identityFlowError(
          'PROVIDER_COMPLETION_INVALID',
          `Provider completion ${completionKey} belongs to another flow.`,
        );
      }
      await this.#activeOrConsumedBoundFlow(
        input.flowId,
        input.binding,
        input.context.now,
      );
      return replay;
    }
    const flow = await this.#activeBoundFlow(
      input.flowId,
      input.binding,
      input.context.now,
    );
    assertProviderCompletion(flow, input.completion);
    if (flow.attempts >= flow.maximumAttempts) {
      throw identityFlowError(
        'FLOW_RATE_LIMITED',
        `Identity flow ${flow.id} exhausted its attempt budget.`,
      );
    }
    const principal = await this.#admitPrincipal({
      completion: input.completion,
      flow,
      context: input.context,
    });
    assertAdmittedPrincipal(principal, input.completion, input.context);
    const now = input.context.now ?? this.#clock();
    const receipt: ApplicationIdentityAdmissionReceipt = {
      apiVersion: 'applik8s.identityAdmission/v1alpha1',
      id: `identity_admission_${digestValue(
        `${flow.id}\0${completionKey}`,
      ).slice(0, 40)}`,
      flowId: flow.id,
      provider: flow.provider,
      providerCompletionKey: completionKey,
      providerSessionId: input.completion.providerSessionId,
      principal,
      authenticationMethod: input.completion.authenticationMethod,
      assurance: normalizedUniqueStrings(
        input.completion.assurance,
        'completion.assurance',
      ),
      trustedContextDigest: input.context.trustedContextDigest,
      ...(flow.oauth ? { oauth: flow.oauth } : {}),
      issuedAt: now.toISOString(),
      ...(input.completion.expiresAt
        ? { expiresAt: input.completion.expiresAt }
        : {}),
    };
    try {
      const result = await this.#store.commitAdmission({
        flow: {
          ...flow,
          state: 'consumed',
          attempts: flow.attempts + 1,
          consumedAt: now.toISOString(),
          version: flow.version + 1,
        },
        expectedFlowVersion: flow.version,
        receipt,
      });
      return result.receipt;
    } catch (error) {
      const recovered = await this.#store.getAdmissionReceipt(completionKey);
      if (recovered) return recovered;
      await this.#containOrphan(flow, input.completion, completionKey, error);
      throw identityFlowError(
        'PROVIDER_SESSION_ORPHANED',
        `Identity provider completion for flow ${flow.id} could not be committed locally.`,
      );
    }
  }

  async cancel(
    flowId: string,
    binding: ApplicationIdentityFlowBinding,
  ): Promise<ApplicationPreAuthenticationFlowRecord> {
    const flow = await this.#activeBoundFlow(flowId, binding);
    const now = this.#clock().toISOString();
    return this.#store.replaceFlow(
      {
        ...flow,
        state: 'cancelled',
        cancelledAt: now,
        version: flow.version + 1,
      },
      flow.version,
    );
  }

  async reconcileOrphans(
    limit = 100,
  ): Promise<readonly ApplicationOrphanedProviderSession[]> {
    const boundedLimit = boundedInteger(limit, 'orphan limit', 1, 1_000);
    const pending = await this.#store.listPendingOrphans(boundedLimit);
    const resolved: ApplicationOrphanedProviderSession[] = [];
    for (const orphan of pending) {
      const provider = this.#provider(orphan.provider);
      try {
        const state = provider.sessionState
          ? await provider.sessionState(orphan.providerSessionId)
          : 'unknown';
        const evidence =
          state === 'revoked' || state === 'expired'
            ? { state }
            : await provider.revokeSession(
                orphan.providerSessionId,
                `Recover orphaned identity flow ${orphan.flowId}.`,
              );
        resolved.push(
          await this.#store.resolveOrphan(orphan.id, orphan.version, {
            state: state === 'expired' ? 'expired' : 'revoked',
            resolvedAt: this.#clock().toISOString(),
            evidence,
          }),
        );
      } catch {
        // The pending obligation is intentionally retained until neutralization
        // or guaranteed expiry is observed.
      }
    }
    return resolved;
  }

  async #activeBoundFlow(
    flowId: string,
    binding: ApplicationIdentityFlowBinding,
    now = this.#clock(),
  ): Promise<ApplicationPreAuthenticationFlowRecord> {
    const flow = await this.#requiredFlow(flowId);
    this.#assertBound(flow, binding);
    if (flow.state !== 'active' || Date.parse(flow.expiresAt) <= now.getTime()) {
      throw identityFlowError(
        'FLOW_UNAVAILABLE',
        `Identity flow ${flow.id} is unavailable.`,
      );
    }
    return flow;
  }

  async #activeOrConsumedBoundFlow(
    flowId: string,
    binding: ApplicationIdentityFlowBinding,
    now = this.#clock(),
  ): Promise<ApplicationPreAuthenticationFlowRecord> {
    const flow = await this.#requiredFlow(flowId);
    this.#assertBound(flow, binding);
    if (
      (flow.state !== 'active' && flow.state !== 'consumed')
      || Date.parse(flow.expiresAt) <= now.getTime()
    ) {
      throw identityFlowError(
        'FLOW_UNAVAILABLE',
        `Identity flow ${flow.id} is unavailable.`,
      );
    }
    return flow;
  }

  async #requiredFlow(
    flowId: string,
  ): Promise<ApplicationPreAuthenticationFlowRecord> {
    const flow = await this.#store.getFlow(requiredString(flowId, 'flowId'));
    if (!flow) {
      throw identityFlowError(
        'FLOW_UNAVAILABLE',
        'Identity flow is unavailable.',
      );
    }
    return flow;
  }

  #assertBound(
    flow: ApplicationPreAuthenticationFlowRecord,
    binding: ApplicationIdentityFlowBinding,
  ): void {
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
      throw identityFlowError(
        'FLOW_BINDING_INVALID',
        `Identity flow ${flow.id} binding is invalid.`,
      );
    }
    if (
      !timingSafeTextEqual(
        flow.providerContinuityDigest,
        this.#digest('provider-continuity', binding.providerContinuity),
      )
    ) {
      throw identityFlowError(
        'PROVIDER_CONTINUITY_INVALID',
        `Identity flow ${flow.id} provider continuity is invalid.`,
      );
    }
    if (
      flow.networkBindingDigest
      && (!binding.networkBinding
        || !timingSafeTextEqual(
          flow.networkBindingDigest,
          this.#digest('network', binding.networkBinding),
        ))
    ) {
      throw identityFlowError(
        'FLOW_BINDING_INVALID',
        `Identity flow ${flow.id} network binding is invalid.`,
      );
    }
  }

  async #containOrphan(
    flow: ApplicationPreAuthenticationFlowRecord,
    completion: ApplicationProviderCompletionAdmission['completion'],
    completionKey: string,
    error: unknown,
  ): Promise<void> {
    const provider = this.#provider(flow.provider);
    const reason = error instanceof Error ? error.message : String(error);
    try {
      await provider.revokeSession(
        completion.providerSessionId,
        `Local admission failed for identity flow ${flow.id}: ${reason}`,
      );
      return;
    } catch {
      const now = this.#clock().toISOString();
      await this.#store.recordOrphan({
        apiVersion: 'applik8s.identityOrphan/v1alpha1',
        id: `identity_orphan_${digestValue(
          `${flow.id}\0${completionKey}`,
        ).slice(0, 40)}`,
        flowId: flow.id,
        provider: flow.provider,
        providerSessionId: completion.providerSessionId,
        providerCompletionKey: completionKey,
        reason,
        state: 'pending',
        createdAt: now,
        version: 1,
      });
    }
  }

  #provider(name: string): ApplicationIdentityProviderAdapter {
    const provider = this.#providers.get(name);
    if (!provider) {
      throw new Error(`Identity provider ${name} is unavailable.`);
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

export function createApplicationPreAuthenticationFlowRuntime(
  options: ApplicationPreAuthenticationFlowRuntimeOptions,
): ApplicationPreAuthenticationFlowRuntime {
  return new ApplicationPreAuthenticationFlowService(options);
}

function assertProviderCompletion(
  flow: ApplicationPreAuthenticationFlowRecord,
  completion: ApplicationProviderCompletionAdmission['completion'],
): void {
  if (
    completion.provider !== flow.provider
    || completion.providerFlowId !== flow.providerFlowId
  ) {
    throw identityFlowError(
      'PROVIDER_COMPLETION_INVALID',
      `Identity provider completion does not belong to flow ${flow.id}.`,
    );
  }
  requiredString(completion.providerSessionId, 'providerSessionId');
  requiredString(completion.authenticationMethod, 'authenticationMethod');
  if (
    !completion.providerIdentity.id.trim()
    || !completion.providerIdentity.issuer.trim()
    || !completion.providerIdentity.subject.trim()
  ) {
    throw identityFlowError(
      'PROVIDER_COMPLETION_INVALID',
      `Identity provider completion for ${flow.id} has no normalized identity.`,
    );
  }
  const completedAt = Date.parse(completion.completedAt);
  if (
    Number.isNaN(completedAt)
    || (completion.expiresAt !== undefined
      && (Number.isNaN(Date.parse(completion.expiresAt))
        || Date.parse(completion.expiresAt) <= completedAt))
  ) {
    throw identityFlowError(
      'PROVIDER_COMPLETION_INVALID',
      `Identity provider completion for ${flow.id} has invalid temporal evidence.`,
    );
  }
}

function assertAdmittedPrincipal(
  principal: ApplicationPrincipal,
  completion: ApplicationProviderCompletionAdmission['completion'],
  context: ApplicationIdentityFlowAdmissionContext,
): void {
  if (
    principal.identity.id !== completion.providerIdentity.id
    || principal.kind !== completion.providerIdentity.kind
    || principal.trustedContextDigest !== context.trustedContextDigest
    || principal.catalogRevision !== context.catalogRevision
    || principal.authorityRevision !== context.authorityRevision
  ) {
    throw identityFlowError(
      'PROVIDER_COMPLETION_INVALID',
      'Identity principal admission changed provider identity or authority context.',
    );
  }
}

function providerCompletionKey(
  completion: ApplicationProviderCompletionAdmission['completion'],
): string {
  return `provider_completion_${digestValue(
    `${completion.provider}\0${completion.providerFlowId}\0${completion.providerSessionId}\0${completion.providerIdentity.id}`,
  )}`;
}

function normalizedOAuthContinuation(
  oauth: NonNullable<ApplicationPreAuthenticationFlowIssue['oauth']>,
) {
  return {
    authorizationRequestId: requiredString(
      oauth.authorizationRequestId,
      'oauth.authorizationRequestId',
    ),
    clientId: requiredString(oauth.clientId, 'oauth.clientId'),
    redirectUri: normalizedRedirectUri(oauth.redirectUri),
    scopes: normalizedUniqueStrings(oauth.scopes, 'oauth.scopes'),
    resources: normalizedUrls(oauth.resources, 'oauth.resources'),
    audience: normalizedUniqueStrings(oauth.audience, 'oauth.audience'),
    ...(oauth.codeChallenge
      ? {
          codeChallenge: requiredString(
            oauth.codeChallenge,
            'oauth.codeChallenge',
          ),
          codeChallengeMethod: 'S256' as const,
        }
      : {}),
  };
}

function assertOAuthContinuation(
  oauth: ApplicationPreAuthenticationFlowIssue['oauth'],
): void {
  if (!oauth) return;
  normalizedOAuthContinuation(oauth);
}

function normalizedRedirectUri(value: string): string {
  const url = new URL(requiredString(value, 'redirectUri'));
  if (
    url.protocol !== 'https:'
    && !(url.protocol === 'http:'
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))
  ) {
    throw new Error(
      'OAuth redirect URI must use HTTPS outside an explicit loopback client.',
    );
  }
  if (url.username || url.password || url.hash) {
    throw new Error(
      'OAuth redirect URI must not contain credentials or a fragment.',
    );
  }
  return url.toString();
}

function normalizedUrls(values: readonly string[], field: string): string[] {
  return normalizedUniqueStrings(values, field).map((value) => {
    const url = new URL(value);
    if (url.protocol !== 'https:') {
      throw new Error(`${field} entries must use HTTPS.`);
    }
    if (url.username || url.password || url.hash || url.search) {
      throw new Error(
        `${field} entries must be canonical origins or resource paths without credentials, query, or fragment.`,
      );
    }
    return url.toString();
  });
}

function normalizedUniqueStrings(
  values: readonly string[],
  field: string,
): string[] {
  const normalized = values.map((value) => requiredString(value, field));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${field} must not contain duplicates.`);
  }
  return [...normalized];
}

function requiredString(value: string, field: string): string {
  if (!value.trim()) throw new Error(`${field} must not be empty.`);
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

function identityFlowError(
  code: ApplicationIdentityFlowError['code'],
  message: string,
): ApplicationIdentityFlowError {
  return new ApplicationIdentityFlowError(code, message);
}

export function deterministicApplicationIdentityPrincipal(
  input: Parameters<ApplicationIdentityPrincipalAdmitter>[0],
): ApplicationPrincipal {
  const now = input.context.now ?? new Date();
  const kind = input.completion.providerIdentity.kind;
  if (
    kind === 'execution'
    || kind === 'pre-authentication-flow'
    || kind === 'oauth-authorization-flow'
  ) {
    throw new Error(
      'Deterministic identity completion cannot admit framework-managed principal kinds.',
    );
  }
  return {
    id: `principal:${input.context.application}:${input.completion.providerIdentity.id}`,
    identity: input.completion.providerIdentity,
    kind,
    authenticationMethod: input.completion.authenticationMethod,
    audience: [...input.context.audience],
    trustedContextDigest: input.context.trustedContextDigest,
    catalogRevision: input.context.catalogRevision,
    authorityRevision: input.context.authorityRevision,
    admittedAt: now.toISOString(),
    ...(input.completion.expiresAt
      ? { expiresAt: input.completion.expiresAt }
      : {}),
    sessionId: input.completion.providerSessionId,
    flowId: input.flow.id,
  };
}
