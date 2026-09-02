// typecast-file-boundary: browser acceptance narrows the framework query
// response only after the live generated application returns JSON.
import { pathToFileURL } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { defineJourneyAdapter, runJourney, type JourneyBrowserTarget } from '@applik8s/testing';
import { expect, test, type Page } from '@playwright/test';
import { agenticProductEvidenceJourneys } from './agentic-product-evidence-contract.js';

test.describe.configure({ mode: 'serial' });

const qualificationProfile =
  process.env.APPLIK8S_AGENTIC_PRODUCT_PROFILE ?? 'starter';
const starterDocumentPrompt =
  'Create a short launch readiness brief with exactly three checklist items.';
const starterDocumentTitle = 'Short launch readiness brief';

interface BrowserDocument {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly principalScope: string;
  readonly createdByPrincipalId: string;
  readonly sourceConversationId?: string;
  readonly sourceRunId?: string;
}

test('executes the generated source-owned document journey through the browser adapter', async ({ page }) => {
  const sourceRoot = process.env.APPLIK8S_AGENTIC_PRODUCT_SOURCE_ROOT;
  if (!sourceRoot) throw new Error('The generated Agentic Start source root is required for source-owned journey qualification.');
  // The acceptance harness loads a freshly generated application whose source
  // root is unknowable at build time.
  // static-import-exception: the per-run generated module requires runtime loading.
  const module = await import(pathToFileURL(`${sourceRoot}/src/journeys.ts`).href) as {
    readonly applicationJourneys?: readonly import('@applik8s/testing').JourneyDefinition[];
  };
  const definition = module.applicationJourneys?.[0];
  if (!definition) throw new Error('The generated Agentic Start did not export its source-owned application journey.');
  const adapter = defineJourneyAdapter({
    mode: 'browser' as const,
    boundary: 'public-admission' as const,
    supports: (requirement: import('@applik8s/testing').JourneyRequirement) => requirement === 'browser',
    begin: async (_definition, options) => ({
      isolation: {
        id: `agentic-product-browser-lease:${options.runId}`,
        scope: `agentic-product-browser/${options.runId}`,
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        orphanPolicy: 'retain-with-remediation' as const,
      },
      providerReceipts: [], physicalResourceReceipts: [], evidence: [],
    }),
    runAs: async <T>(_identity: import('@applik8s/testing').JourneyIdentityFixture, closure: () => T | Promise<T>) => closure(),
    describeOwnedResource: () => ({ id: 'generated-product', kind: 'deployment', scope: 'agentic-product-browser', summary: 'generated product deployment' }),
    verifyCleanupAuthority: async () => true,
    browser: playwrightJourneyBrowser(page),
  });
  const result = await runJourney(definition, adapter, {
    application: 'agentic-product-evidence',
    mode: 'browser',
    runId: `browser-${Date.now()}`,
    fixtureSeed: `fixture-${Date.now()}`,
    sourceRevision: 'generated-consumer',
    sourceDigest: `sha256:${'9'.repeat(64)}`,
    profile: qualificationProfile,
    timeoutMs: 120_000,
  });
  expect(result.status, JSON.stringify(result, null, 2)).toBe('passed');
  expect(result.assertions.length).toBeGreaterThanOrEqual(2);
});

function playwrightJourneyBrowser(page: Page): import('@applik8s/testing').JourneyBrowserAdapter {
  const locator = (target: JourneyBrowserTarget) => {
    switch (target.by) {
      case 'role': return page.getByRole(target.role as never, target.name ? { name: target.name } : {});
      case 'label': return page.getByLabel(target.value);
      case 'text': return page.getByText(target.value, { exact: false });
      case 'testId': return page.getByTestId(target.value);
      case 'placeholder': return page.getByPlaceholder(target.value);
    }
  };
  return {
    goto: async path => { await page.goto(path, { waitUntil: 'domcontentloaded' }); },
    click: async target => { await locator(target).click(); },
    fill: async (target, value) => { await locator(target).fill(value); },
    visible: async target => locator(target).isVisible(),
    text: async target => locator(target).first().innerText(),
    accessibility: async () => (await new AxeBuilder({ page }).analyze()).violations.map(violation => ({
      rule: violation.id,
      impact: violation.impact === 'minor' || violation.impact === 'moderate' || violation.impact === 'serious' || violation.impact === 'critical'
        ? violation.impact
        : 'moderate',
      target: violation.nodes[0]?.target.join(' ') ?? 'document',
      summary: violation.help,
    })),
  };
}

