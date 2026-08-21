import {
  app,
  event,
  Lakehouse,
  LakehouseDataset,
  type,
} from '@applik8s/applik8s';

const platform = app('lakehouse-proof', { namespace: 'lakehouse-proof' });

const UsageHistory = LakehouseDataset.named('historical-usage');
platform
  .provide(UsageHistory)
  .local(() => Lakehouse.duckdbDataset({ root: '.applik8s/lakehouse' }))
  .awsLocal(() => Lakehouse.s3Dataset({
    bucket: 'lakehouse-proof-history',
    prefix: 'historical-usage',
    catalog: 'lakehouse_proof_history',
    region: 'us-east-1',
  }))
  .aws(() => Lakehouse.s3Dataset({
    bucket: 'lakehouse-proof-history',
    prefix: 'historical-usage',
    catalog: 'lakehouse_proof_history',
    region: 'us-east-1',
  }))
  .kubernetes(() => Lakehouse.s3Dataset({
    bucket: 'lakehouse-proof-history',
    prefix: 'historical-usage',
    catalog: 'lakehouse_proof_history',
    region: 'us-east-1',
  }));

const UsageRecorded = event('usage.recorded.v1', {
  payload: type({
    organizationId: 'string',
    occurredAt: 'string',
    quantity: 'number',
  }),
});

export const HistoricalUsage = UsageRecorded.publish(
  UsageHistory,
  type({
    organizationId: 'string',
    occurredAt: 'string',
    quantity: 'number',
  }),
  (usage, output) => output.append(usage),
).partitionBy((row) => ({
  organizationId: row.organizationId,
  month: row.occurredAt.slice(0, 7),
}));

export const lakehouseProof = platform.composition;
