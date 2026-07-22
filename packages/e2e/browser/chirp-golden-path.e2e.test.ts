// typecast-file-boundary: browser fixtures use literal route tuples and a controlled global marker solely to prove hydration continuity.
import { expect, test } from '@playwright/test';

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
