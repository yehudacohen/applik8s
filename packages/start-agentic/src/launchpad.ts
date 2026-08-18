import {
  applicationOperationalHealthState,
  type ApplicationOperationalHealthState,
} from '@applik8s/operations-ui/health';

export type AgenticLaunchpadState = ApplicationOperationalHealthState;

export interface AgenticLaunchpadEvidenceRecord {
  readonly state?: string;
  readonly authority?: string;
}

export interface AgenticLaunchpadEvidenceItem {
  readonly name: string;
  readonly verification: string;
  readonly records: readonly AgenticLaunchpadEvidenceRecord[];
}

export function agenticLaunchpadEvidenceState(
  records: readonly AgenticLaunchpadEvidenceRecord[],
): AgenticLaunchpadState {
  return applicationOperationalHealthState(records.flatMap(record =>
    record.state
      ? [{
          state: record.state,
          authority: record.authority ?? 'inferred',
        }]
      : [],
  ));
}

/** One reducer drives every Launchpad summary and recommendation. */
export function summarizeAgenticLaunchpadEvidence(
  items: readonly AgenticLaunchpadEvidenceItem[],
) {
  const evaluated = items.map(item => Object.freeze({
    name: item.name,
    verification: item.verification,
    state: agenticLaunchpadEvidenceState(item.records),
  }));
  return Object.freeze({
    items: Object.freeze(evaluated),
    ready: evaluated.filter(item => item.state === 'Ready').length,
    actionRequired: evaluated.filter(item => item.state === 'Action required').length,
    needsVerification: evaluated.filter(
      item => item.state === 'Needs verification',
    ).length,
    next: evaluated.find(item => item.state === 'Action required')
      ?? evaluated.find(item => item.state === 'Needs verification'),
  });
}
