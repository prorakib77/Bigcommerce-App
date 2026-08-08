'use client';

import { useState, type ReactNode, type JSX } from 'react';
import { useServerInsertedHTML } from 'next/navigation';
import { ServerStyleSheet, StyleSheetManager } from 'styled-components';

/**
 * Wires styled-components' server-side stylesheet collection into Next.js
 * App Router's streaming SSR, per Next's documented CSS-in-JS integration
 * pattern. Without this, styles either flash unstyled on first paint or
 * fail to render at all during streaming.
 */
export function StyledComponentsRegistry({ children }: { children: ReactNode }): JSX.Element {
  const [sheet] = useState(() => new ServerStyleSheet());

  useServerInsertedHTML(() => {
    const styles = sheet.getStyleElement();
    sheet.instance.clearTag();
    return <>{styles}</>;
  });

  if (typeof window !== 'undefined') {
    return <>{children}</>;
  }

  return <StyleSheetManager sheet={sheet.instance}>{children}</StyleSheetManager>;
}
