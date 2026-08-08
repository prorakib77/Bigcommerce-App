'use client';

import { useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import styled from 'styled-components';
import { useSession } from './session-context';
import { NavLink } from './nav-link';
import { TopBar } from './top-bar';
import {
  GLASS_CHROME_BG,
  GLASS_CHROME_BORDER,
  HEADER_HEIGHT,
  SIDEBAR_WIDTH,
  MOBILE_BREAKPOINT,
  PAGE_GRADIENT_BG,
  backdropBlur,
} from './chrome';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard' },
  { href: '/designs', label: 'Designs' },
  { href: '/products', label: 'Products' },
  { href: '/orders', label: 'Orders' },
  { href: '/imports', label: 'Imports' },
  { href: '/settings', label: 'Settings' },
  { href: '/help', label: 'Help' },
];

const Shell = styled.div`
  min-height: 100vh;
  background: ${PAGE_GRADIENT_BG};
  background-attachment: fixed;
`;

const Sidebar = styled.aside<{ $open: boolean }>`
  box-sizing: border-box;
  position: fixed;
  top: ${HEADER_HEIGHT};
  left: 0;
  bottom: 0;
  width: ${SIDEBAR_WIDTH};
  z-index: 35;
  display: flex;
  flex-direction: column;
  padding: 1.25rem 1rem 1rem;
  background: ${GLASS_CHROME_BG};
  backdrop-filter: ${backdropBlur(20)};
  -webkit-backdrop-filter: ${backdropBlur(20)};
  border-right: 1px solid ${GLASS_CHROME_BORDER};
  overflow-y: auto;
  transition: transform 0.22s ease;

  @media (max-width: ${MOBILE_BREAKPOINT}) {
    transform: translateX(${(p) => (p.$open ? '0' : '-100%')});
    box-shadow: ${(p) => (p.$open ? '0 0 32px rgba(0, 0, 0, 0.35)' : 'none')};
  }
`;

const NavList = styled.nav`
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
`;

const SignedInBlock = styled.div`
  margin-top: auto;
  padding-top: 1.25rem;
`;

const SignedInDivider = styled.div`
  height: 1px;
  background: rgba(255, 255, 255, 0.1);
  margin-bottom: 1rem;
`;

const Backdrop = styled.button<{ $visible: boolean }>`
  box-sizing: border-box;
  display: none;
  border: none;
  padding: 0;
  cursor: pointer;

  @media (max-width: ${MOBILE_BREAKPOINT}) {
    display: ${(p) => (p.$visible ? 'block' : 'none')};
    position: fixed;
    inset: 0;
    top: ${HEADER_HEIGHT};
    background: rgba(10, 17, 48, 0.45);
    z-index: 30;
  }
`;

const Main = styled.main`
  margin-left: ${SIDEBAR_WIDTH};
  padding-top: ${HEADER_HEIGHT};
  min-height: 100vh;
  box-sizing: border-box;
  overflow-x: hidden;

  @media (max-width: ${MOBILE_BREAKPOINT}) {
    margin-left: 0;
  }
`;

const MainInner = styled.div`
  padding: 1.5rem;
  max-width: 80rem;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;

  @media (max-width: 640px) {
    padding: 1rem;
  }
`;

export function AppShell({
  children,
  mockMode,
}: {
  children: ReactNode;
  mockMode: boolean;
}): React.JSX.Element {
  const pathname = usePathname();
  const session = useSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <Shell>
      <TopBar
        mockMode={mockMode}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
      />

      <Backdrop $visible={sidebarOpen} onClick={closeSidebar} aria-label="Close navigation menu" />

      <Sidebar $open={sidebarOpen} aria-label="Main navigation">
        <NavList>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              active={pathname === item.href}
              onNavigate={closeSidebar}
            >
              {item.label}
            </NavLink>
          ))}
        </NavList>

        {session.status === 'ready' && (
          <SignedInBlock>
            <SignedInDivider />
            <div style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.55)' }}>Signed in as</div>
            <div
              style={{
                fontSize: '0.85rem',
                wordBreak: 'break-all',
                color: '#fff',
                marginTop: '0.15rem',
              }}
            >
              {session.email}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.55)', marginTop: '0.15rem' }}>
              {session.role === 'OWNER' ? 'Store owner' : 'Authorized user'}
            </div>
          </SignedInBlock>
        )}
      </Sidebar>

      <Main>
        <MainInner>{children}</MainInner>
      </Main>
    </Shell>
  );
}
