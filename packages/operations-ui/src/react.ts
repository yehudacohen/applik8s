// typecast-file-boundary: React operation hooks restore generic result types after the shared client validates transport responses.
import type { ApplicationQueryOperation } from '@applik8s/client';
import { Applik8sProvider } from '@applik8s/react';
import {
  type CSSProperties,
  createElement,
  type ReactNode,
} from 'react';
import type { ApplicationOperationsSnapshot } from './index.js';

export interface ApplicationOperationsControlCenterProps {
  readonly snapshot: ApplicationQueryOperation<
    { readonly limit?: number },
    ApplicationOperationsSnapshot
  >;
  readonly title?: string;
  readonly baseUrl?: string;
  readonly limit?: number;
}

/**
 * Router-neutral maintained operations surface. TanStack Start contributes a
 * thin route around this component; other React/Vite applications can mount it
 * unchanged.
 */
export function ApplicationOperationsControlCenter(
  props: ApplicationOperationsControlCenterProps,
): ReactNode {
  return createElement(
    Applik8sProvider,
    { ...(props.baseUrl ? { baseUrl: props.baseUrl } : {}) },
    createElement(ApplicationOperationsDashboard, props),
  );
}

function ApplicationOperationsDashboard(
  props: ApplicationOperationsControlCenterProps,
): ReactNode {
  const state = props.snapshot({ limit: props.limit ?? 25 }).useQuery();
  if (state.phase === 'idle' || state.phase === 'loading') {
    return createElement('section', operationSurfaceProps(props.title), [
      heading(props.title),
      createElement('p', { key: 'loading', role: 'status' }, 'Loading canonical operational state…'),
    ]);
  }
  if (state.error) {
    return createElement('section', operationSurfaceProps(props.title), [
      heading(props.title),
      createElement('p', { key: 'error', role: 'alert', style: styles.error },
        `Operational snapshot failed: ${state.error.message}`),
    ]);
  }
  const snapshot = state.data;
  if (!snapshot) {
    return createElement('section', operationSurfaceProps(props.title), [
      heading(props.title),
      createElement('p', { key: 'empty', role: 'status' }, 'No operational snapshot is available.'),
    ]);
  }
  const activitySections = [
    ['Conversations', snapshot.conversations, 'Canonical product state'],
    ['Runs', snapshot.runs, 'Execution and delivery state'],
    ['Approvals', snapshot.approvals, 'Authority and review state'],
    ['Artifacts', snapshot.artifacts, 'Object and provenance state'],
    ['Evaluations', snapshot.evaluations, 'Quality and result state'],
    ['Usage', snapshot.usage, 'Provider usage and cost facts'],
    ['Entitlements', snapshot.entitlements, 'Canonical quota and entitlement state'],
  ] as const;
  const runtimeSections = [
    ['Installations', snapshot.installations, 'Graph and installation convergence state'],
    ['Providers', snapshot.providers, 'Provider-reported readiness and failure state'],
    ['Workflows', snapshot.workflows, 'Queue, wait, retry, cancellation, and terminal state'],
    ['Event consumers', snapshot.eventConsumers, 'Delivery, lag, checkpoint, and dead-letter state'],
    ['Projections and search', snapshot.projections, 'Generation, lag, rebuild, validation, and cutover state'],
    ['AI runtimes', snapshot.ai, 'Resolution, latency, usage, fallback, and redaction-safe state'],
    ['MCP', snapshot.mcp, 'Server, client, tool, denial, and latency state'],
    ['Authority', snapshot.authority, 'Redacted authority lifecycle observations'],
    ['Identity', snapshot.identity, 'Provider-neutral identity and OAuth readiness'],
    ['Object stores', snapshot.objectStores, 'Object authority and provider readiness'],
    ['Databases', snapshot.databases, 'Canonical database readiness and recovery state'],
    ['Gateways', snapshot.gateways, 'Admission and exposure readiness'],
  ] as const;
  const governanceSections = [
    ['Go-live obligations', snapshot.goLive, 'Graph-derived production duties; intent remains Unknown until independent evidence arrives'],
    ['Audit', snapshot.audit, 'Searchable redacted causal authority timeline'],
  ] as const;
  const detailSections = [
    ['Messages', snapshot.messages, 'Canonical conversation content state'],
    ['Run events', snapshot.runEvents, 'Resumable causal delivery state'],
    ['Memory', snapshot.memory, 'Scoped retained memory state'],
    ['Outcomes', snapshot.outcomes, 'Independent outcome verification state'],
    ['Evaluation datasets', snapshot.evaluationDatasets, 'Versioned quality inputs'],
    ['Evaluation cases', snapshot.evaluationCases, 'Bounded quality cases'],
    ['Evaluation scorers', snapshot.evaluationScorers, 'Versioned scoring authority'],
    ['Evaluation results', snapshot.evaluationResults, 'Scored evidence state'],
  ] as const;
  const declared = runtimeSections.flatMap(([, rows]) => rows.filter(isInferred));
  const observedRuntimeSections = runtimeSections.map(([name, rows, description]) =>
    [name, rows.filter((row) => !isInferred(row)), description] as const);
  const visibleActivity = [...activitySections, ...detailSections].filter(([, rows]) => rows.length > 0);
  const visibleRuntime = observedRuntimeSections.filter(([, rows]) => rows.length > 0);
  const visibleGovernance = governanceSections.filter(([, rows]) => rows.length > 0);
  const attention = [...activitySections, ...observedRuntimeSections]
    .flatMap(([section, rows]) =>
      rows
        .filter(needsAttention)
        .map((row) => ({ section, row })),
    )
    .sort((left, right) =>
      attentionPriority(left.row) - attentionPriority(right.row),
    );
  return createElement('section', operationSurfaceProps(props.title), [
    heading(props.title),
    createElement(
      'p',
      { key: 'boundary', style: styles.boundary },
      'Observed runtime health, canonical product activity, and declared topology are separate. A declared component is never presented as healthy—or as an incident—until evidence exists.',
    ),
    createElement('div', { key: 'summary', style: styles.summaryGrid }, [
      summaryMetric('Product records', visibleActivity.reduce((total, [, rows]) => total + rows.length, 0)),
      summaryMetric('Runtime observations', visibleRuntime.reduce((total, [, rows]) => total + rows.length, 0)),
      summaryMetric('Declared components', declared.length),
      summaryMetric('Needs attention', attention.length),
    ]),
    createElement('section', {
      key: 'attention',
      style: styles.attention,
      'aria-label': 'Needs attention',
    }, [
      createElement('div', { key: 'attention-heading' }, [
        createElement('p', { key: 'attention-eyebrow', style: styles.attentionEyebrow }, 'Act first'),
        createElement('h2', { key: 'attention-title', style: styles.attentionTitle }, 'Needs attention'),
      ]),
      attention.length === 0
        ? createElement(
            'p',
            { key: 'attention-empty', style: styles.empty },
            'No observed failures, blocked work, degraded providers, or unresolved runtime waits.',
          )
        : createElement(
            'ol',
            { key: 'attention-rows', style: styles.attentionList },
            attention.slice(0, 12).map(({ section, row }, index) =>
              createElement(
                'li',
                { key: `${section}:${recordKey(row, index)}`, style: styles.attentionRow },
                [
                  createElement('strong', { key: 'section' }, section),
                  createElement(OperationsRecord, { key: 'record', value: row }),
                ],
              ),
            ),
          ),
    ]),
    operationsGroup('Product activity', 'What people and managed executions have actually done.', visibleActivity),
    operationsGroup('Runtime health', 'Current provider and delivery evidence. Absent observations stay absent rather than becoming synthetic incidents.', visibleRuntime),
    operationsGroup('Deployment contract', 'Declared graph components and go-live duties are intent, not runtime health.', [
      ['Declared topology', declared, 'Components inferred from the compiled application graph'],
      ...visibleGovernance,
    ]),
  ]);
}

