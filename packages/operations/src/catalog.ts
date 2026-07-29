import type {
  ApplicationCatalogRevisionId,
  ApplicationOperationCatalog,
  ApplicationOperationCompatibilityChange,
  ApplicationOperationCompatibilityReport,
  ApplicationOperationDescriptor,
  ApplicationOperationId,
} from '@applik8s/core';
import { validateApplicationOperationCatalog } from '@applik8s/core';

export interface ApplicationCatalogReferenceSnapshot {
  readonly grantIds: readonly string[];
  readonly envelopeIds: readonly string[];
  readonly workflowIds: readonly string[];
  readonly sessionIds: readonly string[];
}

export interface ApplicationOperationCatalogRepository {
  list(application: string): Promise<readonly ApplicationOperationCatalog[]>;
  get(application: string, revision: ApplicationCatalogRevisionId): Promise<ApplicationOperationCatalog | undefined>;
  put(catalog: ApplicationOperationCatalog): Promise<void>;
  references(application: string, revision: ApplicationCatalogRevisionId): Promise<ApplicationCatalogReferenceSnapshot>;
  putReference(
    application: string,
    revision: ApplicationCatalogRevisionId,
    kind: 'grant' | 'envelope' | 'workflow' | 'session',
    referenceId: string,
  ): Promise<void>;
  removeReference(
    application: string,
    revision: ApplicationCatalogRevisionId,
    kind: 'grant' | 'envelope' | 'workflow' | 'session',
    referenceId: string,
  ): Promise<void>;
  transaction<T>(application: string, work: () => Promise<T>): Promise<T>;
}

export interface ApplicationCatalogTransition {
  readonly catalog: ApplicationOperationCatalog;
  readonly predecessor?: ApplicationOperationCatalog;
  readonly compatibility?: ApplicationOperationCompatibilityReport;
}

export class ApplicationOperationCatalogManager {
  readonly #repository: ApplicationOperationCatalogRepository;
  readonly #now: () => string;

