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
