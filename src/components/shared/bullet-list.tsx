import type { ReactNode } from 'react';

export function BulletList({ children }: { children: ReactNode }): React.JSX.Element {
  return <ul style={{ margin: '0.5rem 0', paddingLeft: '1.25rem' }}>{children}</ul>;
}

export function BulletItem({ children }: { children: ReactNode }): React.JSX.Element {
  return <li style={{ marginBottom: '0.25rem', lineHeight: 1.5 }}>{children}</li>;
}