async function readAuthoritativeDocuments(
  page: import('@playwright/test').Page,
): Promise<readonly BrowserDocument[]> {
  return page.evaluate(async () => {
    const response = await fetch(
      '/__applik8s/v1/queries/Document.listDocuments/snapshot',
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: {} }),
      },
    );
    if (!response.ok) {
      throw new Error(
        `DocumentList returned ${response.status}: ${await response.text()}`,
      );
    }
    const payload = await response.json() as {
      readonly value?: readonly BrowserDocument[];
    };
    return payload.value ?? [];
  });
}

async function ensureStarterToolCreatedDocument(page: import('@playwright/test').Page) {
  await page.goto('/app/documents');
  const createdDocument = page.getByRole('link').filter({
    hasText: starterDocumentTitle,
  });
  if (await createdDocument.isVisible()) return;

  await page.goto('/app');
  await page.getByLabel('Message').fill(starterDocumentPrompt);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(
    page.getByRole('region', {
      name: 'Recent work sessions',
      exact: true,
    }),
  ).toContainText(starterDocumentTitle, { timeout: 90_000 });
}

test(
  agenticProductEvidenceJourneys.routeReliability.test,
  async ({ browser, baseURL }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    const routes = [
      ['/', /Turn a conversation/u],
      ['/app', 'What should we accomplish?'],
      ['/app/documents', 'Documents'],
      ['/app/setup', 'Get this application ready to launch'],
      ['/app/inbox', 'Inbox'],
      ['/app/artifacts', 'Artifacts'],
      ['/app/agents', 'Agents'],
      ['/app/knowledge', 'Knowledge'],
      ['/app/integrations', 'Integrations'],
      ['/app/evaluations', 'Evaluations'],
      ['/app/account', 'Account'],
      ['/app/billing', 'Plan, usage, and access'],
      ['/app/usage', 'Usage'],
      ['/app/operations', 'agentic-product-evidence operations'],
      ['/app/workspaces', 'Workspaces'],
      ['/admin', 'Product control center'],
      ['/admin/tenants', 'Tenants'],
      ['/admin/catalog', 'Catalog'],
    ] as const;
    for (const [path, heading] of routes) {
      const context = await browser.newContext(baseURL ? { baseURL } : {});
      const page = await context.newPage();
      page.on('console', (message) => {
        if (message.type() === 'error') {
          consoleErrors.push(`${path}: ${message.text()}`);
        }
      });
      page.on('pageerror', (error) => pageErrors.push(`${path}: ${error.message}`));
      try {
        const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
        expect(response?.status(), `${path} returned no successful document`).toBeLessThan(500);
        await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({
          timeout: 90_000,
        });
        await expect(page.locator('body')).not.toContainText('Server Error');
        await expect(page.locator('body')).not.toContainText('Internal Server Error');
        await expect(page.locator('body')).not.toContainText('HTTP 403');
        await expect(page.locator('body')).not.toContainText('temporarily unavailable');
        await expect(page.locator('body')).not.toContainText('snapshot failed');
      } finally {
        await context.close();
      }
    }

    for (const path of [
      '/sign-in?returnTo=%2Fapp',
      '/sign-up',
      '/recover',
      '/verify',
    ]) {
      const context = await browser.newContext(baseURL ? { baseURL } : {});
      const page = await context.newPage();
      try {
        const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
        expect(response?.status(), `${path} returned no successful document`).toBeLessThan(500);
        await expect(page.locator('body')).not.toContainText('Server Error');
        await expect(page.locator('body')).not.toContainText('Internal Server Error');
      } finally {
        await context.close();
      }
    }

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  },
);

