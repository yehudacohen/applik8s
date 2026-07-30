import { app as createApp, IdentityProvider } from '@applik8s/applik8s';
import { entity, type } from '@applik8s/applik8s/dsl';
import type { ApplicationQueryOperation } from '@applik8s/client';
import { fixtureAdmission } from './identity';

export const app = createApp('vite-facade-fixture');
app.provide(IdentityProvider, IdentityProvider.from(async () => fixtureAdmission('fixture')));
const EntryEntity = entity('GuestBookEntry', {
  spec: type({ message: 'string' }),
  status: type({ "phase?": "'Pending' | 'Published'" }),
});
const BaseEntry = app.crd(EntryEntity, {
  apiVersion: 'guestbook.example/v1alpha1',
  create: {
    authorize: () => true,
    place: () => ({ namespace: 'default', generateName: 'entry-' }),
  },
});
export const GuestBookEntry: {
  readonly create: typeof BaseEntry.create;
  readonly published: ApplicationQueryOperation<{ readonly limit: number }, readonly { readonly id: string; readonly message: string }[]>;
} = BaseEntry.view('published', {
  input: type({ limit: 'number.integer >= 1' }),
  output: type({ id: 'string', message: 'string' }).array(),
  authorize: () => true,
  kubernetes: {
    namespace: 'default',
    project: ({ value }) => ({
      id: value.metadata.name,
      message: value.spec.message,
    }),
  },
});
