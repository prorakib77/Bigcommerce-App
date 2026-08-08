'use client';

import type { ReactNode } from 'react';
import { Box, Flex, H3, Text, ProgressCircle } from '@bigcommerce/big-design';
import { useSession } from '@/components/app-shell/session-context';

export function RequireSession({ children }: { children: ReactNode }): React.JSX.Element {
  const session = useSession();

  if (session.status === 'loading') {
    return (
      <Flex justifyContent="center" alignItems="center" style={{ minHeight: '20rem' }}>
        <ProgressCircle size="large" />
      </Flex>
    );
  }

  if (session.status !== 'ready') {
    return (
      <Box
        padding="xxLarge"
        style={{ maxWidth: '32rem', margin: '4rem auto', textAlign: 'center' }}
      >
        <H3>Open this app from BigCommerce</H3>
        <Text color="secondary60">
          {session.errorMessage ?? 'Please open this app from your BigCommerce control panel.'}
        </Text>
      </Box>
    );
  }

  return <>{children}</>;
}
