// typecast-file-boundary: the authority runtime validates catalog, principal, envelope, and receipt identities before restoring execution contracts.
import type {
  ApplicationAuthorizationBoundary,
  ApplicationAuthorizationReceipt,
  ApplicationEffectiveAuthority,
  ApplicationExecutionKind,
  ApplicationExecutionPrincipal,
  ApplicationGrantRecord,
  ApplicationIdentityReference,
  ApplicationOperationCatalog,
  ApplicationOperationId,
  ApplicationOperationTransport,
  ApplicationPrincipal,
  ApplicationScopeExpression,
  ApplicationStaticAuthorityManifest,
  ApplicationWorkloadAuthorityEnvelope,
  JsonObject,
} from '@applik8s/core';
import { intersectApplicationScopes } from '@applik8s/core';
import {
  ApplicationAuthorityService,
  type ApplicationAuthorizationResult,
} from './authority.js';
import { ApplicationOperationCatalogManager } from './catalog.js';
import {
  type ApplicationAuthorityPostgresSql,
  type ApplicationAuthorityPostgresTransaction,
  PostgresApplicationAuthorityRepository,
  PostgresApplicationOperationCatalogRepository,
} from './postgres.js';
import {
  type ApplicationOperationalObservationInput,
  PostgresApplicationOperationalObservationRepository,
} from './observations.js';

export interface ApplicationOperationAuthorityRuntimeOptions {
  readonly sql: ApplicationAuthorityPostgresSql;
  readonly application: string;
  readonly catalog: ApplicationOperationCatalog;
  readonly authorityManifest?: ApplicationStaticAuthorityManifest;
}

export interface ApplicationPrincipalAdmission {
  readonly id: string;
  readonly identity?: ApplicationIdentityReference;
  readonly kind?: ApplicationPrincipal['kind'];
  readonly authenticationMethod?: string;
  readonly audience?: readonly string[];
  readonly expiresAt?: string;
  readonly sessionId?: string;
  readonly clientId?: string;
  readonly flowId?: string;
  readonly roles?: readonly string[];
  readonly attributes?: JsonObject;
}

export interface ApplicationOperationAuthorizationRequest {
  readonly principal: ApplicationPrincipal;
  readonly operationId: ApplicationOperationId;
  readonly target: ApplicationScopeExpression;
  readonly scopeEvidence?: readonly ApplicationScopeExpression[];
  readonly audience: string;
  readonly transport: ApplicationOperationTransport;
  readonly inputDigest: string;
  readonly trustedContextDigest: string;
  readonly idempotencyKey?: string;
  readonly commandId?: string;
  readonly targetDigest?: string;
  readonly applicationPolicyAllowed?: boolean;
}

export interface ApplicationExecutionPrincipalAdmission {
  readonly executionKind: ApplicationExecutionKind;
  readonly executionId: string;
  readonly attempt: number;
  readonly workloadIdentity: ApplicationIdentityReference;
  readonly serviceIdentity?: ApplicationIdentityReference;
  readonly causalPrincipal?: ApplicationIdentityReference;
  readonly causalGrantIds?: readonly string[];
  readonly envelopes: readonly ApplicationWorkloadAuthorityEnvelope[];
  readonly trustedContextDigest: string;
  readonly audience: readonly string[];
  readonly deadline: string;
  readonly cancellationRevision: string;
}

export interface ApplicationExecutionAuthorizationRequest {
  readonly principal: ApplicationExecutionPrincipal;
  readonly envelope: ApplicationWorkloadAuthorityEnvelope;
  readonly target: ApplicationScopeExpression;
  readonly scopeEvidence?: readonly ApplicationScopeExpression[];
  readonly audience: string;
  readonly transport: ApplicationOperationTransport;
  readonly inputDigest: string;
  readonly trustedContextDigest: string;
  readonly currentCancellationRevision: string;
  readonly idempotencyKey?: string;
  readonly commandId?: string;
  readonly targetDigest?: string;
  /**
   * Explicit compiler policy result for operations classified as
   * application-policy. Omitted is fail-closed.
   */
  readonly applicationPolicyAllowed?: boolean;
}

export type ApplicationExecutionAuthorizationResult =
  | {
      readonly allowed: true;
      readonly principal: ApplicationExecutionPrincipal;
      readonly receipt: ApplicationAuthorizationReceipt;
    }
  | {
      readonly allowed: false;
      readonly code: string;
      readonly message: string;
    };