test(
  'admits the Starter operator to Launchpad and operational evidence',
  async ({ browser, baseURL }) => {
    const context = await browser.newContext(baseURL ? { baseURL } : {});
    const page = await context.newPage();

    try {
      await page.goto('/app/setup');
      await expect(
        page.getByRole('heading', {
          name: 'Get this application ready to launch',
        }),
      ).toBeVisible();
      await expect(page.locator('body')).not.toContainText(
        'Deployment evidence is unavailable',
      );
      await expect(page.locator('body')).not.toContainText('HTTP 403');
      await expect(page.getByRole('heading', { name: 'Application deployment is healthy' })).toBeVisible();
      await expect(page.locator('body')).not.toContainText('Unknown');

      await page.goto('/admin');
      await expect(page.getByRole('heading', { name: 'Product control center' })).toBeVisible();
      await expect(page.locator('body')).not.toContainText('Application-operator access required');
      await page.goto('/admin/catalog');
      await expect(page.getByRole('heading', { name: 'Catalog', exact: true })).toBeVisible();
      await expect(page.locator('body')).toContainText('Team');

      await page.goto('/app/operations');
      await expect(
        page.getByRole('heading', {
          name: 'agentic-product-evidence operations',
        }),
      ).toBeVisible();
      await expect(page.locator('body')).not.toContainText(
        'Operational snapshot failed',
      );
      await expect(page.locator('body')).not.toContainText('HTTP 403');
    } finally {
      await context.close();
    }
  },
);

test(
  agenticProductEvidenceJourneys.causalAgentDocument.test,
  async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/app');
    await expect(page).toHaveTitle(/Applik8s Agentic Start/u);
    await expect(
      page.getByRole('heading', {
        name: 'What should we accomplish?',
      }),
    ).toBeVisible();
    await page.evaluate(() => {
      Reflect.set(globalThis, '__agenticProductHydration', 'alive');
    });

    const documentsRegion = page.getByRole('region', {
      name: 'Recent work sessions',
      exact: true,
    });
    const existingIds = new Set(
      (await readAuthoritativeDocuments(page)).map(document => document.id),
    );

    await page.getByLabel('Message').fill(
      qualificationProfile === 'developer'
        ? 'Use Document.create now to create a document titled "Live provider launch brief" with a substantive Markdown launch checklist. Do not only describe it; call the admitted typed tool.'
        : starterDocumentPrompt,
    );
    await page.getByRole('button', { name: 'Send' }).click();

    let authoritative: BrowserDocument | undefined;
    await expect.poll(async () => {
      authoritative = (await readAuthoritativeDocuments(page)).find(
        document =>
          !existingIds.has(document.id)
          && document.sourceConversationId !== undefined,
      );
      return authoritative?.id;
    }, { timeout: 120_000 }).toBeTruthy();
    if (!authoritative) {
      throw new Error('The admitted assistant tool did not create a document.');
    }
    await expect(documentsRegion).toContainText(authoritative.title);
    if (qualificationProfile === 'starter') {
      await expect(documentsRegion).toContainText(starterDocumentTitle);
      expect(authoritative.body.match(/- \[ \]/gu)).toHaveLength(3);
      await expect(
        page.getByRole('region', { name: 'Workspace assistant' }),
      ).toContainText('authoritative result');
    } else {
      expect(authoritative.title).toContain('Live provider launch brief');
      expect(authoritative.body).toMatch(/launch/iu);
      await expect(
        page.getByRole('region', { name: 'Workspace assistant' }),
      ).not.toContainText(/credential.*rejected|temporarily unavailable/iu);
    }
    await expect.poll(
      () =>
        page.evaluate(() =>
          Reflect.get(globalThis, '__agenticProductHydration'),
        ),
    ).toBe('alive');

    expect(authoritative).toMatchObject({
      id: expect.any(String),
      principalScope: expect.any(String),
      createdByPrincipalId: expect.any(String),
    });
    if (qualificationProfile === 'starter') {
      expect(authoritative.body.length).toBeGreaterThan(900);
      expect(authoritative.body).toContain('## Objective');
      expect(authoritative.body).toContain('## Execution plan');
      expect(authoritative.body).toContain('## Success measures');
      expect(authoritative.body).toContain('## Risks and rollback');
      expect(authoritative.body).toContain('## Next action');
    }
    expect(authoritative?.principalScope).not.toBe(
      authoritative?.createdByPrincipalId,
    );
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  },
);

