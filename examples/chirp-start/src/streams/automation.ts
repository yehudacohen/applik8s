import { app } from '../domain-app';
import { executeAutomationRun } from '../automation/workflow';
import { Database } from '../providers/database';
import { AutomationScheduleChanged } from '../domain/events';

/**
 * Committed Automation desired state is the only input to schedule
 * reconciliation. The processor receives one explicit task schedule target;
 * Hatchet remains an injected WorkflowEngine implementation detail.
 */
export const AutomationScheduleChanges = app.stream(AutomationScheduleChanged, {
  database: Database,
  retention: { maxAgeSeconds: 30 * 24 * 60 * 60, maxMessages: 5_000_000 },
  partitionBy: ({ automationId }) => automationId,
  authorize: () => false,
});

export const AutomationScheduleReconciler = AutomationScheduleChanges.onEvent({
  enabled: app.installation.spec.features.automatedAccounts,
  retry: { maxAttempts: 12, initialDelayMs: 500, maxDelayMs: 60_000, deadLetter: false },
  budgets: { timeoutMs: 30_000, maxInputBytes: 64 * 1_024 },
}, async function reconcileAutomationSchedules(changed, context) {
  await executeAutomationRun.reconcile({
    id: `chirp-automation-${changed.automationId}`,
    expression: changed.schedule,
    revision: String(context.event.sequence),
    enabled: changed.state === 'active',
    input: {
      automationId: changed.automationId,
      accountId: changed.accountId,
      profile: changed.generationProfile ?? 'deterministic-safe',
      persona: changed.persona ?? 'A disclosed automated Chirp account.',
      instructions: changed.instructions ?? 'Publish a brief, factual status update.',
    },
  }, {
    idempotencyKey: context.event.id,
    correlationId: context.event.id,
    causationId: context.event.id,
  });
});
