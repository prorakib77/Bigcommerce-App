import { RequireSession } from '@/components/shared/require-session';
import { DashboardView } from '@/components/dashboard/dashboard-view';

export default function DashboardPage(): React.JSX.Element {
  return (
    <RequireSession>
      <DashboardView />
    </RequireSession>
  );
}
