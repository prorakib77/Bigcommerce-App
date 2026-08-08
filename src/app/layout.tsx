import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { StyledComponentsRegistry } from '@/components/app-shell/styled-components-registry';
import { Providers } from '@/components/app-shell/providers';
import { AppShell } from '@/components/app-shell/app-shell';
import { getEnv } from '@/server/env';

export const metadata: Metadata = {
  title: 'Kickflip Import',
  description: 'Import saved Kickflip designs into your BigCommerce catalog.',
  robots: { index: false, follow: false },
};

// middleware.ts mints a fresh CSP nonce on every request and Next threads it
// into its own inline hydration scripts by matching the nonce it finds on
// the response's CSP header. That only works if the HTML is rendered fresh
// per request: a statically prerendered page bakes in whatever nonce was
// current at build/first-request time, which then mismatches every
// subsequent request's freshly-generated header nonce and gets every inline
// script blocked outright (confirmed in production: entirely blank app,
// CSP script-src violations in the console). Forcing dynamic rendering here
// cascades to every route below it.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }): React.JSX.Element {
  const mockMode = getEnv().MOCK_MODE;

  return (
    <html lang="en" suppressHydrationWarning>
      {/* suppressHydrationWarning: browser extensions (Grammarly, password
          managers, translators) inject attributes like
          data-new-gr-c-s-check-loaded / data-gr-ext-installed onto <body>
          before React hydrates. That's a false-positive hydration mismatch
          with no connection to this app's own rendering — this only
          silences the warning for html/body's own attributes, it does not
          suppress hydration-mismatch warnings for anything this app
          actually renders inside them. */}
      <body suppressHydrationWarning>
        <StyledComponentsRegistry>
          <Providers>
            <AppShell mockMode={mockMode}>{children}</AppShell>
          </Providers>
        </StyledComponentsRegistry>
      </body>
    </html>
  );
}
