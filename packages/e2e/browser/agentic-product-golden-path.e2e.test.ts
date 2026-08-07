// typecast-file-boundary: browser acceptance narrows the framework query
// response only after the live generated application returns JSON.
import { expect, test } from '@playwright/test';

test(
  'attributes an agent-created note to its human requester and reactively renders it',
  async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await expect(page).toHaveTitle(/Applik8s Agentic Start/u);
    await expect(
      page.getByRole('heading', {
        name: 'A small app with a real control plane.',
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
