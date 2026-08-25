import {
  app,
  defaultApplicationEventLogProvider,
  event,
  Lakehouse,
  LakehouseDataset,
  Observability,
  postgres,
  trustedContext,
  type,
} from '@applik8s/applik8s';
import { createDeterministicApplicationAdmission } from '@applik8s/identity';
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

const namespace = 'v08-observability-process';
const lakehouseRoot = process.env.APPLIK8S_V08_OBSERVABILITY_LAKEHOUSE_ROOT
  ?? '.applik8s/state/v08-observability-process';

const observations = pgTable('v08_observability_process_observations', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  label: text('label').notNull(),
  revision: text('revision').notNull().default(''),
});

const OrganizationId = trustedContext('organizationId', {
  schema: type('string'),
});

const application = app('v08-observability-process', { namespace });
application.provide(Observability, Observability.local());
application.defaults({
  eventLog: {
    ...defaultApplicationEventLogProvider,
    namespace,
    provision: false,
  },
});

const Database = application.database.postgres('observations', {
  schema: { observations },
  migrations: './migrations',
  database: 'v08_observability',
  access: postgres.rls({ context: OrganizationId, column: 'organizationId' }),
});

const Observation = application.model(observations, {
  name: 'Observation',
  database: Database,
});
Observation.delete.applicationPolicy();
Observation.update.applicationPolicy();

const ObservationCreated = event('observations.created.v1', {
  payload: type({
    observationId: 'string',
    organizationId: 'string',
    label: 'string',
  }),
});

Observation.create.beforeCommit(
  { events: [ObservationCreated], history: true },
  async (observation, input, context) => {
    if (
      !context.principal
      || context.principal.identity.subject !== input.organizationId
    ) {
      throw new Error('An observation may only be created in its authenticated organization.');
    }
    context.emit(ObservationCreated, {
      observationId: observation.id,
      organizationId: observation.value.organizationId,
      label: observation.value.label,
    });
  },
);

const ObservationHistory = LakehouseDataset.named('observation-history');
application
  .provide(ObservationHistory)
  .local(() => Lakehouse.duckdbDataset({ root: lakehouseRoot }));

export const PublishedObservationHistory = ObservationCreated.publish(
  ObservationHistory,
  type({
    observationId: 'string',
    organizationId: 'string',
    label: 'string',
  }),
  (created, output) => output.append(created),
);

application.gateway('public', {
  queries: [],
  commands: [Observation.create],
  subscriptions: [],
  authorizeCommand: ({ principal }) => principal.id.length > 0,
  deployment: {
    namespace,
    replicas: 1,
    cursorSecret: {
      apiVersion: 'v1',
      kind: 'Secret',
      name: 'v08-observability-cursor',
      namespace,
      key: 'secret',
    },
    authenticate: async (request) => createDeterministicApplicationAdmission({
      mode: 'starter',
      application: 'v08-observability-process',
      subject: request.headers.get('x-principal') ?? 'anonymous',
      catalogRevision: 'v08-observability-catalog-v1',
      authorityRevision: request.headers.get('x-authorization-version') ?? 'v1',
      trustedContext: {
        organizationId: request.headers.get('x-organization') ?? 'missing',
      },
      admittedAt: '2026-08-25T12:00:00.000Z',
    }),
  },
});

export const v08ObservabilityGeneratedProcess = application.composition;
