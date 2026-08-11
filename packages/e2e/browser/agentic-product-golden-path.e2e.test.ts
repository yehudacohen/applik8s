// typecast-file-boundary: browser acceptance narrows the framework query
// response only after the live generated application returns JSON.
import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test(
  'renders every first-run route without an unexpected server or hydration failure',
  async ({ browser, baseURL }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    for (const path of [
      '/',
      '/app',
      '/app/setup',
      '/app/inbox',
      '/app/library',
      '/app/account',
      '/app/billing',
      '/app/usage',
      '/app/operations',
      '/sign-in?returnTo=%2Fapp',
      '/sign-up',
      '/recover',
      '/verify',
    ]) {
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
          name: 'Deployment intent, evidence, and the next honest action',
        }),
      ).toBeVisible();
      await expect(page.locator('body')).not.toContainText(
        'Deployment evidence is unavailable',
      );
      await expect(page.locator('body')).not.toContainText('HTTP 403');

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
  'attributes an agent-created note to its human requester and reactively renders it',
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
        name: 'Make useful work appear.',
      }),
    ).toBeVisible();
    await page.evaluate(() => {
      Reflect.set(globalThis, '__agenticProductHydration', 'alive');
    });

    const notes = page.getByRole('region', {
      name: 'Your notes',
      exact: true,
    });
    await expect(notes).not.toContainText('Starter tool-created note.');

    await page.getByLabel('Message').fill(
      'Create a note through your declared typed tool.',
    );
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(notes).toContainText(
      'Starter tool-created note.',
      { timeout: 90_000 },
    );
    await expect(
      page.getByRole('region', { name: 'Notes assistant' }),
    ).toContainText('Credential-free starter inference.');
    await expect.poll(
      () =>
        page.evaluate(() =>
          Reflect.get(globalThis, '__agenticProductHydration'),
        ),
    ).toBe('alive');

    const authoritative = await page.evaluate(async () => {
      const response = await fetch(
        '/__applik8s/v1/queries/Note.listNotes/snapshot',
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input: {} }),
        },
      );
      if (!response.ok) {
        throw new Error(
          `NoteList returned ${response.status}: ${await response.text()}`,
        );
      }
      const payload = await response.json() as {
        readonly value?: readonly {
          readonly id?: string;
          readonly body?: string;
          readonly ownerPrincipalId?: string;
          readonly createdByPrincipalId?: string;
        }[];
      };
      return payload.value?.find(
        (note) => note.body === 'Starter tool-created note.',
      );
    });
    expect(authoritative).toMatchObject({
      id: expect.any(String),
      body: 'Starter tool-created note.',
      ownerPrincipalId: expect.any(String),
      createdByPrincipalId: expect.any(String),
    });
    expect(authoritative?.ownerPrincipalId).not.toBe(
      authoritative?.createdByPrincipalId,
    );
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  },
);

test(
  'uses the provider-neutral Starter billing path without Stripe credentials',
  async ({ page }) => {
    await page.goto('/app/billing');
    await expect(
      page.getByRole('heading', { name: 'Plan, usage, and entitlements' }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Current subscription' }),
    ).toContainText('No active subscription');
    await expect(
      page.getByRole('region', { name: 'Plans' }),
    ).toContainText('Free');
    await expect(
      page.getByRole('region', { name: 'Plans' }),
    ).toContainText('Team');

    await page.getByRole('button', { name: 'Choose Team' }).click();
    await expect(page.getByRole('status')).toContainText(
      'Starter checkout is simulated and non-production.',
    );
    await page.getByRole('button', { name: 'Open billing portal' }).click();
    await expect(page.getByRole('status')).toContainText(
      'Starter billing portal is simulated and non-production.',
    );
    await expect(page.locator('body')).not.toContainText('STRIPE_SECRET_KEY');
  },
);

test(
  'renders maintained provider-neutral account security without generated provider plumbing',
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
      'Multi-factor enrollment is not available in this identity profile.',
    );
    await expect(
      page.getByRole('region', { name: 'Account recovery' }),
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Ory');
    await expect(page.locator('body')).not.toContainText('Kratos');
  },
);

test(
  'delivers and resolves a durable workspace decision across browser reload',
  async ({ page }) => {
    test.setTimeout(180_000);
    const suffix = Date.now().toString(36);
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
    await page.goto('/app/inbox');
    await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Start durable review' }),
    ).toBeEnabled();
    await page.getByLabel('Decision title').fill(title);
    await expect(page.getByLabel('Decision title')).toHaveValue(title);
    await page.getByRole('button', { name: 'Start durable review' }).click();
    const persistedReview = page.getByRole('group', {
      name: `Review ${title}`,
    });
    await expect(
      persistedReview.getByRole('heading', { name: title, exact: true }),
    ).toBeVisible({ timeout: 90_000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    const liveDecision = page.getByRole('group', {
      name: `Decision ${title}`,
    });
    await expect(
      liveDecision.getByRole('heading', { name: title, exact: true }),
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
      name: `Review ${title}`,
    });
    await expect(resolvedReview).toBeVisible({ timeout: 90_000 });
    await expect(resolvedReview.getByText('approved', { exact: true })).toBeVisible();
    await expect(resolvedReview).toContainText(/authorization receipt retained/u);
  },
);

test(
  'delivers an authenticated workspace invitation through the configured notification provider',
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
  'persists the product journey, explains AI trust, and enforces bounded data lifecycle controls',
  async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/app/library');
    await expect(
      page.getByRole('heading', { name: 'Documents' }),
    ).toBeVisible();
    const createdDocument = page.getByText('Starter tool-created note.', {
      exact: true,
    });
    await expect(createdDocument).toBeVisible();
    await createdDocument.click();

    await expect(
      page.getByRole('heading', { name: 'Document', exact: true }),
    ).toBeVisible();
    const content = page.getByLabel('Content');
    await expect(content).toHaveValue('Starter tool-created note.');
    await content.fill('Starter tool-created note, reviewed in the product journey.');
    await page.getByRole('button', { name: 'Save document' }).click();
    await expect(page.getByRole('status')).toContainText('Document committed.');

    await page.goto('/app');
    await expect(page.getByText('Continue working')).toBeVisible();
    const conversationLink = page
      .locator('section[aria-labelledby="recent-conversations-title"] a')
      .first();
    await expect(conversationLink).toBeVisible();
    await conversationLink.click();
    await expect(page.getByText('Trust boundary', { exact: true })).toBeVisible();
    await page.getByText('How this execution works', { exact: true }).click();
    await expect(page.getByText('Logical model', { exact: true })).toBeVisible();
    await expect(page.getByText('Declared tools', { exact: true })).toBeVisible();
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
    await expect(page.getByText(/Lifecycle request .* was admitted/u)).toBeVisible();
    await expect(page.getByText(/Account data · actionRequired/u)).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByText(/transfer or delete owned workspaces/u)).toBeVisible();
    await expect(page.getByText(/immutable artifacts.*retention policies/iu)).toBeVisible();
    await page.goto('/app/library');
    await expect(page.getByText(
      'Starter tool-created note, reviewed in the product journey.',
    )).toBeVisible();
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
