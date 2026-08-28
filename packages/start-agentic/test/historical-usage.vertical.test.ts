// typecast-file-boundary: This product receipt loads freshly generated TypeScript and exercises its public runtime handles.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  executeApplicationLakehousePublication,
  installApplicationLakehousePublicationRuntimeResolver,
  installApplicationLakehouseQueryRuntimeResolver,
} from '@applik8s/applik8s/lakehouse-runtime';
import { installApplicationInvocationAdmissionResolver } from '@applik8s/client';
import type { ApplicationAdmissionInvocationContextV1 } from '@applik8s/core';
import { createDuckDbApplicationLakehouseRuntime } from '@applik8s/runtime-duckdb';
import { type } from 'arktype';
import { afterEach, describe, expect, it } from 'vitest';
import { createApplicationAgenticStart } from '../src/index.js';

const temporaryDirectories: string[] = [];
const disposers: Array<() => void> = [];
const closeables: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (disposers.length > 0) disposers.pop()?.();
  while (closeables.length > 0) await closeables.pop()?.();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('Agentic Start historical usage product receipt', () => {
  it('publishes a generated product event into DuckDB and queries the immutable snapshot through the generated handle', async () => {
    // Keep generated source beneath the workspace so its bare package imports
    // resolve against this clean checkout exactly as a workspace consumer does.
    const parent = await mkdtemp(join(process.cwd(), '.applik8s-tmp-agentic-history-'));
    temporaryDirectories.push(parent);
    const target = join(parent, 'historical-product');
    await createApplicationAgenticStart({
      targetDirectory: target,
      projectName: 'historical-product',
      applik8sVersion: 'workspace:*',
      example: 'product',
      install: false,
      async run() {
        await mkdir(join(target, 'src/routes'), { recursive: true });
        await writeFile(join(target, 'package.json'), `${JSON.stringify({
          name: 'upstream',
          dependencies: {
            '@tanstack/react-router': '1.168.28',
            '@tanstack/react-start': '1.168.28',
          },
        })}\n`);
        await writeFile(
          join(target, 'src/routes/__root.tsx'),
          "import { createRootRoute, Outlet } from '@tanstack/react-router';\nexport const Route = createRootRoute({ component: () => <Outlet /> });\n",
        );
        await writeFile(
          join(target, 'src/routes/index.tsx'),
          'export {};\n',
        );
        await writeFile(
          join(target, 'src/router.tsx'),
          "import { createRouter } from '@tanstack/react-router';\nimport { routeTree } from './routeTree.gen';\nexport function getRouter() { return createRouter({ routeTree }); }\n",
        );
      },
    });

    const root = join(parent, 'duckdb');
    const runtime = await createDuckDbApplicationLakehouseRuntime({
      datasetId: 'historical-usage',
      schemaRevision: 'v1',
      schema: type({
        principalScope: 'string',
        meter: 'string',
        quantity: 'number',
        occurredAt: 'string',
      }),
      cursorKey: 'agentic-start-history-key'.repeat(2),
      root,
      now: () => new Date('2026-08-26T12:00:00.000Z'),
    });
    closeables.push(() => runtime.close());
    disposers.push(installApplicationLakehousePublicationRuntimeResolver(
      (qualification) => qualification === 'historical-usage' ? runtime : undefined,
    ));
    disposers.push(installApplicationLakehouseQueryRuntimeResolver(
      (qualification) => qualification === 'historical-usage' ? runtime : undefined,
    ));

    // static-import-exception: the fixture imports a freshly generated application at its runtime-selected temporary path.
    const generated = await import(
      /* @vite-ignore */ join(target, 'src/features/runtime/model.ts')
    ) as {
      readonly HistoricalUsagePublication: Parameters<typeof executeApplicationLakehousePublication>[0];
      readonly HistoricalUsage: {
        authorize(
          principal: ApplicationAdmissionInvocationContextV1['principal'],
          input: { readonly principalScope: string },
          context: Readonly<Record<string, unknown>>,
        ): Promise<boolean>;
        run(
          context: unknown,
          principal: ApplicationAdmissionInvocationContextV1['principal'],
          input: { readonly principalScope: string },
        ): Promise<{
        readonly snapshot: string;
        readonly schemaRevision: string;
        readonly rows: readonly {
          readonly principalScope: string;
          readonly meter: string;
          readonly quantity: number;
          readonly occurredAt: string;
        }[];
        readonly scannedBytes: number;
        }>;
      };
    };
    const principalScope = 'workspace-history-one';
    const admission = productAdmission(principalScope);
    disposers.push(installApplicationInvocationAdmissionResolver(() => admission));

    const published = await executeApplicationLakehousePublication(
      generated.HistoricalUsagePublication,
      {
        id: 'usage-fact-one',
        recordedAt: '2026-08-26T11:59:00.000Z',
        correlationId: 'assistant-run-one',
        causationId: 'usage-command-one',
        payload: {
          principalScope,
          meter: 'agentic_tokens',
          quantity: 144,
          occurredAt: '2026-08-26T11:58:00.000Z',
        },
      },
    );
    await expect(generated.HistoricalUsage.authorize(
      admission.principal,
      { principalScope },
      admission.trustedContext.values,
    )).resolves.toBe(true);
    const history = await generated.HistoricalUsage.run(
      {},
      admission.principal,
      { principalScope },
    );

    expect(published).toMatchObject({
      rowCount: 1,
      frontier: ['usage-fact-one'],
      causalReceipts: [{
        sourceId: 'usage-fact-one',
        correlationId: 'assistant-run-one',
        causationId: 'usage-command-one',
      }],
    });
    expect(history).toMatchObject({
      snapshot: published.snapshotId,
      schemaRevision: 'v1',
      rows: [{
        principalScope,
        meter: 'agentic_tokens',
        quantity: 144,
        occurredAt: '2026-08-26T11:58:00.000Z',
      }],
      scannedBytes: expect.any(Number),
    });
    expect(history.scannedBytes).toBeGreaterThan(0);
    const workspaceView = await readFile(
      join(target, 'src/features/workspaces/view.tsx'),
      'utf8',
    );
    expect(workspaceView).toContain(
      'HistoricalUsage({ principalScope: workspaceId }).useQuery()',
    );
    expect(workspaceView).toContain('Published lakehouse snapshot');
    expect(workspaceView).toContain('history.data.rows.length');
    await runtime.close();
    closeables.pop();
  }, 120_000);
});

function productAdmission(
  principalScope: string,
): ApplicationAdmissionInvocationContextV1 {
  return Object.freeze({
    apiVersion: 'applik8s.admission/v1',
    principal: Object.freeze({
      id: 'principal:historical-product:human:local-developer',
      identity: Object.freeze({
        id: 'identity:historical-product:human:local-developer',
        kind: 'human',
        issuer: 'applik8s://historical-product/identity/deterministic',
        subject: 'local-developer',
      }),
      kind: 'human',
      authenticationMethod: 'test',
      audience: Object.freeze(['applik8s://historical-product']),
      trustedContextDigest: `sha256:${'1'.repeat(64)}`,
      catalogRevision: 'historical-product-catalog-v1',
      authorityRevision: 'historical-product-authority-v1',
      admittedAt: '2026-08-26T12:00:00.000Z',
    }),
    authorityRevision: 'historical-product-authority-v1',
    trustedContext: Object.freeze({
      values: Object.freeze({ principalScope }),
      digest: `sha256:${'1'.repeat(64)}`,
    }),
    operation: Object.freeze({
      id: 'applik8s://historical-product/queries/historical.usage.v1',
      transport: 'framework',
    }),
    correlationId: 'historical-product-query-one',
  });
}
