import { CreateCredentialLink } from './operations.js';

export function stageCredential(credentialId: string, accountId: string) {
  return CreateCredentialLink({ id: credentialId, accountId });
}
