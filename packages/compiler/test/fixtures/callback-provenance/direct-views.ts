import { sharedProjection } from './shared.js';

declare const Objective: { view(options: unknown, handler: (...args: unknown[]) => unknown): void };
declare const Input: unknown;
declare const Output: unknown;
declare const database: unknown;

async function loadFirst(input: unknown, context: unknown) {
  return normalizeViewResult(sharedProjection('first', input, context));
}

async function loadSecond(input: unknown, context: unknown) {
  return normalizeViewResult(sharedProjection('second', input, context));
}

Objective.view({ input: Input, output: Output, database }, loadFirst);
Objective.view({ input: Input, output: Output, database }, loadSecond);

function normalizeViewResult(value: unknown) {
  return { value };
}

const declarationLookingTemplate = `
function templateImpostor() {}
`;

function declarationContainer() {
  function nestedImpostor() {}
  return nestedImpostor;
}

void declarationLookingTemplate;
void declarationContainer;
