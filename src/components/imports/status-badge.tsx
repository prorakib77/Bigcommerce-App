'use client';

import { Badge } from '@bigcommerce/big-design';

const VARIANTS: Record<string, 'success' | 'warning' | 'danger' | 'secondary' | undefined> = {
  SUCCEEDED: 'success',
  SKIPPED: 'secondary',
  PARTIAL: 'warning',
  FAILED: 'danger',
  CANCELLED: 'secondary',
  QUEUED: undefined,
};

export function ImportStatusBadge({ status }: { status: string }): React.JSX.Element {
  return <Badge variant={VARIANTS[status]} label={status.replace(/_/g, ' ')} />;
}
