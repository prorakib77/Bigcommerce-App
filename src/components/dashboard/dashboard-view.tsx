'use client';

import Link from 'next/link';
import {
  Box,
  Flex,
  Grid,
  H1,
  H4,
  Panel,
  Text,
  Badge,
  ProgressCircle,
  Button,
} from '@bigcommerce/big-design';
import { useApiData } from '@/components/shared/use-api-data';

interface DashboardData {
  isActive: boolean;
  kickflipConnected: boolean;
  bigcommerceConnected: boolean;
  importedProductCount: number;
  succeededCount: number;
  partialCount: number;
  failedCount: number;
  recentActivity: Array<{ id: string; action: string; entityType: string; createdAt: string }>;
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'success' | 'warning' | 'danger';
}) {
  return (
    <Panel>
      <Text color="secondary60" marginBottom="xxSmall">
        {label}
      </Text>
      <H4 marginBottom="none">
        <Badge
          variant={
            tone === 'danger'
              ? 'danger'
              : tone === 'warning'
                ? 'warning'
                : tone === 'success'
                  ? 'success'
                  : undefined
          }
          label={String(value)}
        />
      </H4>
    </Panel>
  );
}

export function DashboardView(): React.JSX.Element {
  const { data, loading, error } = useApiData<DashboardData>('/api/v1/dashboard');

  return (
    <Box>
      <H1>Dashboard</H1>

      {loading && (
        <Flex justifyContent="center" padding="xLarge">
          <ProgressCircle size="large" />
        </Flex>
      )}

      {error && (
        <Panel header="Something went wrong">
          <Text>{error}</Text>
        </Panel>
      )}

      {data && (
        <>
          {(!data.kickflipConnected || !data.bigcommerceConnected) && (
            <Panel header="Finish setup">
              <Flex flexDirection="column">
                <Text>{data.bigcommerceConnected ? '✓' : '○'} BigCommerce connected</Text>
                <Text>{data.kickflipConnected ? '✓' : '○'} Kickflip connected</Text>
                {!data.kickflipConnected && (
                  <Box marginTop="small">
                    <Link href="/settings">
                      <Button>Connect Kickflip</Button>
                    </Link>
                  </Box>
                )}
              </Flex>
            </Panel>
          )}

          <Grid
            gridColumns="repeat(auto-fit, minmax(11rem, 1fr))"
            gridGap="1rem"
            marginBottom="medium"
          >
            <StatTile label="Imported products" value={data.importedProductCount} />
            <StatTile label="Successful imports" value={data.succeededCount} tone="success" />
            <StatTile label="Partial imports" value={data.partialCount} tone="warning" />
            <StatTile label="Failed imports" value={data.failedCount} tone="danger" />
          </Grid>

          <Panel header="Recent activity">
            {data.recentActivity.length === 0 ? (
              <Text color="secondary60">No activity yet.</Text>
            ) : (
              <Flex flexDirection="column">
                {data.recentActivity.map((entry) => (
                  <Box key={entry.id} paddingVertical="xSmall" borderBottom="box">
                    <Text marginBottom="none">{entry.action.replace(/_/g, ' ')}</Text>
                    <Text color="secondary60" style={{ fontSize: '0.8rem' }}>
                      {new Date(entry.createdAt).toLocaleString()}
                    </Text>
                  </Box>
                ))}
              </Flex>
            )}
          </Panel>
        </>
      )}
    </Box>
  );
}