function summaryMetric(label: string, value: number): ReactNode {
  return createElement('div', { key: label, style: styles.metric }, [
    createElement('strong', { key: 'value', style: styles.metricValue }, String(value)),
    createElement('span', { key: 'label', style: styles.metricLabel }, label),
  ]);
}

function operationsGroup(
  title: string,
  description: string,
  sections: readonly (readonly [string, readonly unknown[], string])[],
): ReactNode {
  return createElement('section', { key: title, style: styles.group, 'aria-label': title }, [
    createElement('div', { key: 'heading', style: styles.groupHeading }, [
      createElement('h2', { key: 'title', style: styles.groupTitle }, title),
      createElement('p', { key: 'description', style: styles.description }, description),
    ]),
    sections.length === 0
      ? createElement('p', { key: 'empty', style: styles.empty }, 'No records in this area yet.')
      : createElement('div', { key: 'grid', style: styles.grid }, sections.map(([name, rows, sectionDescription]) =>
          createElement(OperationsSection, {
            key: name,
            name,
            description: sectionDescription,
            rows,
          }),
        )),
  ]);
}

function operationSurfaceProps(title?: string): {
  readonly style: CSSProperties;
  readonly 'aria-label': string;
} {
  return {
    style: styles.shell,
    'aria-label': title ?? 'Application operations',
  };
}

