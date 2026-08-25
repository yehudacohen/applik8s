import {
  app,
  event,
  Lakehouse,
  LakehouseDataset,
  Observability,
  type,
} from '@applik8s/applik8s';

const platform = app('observed-lakehouse-proof', {
  namespace: 'observed-lakehouse-proof',
});
platform.provide(Observability, Observability.local());

const UsageHistory = LakehouseDataset.named('observed-history');
platform
  .provide(UsageHistory)
  .local(() => Lakehouse.duckdbDataset({
    root: '.applik8s/observed-lakehouse',
  }))
  .kubernetes(() => Lakehouse.s3Dataset({
    bucket: 'observed-lakehouse-history',
    prefix: 'observed-history',
    catalog: 'observed_history',
    region: 'us-east-1',
  }));

const UsageRecorded = event('usage.observed.v1', {
  payload: type({ organizationId: 'string', quantity: 'number' }),
});

export const ObservedHistory = UsageRecorded.publish(
  UsageHistory,
  type({ organizationId: 'string', quantity: 'number' }),
  (usage, output) => output.append(usage),
);

export const observedLakehouseProof = platform.composition;