test(
  agenticProductEvidenceJourneys.durableSpecialist.test,
  async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/app/documents');
    const existingIds = new Set(
      (await readAuthoritativeDocuments(page)).map(document => document.id),
    );
    await page.getByRole('button', { name: 'Research brief' }).click();
    await page.getByLabel('Topic').fill('Durable specialist release evidence');
    await page.getByLabel('Source material').fill([
      'The release candidate passed its generated consumer gates.',
      'Deployment readiness must be established by observed runtime evidence.',
      'Missing price or provider evidence must remain explicitly unknown.',
    ].join('\n'));
    await page.getByRole('button', { name: 'Start durable brief' }).click();

    let authoritative: BrowserDocument | undefined;
    await expect.poll(async () => {
      authoritative = (await readAuthoritativeDocuments(page)).find(
        document => !existingIds.has(document.id) && Boolean(document.sourceRunId),
      );
      return authoritative?.sourceRunId;
    }, { timeout: 120_000 }).toBeTruthy();
    if (!authoritative) {
      throw new Error('The durable specialist did not commit its authoritative Document.');
    }
    expect(authoritative).toMatchObject({
      id: expect.any(String),
      sourceRunId: expect.any(String),
      principalScope: expect.any(String),
      createdByPrincipalId: expect.any(String),
    });
    expect(authoritative.body).toContain('## Evidence');
    await expect(page.getByRole('status')).toContainText(
      'The specialist committed an authoritative Document',
    );
    await expect(
      page.getByRole('link').filter({ hasText: authoritative.title }),
    ).toContainText('Created by a durable specialist');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('link').filter({ hasText: authoritative.title }),
    ).toBeVisible();

    if (qualificationProfile === 'starter') {
      await page.getByRole('button', { name: 'Research brief' }).click();
      await page.getByLabel('Evidence source').selectOption('web-research');
      await page.getByLabel('Topic').fill('Facts not present in local fixtures');
      await page.getByLabel('Optional framing or private context').fill('');
      await page.getByRole('button', { name: 'Start durable brief' }).click();
      await expect(page.getByRole('status')).toContainText(
        'No public sources were returned',
        { timeout: 120_000 },
      );
    }
  },
);

test(
  agenticProductEvidenceJourneys.historicalLakehouse.test,
  async ({ page }) => {
    const lakehouseQualified =
      process.env.APPLIK8S_E2E_LAKEHOUSE_QUALIFIED === '1';
    const suffix = Date.now().toString(36);
    const workspaceName = `Historical usage ${suffix}`;
    await page.goto('/app/workspaces');
    await page.getByLabel('Name').fill(workspaceName);
    await page.getByLabel('Slug').fill(`historical-${suffix}`);
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(
      page.getByRole('heading', { name: workspaceName }),
    ).toBeVisible({ timeout: 90_000 });
    const workspaceUrl = page.url();

    if (!lakehouseQualified) {
      await expect(
        page.getByRole('region', { name: 'Historical workspace usage' }),
      ).toContainText(
        'This installation has no qualified historical-query provider.',
      );
      return;
    }

    await page.goto('/app');
    const existingIds = new Set(
      (await readAuthoritativeDocuments(page)).map(document => document.id),
    );
    await page.getByLabel('Message').fill(starterDocumentPrompt);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect.poll(async () =>
      (await readAuthoritativeDocuments(page)).some(
        document =>
          !existingIds.has(document.id)
          && document.sourceConversationId !== undefined,
      ), { timeout: 120_000 }).toBe(true);
    // Creating the authoritative document can complete during an intermediate
    // tool-call turn. Navigating away at that point aborts the admitted SSE
    // request by design, so wait for the provider's terminal turn before
    // observing the usage event produced by that completed attempt.
    await expect(page.getByLabel('Message')).toBeEnabled({
      timeout: 120_000,
    });
    await expect(
      page.getByRole('button', { name: 'Send', exact: true }),
    ).toBeVisible();

    await page.goto(workspaceUrl);
    const history = page.getByRole('region', {
      name: 'Historical workspace usage',
    });
    await expect(history).toContainText(/\b[1-9][0-9]* recent usage facts\b/u, {
      timeout: 120_000,
    });
    await expect(history).toContainText(/bytes scanned · schema v1/u);
    await expect(history).not.toContainText(
      'No published usage snapshot is visible yet.',
    );
  },
);

