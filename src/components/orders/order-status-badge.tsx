'use client';

import { Badge } from '@bigcommerce/big-design';

const DANGER_KEYWORDS = ['cancelled', 'declined', 'refunded'];
const SUCCESS_KEYWORDS = ['completed', 'shipped'];
const WARNING_KEYWORDS = ['awaiting', 'pending', 'disputed', 'manual verification'];

function variantFor(status: string): 'success' | 'warning' | 'danger' | undefined {
  const lower = status.toLowerCase();
  if (DANGER_KEYWORDS.some((keyword) => lower.includes(keyword))) return 'danger';
  if (SUCCESS_KEYWORDS.some((keyword) => lower.includes(keyword))) return 'success';
  if (WARNING_KEYWORDS.some((keyword) => lower.includes(keyword))) return 'warning';
  return undefined;
}

/** BigCommerce order statuses are arbitrary strings, not a fixed enum this app controls — colored by keyword match, not exact value. */
export function OrderStatusBadge({ status }: { status: string }): React.JSX.Element {
  return <Badge variant={variantFor(status)} label={status} />;
}
