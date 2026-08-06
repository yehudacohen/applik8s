// typecast-file-boundary: browser acceptance narrows DOM attributes and
// framework JSON responses only after the live application has rendered them.
import { expect, test } from '@playwright/test';

const expectedPrincipal =
  process.env.APPLIK8S_IDENTITY_START_EXPECTED_PRINCIPAL
  ?? 'identity:deterministic:local-developer';
const sessionCookie = process.env.APPLIK8S_IDENTITY_START_SESSION_COOKIE;

test.beforeEach(async ({ context, baseURL }) => {
  if (!sessionCookie) return;
  if (!baseURL) {
    throw new Error(
      'Identity Start Ory session evidence requires a configured baseURL.',
    );
  }
  const separator = sessionCookie.indexOf('=');
  if (separator <= 0 || separator === sessionCookie.length - 1) {
    throw new Error(
      'APPLIK8S_IDENTITY_START_SESSION_COOKIE must contain name=value.',
    );
  }
  await context.addCookies([
    {
      name: sessionCookie.slice(0, separator),
      value: sessionCookie.slice(separator + 1),
      url: baseURL,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
});

test(
  'admits a typed request, delivers its durable signal, and requeries authoritative state without reload',
  async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await expect(page).toHaveTitle('Applik8s identity acceptance');
    await expect(
      page.getByRole('heading', { name: 'Production access review' }),
    ).toBeVisible();
    await page.evaluate(() => {
      Reflect.set(globalThis, '__identityStartHydration', 'alive');
    });

    const suffix = Date.now().toString(36);
    const target = `production/catalog/${suffix}`;
    const evidence =
      `Incident INC-${suffix} proves the typed request and durable review path.`;
    const intendedOutcome =
      `Approve ${suffix} once and observe authoritative state without reload.`;

    const requestForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Request access' }),
    });
    await requestForm.locator('input').fill(target);
    await requestForm.locator('textarea').nth(0).fill(evidence);
    await requestForm.locator('textarea').nth(1).fill(intendedOutcome);
    await requestForm.getByRole('button', { name: 'Request access' }).click();

    const request = page
      .locator('[data-request-id]')
      .filter({ hasText: target });
    await expect(request).toBeVisible();
    await expect(request.getByText('pending', { exact: true })).toBeVisible();
    const requestId = await request.getAttribute('data-request-id');
    expect(requestId).toBeTruthy();

    const review = page
      .locator('[data-signal-id]')
      .filter({ hasText: evidence });
    await expect(review).toBeVisible();
    const signalId = await review.getAttribute('data-signal-id');
    expect(signalId).toBeTruthy();

    await review.getByRole('button', { name: 'Approve' }).click();
    await expect(review).toBeHidden();
    await expect(
      request.getByText('approved', { exact: true }),
    ).toBeVisible();
    await expect(
      request.getByText(
        `Decided by ${expectedPrincipal}`,
        { exact: true },
      ),
    ).toBeVisible();
    await expect.poll(
      () =>
        page.evaluate(() =>
          Reflect.get(globalThis, '__identityStartHydration'),
        ),
    ).toBe('alive');

    const authoritative = await page.evaluate(async (identity) => {
      const response = await fetch(
        '/__applik8s/v1/queries/AccessRequest.accessRequestQueue/snapshot',
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input: { limit: 100 } }),
        },
      );
      if (!response.ok) {
        throw new Error(
          `AccessRequest.queue returned ${response.status}: ${await response.text()}`,
        );
      }
      const payload = await response.json() as {
        readonly value?: readonly {
          readonly id?: string;
          readonly state?: string;
          readonly approvedBy?: string;
          readonly decisionReceipt?: string;
        }[];
      };
      return payload.value?.find((candidate) => candidate.id === identity);
    }, requestId as string);
    expect(authoritative).toMatchObject({
      id: requestId,
      state: 'approved',
      approvedBy: expectedPrincipal,
      decisionReceipt: expect.any(String),
    });
    expect(authoritative?.decisionReceipt).toBeTruthy();
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  },
);

test(
  'executes the exported agent through its declared typed model operation',
  async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    const before = new Set(await readAccessRequestIds(page));
    const agent = page.getByRole('region', { name: 'Agent access request' });
    await agent.getByRole('textbox', { name: 'Agent request' }).fill(
      'Submit the bounded catalog repair through your declared typed tool.',
    );
    await agent.getByRole('button', { name: 'Ask advisor' }).click();
    await expect(
      agent.getByText(
        'A bounded access request was submitted for durable human review.',
        { exact: true },
      ),
    ).toBeVisible();

    let requestId = '';
    await expect.poll(async () => {
      const current = await readAccessRequests(page);
      requestId = current.find((request) =>
        request.target === 'production/agent-fixture'
        && !before.has(request.id)
      )?.id ?? '';
      return requestId;
    }).not.toBe('');

    const request = page.locator(`[data-request-id="${requestId}"]`);
    await expect(
      request.getByText('production/agent-fixture', { exact: true }),
    ).toBeVisible();
    await expect(request.getByText('pending', { exact: true })).toBeVisible();

    const review = page.locator(
      `[data-review-request-id="${requestId}"]`,
    );
    await expect(review).toBeVisible();
    await review.getByRole('button', { name: 'Approve' }).click();
    await expect(review).toBeHidden();
    await expect(
      request.getByText('approved', { exact: true }),
    ).toBeVisible();
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  },
);

interface AccessRequestSnapshot {
  readonly id: string;
  readonly target?: string;
}

async function readAccessRequestIds(
  page: import('@playwright/test').Page,
): Promise<readonly string[]> {
  return (await readAccessRequests(page)).map((request) => request.id);
}

async function readAccessRequests(
  page: import('@playwright/test').Page,
): Promise<readonly AccessRequestSnapshot[]> {
  return page.evaluate(async () => {
    const response = await fetch(
      '/__applik8s/v1/queries/AccessRequest.accessRequestQueue/snapshot',
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: { limit: 100 } }),
      },
    );
    if (!response.ok) {
      throw new Error(
        `AccessRequest.queue returned ${response.status}: ${await response.text()}`,
      );
    }
    const payload = await response.json() as {
      readonly value?: readonly AccessRequestSnapshot[];
    };
    return payload.value ?? [];
  });
}
