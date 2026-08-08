import { RequireSession } from '@/components/shared/require-session';
import { DesignsView } from '@/components/designs/designs-view';

export default function DesignsPage(): React.JSX.Element {
  return (
    <RequireSession>
      <DesignsView />
    </RequireSession>
  );
}
