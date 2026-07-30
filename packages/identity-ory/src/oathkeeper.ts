import type {
  ApplicationAccessGatewayDecision,
  ApplicationAccessGatewayProjection,
  ApplicationIdentityProjectionFrontier,
  ApplicationIdentityProjectionFrontierStore,
} from '@applik8s/identity';
import { requireApplicationIdentityProjectionFrontier } from '@applik8s/identity';
import type { JsonValue } from '@applik8s/core';
import {
  normalizedOryBaseUrl,
  OryHttpTransport,
  type OryHttpTransportOptions,
} from './transport.js';

export interface OryOathkeeperAccessGatewayOptions extends OryHttpTransportOptions {
  readonly decisionUrl: string;
  readonly frontiers: ApplicationIdentityProjectionFrontierStore;
  readonly forwardedHeaders?: readonly string[];
}

/** Defense-in-depth decision projection; it cannot mint canonical application grants. */
export class OryOathkeeperAccessGateway implements ApplicationAccessGatewayProjection {
  readonly #decisionUrl: URL;
  readonly #frontiers: ApplicationIdentityProjectionFrontierStore;
  readonly #forwardedHeaders: ReadonlySet<string>;
  readonly #transport: OryHttpTransport;

  constructor(options: OryOathkeeperAccessGatewayOptions) {
    this.#decisionUrl = normalizedOryBaseUrl(options.decisionUrl, 'Ory Oathkeeper decisionUrl');
    this.#frontiers = options.frontiers;
    this.#forwardedHeaders = new Set(
      (options.forwardedHeaders ?? ['x-user', 'x-subject', 'x-session-id'])
        .map((name) => name.toLowerCase()),
    );
    this.#transport = new OryHttpTransport(options);
  }

  async decide(input: {
    readonly request: Request;
    readonly projection: string;
    readonly requiredAuthorityRevision: string;
  }): Promise<ApplicationAccessGatewayDecision> {
    const frontier = await this.ready(input);
    const target = new URL('decisions', this.#decisionUrl);
    const original = new URL(input.request.url);
    target.searchParams.set('url', original.toString());
    const headers = new Headers();
    for (const name of ['authorization', 'cookie', 'content-type', 'accept']) {
      const value = input.request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const { response, json } = await this.#transport.request(target, {
      method: input.request.method,
      headers,
    }, [200, 401, 403]);
    const upstreamHeaders = Object.fromEntries(
      [...response.headers]
        .filter(([name]) => this.#forwardedHeaders.has(name.toLowerCase())),
    );
    return {
      allowed: response.status === 200,
      status: response.status,
      upstreamHeaders,
      evidence: providerEvidence(json),
      frontier,
    };
  }

  async ready(input: {
    readonly projection: string;
    readonly requiredAuthorityRevision: string;
  }): Promise<ApplicationIdentityProjectionFrontier> {
    const frontier = requireApplicationIdentityProjectionFrontier(
      await this.#frontiers.read(input.projection),
      input.projection,
      input.requiredAuthorityRevision,
    );
    await this.#transport.request(
      new URL('health/ready', this.#decisionUrl),
      { headers: { accept: 'application/json' } },
      [200],
    );
    return frontier;
  }
}

function providerEvidence(
  value: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, JsonValue>> {
  if (!value) return {};
  const rule = value.rule;
  const error = value.error;
  return {
    ...(typeof rule === 'string' ? { rule } : {}),
    ...(typeof error === 'string' ? { error } : {}),
  };
}
