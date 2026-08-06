import { type ApplicationIdentitySessionView, createApplicationIdentityClient } from '@applik8s/identity/client';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import {
  ApplicationIdentityProvider,
  useApplicationIdentitySession,
} from '../src/identity.js';

const authenticatedSession: ApplicationIdentitySessionView = {
  protocol: 'applik8s.identityHttp/v1alpha1',
  kind: 'session',
  authenticated: true,
  assurance: ['aal1'],
  principal: {
    id: 'principal:ada',
    kind: 'human',
    identity: {
      id: 'identity:ada',
      kind: 'human',
      issuer: 'https://identity.application.test',
      subject: 'ada@example.com',
    },
    authenticationMethod: 'password',
    audience: ['application'],
    admittedAt: '2026-08-05T12:00:00.000Z',
  },
};

describe('application identity SSR hydration', () => {
  test('renders the request-scoped initial session without a loading shell', () => {
    const client = createApplicationIdentityClient({
      fetch: Object.assign(async () => {
        throw new Error('SSR must not refetch an already loaded session.');
      }, { preconnect() {} }),
    });

    function Session() {
      const session = useApplicationIdentitySession();
      return createElement(
        'span',
        null,
        session.phase === 'ready'
          ? session.data?.principal?.identity.subject
          : session.phase,
      );
    }

    const html = renderToStaticMarkup(createElement(
      ApplicationIdentityProvider,
      { client, initialSession: authenticatedSession },
      createElement(Session),
    ));

    expect(html).toBe('<span>ada@example.com</span>');
  });

  test('retains the loading state when no server snapshot is supplied', () => {
    const client = createApplicationIdentityClient({
      fetch: Object.assign(async () => {
        throw new Error('Effects do not run during server rendering.');
      }, { preconnect() {} }),
    });

    function Session() {
      return createElement('span', null, useApplicationIdentitySession().phase);
    }

    const html = renderToStaticMarkup(createElement(
      ApplicationIdentityProvider,
      { client },
      createElement(Session),
    ));

    expect(html).toBe('<span>loading</span>');
  });
});
