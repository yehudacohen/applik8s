import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { runtimeContractArtifactPath, runtimeContractArtifactText } from './runtime-contract-artifact.js';

await mkdir(dirname(runtimeContractArtifactPath), { recursive: true });
await writeFile(runtimeContractArtifactPath, runtimeContractArtifactText());
