import { resolve } from 'node:path';

import { assertCanonicalRuntimeContract, canonicalRuntimeContract } from '../packages/runtime-contract/src/index.js';

export const runtimeContractArtifactPath = resolve('crates/applik8s-runtime-contract/generated/runtime-contract.json');

export function runtimeContractArtifactText(): string {
  const contract = canonicalRuntimeContract();

  assertCanonicalRuntimeContract(contract);
  return `${JSON.stringify(contract, null, 2)}\n`;
}
