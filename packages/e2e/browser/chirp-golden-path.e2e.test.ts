// typecast-file-boundary: browser fixtures use literal route tuples and a controlled global marker solely to prove hydration continuity.
import { expect, test, type Page } from '@playwright/test';

test('registers a new admitted principal without accepting a browser-owned account id', async ({ page }) => {
  const principal = `browser-account-${Date.now()}`;
  const handle = `user_${Date.now().toString(36)}`;
  await page.setExtraHTTPHeaders({ 'x-chirp-user': principal });
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Complete registration' })).toBeVisible();
  await page.getByLabel('Handle').fill(handle);
  await page.getByLabel('Display name').fill('Browser registration account');
  await page.getByLabel('Bio').fill('Identity is derived from the admitted request, not the form body.');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Browser registration account' })).toHaveAttribute('href', `/profile/${handle}`);

  const account = await page.evaluate(async () => {
    const response = await fetch('/__applik8s/v1/queries/Account.me/snapshot', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: {} }),
    });
    if (!response.ok) throw new Error(`Account.me returned ${response.status}: ${await response.text()}`);
    return (await response.json() as { readonly value: unknown }).value;
  });
  expect(account).toMatchObject({ registered: true, id: principal, handle, state: 'active' });
});

test('publishes, renders through live requery, and bookmarks a post without a page reload', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page).toHaveTitle('Chirp · built with Applik8s');
  await expect(page.getByText('Why this feed matters')).toBeVisible();
  await page.evaluate(() => Reflect.set(globalThis, '__chirpBrowserJourney', 'alive'));

  const body = `Playwright live convergence ${new Date().toISOString()}`;
  await page.getByRole('textbox', { name: 'Post text' }).fill(body);
  await page.getByRole('button', { name: 'Post', exact: true }).click();

  const post = page.locator('article').filter({ hasText: body });
  await expect(post).toBeVisible();
  await expect.poll(() => page.evaluate(() => Reflect.get(globalThis, '__chirpBrowserJourney'))).toBe('alive');

  const like = post.getByRole('button', { name: /Like · 0/ });
  await like.click();
  await expect(post.getByRole('button', { name: /Like · 1/ })).toHaveAttribute('aria-pressed', 'true');
  await post.getByRole('button', { name: /Like · 1/ }).click();
  await expect(post.getByRole('button', { name: /Like · 0/ })).toHaveAttribute('aria-pressed', 'false');

  const repost = post.getByRole('button', { name: /Repost · 0/ });
  await repost.click();
  await expect(post.getByRole('button', { name: /Repost · 1/ })).toHaveAttribute('aria-pressed', 'true');

  await post.getByRole('button', { name: '↩ Reply' }).click();
  const replyBody = `Reply through the same typed model ${new Date().toISOString()}`;
  await expect(page.getByText(/Replying to @demo-user/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Post text' }).fill(replyBody);
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  const reply = page.locator('article').filter({ hasText: replyBody });
  await expect(reply).toBeVisible();
  await expect(reply.getByText('Replying in a conversation')).toBeVisible();

  await post.getByRole('button', { name: '❝ Quote' }).click();
  const quoteBody = `Quote through the same typed Post.create ${new Date().toISOString()}`;
  await expect(page.getByText(/Quoting @demo-user/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Post text' }).fill(quoteBody);
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  const quote = page.locator('article').filter({ hasText: quoteBody });
  await expect(quote).toBeVisible();
  await expect(quote.getByText(/Quoting post/)).toBeVisible();

  const save = post.getByRole('button', { name: '⌑ Save' });
  await save.click();
  await expect(post.getByRole('button', { name: '▣ Saved' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('link', { name: 'Bookmarks' }).click();
  await expect(page).toHaveURL(/\/bookmarks$/);
  const saved = page.locator('article').filter({ hasText: body });
  await expect(saved).toBeVisible();

  await saved.getByRole('button', { name: 'Remove' }).click();
  await expect(saved).toBeHidden();
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('finds a newly published post through the bounded typed search view', async ({ page }) => {
  const token = `search-${Date.now().toString(36)}`;
  const body = `A uniquely searchable distributed conversation ${token}`;

  await page.goto('/');
  await page.getByRole('textbox', { name: 'Post text' }).fill(body);
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.locator('article').filter({ hasText: body })).toBeVisible();

  await page.getByRole('link', { name: 'Explore' }).click();
  await expect(page).toHaveURL(/\/explore$/);
  await page.getByRole('textbox', { name: 'Search public posts' }).fill(token);
  await expect(page.locator('article').filter({ hasText: body })).toBeVisible();
});

test('ranks a reacted post through the analytical projection instead of recency fallback', async ({ page }) => {
  const suffix = Date.now().toString(36);
  const rankedBody = `Analytical ranking target ${suffix}`;
  const newerBody = `Newer unranked control ${suffix}`;

  await page.goto('/');
  await page.getByRole('textbox', { name: 'Post text' }).fill(rankedBody);
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  const rankedPost = page.locator('article').filter({ hasText: rankedBody });
  await expect(rankedPost).toBeVisible();
  const rankedPostId = await rankedPost.getAttribute('data-post-id');
  expect(rankedPostId).toBeTruthy();

  await page.getByRole('textbox', { name: 'Post text' }).fill(newerBody);
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  const newerPost = page.locator('article').filter({ hasText: newerBody });
  await expect(newerPost).toBeVisible();
  const newerPostId = await newerPost.getAttribute('data-post-id');
  expect(newerPostId).toBeTruthy();

  await rankedPost.getByRole('button', { name: /Like · 0/ }).click();
  await expect(rankedPost.getByRole('button', { name: /Like · 1/ })).toHaveAttribute('aria-pressed', 'true');

  await expect.poll(async () => page.evaluate(async ({ ranked, unranked }) => {
    const response = await fetch('/__applik8s/v1/queries/Post.trending/snapshot', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { limit: 50 } }),
    });
    if (!response.ok) return false;
    const payload = await response.json() as { readonly value?: readonly { readonly id?: string }[] };
    const ids = payload.value?.map(({ id }) => id) ?? [];
    return ids.includes(ranked) && !ids.includes(unranked);
  }, { ranked: rankedPostId as string, unranked: newerPostId as string }), {
    timeout: 60_000,
  }).toBe(true);

  await page.getByRole('link', { name: 'Explore' }).click();
  await expect(page.locator('article').filter({ hasText: rankedBody })).toBeVisible();
  await expect(page.locator('article').filter({ hasText: newerBody })).toHaveCount(0);
});

test('uploads provider-verified media without exposing object-store credentials', async ({ page }) => {
  await page.goto('/');
  const body = `Media journey ${new Date().toISOString()}`;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await page.getByRole('textbox', { name: 'Post text' }).fill(body);
  await page.getByLabel('Post attachment').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: png });
  await page.getByLabel('Attachment alternative text').fill('One transparent test pixel');
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  const post = page.locator('article').filter({ hasText: body });
  await expect(post).toBeVisible();
  const postId = await post.getAttribute('data-post-id');
  expect(postId).toBeTruthy();

  await expect.poll(async () => page.evaluate(async (id) => {
    const response = await fetch('/__applik8s/v1/queries/Media.forPosts/snapshot', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { postIds: [id] } }),
    });
    if (!response.ok) return undefined;
    const value = (await response.json() as { readonly value?: readonly unknown[] }).value?.[0];
    return value && typeof value === 'object' ? value : undefined;
  }, postId), { timeout: 60_000 }).toMatchObject({
    contentType: 'image/png', byteLength: String(png.byteLength), processingState: 'ready',
		processingReason: 'verified-size-type-checksum-signature', altText: 'One transparent test pixel',
  });
	await expect(post.getByText('One transparent test pixel · verified')).toBeVisible();
	await post.getByRole('button', { name: 'Prepare secure download' }).click();
	await expect(post.getByRole('link', { name: 'Open attachment' })).toBeVisible();

  const downloaded = await page.evaluate(async ({ expectedBytes, post }) => {
    const mediaResponse = await fetch('/__applik8s/v1/queries/Media.forPosts/snapshot', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { postIds: [post] } }),
    });
    const media = (await mediaResponse.json() as { readonly value: readonly { readonly objectKey: string }[] }).value[0];
    if (!media) throw new Error('Media query returned no attachment.');
    const intentResponse = await fetch('/__applik8s/v1/runtime/objectStore.attachments.createDownload', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { key: media.objectKey } }),
    });
    const intent = (await intentResponse.json() as { readonly result: { readonly url: string } }).result;
    const response = await fetch(intent.url, { credentials: 'same-origin' });
    return { status: response.status, bytes: [...new Uint8Array(await response.arrayBuffer())], expectedBytes };
  }, { post: postId, expectedBytes: [...png] });
  expect(downloaded).toEqual({ status: 200, bytes: [...png], expectedBytes: [...png] });
});

