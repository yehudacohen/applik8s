import { createApplik8sStart } from '@applik8s/tanstack-start';
import { type } from 'arktype';

export const app = createApplik8sStart({
  name: process.env.APPLIK8S_APPLICATION_NAME ?? 'guestbook-start',
  namespace: process.env.APPLIK8S_NAMESPACE ?? 'guestbook',
  context: type({
    guestbook: 'string',
    namespace: 'string',
    role: "'reader' | 'author' | 'moderator'",
  }),
  authenticate: async () => ({
    principal: { id: 'guestbook-demo' },
    authorizationVersion: 'demo-v1',
    trustedContext: {
      guestbook: 'main',
      namespace: process.env.APPLIK8S_NAMESPACE ?? 'guestbook',
      role: 'author',
    },
  }),
});
