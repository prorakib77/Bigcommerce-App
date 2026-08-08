import { RequireSession } from '@/components/shared/require-session';
import { SettingsView } from '@/components/settings/settings-view';

export default function SettingsPage(): React.JSX.Element {
  return (
    <RequireSession>
      <SettingsView />
    </RequireSession>
  );
}
