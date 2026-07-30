import type { JsonValue } from '@applik8s/core';

export interface ApplicationIdentityProjectionFrontier {
  readonly projection: string;
  readonly sourceAuthorityRevision: string;
  readonly sourceSequence: number;
  readonly projectedAt: string;
  readonly state: 'current' | 'failed';
  readonly failure?: string;
}

export interface ApplicationIdentityProjectionFrontierStore {
  read(projection: string): Promise<ApplicationIdentityProjectionFrontier | undefined>;
  commit(
    frontier: ApplicationIdentityProjectionFrontier,
    expectedSourceSequence: number | undefined,
  ): Promise<ApplicationIdentityProjectionFrontier>;
}

export interface ApplicationRelationshipTuple {
  readonly namespace: string;
  readonly object: string;
  readonly relation: string;
  readonly subject: string;
}

export interface ApplicationRelationshipProjectionChange {
  readonly operation: 'put' | 'delete';
  readonly tuple: ApplicationRelationshipTuple;
}

export interface ApplicationRelationshipProjectionBatch {
  readonly projection: string;
  readonly sourceAuthorityRevision: string;
  readonly sourceSequence: number;
  readonly changes: readonly ApplicationRelationshipProjectionChange[];
}

export interface ApplicationRelationshipProjection {
  project(batch: ApplicationRelationshipProjectionBatch): Promise<ApplicationIdentityProjectionFrontier>;
  check(input: {
    readonly projection: string;
    readonly requiredAuthorityRevision: string;
    readonly tuple: ApplicationRelationshipTuple;
  }): Promise<{
    readonly allowed: boolean;
    readonly frontier: ApplicationIdentityProjectionFrontier;
  }>;
  ready(input: {
    readonly projection: string;
    readonly requiredAuthorityRevision: string;
  }): Promise<ApplicationIdentityProjectionFrontier>;
}

export interface ApplicationAccessGatewayDecision {
  readonly allowed: boolean;
  readonly status: number;
  /** Provider-projected upstream headers only; credentials and cookies are excluded. */
  readonly upstreamHeaders: Readonly<Record<string, string>>;
  readonly evidence: Readonly<Record<string, JsonValue>>;
  readonly frontier: ApplicationIdentityProjectionFrontier;
}

export interface ApplicationAccessGatewayProjection {
  decide(input: {
    readonly request: Request;
    readonly projection: string;
    readonly requiredAuthorityRevision: string;
  }): Promise<ApplicationAccessGatewayDecision>;
  ready(input: {
    readonly projection: string;
    readonly requiredAuthorityRevision: string;
  }): Promise<ApplicationIdentityProjectionFrontier>;
}

export class ApplicationIdentityProjectionStaleError extends Error {
  readonly code = 'IDENTITY_PROJECTION_STALE';

  constructor(
    readonly projection: string,
    readonly requiredAuthorityRevision: string,
    readonly observedAuthorityRevision: string | undefined,
  ) {
    super(`Identity projection ${projection} has not reached authority revision ${requiredAuthorityRevision}.`);
    this.name = 'ApplicationIdentityProjectionStaleError';
  }
}

export function requireApplicationIdentityProjectionFrontier(
  frontier: ApplicationIdentityProjectionFrontier | undefined,
  projection: string,
  requiredAuthorityRevision: string,
): ApplicationIdentityProjectionFrontier {
  if (
    !frontier
    || frontier.projection !== projection
    || frontier.state !== 'current'
    || frontier.sourceAuthorityRevision !== requiredAuthorityRevision
  ) {
    throw new ApplicationIdentityProjectionStaleError(
      projection,
      requiredAuthorityRevision,
      frontier?.sourceAuthorityRevision,
    );
  }
  return frontier;
}