test('rejects media whose bytes do not match its declared content type', async ({ page }) => {
	await page.goto('/');
	const body = `Rejected media journey ${new Date().toISOString()}`;
	const invalidPng = Buffer.from('this is not a png');
	await page.getByRole('textbox', { name: 'Post text' }).fill(body);
	await page.getByLabel('Post attachment').setInputFiles({ name: 'invalid.png', mimeType: 'image/png', buffer: invalidPng });
	await page.getByLabel('Attachment alternative text').fill('Invalid media fixture');
	await page.getByRole('button', { name: 'Post', exact: true }).click();
	const post = page.locator('article').filter({ hasText: body });
	await expect(post).toBeVisible();
	await expect(post.getByText('Attachment rejected: content-signature-mismatch')).toBeVisible({ timeout: 60_000 });
	await expect(post.getByRole('button', { name: 'Prepare secure download' })).toHaveCount(0);
});

test('hydrates and navigates the principal flagship routes accessibly', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  for (const route of [
    { name: 'Explore', path: '/explore', heading: 'Find people and conversations' },
    { name: 'Notifications', path: '/notifications', heading: 'What changed' },
    { name: 'Automation', path: '/automation', heading: 'Automated accounts' },
    { name: 'Moderation', path: '/moderation', heading: 'Moderation queue' },
    { name: 'Settings', path: '/settings', heading: 'Edit your account' },
  ] as const) {
    await page.getByRole('link', { name: route.name }).click();
    await expect(page).toHaveURL(new RegExp(`${route.path}$`));
    await expect(page.getByRole('heading', { name: route.heading })).toBeVisible();
  }
  expect(pageErrors).toEqual([]);
});

