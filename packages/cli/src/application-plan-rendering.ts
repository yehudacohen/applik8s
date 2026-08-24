// typecast-file-boundary: Parsed plan JSON is restored only at the validator boundary immediately below.
import { readFile } from 'node:fs/promises';
import {
  diffApplicationPlans,
  renderApplicationPlanGraph,
  renderApplicationPlanText,
  serializeApplicationPlan,
  validateApplicationPlan,
  type ApplicationPlan,
} from '@applik8s/core';

export type ApplicationPlanFormat = 'text' | 'json' | 'graph';

export function renderCanonicalApplicationPlan(
  plan: ApplicationPlan,
  format: ApplicationPlanFormat,
): string {
  if (format === 'json') return serializeApplicationPlan(plan).trimEnd();
  if (format === 'graph') return renderApplicationPlanGraph(plan).trimEnd();
  return renderApplicationPlanText(plan).trimEnd();
}

export async function readPriorApplicationPlan(path: string): Promise<ApplicationPlan> {
  const plan = JSON.parse(await readFile(path, 'utf8')) as ApplicationPlan;
  const validation = validateApplicationPlan(plan);
  if (!validation.valid) {
    throw new Error(
      `Prior ApplicationPlan ${path} is invalid: ${validation.diagnostics.map(({ code }) => code).join(', ')}.`,
    );
  }
  return plan;
}

export function renderApplicationPlanDiff(
  diff: ReturnType<typeof diffApplicationPlans>,
): string {
  return [
    `ApplicationPlan diff ${diff.fromTarget} -> ${diff.toTarget}`,
    `  summary create=${diff.summary.create} update=${diff.summary.update} replace=${diff.summary.replace} delete=${diff.summary.delete} no-op=${diff.summary.noOp}`,
    ...(diff.entries.length === 0
      ? ['  no changes']
      : diff.entries.map(
          (entry) =>
            `  ${entry.severity.toUpperCase().padEnd(11)} ${entry.action.padEnd(7)} ${entry.category.padEnd(15)} ${entry.id}`,
        )),
  ].join('\n');
}
