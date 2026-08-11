// typecast-file-boundary: release route and accessibility inventories are
// closed literal tuples whose values are exercised against the generated app.
import { expect, test } from '@playwright/test';

const representativeRoutes = [
  '/',
  '/sign-in?returnTo=%2Fapp',
  '/sign-up',
  '/recover',
  '/verify',
  '/app',
  '/app/inbox',
  '/app/library',
  '/app/account',
  '/app/billing',
  '/app/setup',
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

test('preserves intentional custom surfaces and readable contrast', async ({ page }) => {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  const assistant = page.getByRole('region', { name: 'Notes assistant' });
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
  await expect(page.getByRole('heading', { name: 'Make useful work appear.' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Your notes', exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Internal Server Error');
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
  expect(await response?.text()).toContain('Make useful work appear.');
  await expect(
    page.getByRole('heading', { name: 'Make useful work appear.' }),
  ).toBeVisible({ timeout: 15_000 });
  expect(Date.now() - startedAt).toBeLessThan(15_000);

  await expect.poll(() => multiplexAttempts, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(2);
  await expect(
    page.getByRole('region', { name: 'Your notes', exact: true }),
  ).toBeVisible();

  const transitionStartedAt = Date.now();
  await page.getByRole('link', { name: 'Library', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Documents and artifacts', exact: true })).toBeVisible({
    timeout: 10_000,
  });
  expect(Date.now() - transitionStartedAt).toBeLessThan(10_000);
});
