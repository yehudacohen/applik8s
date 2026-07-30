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
    return createElement('main', { style: styles.shell }, [
      heading(props.title),
      createElement('p', { key: 'loading', role: 'status' }, 'Loading canonical operational state…'),
    ]);
  }
  if (state.error) {
    return createElement('main', { style: styles.shell }, [
      heading(props.title),
      createElement('p', { key: 'error', role: 'alert', style: styles.error },
        `Operational snapshot failed: ${state.error.message}`),
    ]);
  }
  const snapshot = state.data;
  if (!snapshot) {
    return createElement('main', { style: styles.shell }, [
      heading(props.title),
      createElement('p', { key: 'empty', role: 'status' }, 'No operational snapshot is available.'),
    ]);
  }
  const sections = [
    ['Conversations', snapshot.conversations, 'Canonical product state'],
    ['Runs', snapshot.runs, 'Execution and delivery state'],
    ['Approvals', snapshot.approvals, 'Authority and review state'],
    ['Artifacts', snapshot.artifacts, 'Object and provenance state'],
    ['Evaluations', snapshot.evaluations, 'Quality and result state'],
    ['Usage', snapshot.usage, 'Provider usage and cost facts'],
  ] as const;
  return createElement('main', { style: styles.shell }, [
    heading(props.title),
    createElement(
      'p',
      { key: 'boundary', style: styles.boundary },
      'Canonical application state is shown separately from delivery, authority, object, quality, and provider facts. Missing evidence is never reported as healthy.',
    ),
    createElement(
      'div',
      { key: 'grid', style: styles.grid },
      sections.map(([name, rows, description]) =>
        createElement(OperationsSection, {
          key: name,
          name,
          description,
          rows,
        }),
      ),
    ),
  ]);
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
          props.rows.slice(0, 8).map((row, index) =>
            createElement('li', { key: recordKey(row, index), style: styles.row }, summarize(row)),
          ),
        ),
  ]);
}

function recordKey(value: unknown, index: number): string {
  if (isRecord(value) && typeof value.id === 'string') return value.id;
  return String(index);
}

function summarize(value: unknown): string {
  if (!isRecord(value)) return String(value);
  const identity = firstString(value, ['name', 'id', 'operationId', 'capability']) ?? 'record';
  const state = firstString(value, ['status', 'state', 'phase', 'confidence']);
  return state ? `${identity} — ${state}` : identity;
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
    color: '#13241f',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  },
  header: { marginBottom: 24 },
  eyebrow: {
    margin: 0,
    color: '#25745a',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
  },
  title: { margin: '6px 0 0', fontSize: 38, letterSpacing: '-0.035em' },
  boundary: {
    maxWidth: 800,
    padding: 16,
    border: '1px solid #b7d8cc',
    borderRadius: 12,
    background: '#f1faf6',
    lineHeight: 1.55,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))',
    gap: 16,
    marginTop: 24,
  },
  card: {
    border: '1px solid #dce7e2',
    borderRadius: 16,
    background: '#fff',
    boxShadow: '0 10px 35px rgba(19, 36, 31, 0.06)',
    overflow: 'hidden',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    padding: 18,
    borderBottom: '1px solid #edf2ef',
  },
  sectionTitle: { margin: 0, fontSize: 18 },
  description: { margin: '5px 0 0', color: '#60706a', fontSize: 13 },
  count: {
    alignSelf: 'start',
    minWidth: 30,
    padding: '5px 8px',
    borderRadius: 999,
    background: '#163b31',
    color: '#fff',
    textAlign: 'center',
  },
  list: { margin: 0, padding: 0, listStyle: 'none' },
  row: { padding: '11px 18px', borderTop: '1px solid #f1f4f2', fontSize: 14 },
  empty: { margin: 0, padding: 18, color: '#73817c', fontStyle: 'italic' },
  error: {
    padding: 16,
    borderRadius: 12,
    background: '#fff0ef',
    color: '#8b2420',
  },
} satisfies Readonly<Record<string, CSSProperties>>;
