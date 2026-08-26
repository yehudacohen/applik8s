import type {
  ApplicationLakehouseQueryRequest,
  ApplicationLakehouseQueryRuntime,
  ApplicationLakehouseRowExpression,
  QualifiedLakehouseDatasetRef,
} from './application-lakehouse.js';

export interface ApplicationLakehouseConformanceRow {
  readonly id: string;
  readonly group: string;
  readonly quantity: number;
  readonly active: boolean;
  readonly note: string | null;
}

export interface ApplicationLakehouseConformanceCase {
  readonly id: string;
  readonly request: ApplicationLakehouseQueryRequest<ApplicationLakehouseConformanceRow>;
  readonly expectedIds: readonly string[];
}

export interface ApplicationLakehouseConformanceReport {
  readonly apiVersion: 'applik8s.lakehouseConformance/v1';
  readonly provider: string;
  readonly cases: readonly {
    readonly id: string;
    readonly snapshot: string;
    readonly rowIds: readonly string[];
    readonly scannedBytes: number;
  }[];
}

/** Frozen provider-neutral rows shared by every maintained lakehouse runtime. */
export const applicationLakehouseConformanceRows: readonly ApplicationLakehouseConformanceRow[] = Object.freeze([
  Object.freeze({ id: 'a', group: 'alpha', quantity: 2, active: true, note: null }),
  Object.freeze({ id: 'b', group: 'alpha', quantity: 2, active: false, note: 'second' }),
  Object.freeze({ id: 'c', group: 'alpha', quantity: 5, active: true, note: 'third' }),
  Object.freeze({ id: 'd', group: 'beta', quantity: 1, active: true, note: null }),
]);

/**
 * Shared semantic fixtures. Provider suites may add implementation-specific
 * cases, but cannot remove or reinterpret these portable expectations.
 */
export function applicationLakehouseConformanceCases(
  dataset: QualifiedLakehouseDatasetRef,
): readonly ApplicationLakehouseConformanceCase[] {
  return Object.freeze([
    Object.freeze({
      id: 'filtered-numeric-boolean-order',
      request: {
        dataset,
        principalScope: 'conformance-v1',
        where: (row: ApplicationLakehouseRowExpression<ApplicationLakehouseConformanceRow>) => row.group.eq('alpha').and(row.quantity.gte(2)).and(row.active.eq(true)),
        orderBy: (row: ApplicationLakehouseRowExpression<ApplicationLakehouseConformanceRow>) => [row.quantity.desc(), row.id.asc()],
      },
      expectedIds: Object.freeze(['c', 'a']),
    }),
    Object.freeze({
      id: 'nullable-equality',
      request: {
        dataset,
        principalScope: 'conformance-v1',
        where: (row: ApplicationLakehouseRowExpression<ApplicationLakehouseConformanceRow>) => row.note.eq(null),
        orderBy: (row: ApplicationLakehouseRowExpression<ApplicationLakehouseConformanceRow>) => [row.id.asc()],
      },
      expectedIds: Object.freeze(['a', 'd']),
    }),
    Object.freeze({
      id: 'stable-tie-order',
      request: {
        dataset,
        principalScope: 'conformance-v1',
        where: (row: ApplicationLakehouseRowExpression<ApplicationLakehouseConformanceRow>) => row.group.eq('alpha'),
        orderBy: (row: ApplicationLakehouseRowExpression<ApplicationLakehouseConformanceRow>) => [row.quantity.asc(), row.id.asc()],
      },
      expectedIds: Object.freeze(['a', 'b', 'c']),
    }),
  ]);
}

export async function runApplicationLakehouseConformance(
  runtime: ApplicationLakehouseQueryRuntime<ApplicationLakehouseConformanceRow>,
  dataset: QualifiedLakehouseDatasetRef,
): Promise<ApplicationLakehouseConformanceReport> {
  const cases = [];
  let provider: string | undefined;
  for (const fixture of applicationLakehouseConformanceCases(dataset)) {
    const result = await runtime.query(fixture.request);
    const rowIds = result.rows.map(({ id }) => id);
    if (JSON.stringify(rowIds) !== JSON.stringify(fixture.expectedIds)) {
      throw new Error(`Lakehouse conformance ${fixture.id} expected ${JSON.stringify(fixture.expectedIds)}, received ${JSON.stringify(rowIds)}.`);
    }
    provider ??= result.receipt.provider;
    if (provider !== result.receipt.provider) throw new Error('Lakehouse conformance provider identity changed within one run.');
    cases.push(Object.freeze({ id: fixture.id, snapshot: result.snapshot, rowIds: Object.freeze(rowIds), scannedBytes: result.scannedBytes }));
  }
  return Object.freeze({
    apiVersion: 'applik8s.lakehouseConformance/v1',
    provider: provider ?? 'unknown',
    cases: Object.freeze(cases),
  });
}