test(
  'uses live provider-neutral Developer billing without exposing Stripe credentials',
  async ({ page }) => {
    test.skip(
      qualificationProfile !== 'developer',
      'Live Stripe checkout is qualified only in the explicit Developer lane.',
    );
    await page.goto('/app/billing');
    await expect(
      page.getByRole('heading', { name: 'Plan, usage, and access' }),
    ).toBeVisible();
    const checkoutRequest = page.waitForRequest(
      request => request.url().startsWith('https://checkout.stripe.com/'),
      { timeout: 90_000 },
    );
    await page.route('https://checkout.stripe.com/**', route => route.abort());
    await page.getByRole('button', { name: 'Choose Team' }).click();
    expect((await checkoutRequest).url()).toMatch(
      /^https:\/\/checkout\.stripe\.com\//u,
    );
    await expect(page.locator('body')).not.toContainText('STRIPE_SECRET_KEY');
  },
);

test(
  agenticProductEvidenceJourneys.starterBilling.test,
  async ({ page }) => {
    await page.goto('/app/billing');
    await expect(
      page.getByRole('heading', { name: 'Plan, usage, and access' }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Current plan' }),
    ).toContainText('Free · included');
    await expect(
      page.getByRole('button', { name: 'Open billing portal' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'Plans' }),
    ).toContainText('Free');
    await expect(
      page.getByRole('region', { name: 'Plans' }),
    ).toContainText('Team');

    await page.getByRole('button', { name: 'Choose Team' }).click();
    await expect(page.getByRole('status')).toContainText(
      'Test checkout completed. No payment method was charged.',
    );
    await expect(page.locator('body')).not.toContainText('STRIPE_SECRET_KEY');
  },
);

test(
  'rejects a billing plan that is not published in the application catalog',
  async ({ page }) => {
    await page.goto('/app/billing');
    const attemptedExternalCheckout: string[] = [];
    page.on('request', request => {
      if (request.url().startsWith('https://checkout.stripe.com/')) {
        attemptedExternalCheckout.push(request.url());
      }
    });
    const result = await page.evaluate(async () => {
      const operation = 'applik8s://http/billing/operations/start-checkout';
      const response = await fetch(
        `/__applik8s/v1/runtime/${encodeURIComponent(operation)}`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'idempotency-key': crypto.randomUUID(),
          },
          body: JSON.stringify({
            input: {
              plan: 'attacker-controlled-plan',
              intentId: crypto.randomUUID(),
              returnTo: globalThis.location.href,
            },
          }),
        },
      );
      return {
        status: response.status,
        body: await response.text(),
      };
    });
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.body).not.toContain('STRIPE_SECRET_KEY');
    expect(attemptedExternalCheckout).toEqual([]);
  },
);

