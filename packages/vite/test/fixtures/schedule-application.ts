import { app as createApp } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';

export const app = createApp('vite-schedule-fixture');

export const RebuildTenant = app.workflow(
  'tenant.rebuild.v1',
  {
    input: type({ tenantId: 'string' }),
    output: type({ tenantId: 'string', rebuilt: 'boolean' }),
  },
  async ({ tenantId }) => ({ tenantId, rebuilt: true }),
);
