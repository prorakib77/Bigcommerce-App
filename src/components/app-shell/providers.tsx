'use client';

import { Suspense, type ReactNode } from 'react';
import { GlobalStyles } from '@bigcommerce/big-design';
import { theme } from '@bigcommerce/big-design-theme';
import { ThemeProvider, createGlobalStyle } from 'styled-components';
import { SessionProvider } from './session-context';

// BigDesign's own GlobalStyles doesn't reset box-sizing on plain elements
// outside its component set. Without this, a fixed-width sidebar with
// padding/border renders WIDER than its declared `width` (content-box is
// the CSS default), so a sibling relying on that same width for its
// margin/offset visibly overlaps it — confirmed by an actual rendered
// screenshot, not assumed. `border-box` everywhere is standard practice and
// makes width/padding/border math predictable across the whole app.
const BoxSizingReset = createGlobalStyle`
  *, *::before, *::after {
    box-sizing: border-box;
  }
`;

export function Providers({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <ThemeProvider theme={theme}>
      <BoxSizingReset />
      <GlobalStyles />
      <Suspense fallback={null}>
        <SessionProvider>{children}</SessionProvider>
      </Suspense>
    </ThemeProvider>
  );
}