test(
  agenticProductEvidenceJourneys.maintainedAccount.test,
  async ({ page }) => {
    await page.goto('/app/account');
    await expect(
      page.getByRole('heading', { name: 'Account', exact: true }),
    ).toBeVisible();
    const multiFactor = page.getByRole('region', {
      name: 'Multi-factor authentication',
    });
    await expect(multiFactor).toBeVisible();
    await expect(multiFactor).toContainText(
      'This identity profile does not offer multi-factor enrollment.',
    );
    await expect(
      page.getByRole('region', { name: 'Account recovery' }),
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Ory');
    await expect(page.locator('body')).not.toContainText('Kratos');

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(
      page.getByRole('heading', { name: 'Enter your workspace' }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Enter your workspace' }),
    ).toBeVisible();
    await page.getByLabel('Email', { exact: true }).fill('human@example.test');
    await page.getByLabel('Password', { exact: true }).fill('starter-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/app$/u, { timeout: 90_000 });
    await expect(
      page.getByRole('heading', { name: 'What should we accomplish?' }),
    ).toBeVisible();
  },
);

async function completeDurableWorkspaceDecision(
  page: import('@playwright/test').Page,
  iteration: number,
): Promise<void> {
    const suffix = `${Date.now().toString(36)}-${iteration}`;
    const workspaceName = `Release workspace ${suffix}`;
    const title = `Review candidate ${suffix}`;
    await page.goto('/app/workspaces');
    await expect(
      page.getByRole('heading', { name: 'Create a workspace' }),
    ).toBeVisible();
    await page.getByLabel('Name').fill(workspaceName);
    await page.getByLabel('Slug').fill(`release-${suffix}`);
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(
      page.getByRole('heading', { name: workspaceName }),
    ).toBeVisible({ timeout: 90_000 });
    await page.goto('/app/documents');
    await page.getByRole('button', { name: 'New document' }).click();
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Content').fill('# Review candidate\n\nA durable document awaiting a real workflow decision.');
    await page.getByRole('button', { name: 'Create document' }).click();
    await expect(page.getByRole('status')).toContainText('Document created.');
    await page.getByRole('link', { name: new RegExp(title, 'u') }).click();
    await page.getByLabel('Add a comment').fill('Confirm the rollback owner before publication.');
    await page.getByRole('button', { name: 'Add comment' }).click();
    const discussion = page.getByRole('list').filter({
      has: page.getByText('Confirm the rollback owner before publication.', { exact: true }),
    });
    await expect(discussion.getByText('Confirm the rollback owner before publication.', { exact: true })).toBeVisible({ timeout: 90_000 });
    await discussion.getByRole('button', { name: 'Resolve' }).click();
    await expect(discussion.getByRole('button', { name: 'Reopen' })).toBeVisible();
    await page.getByRole('button', { name: 'Request review' }).click();
    await expect(page.getByRole('status').filter({
      hasText: 'Review requested.',
    })).toBeVisible();
    await page.getByRole('link', { name: 'Open review Inbox' }).click();
    await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
    const persistedReview = page.getByRole('group', {
      name: `Review record: Review “${title}”`,
    });
    await expect(
      persistedReview.getByRole('heading', { name: `Review “${title}”`, exact: true }),
    ).toBeVisible({ timeout: 90_000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    const liveDecision = page.getByRole('group', {
      name: `Decision Review “${title}”`,
    });
    await expect(
      liveDecision.getByRole('heading', { name: `Review “${title}”`, exact: true }),
    ).toBeVisible({
      timeout: 90_000,
    });
    await liveDecision
      .getByRole('button', { name: 'Approve' })
      .click();
    await expect(liveDecision).not.toBeVisible({
      timeout: 90_000,
    });

    await page.getByRole('tab', { name: 'Resolved' }).click();
    const resolvedReview = page.getByRole('group', {
      name: `Review record: Review “${title}”`,
    });
    await expect(resolvedReview).toBeVisible({ timeout: 90_000 });
    await expect(resolvedReview.getByText('approved', { exact: true })).toBeVisible();
    await expect(resolvedReview).toContainText(/authorization receipt retained/u);

    await resolvedReview.getByRole('link', { name: 'View document' }).click();
    await expect(page.getByLabel('Document state')).toHaveText('approved', {
      timeout: 90_000,
    });
    await page.getByRole('button', { name: 'Publish document' }).click();
    await expect(page.getByRole('status').filter({
      hasText: 'Document published.',
    })).toBeVisible();
    await page.goto('/app/artifacts');
    const artifact = page.getByRole('link').filter({ hasText: title }).first();
    await expect(artifact).toBeVisible({ timeout: 90_000 });
    await artifact.click();
    await expect(
      page.getByRole('heading', { name: title, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /Open source document/u })).toBeVisible();
    await expect(page.locator('code')).toContainText(/^sha256:[a-f0-9]{64}$/u);
}

test(
  agenticProductEvidenceJourneys.durableDecision.test,
  async ({ page }) => {
    test.setTimeout(360_000);
    for (const iteration of [1, 2]) {
      await completeDurableWorkspaceDecision(page, iteration);
    }
  },
);

test(
  agenticProductEvidenceJourneys.agentWorkbench.test,
  async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/app/agents');
    await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('status')).toContainText('Draft saved.');

    await page.goto('/app/evaluations');
    await expect(page.getByRole('heading', { name: 'Evaluations' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Evaluation scorer' }).selectOption(
      'agent-runtime-contract-v1',
    );
    await page.getByRole('button', { name: 'Run runtime gate' }).click();
    await expect(page.getByRole('status')).toContainText(
      'Deterministic runtime gate started for this exact agent revision.',
    );
    await expect(
      page.getByRole('group', { name: 'Latest evaluation' }).getByText('100%', {
        exact: true,
      }),
    ).toBeVisible({
      timeout: 90_000,
    });

    await page.goto('/app/agents');
    await expect(page.getByText(/This exact revision executed through the native agent loop/u)).toBeVisible({
      timeout: 90_000,
    });
    const publish = page.getByRole('button', { name: 'Publish' });
    await expect(publish).toBeEnabled();
    await publish.click();
    await expect(page.getByRole('status')).toContainText(
      'Published. New Workspace assistant runs now resolve this profile.',
    );
  },
);

test(
  agenticProductEvidenceJourneys.boundedKnowledge.test,
  async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/app/knowledge');
    await page.getByRole('button', { name: 'Add source' }).click();
    await expect(page.getByLabel('Title')).toBeVisible();
    await page.getByLabel('Title').fill('Launch principles');
    await page.getByLabel('Content').fill(
      'Every launch brief must name an owner, a measurable outcome, and a rollback condition.',
    );
    await page.getByRole('button', { name: 'Add to agent context' }).click();
    await expect(page.getByText('Launch principles', { exact: true })).toBeVisible({
      timeout: 90_000,
    });
  },
);

test(
  agenticProductEvidenceJourneys.notificationDelivery.test,
  async ({ page }) => {
    test.setTimeout(120_000);
    const suffix = Date.now().toString(36);
    const workspaceName = `Delivery workspace ${suffix}`;
    const email = `invite-${suffix}@example.test`;

    await page.goto('/app/workspaces');
    await page.getByLabel('Name').fill(workspaceName);
    await page.getByLabel('Slug').fill(`delivery-${suffix}`);
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(
      page.getByRole('heading', { name: workspaceName }),
    ).toBeVisible({ timeout: 90_000 });

    await page.getByLabel('Invite by email').fill(email);
    await page.getByRole('button', { name: 'Invite member' }).click();
    const invitation = page.getByRole('group', {
      name: `Invitation ${email}`,
    });
    await expect(invitation).toBeVisible({ timeout: 90_000 });
    await expect(invitation).toContainText('queued', { timeout: 90_000 });
    await expect(invitation).toContainText(/local · [1-9][0-9]* attempt/u, {
      timeout: 90_000,
    });
    await expect(invitation).not.toContainText(/failed|credential|secret/iu);
  },
);

test(
  agenticProductEvidenceJourneys.productLifecycleTrust.test,
  async ({ page }) => {
    test.setTimeout(180_000);
    const lifecycleWorkspace = `Lifecycle workspace ${Date.now().toString(36)}`;
    await page.goto('/app/workspaces');
    await page.getByLabel('Name').fill(lifecycleWorkspace);
    await page.getByLabel('Slug').fill(
      `lifecycle-${Date.now().toString(36)}`,
    );
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(
      page.getByRole('heading', { name: lifecycleWorkspace }),
    ).toBeVisible({ timeout: 90_000 });
    // Create the durable work only after the workspace selector is admitted so
    // the assistant, document query, and lifecycle request all address the
    // same application-owned collaboration boundary. Focused execution must
    // not depend on a workspace left behind by an earlier serial test.
    await ensureStarterToolCreatedDocument(page);
    await page.goto('/app/documents');
    await expect(
      page.getByRole('heading', { name: 'Documents' }),
    ).toBeVisible();
    const createdDocument = page.getByRole('link').filter({
      hasText: starterDocumentTitle,
    });
    await expect(createdDocument).toBeVisible();
    await createdDocument.click();

    await expect(
      page.locator('header').getByRole('heading', {
        name: starterDocumentTitle,
        exact: true,
        level: 1,
      }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Edit document' }).click();
    const content = page.getByLabel('Content');
    await expect(content).toContainText('## Checklist');
    await content.fill('# Release brief\n\nA customer-ready launch plan, reviewed in the product journey.\n\n| State | Owner |\n| --- | --- |\n| Ready | Product team |');
    await page.getByRole('button', { name: 'Save revision' }).click();
    await expect(page.getByRole('status').filter({
      hasText: 'Saved as a new revision.',
    })).toBeVisible();
    await expect(
      page.locator('article').getByRole('heading', {
        name: 'Release brief',
        exact: true,
        level: 2,
      }),
    ).toBeVisible();
    await expect(page.getByRole('table')).toContainText('Product team');

    await page.goto('/app');
    await expect(
      page.getByRole('heading', {
        name: 'Recent work',
        exact: true,
        level: 2,
      }),
    ).toBeVisible();
    const conversationLink = page
      .getByRole('region', { name: 'Recent work sessions' })
      .locator('a[href^="/app/conversations/"]')
      .first();
    await expect(conversationLink).toBeVisible();
    await conversationLink.click();
    await expect(page.getByText('Trust boundary', { exact: true })).toBeVisible();
    await page.getByText('How this execution works', { exact: true }).click();
    await expect(page.getByText('Model', { exact: true })).toBeVisible();
    await expect(page.getByText('Workspace access', { exact: true })).toBeVisible();
    await expect(page.getByText('Audit trail', { exact: true })).toBeVisible();
    await expect(page.getByText('Data boundary', { exact: true })).toBeVisible();
    await expect(page.getByText('Completion', { exact: true })).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Trust boundary', { exact: true })).toBeVisible();

    await page.goto('/app/account');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export visible data' }).click();
    const exported = await download;
    expect(exported.suggestedFilename()).toMatch(/^application-export-\d{4}-\d{2}-\d{2}\.json$/u);

    await page.getByLabel('Type DELETE MY DATA to continue').fill(
      'DELETE MY DATA',
    );
    await page
      .getByRole('button', {
        name: 'Request account-data removal',
      })
      .click();
    await expect(page.getByText(/Request .* was received/u)).toBeVisible();
    await expect(page.getByText(/Account data · actionRequired/u)).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByText(/transfer or delete owned workspaces/u)).toBeVisible();
    await expect(page.getByText(/immutable artifacts.*retention policies/iu)).toBeVisible();
    await page.goto('/app/documents');
    const persistedDocument = page.getByRole('link').filter({
      hasText: starterDocumentTitle,
    }).first();
    await expect(persistedDocument).toBeVisible();
    await expect(
      persistedDocument.getByText('draft', { exact: true }),
    ).toBeVisible();
    await expect(persistedDocument).toContainText(/v2\b/u);
    await page.goto('/app/workspaces');
    const firstWorkspace = page.locator('section[aria-label="Your workspaces"] a').first();
    const workspaceName = (await firstWorkspace.textContent())?.trim();
    if (!workspaceName) throw new Error('Expected one owned workspace for lifecycle qualification.');
    await firstWorkspace.click();
    await page.getByLabel(`Type ${workspaceName} to continue`).fill(workspaceName);
    await page.getByRole('button', { name: 'Request workspace deletion' }).click();
    await expect(page.getByText(/Workspace lifecycle request .* was admitted/u)).toBeVisible(
      { timeout: 90_000 },
    );
  },
);
