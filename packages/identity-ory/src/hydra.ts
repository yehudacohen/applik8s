import { createHash } from 'node:crypto';
import type {
  ApplicationOAuthAuthorizationProviderAdapter,
  ApplicationOAuthProviderDecision,
} from '@applik8s/identity';
import {
  normalizedOryBaseUrl,
  OryAdapterError,
  OryHttpTransport,
  type OryHttpTransportOptions,
  oryStringArray,
  requiredOryString,
} from './transport.js';

export interface OryHydraAdapterOptions extends OryHttpTransportOptions {
  readonly adminUrl: string;
  readonly publicUrl: string;
}

export class OryHydraOAuthAdapter
  implements ApplicationOAuthAuthorizationProviderAdapter
{
  readonly name = 'ory-hydra';
  readonly #adminUrl: URL;
  readonly #publicOrigin: string;
  readonly #transport: OryHttpTransport;

  constructor(options: OryHydraAdapterOptions) {
    this.#adminUrl = normalizedOryBaseUrl(
      options.adminUrl,
      'Ory Hydra adminUrl',
    );
    this.#publicOrigin = normalizedOryBaseUrl(
      options.publicUrl,
      'Ory Hydra publicUrl',
    ).origin;
    this.#transport = new OryHttpTransport(options);
  }

  async decide(input: {
    readonly flow: Parameters<
      ApplicationOAuthAuthorizationProviderAdapter['decide']
    >[0]['flow'];
    readonly decision: 'approve' | 'deny';
    readonly idempotencyKey: string;
  }): Promise<ApplicationOAuthProviderDecision> {
    const challenge = requiredChallenge(
      input.flow.providerAuthorizationRequestId,
    );
    const request = await this.#consentRequest(challenge);
    assertConsentRequest(input.flow, request);
    const endpoint = input.decision === 'approve'
      ? 'admin/oauth2/auth/requests/consent/accept'
      : 'admin/oauth2/auth/requests/consent/reject';
    const url = new URL(endpoint, this.#adminUrl);
    url.searchParams.set('consent_challenge', challenge);
    const body = input.decision === 'approve'
      ? {
          grant_scope: [...input.flow.scopes],
          grant_access_token_audience: [...input.flow.audience],
          remember: false,
          context: {
            applik8s_flow_id: input.flow.id,
            applik8s_client_revision: input.flow.clientRevision,
          },
        }
      : {
          error: 'access_denied',
          error_description: 'The resource owner denied this request.',
          status_code: 403,
        };
    const { json } = await this.#transport.request(url, {
      method: 'PUT',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'idempotency-key': input.idempotencyKey,
      },
      body: JSON.stringify(body),
    });
    if (!json) {
      throw new OryAdapterError(
        'ORY_RESPONSE_INVALID',
        'Ory Hydra consent decision response is empty.',
      );
    }
    const continuationUri = requiredOryString(
      json.redirect_to,
      'consent.redirect_to',
    );
    const continuation = new URL(continuationUri);
    if (continuation.origin !== this.#publicOrigin) {
      throw new OryAdapterError(
        'ORY_RESPONSE_INVALID',
        `Ory Hydra returned continuation origin ${continuation.origin}, expected ${this.#publicOrigin}.`,
      );
    }
    return {
      id: `ory_hydra_consent_${createHash('sha256')
        .update(challenge)
        .update('\0')
        .update(input.decision)
        .digest('base64url')}`,
      providerAuthorizationRequestId: challenge,
      accepted: input.decision === 'approve',
      continuationUri: continuation.toString(),
      evidence: {
        provider: 'ory-hydra',
        consentRequestId:
          typeof request.consent_request_id === 'string'
            ? request.consent_request_id
            : challenge,
      },
    };
  }

  async ready(): Promise<void> {
    await this.#transport.request(
      new URL('health/ready', this.#adminUrl),
      { headers: { accept: 'application/json' } },
      [200],
    );
  }

  async #consentRequest(
    challenge: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    const url = new URL(
      'admin/oauth2/auth/requests/consent',
      this.#adminUrl,
    );
    url.searchParams.set('consent_challenge', challenge);
    const { json } = await this.#transport.request(url, {
      headers: { accept: 'application/json' },
    });
    if (!json) {
      throw new OryAdapterError(
        'ORY_RESPONSE_INVALID',
        'Ory Hydra consent request is empty.',
      );
    }
    return json;
  }
}

function assertConsentRequest(
  flow: Parameters<
    ApplicationOAuthAuthorizationProviderAdapter['decide']
  >[0]['flow'],
  request: Readonly<Record<string, unknown>>,
): void {
  const challenge = requiredOryString(request.challenge, 'consent.challenge');
  const subject = requiredOryString(request.subject, 'consent.subject');
  const clientValue = request.client;
  if (!clientValue || typeof clientValue !== 'object' || Array.isArray(clientValue)) {
    throw new OryAdapterError(
      'ORY_RESPONSE_INVALID',
      'Ory Hydra consent request has no client.',
    );
  }
  const clientId = requiredOryString(
    Reflect.get(clientValue, 'client_id'),
    'consent.client.client_id',
  );
  const scopes = oryStringArray(request.requested_scope, 'consent.requested_scope');
  const audience = oryStringArray(
    request.requested_access_token_audience,
    'consent.requested_access_token_audience',
  );
  if (
    challenge !== flow.providerAuthorizationRequestId
    || subject !== flow.resourceOwner.subject
    || clientId !== flow.clientId
    || !sameSet(scopes, flow.scopes)
    || !sameSet(audience, flow.audience)
  ) {
    throw new OryAdapterError(
      'ORY_REQUEST_REJECTED',
      `Ory Hydra consent request does not match bound flow ${flow.id}.`,
    );
  }
}

function requiredChallenge(value: string): string {
  if (!value.trim() || value.length > 4096) {
    throw new Error('Ory Hydra consent challenge is invalid.');
  }
  return value;
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value) => right.includes(value));
}
