import type { ApplicationCommandProcessorBinding } from './model-command-processor-runtime.js';

const indexes = new WeakMap<readonly ApplicationCommandProcessorBinding[], ReadonlyMap<string, ApplicationCommandProcessorBinding>>();

export function commandProcessorBindingFor(
  bindings: readonly ApplicationCommandProcessorBinding[],
  contract: { readonly name: string; readonly version: string },
): ApplicationCommandProcessorBinding | undefined {
  let index = indexes.get(bindings);
  if (!index) {
    index = new Map(bindings.map((binding) => [contractKey(binding.contract), binding]));
    indexes.set(bindings, index);
  }
  return index.get(contractKey(contract));
}

function contractKey(contract: { readonly name: string; readonly version: string }): string {
  return `${contract.name}\u0000${contract.version}`;
}