function heading(title?: string): ReactNode {
  return createElement('header', { key: 'heading', style: styles.header }, [
    createElement('p', { key: 'eyebrow', style: styles.eyebrow }, 'Applik8s control center'),
    createElement('h1', { key: 'title', style: styles.title }, title ?? 'Application operations'),
  ]);
}

function OperationsSection(props: {
  readonly name: string;
  readonly description: string;
  readonly rows: readonly unknown[];
}): ReactNode {
  return createElement('section', { style: styles.card, 'aria-label': props.name }, [
    createElement('div', { key: 'summary', style: styles.cardHeader }, [
      createElement('div', { key: 'labels' }, [
        createElement('h2', { key: 'name', style: styles.sectionTitle }, props.name),
        createElement('p', { key: 'description', style: styles.description }, props.description),
      ]),
      createElement('strong', { key: 'count', style: styles.count }, String(props.rows.length)),
    ]),
    props.rows.length === 0
      ? createElement('p', { key: 'none', style: styles.empty }, 'No observed records')
      : createElement(
          'ol',
          { key: 'rows', style: styles.list },
          [...props.rows]
            .sort((left, right) =>
              attentionPriority(left) - attentionPriority(right),
            )
            .slice(0, 8)
            .map((row, index) =>
            createElement(
              'li',
              { key: recordKey(row, index), style: styles.row },
              createElement(OperationsRecord, { value: row }),
            ),
          ),
        ),
  ]);
}

function OperationsRecord(props: { readonly value: unknown }): ReactNode {
  if (!isRecord(props.value)) return String(props.value);
  const id = firstString(props.value, ['id']);
  const identity =
    firstString(props.value, ['name', 'label', 'operationId', 'capability'])
      ?? id
      ?? 'record';
  const state = firstString(props.value, [
    'status',
    'state',
    'phase',
    'confidence',
  ]);
  const category = firstString(props.value, ['category']);
  return createElement('div', { style: styles.record }, [
    createElement('span', { key: 'summary' }, [
      createElement('span', { key: 'identity' }, identity),
      ...(state
        ? [
            createElement(
              'strong',
              {
                key: 'state',
                style: needsAttention(props.value)
                  ? styles.stateAttention
                  : styles.state,
              },
              state,
            ),
          ]
        : []),
    ]),
    category || id
      ? createElement(
          'code',
          { key: 'identity', style: styles.identifier },
          [category, id].filter(Boolean).join(' · '),
        )
      : null,
  ]);
}

function recordKey(value: unknown, index: number): string {
  if (isRecord(value) && typeof value.id === 'string') return value.id;
  return String(index);
}

function needsAttention(value: unknown): boolean {
  if (isInferred(value)) return false;
  return attentionPriority(value) < 2;
}

function isInferred(value: unknown): boolean {
  return isRecord(value) && value.authority === 'inferred';
}

function attentionPriority(value: unknown): number {
  if (!isRecord(value)) return 2;
  const state = firstString(value, [
    'status',
    'state',
    'phase',
    'confidence',
  ])?.toLowerCase();
  if (!state) return 2;
  if (
    /failed|failure|error|unhealthy|degraded|blocked|denied|stalled|dead.?letter/.test(
      state,
    )
  ) {
    return 0;
  }
  if (
    /waiting|pending|retry|installing|unknown|missing|reconcil|terminating/.test(
      state,
    )
  ) {
    return 1;
  }
  return 2;
}

