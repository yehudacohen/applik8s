import { AccountChanged } from './events.js';
import { stageCredential } from './nested.js';

export function createAccount(account: {
  readonly id: string;
  readonly credentialId: string;
}) {
  AccountChanged.emit({ accountId: account.id });
  stageCredential(account.credentialId, account.id);
}
