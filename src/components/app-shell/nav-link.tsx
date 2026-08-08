'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import styled from 'styled-components';

const StyledLink = styled(Link)<{ $active: boolean }>`
  display: flex;
  align-items: center;
  padding: 0.55rem 0.75rem;
  border-radius: 8px;
  margin-bottom: 0.15rem;
  text-decoration: none;
  font-size: 0.9rem;
  color: ${(p) => (p.$active ? '#fff' : 'rgba(255, 255, 255, 0.72)')};
  background: ${(p) => (p.$active ? 'rgba(255, 255, 255, 0.12)' : 'transparent')};
  font-weight: ${(p) => (p.$active ? 600 : 400)};
  border: 1px solid ${(p) => (p.$active ? 'rgba(255, 255, 255, 0.14)' : 'transparent')};
  transition:
    background 0.15s ease,
    color 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.6);
    outline-offset: 1px;
  }
`;

export function NavLink({
  href,
  active,
  children,
  onNavigate,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
  /** Closes the mobile off-canvas drawer after a navigation. No-op on desktop (drawer isn't rendered open there). */
  onNavigate?: () => void;
}): React.JSX.Element {
  return (
    <StyledLink href={href} $active={active} onClick={onNavigate}>
      {children}
    </StyledLink>
  );
}
