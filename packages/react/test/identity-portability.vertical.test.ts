import { applicationIdentityHttpProtocol, type ApplicationIdentityClient } from '@applik8s/identity/client';
import {
  ApplicationIdentityProvider,
  useApplicationIdentityClient,
} from '@applik8s/react/identity';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

describe('router-independent React identity integration', () => {
  it('supplies the browser-safe client without owning routes or provider state', () => {
    const client = identityClient();
    const html = renderToString(createElement(
      ApplicationIdentityProvider,
      { client },
      createElement(IdentityMarker, { expected: client }),
    ));

    expect(html).toContain('identity-client-ready');
  });
});

function IdentityMarker({ expected }: { readonly expected: ApplicationIdentityClient }) {
  const client = useApplicationIdentityClient();
  return createElement('span', undefined, client === expected ? 'identity-client-ready' : 'wrong-client');
}

function identityClient(): ApplicationIdentityClient {
  const unsupported = async (): Promise<never> => {
    throw new Error('not used');
  };
  return {
    async session() {
      return {
        protocol: applicationIdentityHttpProtocol,
        kind: 'session',
        authenticated: false,
        assurance: [],
      };
    },
    beginFlow: unsupported,
    transitionFlow: unsupported,
    cancelFlow: unsupported,
    logout: unsupported,
    account: unsupported,
    updateAccount: unsupported,
    beginMfa: unsupported,
    completeMfa: unsupported,
    removeMfa: unsupported,
    consent: unsupported,
    decideConsent: unsupported,
    clients: unsupported,
    createClient: unsupported,
    rotateClient: unsupported,
    revokeClient: unsupported,
  };
}
