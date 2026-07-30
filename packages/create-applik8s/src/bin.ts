#!/usr/bin/env node

import { createApplicationAgenticStart } from '@applik8s/start-agentic';

const arguments_ = process.argv.slice(2);
const target = arguments_.find((argument) => !argument.startsWith('-'));
const startIndex = arguments_.indexOf('--start');
const start = startIndex >= 0 ? arguments_[startIndex + 1] : 'agentic';

if (!target) {
  throw new Error(
    'Usage: bun create applik8s <project-name> [--start agentic]',
  );
}
if (start !== 'agentic') {
  throw new Error(
    `Unknown Applik8s Start ${JSON.stringify(start)}. Available Starts: agentic.`,
  );
}

const result = await createApplicationAgenticStart({
  targetDirectory: target,
});
process.stdout.write(
  `Created ${result.projectName} from @tanstack/cli@${result.upstream.version} with the Applik8s Agentic Start.\n`,
);
