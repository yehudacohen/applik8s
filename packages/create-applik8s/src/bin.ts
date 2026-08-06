#!/usr/bin/env node

import { createApplicationAgenticStart } from '@applik8s/start-agentic';

const arguments_ = process.argv.slice(2);
const values = parseArguments(arguments_);
const target = values.target;
const start = values.start ?? 'agentic';

if (!target) {
  throw new Error(
    'Usage: bun create applik8s <project-name> [--start agentic] [--example research] [--context <kube-context>]',
  );
}
if (start !== 'agentic') {
  throw new Error(
    `Unknown Applik8s Start ${JSON.stringify(start)}. Available Starts: agentic.`,
  );
}

const result = await createApplicationAgenticStart({
  targetDirectory: target,
  ...(values.context ? { context: values.context } : {}),
  ...(values.example ? { example: values.example } : {}),
  progress({ message }) {
    process.stdout.write(`→ ${message}\n`);
  },
});
process.stdout.write(
  [
    '',
    `Created ${result.projectName} from @tanstack/cli@${result.upstream.version} with the Applik8s Agentic Start.`,
    `  cd ${target}`,
    '  bun run check',
    values.context
      ? '  bun run dev:cluster'
      : '  applik8s deploy --context <kube-context> && bun run dev',
    '',
    values.context
      ? `Kubernetes context ${values.context} is persisted in package.json.`
      : 'No Kubernetes context was adopted. Pass --context when creating or add applik8s.context to package.json before deploying.',
    '',
  ].join('\n'),
);

interface ParsedArguments {
  readonly target?: string;
  readonly start?: string;
  readonly context?: string;
  readonly example?: 'product' | 'research';
}

function parseArguments(args: readonly string[]): ParsedArguments {
  let target: string | undefined;
  let start: string | undefined;
  let context: string | undefined;
  let example: 'product' | 'research' | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--start' || value === '--context' || value === '--example') {
      const option = args[index + 1];
      if (!option || option.startsWith('-')) {
        throw new Error(`${value} requires a value.`);
      }
      index += 1;
      if (value === '--start') start = option;
      if (value === '--context') context = option;
      if (value === '--example') {
        if (option !== 'product' && option !== 'research') {
          throw new Error(
            `Unknown Agentic Start example ${JSON.stringify(option)}. Available examples: product, research.`,
          );
        }
        example = option;
      }
      continue;
    }
    if (value?.startsWith('-')) {
      throw new Error(`Unknown option ${value}.`);
    }
    if (target) {
      throw new Error(`Unexpected argument ${value}.`);
    }
    target = value;
  }
  return {
    ...(target ? { target } : {}),
    ...(start ? { start } : {}),
    ...(context ? { context } : {}),
    ...(example ? { example } : {}),
  };
}
