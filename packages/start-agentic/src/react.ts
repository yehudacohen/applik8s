import {
  type CSSProperties,
  createElement,
  type ReactNode,
} from 'react';

export {
  AgenticAccountSession,
  AgenticAccountSettings,
  type AgenticAccountSessionProps,
  type AgenticAccountSettingsProps,
} from './account.js';

const workspaceCookieName = 'applik8s_workspace';
const workspaceIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Selects the browser's requested workspace. This is deliberately only a
 * selector: every server request revalidates it against the authenticated
 * principal before adding workspace identity or role to trusted context.
 */
export function selectAgenticWorkspace(workspaceId: string): void {
  if (
    !workspaceIdPattern.test(workspaceId)
  ) {
    throw new Error('Agentic workspace selector must be a UUID.');
  }
  if (typeof document === 'undefined') {
    throw new Error(
      'selectAgenticWorkspace(...) is available only in the browser.',
    );
  }
  const secure = globalThis.location?.protocol === 'https:' ? '; Secure' : '';
  document.cookie =
    `${workspaceCookieName}=${encodeURIComponent(workspaceId.toLowerCase())}`
    + `; Path=/; SameSite=Lax${secure}`;
}

/**
 * Reads the browser's untrusted workspace selector for browser-local scoping.
 * The returned value is never authority; the server independently admits it
 * against the authenticated principal on every request.
 */
export function readAgenticWorkspaceSelection(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const prefix = `${workspaceCookieName}=`;
  const encoded = document.cookie
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(prefix))
    ?.slice(prefix.length);
  if (!encoded) return undefined;
  let value: string;
  try {
    value = decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
  return workspaceIdPattern.test(value) ? value.toLowerCase() : undefined;
}

/** Clears the untrusted selector without changing workspace membership. */
export function clearAgenticWorkspaceSelection(): void {
  if (typeof document === 'undefined') {
    throw new Error(
      'clearAgenticWorkspaceSelection() is available only in the browser.',
    );
  }
  const secure = globalThis.location?.protocol === 'https:' ? '; Secure' : '';
  document.cookie =
    `${workspaceCookieName}=; Path=/; SameSite=Lax; Max-Age=0${secure}`;
}

export interface AgenticStartOnboardingProps {
  readonly application: string;
  readonly operationsHref?: string;
  readonly documentationHref?: string;
}

interface OnboardingStep {
  readonly title: string;
  readonly body: string;
  readonly state: string;
  readonly href?: string;
  readonly action?: string;
}

/**
 * Maintained first-run surface shared by generated Agentic Start applications.
 * It teaches the stable product/deployment boundaries without copying a
 * profile inspector or provider registry into application-owned source.
 */
export function AgenticStartOnboarding(
  props: AgenticStartOnboardingProps,
): ReactNode {
  const steps: readonly OnboardingStep[] = [
    {
      title: 'Use the product',
      body: 'The page below is ordinary TanStack Start UI backed by typed Applik8s operations.',
      state: 'ready',
    },
    {
      title: 'Inspect operational truth',
      body: 'Canonical application state remains separate from delivery and provider observations.',
      state: 'available',
      href: props.operationsHref ?? '/operations',
      action: 'Open operations',
    },
    {
      title: 'Preview infrastructure',
      body: 'Run bun run plan to inspect the same normalized deployment graph before any side effect.',
      state: 'command',
    },
    {
      title: 'Choose production providers deliberately',
      body: 'Starter is the credential-free, explicitly non-production first-run default. Developer adds operation-host credentials and local hot reload without changing that production boundary; Dedicated and External require reviewed provider configuration.',
      state: 'non-production',
    },
  ];

  return createElement('section', {
    style: styles.shell,
    'aria-labelledby': 'agentic-start-onboarding-title',
  }, [
    createElement('div', { key: 'heading', style: styles.heading }, [
      createElement('div', { key: 'copy' }, [
        createElement('p', { key: 'eyebrow', style: styles.eyebrow },
          'Applik8s Agentic Start'),
        createElement('h1', {
          key: 'title',
          id: 'agentic-start-onboarding-title',
          style: styles.title,
        }, `${props.application} is ready to explore`),
        createElement('p', { key: 'summary', style: styles.summary },
          'Start with the working product, then progressively disclose operations, deployment, and provider configuration.'),
      ]),
      createElement('span', {
        key: 'profile',
        style: styles.warningBadge,
      }, 'default: starter · non-production'),
    ]),
    createElement('ol', { key: 'steps', style: styles.steps },
      steps.map((step, index) =>
        createElement('li', { key: step.title, style: styles.step }, [
          createElement('span', { key: 'number', style: styles.number },
            String(index + 1)),
          createElement('div', { key: 'content' }, [
            createElement('div', { key: 'line', style: styles.stepLine }, [
              createElement('strong', { key: 'title' }, step.title),
              createElement('span', { key: 'state', style: styles.state },
                step.state),
            ]),
            createElement('p', { key: 'body', style: styles.body }, step.body),
            'href' in step
              ? createElement('a', {
                  key: 'action',
                  href: step.href,
                  style: styles.link,
                }, step.action)
              : null,
          ]),
        ]),
      )),
    props.documentationHref
      ? createElement('a', {
          key: 'docs',
          href: props.documentationHref,
          style: styles.docs,
        }, 'Read the deployment and profile guide')
      : null,
  ]);
}

const styles = {
  shell: {
    margin: '0 0 32px',
    padding: 24,
    border: '1px solid #d9e5df',
    borderRadius: 18,
    background: 'linear-gradient(145deg, #f4fbf7, #ffffff)',
    color: '#14241f',
  },
  heading: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'start',
    gap: 20,
  },
  eyebrow: {
    margin: 0,
    color: '#26725a',
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
  },
  title: { margin: '5px 0 8px', fontSize: 28, letterSpacing: '-0.03em' },
  summary: { maxWidth: 700, margin: 0, color: '#53645e', lineHeight: 1.55 },
  warningBadge: {
    padding: '6px 10px',
    borderRadius: 999,
    background: '#fff0c7',
    color: '#6f4b00',
    fontSize: 12,
    fontWeight: 800,
    whiteSpace: 'nowrap',
  },
  steps: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
    gap: 12,
    margin: '22px 0 0',
    padding: 0,
    listStyle: 'none',
  },
  step: {
    display: 'flex',
    gap: 10,
    padding: 14,
    border: '1px solid #e4ece8',
    borderRadius: 12,
    background: '#fff',
  },
  number: {
    display: 'grid',
    placeItems: 'center',
    flex: '0 0 24px',
    height: 24,
    borderRadius: 999,
    background: '#173d32',
    color: '#fff',
    fontSize: 12,
    fontWeight: 800,
  },
  stepLine: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
  },
  state: {
    color: '#6c7a75',
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
  },
  body: { margin: '6px 0 0', color: '#5d6c67', fontSize: 13, lineHeight: 1.45 },
  link: {
    display: 'inline-block',
    marginTop: 9,
    color: '#17694f',
    fontSize: 13,
    fontWeight: 750,
  },
  docs: {
    display: 'inline-block',
    marginTop: 18,
    color: '#17694f',
    fontWeight: 700,
  },
} satisfies Readonly<Record<string, CSSProperties>>;