test('hydrates and toggles the authenticated viewer follow relationship', async ({ page }) => {
  await page.goto('/profile/ada');
  const follow = page.getByRole('button', { name: 'Following', exact: true });
  await expect(follow).toHaveAttribute('aria-pressed', 'true');
  await follow.click();
  const removed = page.getByRole('button', { name: 'Follow', exact: true });
  await expect(removed).toHaveAttribute('aria-pressed', 'false');
  await removed.click();
  await expect(page.getByRole('button', { name: 'Following', exact: true })).toHaveAttribute('aria-pressed', 'true');

  const mute = page.getByRole('button', { name: 'Mute', exact: true });
  await mute.click();
  await expect(page.getByRole('button', { name: 'Muted', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Muted', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mute', exact: true })).toHaveAttribute('aria-pressed', 'false');

  const block = page.getByRole('button', { name: 'Block', exact: true });
  await block.click();
  await expect(page.getByRole('button', { name: 'Blocked', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Following', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Blocked', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Block', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

// Run the latency-sensitive schedule-to-signal contract before the separate
// fixture that deliberately creates and immediately suspends a schedule.
// Each journey remains independently runnable, while the full serial suite
// does not manufacture provider backpressure immediately before its bounded
// signal-delivery assertion.
test(
  'receives a risky automation signal over SSE and resumes its durable workflow through a typed approval',
  riskyAutomationSignalJourney,
);

test('updates the authenticated profile and configures an idempotent disclosed automation', async ({ page }) => {
  const suffix = Date.now().toString(36);
  const displayName = `Demo User ${suffix}`;
  const persona = `Disclosed operations reporter ${suffix}`;

  await page.goto('/settings');
  await page.getByLabel('Display name').fill(displayName);
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeEnabled();
  await page.getByRole('link', { name: 'Demo User' }).click();
  await expect(page.getByRole('heading', { name: displayName })).toBeVisible();

  await page.getByRole('link', { name: 'Automation' }).click();
  await page.getByLabel('Persona').fill(persona);
  await page.getByRole('button', { name: /Configure automation|Save automation/ }).click();
  const automation = page.locator('article').filter({ hasText: persona });
  await expect(automation).toBeVisible();
  await automation.getByRole('button', { name: 'Emergency stop' }).click();
  await expect(automation.getByText('Suspended', { exact: true })).toBeVisible();
});

test('administratively stops and resumes every automated publication through durable product state', async ({ page }) => {
  const reason = `Playwright safety stop ${new Date().toISOString()}`;
  await page.goto('/moderation');
  const policy = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Moderation policy' }) });
  await expect(policy).toContainText('Ready');
  await expect(policy).toContainText('maximum risk 0.8');
  const control = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Automated publication' }) });
  await expect(control).toContainText(/Enabled|Stopped/);
  if (await control.getByRole('button', { name: 'Resume automation' }).isVisible().catch(() => false)) {
    await control.getByRole('button', { name: 'Resume automation' }).click();
    await expect(control).toContainText('Enabled.');
  }
  await control.getByLabel('Stop reason').fill(reason);
  await control.getByRole('button', { name: 'Stop all automation' }).click();
  await expect(control).toContainText(`Stopped: ${reason}`);
  await control.getByRole('button', { name: 'Resume automation' }).click();
  await expect(control).toContainText('Enabled.');
});

async function riskyAutomationSignalJourney({ page }: { readonly page: Page }) {
  test.setTimeout(180_000);
  const automationPersona = `Signal release fixture ${Date.now().toString(36)}`;
  let automationId: string | undefined;
  // Keep this release gate independently runnable: a prior safety-stop journey
  // or retained local product state must not suppress the scheduled workflow.
  await page.goto('/moderation');
  const automationControl = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Automated publication' }),
  });
  if (await automationControl.getByRole('button', { name: 'Resume automation' }).isVisible().catch(() => false)) {
    await automationControl.getByRole('button', { name: 'Resume automation' }).click();
    await expect(automationControl).toContainText('Enabled.');
  }
  await page.goto('/automation');
  const createAnother = page.getByRole('button', { name: 'Create another automation' });
  if (await createAnother.isVisible().catch(() => false)) await createAnother.click();
  await page.getByLabel('Persona').fill(automationPersona);
  await page.getByLabel('Five-field schedule').fill('* * * * *');
  await page.getByLabel('Daily post limit').fill('24');
  try {
    await page.getByRole('button', { name: /Configure automation|Save automation/ }).click();
    const automation = page.locator('article').filter({ hasText: automationPersona });
    await expect(automation).toBeVisible();
    automationId = await automation.getAttribute('data-automation-id') ?? undefined;
    expect(automationId).toBeTruthy();

    await page.getByRole('link', { name: 'Moderation' }).click();
    const review = page.locator('article').filter({
      hasText: `Automation ${automationId}`,
    }).first();
    await expect(review).toBeVisible({ timeout: 120_000 });
    const signalId = await review.getAttribute('data-signal-id');
    const runId = await review.getAttribute('data-run-id');
    expect(signalId).toBeTruthy();
    expect(runId).toBeTruthy();
    const signalActionPath =
      `/__applik8s/v1/signals/automation.post-review.v1/${encodeURIComponent(signalId as string)}/actions`;
    const unauthorized = await page.request.post(`${signalActionPath}/approve`, {
      headers: {
        'content-type': 'application/json',
        'x-chirp-user': 'ordinary-user',
      },
      data: {
        input: { comment: 'A forged non-moderator decision.' },
        idempotencyKey: `${signalId}:unauthorized`,
      },
    });
    expect(unauthorized.status()).toBe(403);

    // A browser restart must recover the same exact-instance capability from
    // the durable issuance stream rather than relying on component memory.
    await page.reload();
    // Pin the immutable issuance identity. A one-minute schedule may emit the
    // next review while this assertion is running; a text/.first() locator
    // would then retarget to that distinct, still-pending signal.
    const replayedReview = page.locator(
      `article[data-signal-id="${signalId as string}"]`,
    );
    await expect(replayedReview).toBeVisible({ timeout: 60_000 });
    await expect(replayedReview).toHaveAttribute('data-signal-id', signalId as string);
    await replayedReview.getByRole('button', { name: 'Approve' }).click();
    await expect(replayedReview).toBeHidden();

    const losingAction = await page.request.post(`${signalActionPath}/reject`, {
      headers: {
        'content-type': 'application/json',
        'x-chirp-user': 'demo-user',
      },
      data: {
        input: { reason: 'This terminal action lost the compare-and-swap.' },
        idempotencyKey: `${signalId}:losing-reject`,
      },
    });
    expect(losingAction.status()).toBe(200);
    const losingResult = await losingAction.json() as {
      readonly status?: string;
      readonly outcome?: Readonly<Record<string, unknown>>;
    };
    expect(losingResult.status).toBe('alreadyResolved');
    expect(losingResult.outcome).toMatchObject({ status: 'resolved' });
    expect(losingResult.outcome).not.toHaveProperty('action');
    expect(losingResult.outcome).not.toHaveProperty('input');
    expect(losingResult.outcome).not.toHaveProperty('actor');
    expect(losingResult.outcome).not.toHaveProperty('receipt');

    await page.getByRole('link', { name: 'Automation' }).click();
    const run = page.locator(`article[data-run-id="${runId as string}"]`);
    await expect(run).toContainText('published', { timeout: 60_000 });
    await expect(run).toContainText(`post:${runId as string}:post`);
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    const publishedPost = page.locator(
      `article[data-post-id="${runId as string}:post"]`,
    );
    await expect(publishedPost).toContainText(
      'Automated Chirp status: review the local runbook at http://status.local before publishing.',
      { timeout: 60_000 },
    );
  } finally {
    await page.goto('/automation').catch(() => undefined);
    const created = page.locator('article').filter({ hasText: automationPersona });
    if (await created.isVisible().catch(() => false)) {
      const stop = created.getByRole('button', { name: 'Emergency stop' });
      if (await stop.isVisible().catch(() => false)) {
        await stop.click().catch(() => undefined);
        await expect(created.getByText('Suspended', { exact: true }))
          .toBeVisible()
          .catch(() => undefined);
      }
    }
  }
}

test('reports, moderates, and removes a post through durable product state', async ({ page }) => {
  const body = `Moderation journey ${new Date().toISOString()}`;
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Post text' }).fill(body);
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  const post = page.locator('article').filter({ hasText: body });
  await expect(post).toBeVisible();
  const postId = await post.getAttribute('data-post-id');
  expect(postId).toBeTruthy();
  await post.getByRole('button', { name: '⚑ Report' }).click();
  await expect(post.getByRole('button', { name: '⚑ Report' })).toBeEnabled();

  await page.getByRole('link', { name: 'Moderation' }).click();
  const report = page.locator('article').filter({ hasText: `Submitted from Chirp for ${postId}.` });
  await expect(report).toBeVisible();
  await report.getByRole('button', { name: 'Open case' }).click();

  const moderationCase = page.locator('article').filter({ hasText: `post · ${postId}` });
  await expect(moderationCase).toBeVisible();
  await moderationCase.getByRole('button', { name: 'Remove post' }).click();
  await expect(moderationCase.getByRole('button', { name: 'Remove post' })).toBeEnabled();
  await moderationCase.getByRole('button', { name: 'Resolve' }).click();
  await expect(moderationCase).toBeHidden();
  await expect(report).toBeHidden();

  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.locator('article').filter({ hasText: body })).toBeHidden();
});
