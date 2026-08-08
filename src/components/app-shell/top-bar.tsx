'use client';

import styled from 'styled-components';
import { MenuIcon, CloseIcon } from '@bigcommerce/big-design-icons';
import { GLASS_CHROME_BG, GLASS_CHROME_BORDER, HEADER_HEIGHT, MOBILE_BREAKPOINT, backdropBlur } from './chrome';

const Header = styled.header`
  box-sizing: border-box;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: ${HEADER_HEIGHT};
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0 1rem;
  background: ${GLASS_CHROME_BG};
  backdrop-filter: ${backdropBlur(20)};
  -webkit-backdrop-filter: ${backdropBlur(20)};
  border-bottom: 1px solid ${GLASS_CHROME_BORDER};
`;

const NavToggleButton = styled.button`
  box-sizing: border-box;
  display: none;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  @media (max-width: ${MOBILE_BREAKPOINT}) {
    display: flex;
  }
`;

const AppMark = styled.div`
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 8px;
  background: linear-gradient(135deg, #6c8cff 0%, #3c64f4 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(60, 100, 244, 0.5);
`;

const AppName = styled.span`
  color: #fff;
  font-weight: 600;
  font-size: 0.95rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const MockBadge = styled.span`
  margin-left: auto;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  background: rgba(255, 191, 0, 0.18);
  border: 1px solid rgba(255, 191, 0, 0.4);
  color: #ffd666;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  white-space: nowrap;
`;

export function TopBar({
  mockMode,
  sidebarOpen,
  onToggleSidebar,
}: {
  mockMode: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}): React.JSX.Element {
  return (
    <Header>
      <NavToggleButton
        type="button"
        onClick={onToggleSidebar}
        aria-label={sidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={sidebarOpen}
      >
        {sidebarOpen ? <CloseIcon color="white" /> : <MenuIcon color="white" />}
      </NavToggleButton>

      <AppMark aria-hidden="true">
        <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.85rem' }}>K</span>
      </AppMark>

      <AppName>Kickflip Import</AppName>

      {mockMode && (
        <MockBadge title="Data shown is fixture data, not live Kickflip/BigCommerce data.">
          Mock mode
        </MockBadge>
      )}
    </Header>
  );
}
