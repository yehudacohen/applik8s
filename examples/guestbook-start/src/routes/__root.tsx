import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router';
import { Applik8sStartProvider } from '@applik8s/tanstack-start/react';
import type { ReactNode } from 'react';
import '../styles.css';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'applik8s GuestBook' },
    ],
  }),
  component: Root,
});

function Root() {
  return (
    <Document>
      <Applik8sStartProvider>
        <Outlet />
      </Applik8sStartProvider>
    </Document>
  );
}

function Document({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
