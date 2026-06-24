import { readFile } from 'node:fs/promises';

import { runtimeContractArtifactPath, runtimeContractArtifactText } from './runtime-contract-artifact.js';

const expected = runtimeContractArtifactText();
const actual = await readFile(runtimeContractArtifactPath, 'utf8');

if (actual !== expected) {
  console.error(`Generated runtime contract is stale: ${runtimeContractArtifactPath}`);
  console.error('Run `bun run generate:runtime-contract` and commit the updated artifact.');
  process.exit(1);
}
