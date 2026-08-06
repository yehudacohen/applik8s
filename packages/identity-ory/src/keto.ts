import type {
  ApplicationIdentityProjectionFrontier,
  ApplicationIdentityProjectionFrontierStore,
  ApplicationRelationshipProjection,
  ApplicationRelationshipProjectionBatch,
  ApplicationRelationshipTuple,
} from '@applik8s/identity';
import { requireApplicationIdentityProjectionFrontier } from '@applik8s/identity';
import {
  normalizedOryBaseUrl,
  OryAdapterError,
  OryHttpTransport,
  type OryHttpTransportOptions,
} from './transport.js';

export interface OryKetoRelationshipProjectionOptions extends OryHttpTransportOptions {
  readonly readUrl: string;
  readonly writeUrl: string;
  readonly frontiers: ApplicationIdentityProjectionFrontierStore;
  readonly clock?: () => Date;
}

/** Fail-closed Keto projection; canonical grants remain in Applik8s authority. */
export class OryKetoRelationshipProjection implements ApplicationRelationshipProjection {
  readonly #readUrl: URL;
  readonly #writeUrl: URL;
  readonly #frontiers: ApplicationIdentityProjectionFrontierStore;
  readonly #clock: () => Date;
  readonly #transport: OryHttpTransport;

  constructor(options: OryKetoRelationshipProjectionOptions) {
    this.#readUrl = normalizedOryBaseUrl(options.readUrl, 'Ory Keto readUrl');
    this.#writeUrl = normalizedOryBaseUrl(options.writeUrl, 'Ory Keto writeUrl');
    this.#frontiers = options.frontiers;
    this.#clock = options.clock ?? (() => new Date());
    this.#transport = new OryHttpTransport(options);
  }

  async project(batch: ApplicationRelationshipProjectionBatch): Promise<ApplicationIdentityProjectionFrontier> {
    const current = await this.#frontiers.read(requiredName(batch.projection, 'projection'));
    if (current && batch.sourceSequence < current.sourceSequence) {
      throw new Error(`Keto projection ${batch.projection} cannot move backward from ${current.sourceSequence} to ${batch.sourceSequence}.`);
    }
    for (const change of batch.changes) {
      const tuple = normalizedTuple(change.tuple);
      if (change.operation === 'put') {
        await this.#transport.request(
          new URL('admin/relation-tuples', this.#writeUrl),
          {
            method: 'PUT',
            headers: { accept: 'application/json', 'content-type': 'application/json' },
            body: JSON.stringify(ketoTuple(tuple)),
          },
          [200, 201, 204],
        );
      } else {
        const url = tupleUrl(new URL('admin/relation-tuples', this.#writeUrl), tuple);
        await this.#transport.request(url, { method: 'DELETE', headers: { accept: 'application/json' } }, [204]);
      }
    }
    return this.#frontiers.commit({
      projection: batch.projection,
      sourceAuthorityRevision: requiredName(batch.sourceAuthorityRevision, 'authority revision'),
      sourceSequence: boundedSequence(batch.sourceSequence),
      projectedAt: this.#clock().toISOString(),
      state: 'current',
    }, current?.sourceSequence);
  }

  async check(input: {
    readonly projection: string;
    readonly requiredAuthorityRevision: string;
    readonly tuple: ApplicationRelationshipTuple;
  }) {
    const frontier = await this.ready(input);
    const url = tupleUrl(
      new URL('relation-tuples/check/openapi', this.#readUrl),
      normalizedTuple(input.tuple),
    );
    const { json } = await this.#transport.request(url, { headers: { accept: 'application/json' } });
    if (!json || typeof json.allowed !== 'boolean') {
      throw new OryAdapterError('ORY_RESPONSE_INVALID', 'Ory Keto decision has no allowed result.');
    }
    return { allowed: json.allowed, frontier };
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
      new URL('health/ready', this.#readUrl),
      { headers: { accept: 'application/json' } },
      [200],
    );
    return frontier;
  }
}

function tupleUrl(url: URL, tuple: ApplicationRelationshipTuple): URL {
  url.searchParams.set('namespace', tuple.namespace);
  url.searchParams.set('object', tuple.object);
  url.searchParams.set('relation', tuple.relation);
  url.searchParams.set('subject_id', tuple.subject);
  return url;
}

function ketoTuple(tuple: ApplicationRelationshipTuple) {
  return {
    namespace: tuple.namespace,
    object: tuple.object,
    relation: tuple.relation,
    subject_id: tuple.subject,
  };
}

function normalizedTuple(tuple: ApplicationRelationshipTuple): ApplicationRelationshipTuple {
  return {
    namespace: requiredName(tuple.namespace, 'namespace'),
    object: requiredName(tuple.object, 'object'),
    relation: requiredName(tuple.relation, 'relation'),
    subject: requiredName(tuple.subject, 'subject'),
  };
}

function requiredName(value: string, field: string): string {
  if (!value.trim() || value.length > 512 || containsControlCharacter(value)) {
    throw new Error(`Keto relationship ${field} is invalid.`);
  }
  return value;
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && codePoint <= 0x1f;
  });
}

function boundedSequence(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Keto projection sourceSequence is invalid.');
  return value;
}
