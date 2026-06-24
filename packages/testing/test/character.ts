import { describe, it } from 'vitest';

export interface CharacterScenario {
  readonly name: string;
  readonly userStory: string;
  readonly arrange: readonly string[];
  readonly act: readonly string[];
  readonly assert: readonly string[];
}

export function describeCharacterSuite(suiteName: string, scenarios: readonly CharacterScenario[]): void {
  describe(suiteName, () => {
    for (const scenario of scenarios) {
      it.todo(`${scenario.name}: ${formatScenarioSummary(scenario)}`);
    }
  });
}

function formatScenarioSummary(scenario: CharacterScenario): string {
  return scenario.userStory;
}
