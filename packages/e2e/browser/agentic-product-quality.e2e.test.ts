// typecast-file-boundary: release route and accessibility inventories are
// closed literal tuples whose values are exercised against the generated app.

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const representativeRoutes = [
  '/',
  '/sign-in?returnTo=%2Fapp',
  '/sign-up',
  '/recover',
  '/verify',
  '/app',
  '/app/documents',
  '/app/inbox',
  '/app/artifacts',
  '/app/agents',
  '/app/knowledge',
  '/app/integrations',
  '/app/evaluations',
  '/app/workspaces',
  '/app/usage',
  '/app/account',
  '/app/billing',
  '/app/setup',
  '/app/operations',
  '/admin',
  '/admin/tenants',
  '/admin/catalog',
] as const;

test.describe.configure({ mode: 'serial' });

test('keeps the representative product surface responsive and free of browser failures', async ({ browser, baseURL }) => {
  const failures: string[] = [];

  for (const path of representativeRoutes) {
    const context = await browser.newContext(baseURL ? { baseURL } : {});
    const page = await context.newPage();
    const routeFailures: string[] = [];
    const documentStatuses: number[] = [];
    page.on('console', message => {
      if (message.type() === 'error') routeFailures.push(`console: ${message.text()}`);
    });
    page.on('pageerror', error => routeFailures.push(`page: ${error.message}`));
    page.on('response', response => {
      if (response.request().resourceType() === 'document') {
        documentStatuses.push(response.status());
      }
    });

    let admittedRedirect = false;
    const publicAdmissionRoute = /^\/(?:sign-in|sign-up|recover|verify)(?:\?|$)/u.test(path);
    try {
      try {
        await page.goto(path, { waitUntil: 'domcontentloaded' });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (!publicAdmissionRoute || !/(?:ERR_ABORTED|interrupted by another navigation)/u.test(message)) {
          throw cause;
        }
        await page.waitForURL(url => url.pathname === '/app');
        admittedRedirect = true;
      }
      admittedRedirect ||= publicAdmissionRoute
        && new URL(page.url()).pathname === '/app';
      expect(
        documentStatuses.length,
        `${path} did not return a document`,
      ).toBeGreaterThan(0);
      expect(
        documentStatuses.every(status => status < 500),
        `${path} returned a server error: ${documentStatuses.join(', ')}`,
      ).toBe(true);
      await expect(page.locator('body')).not.toContainText('Internal Server Error');
      await expect(page.locator('body')).not.toContainText('Server Error');
      await expect(page.locator('main')).toHaveCount(1);
      await expect(page.locator('main')).toBeVisible();
      const overflow = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      }));
      expect(
        overflow.content,
        `${path} overflowed the ${overflow.viewport}px viewport`,
      ).toBeLessThanOrEqual(overflow.viewport + 1);
      failures.push(...routeFailures
        .filter(failure => !(
          admittedRedirect
          && /(?:NetworkError when attempting to fetch resource|TypeError: Load failed)/u.test(failure)
        ))
        .map(failure => `${path}: ${failure}`));
    } finally {
      await context.close();
    }
  }

  expect(failures).toEqual([]);
});

test('exposes a keyboard-usable, semantically named first-run experience', async ({ page }) => {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('main')).toHaveCount(1);

  const semanticFailures = await page.evaluate(() => {
    const failures: string[] = [];
    const ids = new Set<string>();
    for (const element of document.querySelectorAll<HTMLElement>('[id]')) {
      if (ids.has(element.id)) failures.push(`duplicate id ${element.id}`);
      ids.add(element.id);
    }
    for (const image of document.querySelectorAll<HTMLImageElement>('img')) {
      if (!image.hasAttribute('alt')) failures.push(`image without alt: ${image.src}`);
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('button')) {
      if (button.disabled || button.hidden) continue;
      const label = button.getAttribute('aria-label') ?? button.textContent?.trim();
      if (!label) failures.push('button without an accessible name');
    }
    for (const control of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')) {
      if (control.type === 'hidden' || control.disabled) continue;
      const labelled = control.hasAttribute('aria-label')
        || control.hasAttribute('aria-labelledby')
        || (control.id !== '' && document.querySelector(`label[for="${CSS.escape(control.id)}"]`) !== null)
        || control.closest('label') !== null;
      if (!labelled) failures.push(`${control.tagName.toLowerCase()} without an accessible label`);
    }
    return failures;
  });
  expect(semanticFailures).toEqual([]);

  await page.keyboard.press('Tab');
  const focused = page.locator(':focus');
  await expect(focused).toBeVisible();
  expect(await focused.evaluate(element => {
    const style = getComputedStyle(element);
    return style.outlineStyle !== 'none'
      || style.boxShadow !== 'none'
      || element.matches(':focus-visible');
  })).toBe(true);
});

test('has no serious automated accessibility violations across the core journeys', async ({ page }) => {
  for (const path of [
    '/app',
    '/app/agents',
    '/app/billing',
    '/app/setup',
  ] as const) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const violations = results.violations
      .filter(violation => violation.impact === 'critical' || violation.impact === 'serious')
      .map(violation => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.map(node => ({ target: node.target, summary: node.failureSummary })),
      }));
    expect(violations, `${path} has serious automated accessibility violations`).toEqual([]);
  }
});

