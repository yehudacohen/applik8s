// typecast-file-boundary: browser acceptance narrows DOM values and cookie
// state only after the live generated application has rendered them.
import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test(
  'bootstraps a local owner and admits only server-validated workspace selection',
  async ({ page, context, baseURL }) => {
    const suffix = Date.now().toString(36);
    const workspaceName = `Evidence workspace ${suffix}`;
    const workspaceSlug = `evidence-${suffix}`;

    await page.goto('/workspaces');
    await expect(page).toHaveTitle(/Applik8s Agentic Start/);
    await expect(
      page.getByRole('heading', { name: 'Workspaces' }),
    ).toBeVisible();
    const local = page
      .getByRole('region', { name: 'Available workspaces' })
      .locator('article')
      .filter({ hasText: 'Local workspace' });
    await expect(local).toContainText('local · workspace-owner');

    await page.getByLabel('Workspace name').fill(workspaceName);
    await page.getByLabel('Workspace slug').fill(workspaceSlug);
    await page.getByRole('button', { name: 'Create workspace' }).click();

    await expect(
      page.getByRole('heading', { name: workspaceName }),
    ).toBeVisible();
    await expect(page.getByText('workspace-owner', { exact: true }).first())
      .toBeVisible();
    const workspaceId = workspaceIdFromUrl(page.url());
    const selector = (await context.cookies()).find(
      (cookie) => cookie.name === 'applik8s_workspace',
    );
    expect(selector?.value).toBe(workspaceId);
    expect(selector?.httpOnly).toBe(false);
    expect(selector?.sameSite).toBe('Lax');

    await page.reload();
    await expect(
      page.getByRole('heading', { name: workspaceName }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Workspace members' }),
    ).toContainText('workspace-owner');

    const invitationEmail = `reviewer-${suffix}@example.test`;
    await page.getByLabel('Email').fill(invitationEmail);
    await page.getByLabel('Role').selectOption('workspace-administrator');
    await page.getByRole('button', { name: 'Send invitation' }).click();
    const invitations = page.getByRole('region', {
      name: 'Workspace invitations',
    });
    await expect(invitations).toContainText(invitationEmail);
    await expect(invitations).toContainText(
      'workspace-administrator · pending',
    );

    const admittedIdentity =
      `principal:${workspaceId}:invited-reviewer`;
    await page.getByLabel('Identity').fill(admittedIdentity);
    await page.getByRole('button', { name: 'Add member' }).click();
    const member = page
      .getByRole('region', { name: 'Workspace members' })
      .locator('article')
      .filter({ hasText: admittedIdentity });
    await expect(member).toContainText('workspace-member');
    await member
      .getByLabel(`Role for ${admittedIdentity}`)
      .selectOption('workspace-administrator');
    await expect(member).toContainText('workspace-administrator');

    if (!baseURL) throw new Error('Agentic Start acceptance requires baseURL.');
    const forgedWorkspace = '00000000-0000-4000-8000-000000000099';
    await context.addCookies([{
      name: 'applik8s_workspace',
      value: forgedWorkspace,
      url: baseURL,
      sameSite: 'Lax',
    }]);
    const denied = await page.request.get('/workspaces');
    expect(denied.status()).toBeGreaterThanOrEqual(400);
    expect(await denied.text()).not.toContain(workspaceName);

    await context.addCookies([{
      name: 'applik8s_workspace',
      value: workspaceId,
      url: baseURL,
      sameSite: 'Lax',
    }]);
    await page.goto(`/workspaces/${workspaceId}`);
    await expect(
      page.getByRole('heading', { name: workspaceName }),
    ).toBeVisible();
  },
);

test(
  'calls the bounded public assistant through its generated function-native facade',
  async ({ page }) => {
    await page.goto('/assistant');
    await expect(
      page.getByRole('heading', { name: 'Deployment assistant' }),
    ).toBeVisible();
    await expect(page.getByText('Public · capability-free')).toBeVisible();
    await page.getByLabel('Question').fill('How do I deploy this application?');
    await page.getByRole('button', { name: 'Ask' }).click();
    await expect(page.getByRole('status')).toContainText(
      'Use bun run plan first, then bun run deploy.',
    );
    await expect(page.locator('body')).not.toContainText(
      'APPLIK8S_DATABASE',
    );
  },
);

test(
  'renders provider-neutral billing and executes simulated checkout and portal calls',
  async ({ page }) => {
    await page.goto('/billing');
    await expect(
      page.getByRole('heading', { name: 'Plan, usage, and entitlements' }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Current subscription' }),
    ).toContainText('No active subscription');
    await expect(
      page.getByRole('region', { name: 'Plans' }),
    ).toContainText('Research Free');
    await expect(
      page.getByRole('region', { name: 'Plans' }),
    ).toContainText('Research Team');

    await page.getByRole('button', { name: 'Choose Research Team' }).click();
    await expect(page.getByRole('status')).toContainText(
      'Starter checkout is simulated and non-production.',
    );
    await page.getByRole('button', { name: 'Open billing portal' }).click();
    await expect(page.getByRole('status')).toContainText(
      'Starter billing portal is simulated and non-production.',
    );
    await expect(
      page.getByRole('region', { name: 'Usage' }),
    ).toContainText('0 input tokens');
  },
);

test(
  'persists, reloads, renames, and archives a generated research conversation',
  async ({ page }) => {
    const suffix = Date.now().toString(36);
    const prompt = `Summarize durable evidence ${suffix}.`;
    const title = `Durable evidence ${suffix}`;

    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Research inbox' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'New conversation' }).click();
    const conversationId = page.url().split('/').at(-1);
    expect(conversationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    await page.getByLabel('Research prompt').fill(prompt);
    await page.getByRole('button', { name: 'Send' }).click();
    const conversation = page.getByRole('region', {
      name: 'Research conversation',
    });
    await expect(conversation.locator('[data-role="user"]')).toContainText(
      prompt,
    );
    const assistant = conversation.locator('[data-role="assistant"]');
    await expect(assistant).toHaveCount(1);
    await expect(assistant).toContainText(
      'Credential-free starter inference.',
    );
    // Assistant tokens are intentionally visible while the durable stream is
    // still running. Wait for the terminal UI state so this reload verifies
    // committed conversation history rather than cancelling an active run.
    await expect(page.getByLabel('Research prompt')).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);

    await page.reload();
    await expect(conversation.locator('[data-role="user"]')).toContainText(
      prompt,
    );
    await expect(assistant).toHaveCount(1);
    await expect(assistant).toContainText(
      'Credential-free starter inference.',
    );

    await page.getByLabel('Conversation title').fill(title);
    await page.getByRole('button', { name: 'Rename' }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();

    await page.getByRole('link', { name: 'Back to inbox' }).click();
    const card = page.locator('article').filter({ hasText: title });
    await expect(card).toBeVisible();
    await card.getByRole('link', { name: 'Open conversation' }).click();
    await page.getByRole('button', { name: 'Archive' }).click();
    await expect(
      page.getByRole('heading', { name: 'Research inbox' }),
    ).toBeVisible();
    await expect(page.locator('article').filter({ hasText: title })).toHaveCount(
      0,
    );
  },
);

test(
  'runs a workspace-scoped durable review from SSE signal to immutable artifact',
  async ({ page }) => {
    test.setTimeout(180_000);
    const suffix = Date.now().toString(36);
    const title = `Durable review ${suffix}`;

    await page.goto('/workspaces');
    const local = page
      .getByRole('region', { name: 'Available workspaces' })
      .locator('article')
      .filter({ hasText: 'Local workspace' });
    await local.getByRole('link', { name: 'Open workspace' }).click();
    await page.getByRole('link', { name: 'Open durable reviews' }).click();
    await expect(
      page.getByRole('heading', { name: 'Research reviews' }),
    ).toBeVisible();

    await page.getByLabel('Review title').fill(title);
    await page.getByRole('button', { name: 'Start durable review' }).click();
    const state = page
      .getByRole('region', { name: 'Authoritative review state' })
      .locator('article')
      .filter({ hasText: title });
    await expect(state).toContainText('pending');

    const signal = page
      .getByRole('region', { name: 'Pending review signals' })
      .locator('article')
      .filter({ hasText: title });
    await expect(signal).toBeVisible({ timeout: 90_000 });
    await signal.getByRole('button', { name: 'Approve' }).click();
    await expect(signal).toHaveCount(0);
    await expect(state).toContainText('approved', { timeout: 90_000 });
    await expect(state).toContainText('Artifact');
    await expect(state).toContainText('Decided by');

    await page.goto('/operations');
    await expect(
      page.getByRole('heading', { name: /operations/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Artifacts' }),
    ).not.toContainText('No observed records');
    await expect(
      page.getByRole('region', { name: 'Runs' }),
    ).not.toContainText('No observed records');
    await expect(
      page.getByRole('region', { name: 'Memory' }),
    ).not.toContainText('No observed records');
    await expect(
      page.getByRole('region', { name: 'Usage' }),
    ).not.toContainText('No observed records');
    await expect(
      page.getByRole('region', { name: 'Evaluations' }),
    ).not.toContainText('No observed records');
    await expect(
      page.getByRole('region', { name: 'Evaluation results' }),
    ).not.toContainText('No observed records');
  },
);

function workspaceIdFromUrl(value: string): string {
  const candidate = new URL(value).pathname.split('/').at(-1) ?? '';
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(candidate)
  ) {
    throw new Error(`Generated workspace route has invalid identity ${candidate}.`);
  }
  return candidate;
}