  constructor(repository: ApplicationOperationCatalogRepository, options: { readonly now?: () => string } = {}) {
    this.#repository = repository;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async stage(catalog: ApplicationOperationCatalog): Promise<ApplicationCatalogTransition> {
    const diagnostics = validateApplicationOperationCatalog(catalog);
    if (diagnostics.length > 0) {
      throw new ApplicationCatalogError(
        'CATALOG_INVALID',
        `Operation catalog ${catalog.revision} is invalid: ${diagnostics.map((diagnostic) => diagnostic.message).join(' ')}`,
      );
    }
    if (catalog.state !== 'proposed') {
      throw new ApplicationCatalogError('CATALOG_INVALID_STATE', `Only proposed catalogs can be staged; ${catalog.revision} is ${catalog.state}.`);
    }
    return this.#repository.transaction(catalog.application, async () => {
      const existing = await this.#repository.get(catalog.application, catalog.revision);
      if (existing) {
        if (existing.digest !== catalog.digest) {
          throw new ApplicationCatalogError('CATALOG_REVISION_CONFLICT', `Catalog revision ${catalog.revision} already exists with digest ${existing.digest}.`);
        }
        return { catalog: existing };
      }
      const catalogs = await this.#repository.list(catalog.application);
      const active = catalogs.find((candidate) => candidate.state === 'active');
      const predecessor = catalog.predecessor
        ? await this.#repository.get(catalog.application, catalog.predecessor)
        : active;
      if (active && predecessor?.revision !== active.revision) {
        throw new ApplicationCatalogError(
          'CATALOG_PREDECESSOR_MISMATCH',
          `Catalog ${catalog.revision} must name active revision ${active.revision} as its predecessor.`,
        );
      }
      const compatibility = predecessor ? compareApplicationOperationCatalogs(predecessor, catalog) : undefined;
      const staged: ApplicationOperationCatalog = {
        ...catalog,
        state: 'staged',
        stagedAt: this.#now(),
      };
      await this.#repository.put(staged);
      return {
        catalog: staged,
        ...(predecessor ? { predecessor } : {}),
        ...(compatibility ? { compatibility } : {}),
      };
    });
  }

  async activate(application: string, revision: ApplicationCatalogRevisionId): Promise<ApplicationCatalogTransition> {
    return this.#repository.transaction(application, async () => {
      const candidate = await requiredCatalog(this.#repository, application, revision);
      if (candidate.state === 'active') return { catalog: candidate };
      if (candidate.state !== 'staged') {
        throw new ApplicationCatalogError('CATALOG_INVALID_STATE', `Catalog ${revision} must be staged before activation; it is ${candidate.state}.`);
      }
      const catalogs = await this.#repository.list(application);
      const active = catalogs.find((catalog) => catalog.state === 'active');
      const activeReferences = active
        ? await this.#repository.references(application, active.revision)
        : undefined;
      const compatibility = active
        ? compareApplicationOperationCatalogs(active, candidate, activeReferences)
        : undefined;
      const blockingReferences = compatibility
        ? [...compatibility.blockingGrantIds, ...compatibility.blockingEnvelopeIds]
        : [];
      const otherBlockingReferences = compatibility
        ? [...compatibility.blockingWorkflowIds, ...compatibility.blockingSessionIds]
        : [];
      if (compatibility && !compatibility.compatible
        && (blockingReferences.length > 0 || otherBlockingReferences.length > 0)) {
        throw new ApplicationCatalogError(
          'CATALOG_INCOMPATIBLE',
          `Catalog ${revision} cannot activate while incompatible operations remain referenced: ${[
            ...blockingReferences,
            ...otherBlockingReferences,
          ].join(', ')}. Migrate or drain those durable references before activation.`,
        );
      }
      const activatedAt = this.#now();
      if (active) {
        await this.#repository.put({ ...active, state: 'draining', drainingAt: activatedAt });
      }
      const activated: ApplicationOperationCatalog = { ...candidate, state: 'active', activatedAt };
      await this.#repository.put(activated);
      return {
        catalog: activated,
        ...(active ? { predecessor: active } : {}),
        ...(compatibility ? { compatibility } : {}),
      };
    });
  }

  async retire(application: string, revision: ApplicationCatalogRevisionId): Promise<ApplicationOperationCatalog> {
    return this.#repository.transaction(application, async () => {
      const catalog = await requiredCatalog(this.#repository, application, revision);
      if (catalog.state === 'retired') return catalog;
      if (catalog.state !== 'draining') {
        throw new ApplicationCatalogError('CATALOG_INVALID_STATE', `Only a draining catalog can retire; ${revision} is ${catalog.state}.`);
      }
      const references = await this.#repository.references(application, revision);
      const blocking = [
        ...references.grantIds,
        ...references.envelopeIds,
        ...references.workflowIds,
        ...references.sessionIds,
      ];
      if (blocking.length > 0) {
        throw new ApplicationCatalogError('CATALOG_REFERENCED', `Catalog ${revision} still has ${blocking.length} live reference(s): ${blocking.join(', ')}.`);
      }
      const retired: ApplicationOperationCatalog = {
        ...catalog,
        state: 'retired',
        retiredAt: this.#now(),
      };
      await this.#repository.put(retired);
      return retired;
    });
  }

  async resolve(
    application: string,
    operationId: ApplicationOperationId,
    revision?: ApplicationCatalogRevisionId,
  ): Promise<ApplicationOperationDescriptor> {
    const catalogs = revision
      ? [await requiredCatalog(this.#repository, application, revision)]
      : await this.#repository.list(application);
    const eligible = catalogs.filter((catalog) => catalog.state === 'active' || catalog.state === 'draining');
    const operation = eligible.flatMap((catalog) => catalog.operations).find((candidate) => candidate.id === operationId);
    if (!operation) {
      throw new ApplicationCatalogError(
        'CATALOG_OPERATION_UNAVAILABLE',
        `Operation ${operationId} is unknown or retired${revision ? ` in catalog ${revision}` : ''}.`,
      );
    }
    return operation;
  }
}

export class InMemoryApplicationOperationCatalogRepository implements ApplicationOperationCatalogRepository {
  readonly #catalogs = new Map<string, ApplicationOperationCatalog>();
  readonly #references = new Map<string, ApplicationCatalogReferenceSnapshot>();
  #tail = Promise.resolve();

  async list(application: string): Promise<readonly ApplicationOperationCatalog[]> {
    return [...this.#catalogs.values()]
      .filter((catalog) => catalog.application === application)
      .sort((left, right) => left.revision.localeCompare(right.revision))
      .map(clone);
  }

  async get(application: string, revision: ApplicationCatalogRevisionId): Promise<ApplicationOperationCatalog | undefined> {
    const catalog = this.#catalogs.get(catalogKey(application, revision));
    return catalog ? clone(catalog) : undefined;
  }

  async put(catalog: ApplicationOperationCatalog): Promise<void> {
    this.#catalogs.set(catalogKey(catalog.application, catalog.revision), clone(catalog));
  }

  async references(application: string, revision: ApplicationCatalogRevisionId): Promise<ApplicationCatalogReferenceSnapshot> {
    return clone(this.#references.get(catalogKey(application, revision)) ?? {
      grantIds: [],
      envelopeIds: [],
      workflowIds: [],
      sessionIds: [],
    });
  }

  setReferences(application: string, revision: ApplicationCatalogRevisionId, references: ApplicationCatalogReferenceSnapshot): void {
    this.#references.set(catalogKey(application, revision), clone(references));
  }

  async putReference(
    application: string,
    revision: ApplicationCatalogRevisionId,
    kind: 'grant' | 'envelope' | 'workflow' | 'session',
    referenceId: string,
  ): Promise<void> {
    const key = catalogKey(application, revision);
    const current = await this.references(application, revision);
    const field = referenceKindField(kind);
    this.#references.set(key, {
      ...current,
      [field]: [...new Set([...current[field], referenceId])].sort(),
    });
  }

  async removeReference(
    application: string,
    revision: ApplicationCatalogRevisionId,
    kind: 'grant' | 'envelope' | 'workflow' | 'session',
    referenceId: string,
  ): Promise<void> {
    const key = catalogKey(application, revision);
    const current = await this.references(application, revision);
    const field = referenceKindField(kind);
    this.#references.set(key, {
      ...current,
      [field]: current[field].filter((candidate) => candidate !== referenceId),
    });
  }

  async transaction<T>(_application: string, work: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const prior = this.#tail;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      return await work();
    } finally {
      release();
    }
  }
}

