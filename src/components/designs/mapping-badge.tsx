'use client';

import { Badge } from '@bigcommerce/big-design';
import type { DesignListItem } from './types';

const LABELS: Record<
  DesignListItem['mapping']['status'],
  { label: string; variant?: 'success' | 'warning' | 'danger' | 'secondary' }
> = {
  NONE: { label: 'Not imported' },
  UP_TO_DATE: { label: 'Imported', variant: 'success' },
  CHANGED: { label: 'Changed since import', variant: 'warning' },
  ORPHANED: { label: 'Product missing', variant: 'danger' },
};

export function MappingBadge({
  status,
}: {
  status: DesignListItem['mapping']['status'];
}): React.JSX.Element {
  const config = LABELS[status];
  return <Badge variant={config.variant} label={config.label} />;
}
