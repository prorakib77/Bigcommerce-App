import { RequireSession } from '@/components/shared/require-session';
import { ImportsView } from '@/components/imports/imports-view';

export default function ImportsPage(): React.JSX.Element {
  return (
    <RequireSession>
      <ImportsView />
    </RequireSession>
  );
}