/**
 * Provider-neutral runtime facade over the default PostgreSQL authority.
 *
 * Generated runtimes use this facade rather than reaching into repository
 * tables or carrying provider-specific decision shapes. The catalog is staged
 * and activated through the same compatibility manager used by deployment and
 * administrative tooling.
 */
export class ApplicationOperationAuthorityRuntime {
  readonly #application: string;
  readonly #declaredCatalog: ApplicationOperationCatalog;
  readonly #authorityManifest: ApplicationStaticAuthorityManifest | undefined;
  readonly #authorityRepository: PostgresApplicationAuthorityRepository;
  readonly #catalogRepository: PostgresApplicationOperationCatalogRepository;
  readonly #catalogManager: ApplicationOperationCatalogManager;
  readonly #authority: ApplicationAuthorityService;
  readonly #observations: PostgresApplicationOperationalObservationRepository;
  #prepared: Promise<ApplicationOperationCatalog> | undefined;

  constructor(options: ApplicationOperationAuthorityRuntimeOptions) {
    if (!options.application.trim()) {
      throw new Error('Application operation authority runtime requires a non-empty application name.');
    }
    if (options.catalog.application !== options.application) {
      throw new Error(`Application operation authority catalog ${options.catalog.application} does not belong to ${options.application}.`);
    }
    this.#application = options.application;
    this.#declaredCatalog = options.catalog;
    if (options.authorityManifest && options.authorityManifest.application !== options.application) {
      throw new Error(`Application authority manifest ${options.authorityManifest.application} does not belong to ${options.application}.`);
    }
    this.#authorityManifest = options.authorityManifest;
    this.#authorityRepository = new PostgresApplicationAuthorityRepository(options.sql, options.application);
    this.#catalogRepository = new PostgresApplicationOperationCatalogRepository(options.sql);
    this.#catalogManager = new ApplicationOperationCatalogManager(this.#catalogRepository);
    this.#authority = new ApplicationAuthorityService(this.#authorityRepository);
    this.#observations = new PostgresApplicationOperationalObservationRepository(
      options.sql,
      options.application,
    );
  }

  prepare(): Promise<ApplicationOperationCatalog> {
    if (!this.#prepared) {
      const attempt = this.#prepare();
      this.#prepared = attempt;
      void attempt.catch(() => {
        this.#clearFailedPreparation(attempt);
      });
    }
    return this.#prepared;
  }

  #clearFailedPreparation(attempt: Promise<ApplicationOperationCatalog>): void {
    if (this.#prepared === attempt) this.#prepared = undefined;
  }

  async admitPrincipal(
    admission: ApplicationPrincipalAdmission,
    trustedContextDigest: string,
  ): Promise<ApplicationPrincipal> {
    const catalog = await this.prepare();
    const authority = await this.#authorityRepository.snapshot();
    const identity = admission.identity ?? {
      id: `identity:${admission.id}`,
      kind: admission.kind ?? 'external',
      issuer: 'applik8s.identity-provider',
      subject: admission.id,
    };
    const kind = admission.kind ?? identity.kind;
    return {
      id: admission.id,
      identity,
      kind,
      authenticationMethod: admission.authenticationMethod ?? 'identity-provider-provider',
      audience: admission.audience ?? [],
      trustedContextDigest,
      catalogRevision: catalog.revision,
      authorityRevision: authority.revision,
      admittedAt: new Date().toISOString(),
      ...(admission.roles ? { roles: [...admission.roles] } : {}),
      ...(admission.attributes ? { attributes: admission.attributes } : {}),
      ...(admission.expiresAt ? { expiresAt: admission.expiresAt } : {}),
      ...(admission.sessionId ? { sessionId: admission.sessionId } : {}),
      ...(admission.clientId ? { clientId: admission.clientId } : {}),
      ...(admission.flowId ? { flowId: admission.flowId } : {}),
    };
  }

  async authorize(request: ApplicationOperationAuthorizationRequest): Promise<ApplicationAuthorizationResult> {
    const catalog = await this.prepare();
    const operation = catalog.operations.find((candidate) => candidate.id === request.operationId);
    if (!operation) {
      return {
        allowed: false,
        code: 'AUTHORIZATION_OPERATION_MISMATCH',
        message: `Operation ${request.operationId} is unavailable in catalog ${catalog.revision}.`,
      };
    }
    let authorization: ApplicationAuthorizationResult;
    try {
      authorization = await this.#authority.authorize({
        application: this.#application,
        catalog,
        operation,
        principal: request.principal,
        target: request.target,
        ...(request.scopeEvidence ? { scopeEvidence: request.scopeEvidence } : {}),
        audience: request.audience,
        transport: request.transport,
        inputDigest: request.inputDigest,
        trustedContextDigest: request.trustedContextDigest,
        ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
        ...(request.commandId ? { commandId: request.commandId } : {}),
        ...(request.targetDigest ? { targetDigest: request.targetDigest } : {}),
        ...(request.applicationPolicyAllowed !== undefined
          ? { applicationPolicyAllowed: request.applicationPolicyAllowed }
          : {}),
      });
    } catch (cause) {
      throw new Error(
        `Operation ${request.operationId} authority decision failed.`,
        { cause },
      );
    }
    try {
      await this.#recordAuthorization(
        request.operationId,
        request.inputDigest,
        request.transport,
        request.audience,
        authorization,
      );
    } catch (cause) {
      throw new Error(
        `Operation ${request.operationId} authority observation failed.`,
        { cause },
      );
    }
    return authorization;
  }

  async admitExecutionPrincipal(
    admission: ApplicationExecutionPrincipalAdmission,
  ): Promise<ApplicationExecutionPrincipal> {
    const catalog = await this.prepare();
    const authority = await this.#authorityRepository.snapshot();
    if (!admission.executionId.trim() || !Number.isSafeInteger(admission.attempt) || admission.attempt < 1) {
      throw new Error('Application execution admission requires a stable executionId and positive attempt.');
    }
    if (!admission.workloadIdentity.id.trim() || admission.workloadIdentity.kind !== 'workload') {
      throw new Error('Application execution admission requires one normalized workload identity.');
    }
    if (!admission.cancellationRevision.trim()) {
      throw new Error('Application execution admission requires a cancellation revision.');
    }
    const deadline = new Date(admission.deadline);
    if (Number.isNaN(deadline.getTime())) {
      throw new Error('Application execution admission deadline must be an ISO timestamp.');
    }
    const envelopeIds = new Set<string>();
    for (const envelope of admission.envelopes) {
      if (envelope.catalogRevision !== catalog.revision) {
        throw new Error(`Workload envelope ${envelope.id} references catalog ${envelope.catalogRevision}, not active catalog ${catalog.revision}.`);
      }
      if (envelope.workloadIdentity.id !== admission.workloadIdentity.id) {
        throw new Error(`Workload envelope ${envelope.id} belongs to ${envelope.workloadIdentity.id}, not ${admission.workloadIdentity.id}.`);
      }
      if (envelope.serviceIdentity?.id !== admission.serviceIdentity?.id) {
        throw new Error(`Workload envelope ${envelope.id} service identity does not match this execution.`);
      }
      if (envelopeIds.has(envelope.id)) {
        throw new Error(`Application execution admission received duplicate workload envelope ${envelope.id}.`);
      }
      envelopeIds.add(envelope.id);
    }
    const identity = admission.serviceIdentity ?? admission.workloadIdentity;
    return {
      id: `principal:${this.#application}:execution:${admission.executionKind}:${admission.executionId}:${admission.attempt}`,
      identity,
      kind: 'execution',
      executionKind: admission.executionKind,
      executionId: admission.executionId,
      attempt: admission.attempt,
      workloadIdentity: admission.workloadIdentity,
      ...(admission.serviceIdentity ? { serviceIdentity: admission.serviceIdentity } : {}),
      ...(admission.causalPrincipal ? { causalPrincipal: admission.causalPrincipal } : {}),
      causalGrantIds: [...(admission.causalGrantIds ?? [])],
      authenticationMethod: 'workload-identity',
      audience: [...admission.audience],
      trustedContextDigest: admission.trustedContextDigest,
      catalogRevision: catalog.revision,
      authorityRevision: authority.revision,
      admittedAt: new Date().toISOString(),
      deadline: deadline.toISOString(),
      expiresAt: deadline.toISOString(),
      cancellationRevision: admission.cancellationRevision,
      bindings: admission.envelopes.flatMap((envelope) => envelope.binding ? [envelope.binding] : []),
      effectiveAuthority: [],
    };
  }

  async authorizeExecution(
    request: ApplicationExecutionAuthorizationRequest,
  ): Promise<ApplicationExecutionAuthorizationResult> {
    const catalog = await this.prepare();
    const operation = catalog.operations.find((candidate) => candidate.id === request.envelope.operationId);
    if (!operation) {
      return this.#executionDenied(request, 'AUTHORIZATION_OPERATION_MISMATCH', `Workload envelope ${request.envelope.id} references unavailable operation ${request.envelope.operationId}.`);
    }
    if (request.principal.catalogRevision !== catalog.revision
      || request.envelope.catalogRevision !== catalog.revision) {
      return this.#executionDenied(request, 'AUTHORIZATION_CATALOG_INACTIVE', `Execution ${request.principal.executionId} references a stale operation catalog.`);
    }
    if (request.principal.workloadIdentity.id !== request.envelope.workloadIdentity.id
      || request.principal.serviceIdentity?.id !== request.envelope.serviceIdentity?.id) {
      return this.#executionDenied(request, 'AUTHORIZATION_WORKLOAD_MISMATCH', `Execution principal ${request.principal.id} does not own workload envelope ${request.envelope.id}.`);
    }
    if (request.principal.cancellationRevision !== request.currentCancellationRevision) {
      return this.#executionDenied(request, 'AUTHORIZATION_EXECUTION_CANCELLED', `Execution ${request.principal.executionId} cancellation revision changed.`);
    }
    if (Date.now() >= new Date(request.principal.deadline).getTime()) {
      return this.#executionDenied(request, 'AUTHORIZATION_GRANT_EXPIRED', `Execution ${request.principal.executionId} exceeded its deadline.`);
    }
    if (request.envelope.inputSchemaDigest !== operation.input.digest) {
      return this.#executionDenied(request, 'AUTHORIZATION_OPERATION_MISMATCH', `Workload envelope ${request.envelope.id} input schema is stale.`);
    }
    if (request.envelope.audiences.length > 0 && !request.envelope.audiences.includes(request.audience)) {
      return this.#executionDenied(request, 'AUTHORIZATION_AUDIENCE_DENIED', `Audience ${request.audience} is outside workload envelope ${request.envelope.id}.`);
    }
    if (!request.envelope.transports.includes(request.transport)) {
      return this.#executionDenied(request, 'AUTHORIZATION_TRANSPORT_DENIED', `Transport ${request.transport} is outside workload envelope ${request.envelope.id}.`);
    }
    const envelopeScopes = [
      ...(request.envelope.restrictions.target ? [request.envelope.restrictions.target] : []),
      ...request.envelope.restrictions.predicates,
      ...(request.envelope.restrictions.transport ? [request.envelope.restrictions.transport] : []),
      ...(request.envelope.restrictions.audience ? [request.envelope.restrictions.audience] : []),
    ];
    const authorization = await this.#authority.authorize({
      application: this.#application,
      catalog,
      operation,
      principal: request.principal,
      target: request.target,
      scopeEvidence: [...envelopeScopes, ...(request.scopeEvidence ?? [])],
      audience: request.audience,
      transport: request.transport,
      inputDigest: request.inputDigest,
      trustedContextDigest: request.trustedContextDigest,
      ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
      ...(request.commandId ? { commandId: request.commandId } : {}),
      ...(request.targetDigest ? { targetDigest: request.targetDigest } : {}),
      ...(request.applicationPolicyAllowed !== undefined
        ? { applicationPolicyAllowed: request.applicationPolicyAllowed }
        : {}),
    });
    if (!authorization.allowed) {
      await this.#recordAuthorization(
        request.envelope.operationId,
        request.inputDigest,
        request.transport,
        request.audience,
        authorization,
      );
      return authorization;
    }
    const effectiveScope = intersectApplicationScopes(
      operation.authority.defaultScope,
      request.target,
      ...envelopeScopes,
      ...(request.scopeEvidence ?? []),
    );
    const receipt: ApplicationAuthorizationReceipt = {
      ...authorization.receipt,
      workloadEnvelopeId: request.envelope.id,
      executionPrincipalId: request.principal.id,
    };
    const effective: ApplicationEffectiveAuthority = {
      operationId: operation.id,
      catalogRevision: catalog.revision,
      authorityRevision: receipt.authorityRevision,
      workloadEnvelopeId: request.envelope.id,
      grantIds: [...receipt.matchedGrantIds],
      inputDigest: request.inputDigest,
      target: request.target,
      scope: effectiveScope,
      audience: request.audience,
      transport: request.transport,
    };
    const result: ApplicationExecutionAuthorizationResult = {
      allowed: true,
      receipt,
      principal: {
        ...request.principal,
        effectiveAuthority: [
          ...request.principal.effectiveAuthority.filter((candidate) =>
            candidate.workloadEnvelopeId !== request.envelope.id),
          effective,
        ],
      },
    };
    await this.#recordAuthorization(
      request.envelope.operationId,
      request.inputDigest,
      request.transport,
      request.audience,
      { allowed: true, receipt },
    );
    return result;
  }

  /**
   * Framework runtimes use the authority database as the canonical
   * application-scoped administrative observation store. Application code
   * never receives this method and never wires an observation sink.
   */
  async observe(
    observation: ApplicationOperationalObservationInput,
    transaction?: ApplicationAuthorityPostgresTransaction,
  ): Promise<void> {
    await this.prepare();
    await this.#observations.upsert(
      observation,
      transaction ?? undefined,
    );
  }

  async revalidate(
    receipt: ApplicationAuthorizationReceipt,
    boundary: Extract<ApplicationAuthorizationBoundary, 'execution' | 'protected-step' | 'pre-commit' | 'result-read' | 'subscription-resume'>,
    trustedContextDigest: string,
    transaction?: ApplicationAuthorityPostgresTransaction,
  ): Promise<ApplicationAuthorizationResult> {
    if (receipt.application !== this.#application) {
      return {
        allowed: false,
        code: 'AUTHORIZATION_OPERATION_MISMATCH',
        message: `Receipt ${receipt.id} belongs to application ${receipt.application}, not ${this.#application}.`,
      };
    }
    await this.prepare();
    const work = async () => {
      const catalog = await this.#catalogRepository.get(this.#application, receipt.catalogRevision);
      if (!catalog) {
        return {
          allowed: false as const,
          code: 'AUTHORIZATION_CATALOG_INACTIVE' as const,
          message: `Receipt ${receipt.id} references unavailable catalog ${receipt.catalogRevision}.`,
        };
      }
      return this.#authority.revalidateReceipt(receipt, catalog, boundary, trustedContextDigest);
    };
    if (!transaction) return work();
    return this.#catalogRepository.withinTransaction(this.#application, transaction, () =>
      this.#authorityRepository.withinTransaction(transaction, work));
  }

  /**
   * Runs authority work in an already-open PostgreSQL transaction. Signal
   * issuance uses this seam so exact-instance grants and the issuance outbox
   * share one commit boundary rather than coordinating two databases.
   */
  async withinTransaction<T>(
    transaction: ApplicationAuthorityPostgresTransaction,
    work: () => Promise<T>,
  ): Promise<T> {
    await this.prepare();
    return this.#catalogRepository.withinTransaction(
      this.#application,
      transaction,
      () => this.#authorityRepository.withinTransaction(transaction, work),
    );
  }

  async assignGrant(
    record: ApplicationGrantRecord,
    transaction?: ApplicationAuthorityPostgresTransaction,
  ): Promise<ApplicationGrantRecord> {
    await this.prepare();
    if (!transaction) return this.#authority.assignGrant(record);
    return this.withinTransaction(
      transaction,
      () => this.#authority.assignGrant(record),
    );
  }

  async authorityRevision(
    transaction?: ApplicationAuthorityPostgresTransaction,
  ): Promise<string> {
    await this.prepare();
    const read = async () => (await this.#authorityRepository.snapshot()).revision;
    return transaction ? this.withinTransaction(transaction, read) : read();
  }

  async revokeGrant(
    grantId: string,
    reason: string,
    transaction?: ApplicationAuthorityPostgresTransaction,
  ): Promise<ApplicationGrantRecord> {
    await this.prepare();
    if (!transaction) return this.#authority.revokeGrant(grantId, reason);
    return this.withinTransaction(
      transaction,
      () => this.#authority.revokeGrant(grantId, reason),
    );
  }

  async releaseEnvelope(receipt: ApplicationAuthorizationReceipt, envelopeId: string): Promise<void> {
    await this.prepare();
    await this.#catalogRepository.removeReference(
      this.#application,
      receipt.catalogRevision,
      'envelope',
      envelopeId,
    );
  }

  async #prepare(): Promise<ApplicationOperationCatalog> {
    await this.#authorityRepository.prepare();
    const transition = await this.#catalogManager.stage(this.#declaredCatalog);
    const operationIds = new Set(transition.catalog.operations.map((operation) => operation.id));
    if (this.#authorityManifest) {
      const unknown = this.#authorityManifest.permissions
        .flatMap((permission) => permission.operationIds)
        .filter((operationId) => !operationIds.has(operationId));
      if (unknown.length > 0) {
        throw new Error(`Application authority manifest ${this.#authorityManifest.revision} references unknown catalog operations: ${[...new Set(unknown)].sort().join(', ')}.`);
      }
    }
    if (transition.predecessor
      && transition.catalog.state === 'staged'
      && transition.predecessor.revision !== transition.catalog.revision) {
      // Application-owned authority is declarative, so reconcile it to the
      // staged catalog before compatibility activation. Runtime grants then
      // migrate only when every operation they carry is compatible (or has an
      // explicit compatible replacement).
      if (this.#authorityManifest) {
        await this.#authority.reconcileStaticAuthorityManifest(
          this.#authorityManifest,
          transition.catalog.revision,
        );
      }
      const authorityRevision = (await this.#authorityRepository.snapshot()).revision;
      await this.#authority.migrateCatalogAuthority(
        transition.predecessor,
        transition.catalog,
        authorityRevision,
      );
      await this.#catalogRepository.pruneTerminalCommandEnvelopeReferences(
        this.#application,
        transition.predecessor.revision,
      );
    }
    const activated = await this.#catalogManager.activate(
      this.#application,
      transition.catalog.revision,
    );
    if (this.#authorityManifest) {
      await this.#authority.reconcileStaticAuthorityManifest(
        this.#authorityManifest,
        activated.catalog.revision,
      );
    }
    await this.#observations.prepare();
    await this.#observations.upsert({
      id: 'authority:operation-catalog',
      domain: 'authority',
      subject: `operation-catalog:${activated.catalog.revision}`,
      authority: 'canonical',
      state: 'ready',
      source: 'application-operation-authority-runtime',
      evidence: {
        catalogRevision: activated.catalog.revision,
        operationCount: activated.catalog.operations.length,
      },
      observedAt: new Date().toISOString(),
    });
    return activated.catalog;
  }

  async #recordAuthorization(
    operationId: ApplicationOperationId,
    inputDigest: string,
    transport: ApplicationOperationTransport,
    audience: string,
    authorization:
      | ApplicationAuthorizationResult
      | ApplicationExecutionAuthorizationResult,
  ): Promise<void> {
    await this.#observations.upsert({
      id: authorization.allowed
        ? `authority:receipt:${authorization.receipt.id}`
        : `authority:denial:${operationId}:${inputDigest}`,
      domain: 'authority',
      subject: operationId,
      authority: 'canonical',
      state: authorization.allowed ? 'succeeded' : 'failed',
      ...(!authorization.allowed ? { reason: authorization.code } : {}),
      source: 'application-operation-authority-runtime',
      ...(authorization.allowed
        ? { causalId: authorization.receipt.id }
        : {}),
      evidence: authorization.allowed
        ? {
            operationId,
            audience,
            transport,
            receiptId: authorization.receipt.id,
          }
        : {
            operationId,
            audience,
            transport,
            code: authorization.code,
          },
      observedAt: new Date().toISOString(),
    });
  }

  async #executionDenied(
    request: ApplicationExecutionAuthorizationRequest,
    code: string,
    message: string,
  ): Promise<ApplicationExecutionAuthorizationResult> {
    const denied = executionDenied(code, message);
    await this.#recordAuthorization(
      request.envelope.operationId,
      request.inputDigest,
      request.transport,
      request.audience,
      denied,
    );
    return denied;
  }
}

export function createApplicationOperationAuthorityRuntime(
  options: ApplicationOperationAuthorityRuntimeOptions,
): ApplicationOperationAuthorityRuntime {
  return new ApplicationOperationAuthorityRuntime(options);
}

function executionDenied(code: string, message: string): ApplicationExecutionAuthorizationResult {
  return { allowed: false, code, message };
}
