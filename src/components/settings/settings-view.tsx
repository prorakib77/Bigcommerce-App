'use client';

import { Box, H1 } from '@bigcommerce/big-design';
import { ConnectionPanel } from './connection-panel';
import { DefaultsPanel } from './defaults-panel';

export function SettingsView(): React.JSX.Element {
  return (
    <Box>
      <H1>Settings</H1>
      <Box marginBottom="medium">
        <ConnectionPanel />
      </Box>
      <DefaultsPanel />
    </Box>
  );
}