test('preserves intentional custom surfaces and readable contrast', async ({ page }) => {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  const assistant = page.getByRole('region', { name: 'Workspace assistant' });
  await expect(assistant).toBeVisible();

  const surface = await assistant.evaluate(element => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas 2D color conversion is unavailable.');
    const toSrgb = (value: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const luminance = (channels: number[]) => {
      const [red = 0, green = 0, blue = 0] = channels
        .map(channel => channel / 255)
        .map(channel => channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4);
      return red * 0.2126 + green * 0.7152 + blue * 0.0722;
    };
    const style = getComputedStyle(element);
    const foregroundChannels = toSrgb(style.color);
    const backgroundChannels = toSrgb(style.backgroundColor);
    const foreground = luminance(foregroundChannels);
    const background = luminance(backgroundChannels);
    return {
      backgroundColor: style.backgroundColor,
      backgroundChannels,
      foregroundColor: style.color,
      foregroundChannels,
      contrast: (Math.max(foreground, background) + 0.05)
        / (Math.min(foreground, background) + 0.05),
    };
  });

  expect(surface.backgroundColor).not.toBe('rgb(255, 255, 255)');
  expect(surface.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(surface.contrast).toBeGreaterThanOrEqual(4.5);
});

test('preserves product meaning in dark mode and reduced motion', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'What should we accomplish?' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recent work sessions', exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Internal Server Error');
});

test('captures a reviewable product, builder, billing, and operator journey', async ({ page }, testInfo) => {
  for (const [name, path, heading] of [
    ['product-home', '/app', 'What should we accomplish?'],
    ['builder-agents', '/app/agents', 'Agents'],
    ['workspace-billing', '/app/billing', 'Plan, usage, and access'],
    ['operator-launchpad', '/app/setup', 'Get this application ready to launch'],
  ] as const) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0, {
      timeout: 15_000,
    });
    await page.screenshot({
      path: testInfo.outputPath(`${name}.png`),
      fullPage: true,
    });
  }
});

test('preserves SSR content, bounded navigation, and live-query recovery on a degraded connection', async ({ page }) => {
  test.setTimeout(90_000);
  let multiplexAttempts = 0;

  await page.route('**/*', async route => {
    const request = route.request();
    if (request.url().includes('/__applik8s/v1/queries/multiplex')) {
      multiplexAttempts += 1;
      if (multiplexAttempts === 1) {
        await route.abort('connectionreset');
        return;
      }
    }
    if (['document', 'script', 'stylesheet'].includes(request.resourceType())) {
      await new Promise(resolve => setTimeout(resolve, 75));
    }
    await route.continue();
  });

  const startedAt = Date.now();
  const response = await page.goto('/app', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBeLessThan(500);
  expect(await response?.text()).toContain('What should we accomplish?');
  await expect(
    page.getByRole('heading', { name: 'What should we accomplish?' }),
  ).toBeVisible({ timeout: 15_000 });
  expect(Date.now() - startedAt).toBeLessThan(15_000);

  await expect.poll(() => multiplexAttempts, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(2);
  await expect(
    page.getByRole('region', { name: 'Recent work sessions', exact: true }),
  ).toBeVisible();

  const transitionStartedAt = Date.now();
  const artifactLink = page.getByRole('link', { name: 'Artifacts', exact: true }).first();
  if (!(await artifactLink.isVisible())) {
    await page.getByRole('navigation', { name: 'Mobile application' })
      .getByRole('button', { name: 'More' })
      .click();
  }
  await artifactLink.click();
  await expect(page.getByRole('heading', { name: 'Artifacts', exact: true, level: 1 })).toBeVisible({
    timeout: 10_000,
  });
  expect(Date.now() - transitionStartedAt).toBeLessThan(10_000);
});

test('recovers an authenticated session from a stale workspace selector', async ({ page, baseURL }) => {
  const origin = baseURL ?? 'http://127.0.0.1:30080';
  await page.context().addCookies([{
    name: 'applik8s_workspace',
    value: '11111111-1111-4111-8111-111111111111',
    url: origin,
    sameSite: 'Lax',
  }]);

  const response = await page.goto('/app', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBeLessThan(500);
  await expect(page.getByRole('heading', { name: 'What should we accomplish?' })).toBeVisible();
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(async () => (
    await page.context().cookies(origin)
  ).some(cookie => cookie.name === 'applik8s_workspace')).toBe(false);

  const queryStatus = await page.evaluate(async () => {
    const result = await fetch('/__applik8s/v1/queries/Document.listDocuments/snapshot', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: {} }),
    });
    return result.status;
  });
  expect(queryStatus).toBe(200);
  await expect(page.locator('body')).not.toContainText('HTTP 403');
  await expect(page.locator('body')).not.toContainText('Reconnecting…');
});

test('uses one bounded mobile navigation with an authority-shaped More sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'What should we accomplish?' })).toBeVisible();

  const navigation = page.getByRole('navigation', { name: 'Mobile application' });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole('link')).toHaveCount(3);
  await expect(navigation.getByRole('button', { name: 'More' })).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: /Product navigation/u })).toHaveCount(0);

  const layout = await page.evaluate(() => {
    const main = document.querySelector('main');
    const mobileNavigation = document.querySelector<HTMLElement>('[data-mobile-navigation]');
    const visibleOverflow = [...document.querySelectorAll<HTMLElement>('nav')]
      .filter(element => getComputedStyle(element).display !== 'none')
      .filter(element => element.scrollWidth > element.clientWidth + 1)
      .map(element => element.getAttribute('aria-label'));
    return {
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      mainPaddingBottom: main ? Number.parseFloat(getComputedStyle(main).paddingBottom) : 0,
      navigationHeight: mobileNavigation?.getBoundingClientRect().height ?? 0,
      visibleOverflow,
    };
  });
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.visibleOverflow).toEqual([]);
  expect(layout.mainPaddingBottom).toBeGreaterThan(layout.navigationHeight);

  await navigation.getByRole('button', { name: 'More' }).click();
  const sheet = page.getByRole('dialog', { name: 'Explore the application' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'Artifacts' })).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'Workspaces' })).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'Account' })).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'Launchpad' })).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'Operations' })).toBeVisible();
});
