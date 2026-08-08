/**
 * Shared design tokens for the app "chrome" (fixed header + sidebar) and the
 * glass treatment layered on top of BigDesign. Kept as plain constants
 * (not a full theme override) so BigDesign's own components — Panel,
 * Table, Modal, Form controls — keep their default, accessible styling;
 * only the surfaces this app fully owns (header, sidebar, page background)
 * take on the navy/glass look, matching the BigCommerce admin chrome.
 */

// Deep navy palette, sampled from BigCommerce's own admin chrome.
export const NAVY_950 = '#0A1130';
export const NAVY_900 = '#111B42';
export const NAVY_800 = '#1B2A5C';
export const NAVY_700 = '#28387A';

// Glass surfaces: translucent + blurred, always paired with backdrop-filter.
// High opacity (~94%) is deliberate: at the ~70% this started at, the navy
// blended with the light page background behind it and read as washed-out
// slate-gray instead of a dark chrome — verified visually, not just assumed.
// Still technically "glass" (blur + a sliver of translucency + a soft
// highlight border), just dark enough to actually read as navy.
export const GLASS_CHROME_BG =
  'linear-gradient(180deg, rgba(20, 29, 68, 0.96) 0%, rgba(8, 13, 36, 0.96) 100%)';
export const GLASS_CHROME_BORDER = 'rgba(255, 255, 255, 0.08)';
export const GLASS_NAV_ACTIVE_BG = 'rgba(255, 255, 255, 0.12)';
export const GLASS_NAV_HOVER_BG = 'rgba(255, 255, 255, 0.06)';

export const GLASS_CARD_BG = 'rgba(255, 255, 255, 0.72)';
export const GLASS_CARD_BORDER = 'rgba(255, 255, 255, 0.6)';
export const GLASS_CARD_SHADOW = '0 8px 32px rgba(17, 27, 66, 0.08)';

// Page background: a soft, static gradient so translucent glass surfaces
// have something to actually blur — flat white behind glass reads as
// nothing. Fixed (not scrolled) so it stays consistent behind content.
export const PAGE_GRADIENT_BG =
  'radial-gradient(1200px 600px at 8% -10%, #E9EEFF 0%, transparent 55%), ' +
  'radial-gradient(1000px 700px at 100% 0%, #F1F0FF 0%, transparent 50%), ' +
  '#F5F6FB';

export const HEADER_HEIGHT = '3.5rem';
export const SIDEBAR_WIDTH = '15.5rem';

/** Below this, the sidebar becomes an off-canvas drawer instead of a static column. */
export const MOBILE_BREAKPOINT_PX = 960;
export const MOBILE_BREAKPOINT = `${MOBILE_BREAKPOINT_PX}px`;

export const backdropBlur = (px: number): string => `blur(${px}px) saturate(160%)`;