export type ApplicationCatalogErrorCode =
  | 'CATALOG_INVALID'
  | 'CATALOG_INVALID_STATE'
  | 'CATALOG_REVISION_CONFLICT'
  | 'CATALOG_PREDECESSOR_MISMATCH'
  | 'CATALOG_INCOMPATIBLE'
  | 'CATALOG_REFERENCED'
  | 'CATALOG_NOT_FOUND'
  | 'CATALOG_OPERATION_UNAVAILABLE';

export class ApplicationCatalogError extends Error {
  readonly code: ApplicationCatalogErrorCode;

  constructor(code: ApplicationCatalogErrorCode, message: string) {
    super(message);
    this.name = 'ApplicationCatalogError';
    this.code = code;
  }
}

export function compareApplicationOperationCatalogs(
  from: ApplicationOperationCatalog,
  to: ApplicationOperationCatalog,
  references: {
    readonly grantIds?: readonly string[];
    readonly envelopeIds?: readonly string[];
    readonly workflowIds?: readonly string[];
    readonly sessionIds?: readonly string[];
  } = {},
): ApplicationOperationCompatibilityReport {
  const changes: ApplicationOperationCompatibilityChange[] = [];
  const fromById = new Map(from.operations.map((operation) => [operation.id, operation]));
  const toById = new Map(to.operations.map((operation) => [operation.id, operation]));
  const replacementsByPriorId = new Map(
    to.operations
      .filter((operation) => operation.replaces)
      .map((operation) => [operation.replaces!.operationId, operation] as const),
  );
  for (const operation of from.operations) {
    const next = toById.get(operation.id);
    if (!next) {
      const replacement = replacementsByPriorId.get(operation.id);
      changes.push({
        operationId: operation.id,
        kind: replacement?.replaces?.compatible ? 'replaced' : 'removed',
        message: replacement?.replaces?.compatible
          ? `Operation ${operation.id} is replaced by ${replacement.id}.`
          : `Operation ${operation.id} was removed without a compatible replacement.`,
        ...(replacement?.replaces
          ? {
              replacement: {
                ...replacement.replaces,
                operationId: replacement.id,
              },
            }
          : {}),
      });
      continue;
    }
    const compatibility = compareOperation(operation, next);
    changes.push({
      operationId: operation.id,
      kind: compatibility.kind,
      message: compatibility.message,
    });
  }
  for (const operation of to.operations) {
    if (!fromById.has(operation.id) && !operation.replaces) {
      changes.push({ operationId: operation.id, kind: 'added', message: `Operation ${operation.id} was added.` });
    }
  }
  const incompatible = changes.some((change) => change.kind === 'removed' || change.kind === 'incompatible');
  return {
    fromRevision: from.revision,
    toRevision: to.revision,
    compatible: !incompatible,
    changes,
    blockingGrantIds: incompatible ? [...(references.grantIds ?? [])] : [],
    blockingEnvelopeIds: incompatible ? [...(references.envelopeIds ?? [])] : [],
    blockingWorkflowIds: incompatible ? [...(references.workflowIds ?? [])] : [],
    blockingSessionIds: incompatible ? [...(references.sessionIds ?? [])] : [],
  };
}

