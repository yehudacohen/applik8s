import { Applik8sProvider } from '@applik8s/react';
import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { currentAccount } from '../session';
import '../styles.css';

export const Route = createRootRoute({
  loader: () => currentAccount.snapshot(),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Chirp · built with Applik8s' },
    ],
  }),
  component: Root,
});

function Root() {
  return <Document><Applik8sProvider><Outlet /></Applik8sProvider></Document>;
}

function Document({ children }: { readonly children: ReactNode }) {
  return <html lang="en"><head><HeadContent /></head><body>{children}<Scripts /></body></html>;
}
