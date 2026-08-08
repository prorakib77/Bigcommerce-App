'use client';

import type { ReactNode } from 'react';

/**
 * Wraps a BigDesign `<Table>` so wide columns scroll horizontally within
 * their own container on narrow viewports, instead of forcing the whole
 * page to scroll sideways (which would also drag the fixed header/sidebar
 * out of alignment with the rest of the page).
 */
export function ScrollableTable({ children }: { children: ReactNode }): React.JSX.Element {
  return <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>{children}</div>;
}