function firstString(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const styles = {
  shell: {
    maxWidth: 1180,
    margin: '0 auto',
    padding: '48px 24px 80px',
    color: 'var(--applik8s-operations-text, var(--text, #13241f))',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  },
  header: { marginBottom: 24 },
  eyebrow: {
    margin: 0,
    color: 'var(--applik8s-operations-accent, var(--accent, #25745a))',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
  },
  title: { margin: '6px 0 0', fontSize: 38, letterSpacing: '-0.035em' },
  boundary: {
    maxWidth: 800,
    padding: 16,
    border: '1px solid var(--applik8s-operations-border, var(--border, #b7d8cc))',
    borderRadius: 12,
    background: 'var(--applik8s-operations-muted-surface, var(--surface-muted, #f1faf6))',
    color: 'var(--applik8s-operations-text, var(--text, #13241f))',
    lineHeight: 1.55,
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 12,
    marginTop: 20,
  },
  metric: {
    display: 'grid',
    gap: 3,
    padding: 16,
    border: '1px solid var(--applik8s-operations-border, var(--border, #dce7e2))',
    borderRadius: 14,
    background: 'var(--applik8s-operations-surface, var(--surface, #fff))',
  },
  metricValue: { fontSize: 24, letterSpacing: '-0.03em' },
  metricLabel: {
    color: 'var(--applik8s-operations-muted-text, var(--text-muted, #60706a))',
    fontSize: 12,
  },
  attention: {
    marginTop: 20,
    padding: 18,
    border: '1px solid var(--applik8s-operations-danger-border, #efc5b8)',
    borderRadius: 16,
    background: 'var(--applik8s-operations-danger-surface, var(--surface, #fff8f5))',
  },
  attentionEyebrow: {
    margin: 0,
    color: 'var(--applik8s-operations-danger, #9a3f28)',
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
  },
  attentionTitle: { margin: '4px 0 0', fontSize: 22 },
  attentionList: {
    display: 'grid',
    gap: 8,
    margin: '16px 0 0',
    padding: 0,
    listStyle: 'none',
  },
  attentionRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(120px, 0.35fr) minmax(0, 1fr)',
    alignItems: 'start',
    gap: 12,
    padding: 10,
    borderRadius: 10,
    background: 'var(--applik8s-operations-surface, var(--surface, #fff))',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))',
    gap: 16,
    marginTop: 16,
  },
  group: { marginTop: 30 },
  groupHeading: { maxWidth: 720 },
  groupTitle: { margin: 0, fontSize: 24, letterSpacing: '-0.02em' },
  card: {
    border: '1px solid var(--applik8s-operations-border, var(--border, #dce7e2))',
    borderRadius: 16,
    background: 'var(--applik8s-operations-surface, var(--surface, #fff))',
    boxShadow: 'var(--applik8s-operations-shadow, 0 10px 35px rgba(19, 36, 31, 0.06))',
    overflow: 'hidden',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    padding: 18,
    borderBottom: '1px solid var(--applik8s-operations-border, var(--border, #edf2ef))',
  },
  sectionTitle: { margin: 0, fontSize: 18 },
  description: {
    margin: '5px 0 0',
    color: 'var(--applik8s-operations-muted-text, var(--text-muted, #60706a))',
    fontSize: 13,
  },
  count: {
    alignSelf: 'start',
    minWidth: 30,
    padding: '5px 8px',
    borderRadius: 999,
    background: 'var(--applik8s-operations-accent, var(--accent, #163b31))',
    color: 'var(--applik8s-operations-accent-contrast, var(--surface, #fff))',
    textAlign: 'center',
  },
  list: { margin: 0, padding: 0, listStyle: 'none' },
  row: {
    padding: '11px 18px',
    borderTop: '1px solid var(--applik8s-operations-border, var(--border, #f1f4f2))',
    fontSize: 14,
  },
  record: { display: 'grid', gap: 3 },
  state: {
    marginLeft: 8,
    padding: '2px 7px',
    borderRadius: 999,
    background: 'var(--applik8s-operations-muted-surface, var(--surface-muted, #edf2ef))',
    color: 'var(--applik8s-operations-muted-text, var(--text-muted, #45544f))',
    fontSize: 11,
  },
  stateAttention: {
    marginLeft: 8,
    padding: '2px 7px',
    borderRadius: 999,
    background: 'var(--applik8s-operations-danger-surface, #ffe2d8)',
    color: 'var(--applik8s-operations-danger, #8b2f18)',
    fontSize: 11,
  },
  identifier: {
    color: 'var(--applik8s-operations-muted-text, var(--text-muted, #6a7772))',
    fontSize: 11,
    overflowWrap: 'anywhere',
  },
  empty: {
    margin: 0,
    padding: 18,
    color: 'var(--applik8s-operations-muted-text, var(--text-muted, #73817c))',
    fontStyle: 'italic',
  },
  error: {
    padding: 16,
    borderRadius: 12,
    background: 'var(--applik8s-operations-danger-surface, #fff0ef)',
    color: 'var(--applik8s-operations-danger, #8b2420)',
  },
} satisfies Readonly<Record<string, CSSProperties>>;
