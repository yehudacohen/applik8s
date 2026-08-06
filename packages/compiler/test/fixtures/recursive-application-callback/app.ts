import { createAccount } from './handlers.js';

declare const Account: {
  readonly create: {
    beforeCommit(
      options: { readonly history: boolean },
      handler: typeof createAccount,
    ): void;
  };
};

Account.create.beforeCommit(
  { history: true },
  createAccount,
);