function compareOperation(
  from: ApplicationOperationDescriptor,
  to: ApplicationOperationDescriptor,
): { readonly kind: ApplicationOperationCompatibilityChange['kind']; readonly message: string } {
  if (from.kind !== to.kind || from.target?.identity.digest !== to.target?.identity.digest) {
    return { kind: 'incompatible', message: `Operation ${from.id} changed kind or target identity.` };
  }
  if (from.input.digest !== to.input.digest || from.output.digest !== to.output.digest) {
    return { kind: 'incompatible', message: `Operation ${from.id} changed its input or output schema.` };
  }
  if (from.authority.classification !== to.authority.classification
    || from.authority.delegable !== to.authority.delegable
    || from.authority.grantable !== to.authority.grantable) {
    return { kind: 'incompatible', message: `Operation ${from.id} changed its authority classification.` };
  }
  return { kind: 'compatible', message: `Operation ${from.id} remains compatible.` };
}

async function requiredCatalog(
  repository: ApplicationOperationCatalogRepository,
  application: string,
  revision: ApplicationCatalogRevisionId,
): Promise<ApplicationOperationCatalog> {
  const catalog = await repository.get(application, revision);
  if (!catalog) throw new ApplicationCatalogError('CATALOG_NOT_FOUND', `Operation catalog ${application}/${revision} does not exist.`);
  return catalog;
}

function catalogKey(application: string, revision: ApplicationCatalogRevisionId): string {
  return `${application}\u0000${revision}`;
}

function referenceKindField(
  kind: 'grant' | 'envelope' | 'workflow' | 'session',
): keyof ApplicationCatalogReferenceSnapshot {
  switch (kind) {
    case 'grant': return 'grantIds';
    case 'envelope': return 'envelopeIds';
    case 'workflow': return 'workflowIds';
    case 'session': return 'sessionIds';
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
