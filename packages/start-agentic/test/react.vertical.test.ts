import {
  AgenticAccountSettings,
  AgenticStartOnboarding,
  clearAgenticWorkspaceSelection,
  selectAgenticWorkspace,
} from '@applik8s/start-agentic/react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Agentic Start onboarding', () => {
  it('owns provider-neutral account security without generated provider plumbing', () => {
    const html = renderToStaticMarkup(createElement(AgenticAccountSettings));

    expect(html).toContain('Provider-neutral identity');
    expect(html).toContain('Account security');
    expect(html).toContain('agentic-account-settings');
    expect(html).toContain('Signed in as');
    expect(html).toContain('Multi-factor authentication');
    expect(html).toContain('Verification and recovery');
    expect(html).not.toContain('account-recovery-email');
    expect(html).not.toContain('<main');
    expect(html).not.toContain('Ory');
  });

  it('makes the credential-free boundary and progressive next steps explicit', () => {
    const html = renderToStaticMarkup(AgenticStartOnboarding({
      application: 'research',
      operationsHref: '/operations',
    }));

    expect(html).toContain('research is ready to explore');
    expect(html).toContain('default: starter · non-production');
    expect(html).toContain('Use the product');
    expect(html).toContain('Open operations');
    expect(html).toContain('bun run plan');
    expect(html).toContain('href="/operations"');
    expect(html).not.toContain('password');
    expect(html).not.toContain('token');
  });

  it('stores only a SameSite workspace selector and never browser authority', () => {
    const writes: string[] = [];
    vi.stubGlobal('document', {
      set cookie(value: string) {
        writes.push(value);
      },
    });
    vi.stubGlobal('location', { protocol: 'https:' });

    selectAgenticWorkspace('9D389C54-4E6E-4E69-995F-C663946CEF3E');
    clearAgenticWorkspaceSelection();

    expect(writes).toEqual([
      'applik8s_workspace=9d389c54-4e6e-4e69-995f-c663946cef3e; Path=/; SameSite=Lax; Secure',
      'applik8s_workspace=; Path=/; SameSite=Lax; Max-Age=0; Secure',
    ]);
    expect(writes.join(' ')).not.toMatch(/role|principal|authorization/i);
  });
});
