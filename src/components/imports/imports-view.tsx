'use client';

import { useState } from 'react';
import {
  Box,
  Flex,
  H1,
  Button,
  Select,
  Table,
  Text,
  ProgressCircle,
  Panel,
  Modal,
} from '@bigcommerce/big-design';
import { useApiData } from '@/components/shared/use-api-data';
import { apiClient, ApiClientError } from '@/components/shared/api-client';
import { ScrollableTable } from '@/components/shared/scrollable-table';
import type { ImportRunItem } from './types';
import { ImportStatusBadge } from './status-badge';

const STATUS_FILTERS = [
  { value: 'ALL', content: 'All statuses' },
  { value: 'QUEUED', content: 'Queued' },
  { value: 'SUCCEEDED', content: 'Succeeded' },
  { value: 'PARTIAL', content: 'Partial' },
  { value: 'FAILED', content: 'Failed' },
  { value: 'CANCELLED', content: 'Cancelled' },
];

const CANCELLABLE = new Set(['QUEUED']);
const RETRYABLE = new Set(['FAILED', 'PARTIAL']);

export function ImportsView(): React.JSX.Element {
  const [status, setStatus] = useState('ALL');
  const [detail, setDetail] = useState<ImportRunItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const path = `/api/v1/imports${status !== 'ALL' ? `?status=${status}` : ''}`;
  const { data, loading, error, reload } = useApiData<ImportRunItem[]>(path, [status]);

  async function act(id: string, action: 'retry' | 'cancel') {
    setBusyId(id);
    setMessage(null);
    try {
      await apiClient.post(`/api/v1/imports/${id}/${action}`);
      setMessage(action === 'retry' ? 'Retry started.' : 'Import cancelled.');
      reload();
    } catch (err) {
      setMessage(err instanceof ApiClientError ? err.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Box>
      <Flex
        justifyContent="space-between"
        alignItems="center"
        flexWrap="wrap"
        flexGap="0.75rem"
        marginBottom="medium"
      >
        <H1 marginBottom="none">Import history</H1>
        <Flex flexWrap="wrap" flexGap="0.5rem">
          <Select
            options={STATUS_FILTERS}
            value={status}
            onOptionChange={(v) => setStatus(String(v))}
          />
          <Button variant="secondary" onClick={() => reload()} isLoading={loading}>
            Refresh
          </Button>
        </Flex>
      </Flex>

      {message && (
        <Box marginBottom="medium">
          <Text>{message}</Text>
        </Box>
      )}

      {error && (
        <Panel header="Could not load import history">
          <Text>{error}</Text>
        </Panel>
      )}

      {loading && (
        <Flex justifyContent="center" padding="xLarge">
          <ProgressCircle size="large" />
        </Flex>
      )}

      {!loading && data && data.length === 0 && (
        <Panel>
          <Text color="secondary60">No imports yet.</Text>
        </Panel>
      )}

      {!loading && data && data.length > 0 && (
        <ScrollableTable>
          <Table
            columns={[
            {
              header: 'Design',
              hash: 'design',
              render: (item: ImportRunItem) => (
                <Text
                  style={{ cursor: 'pointer' }}
                  onClick={() => setDetail(item)}
                  bold
                  marginBottom="none"
                >
                  {item.kickflipDesignId}
                </Text>
              ),
            },
            {
              header: 'Operation',
              hash: 'operation',
              render: (item: ImportRunItem) => item.operation.replace(/_/g, ' '),
            },
            {
              header: 'Status',
              hash: 'status',
              render: (item: ImportRunItem) => <ImportStatusBadge status={item.status} />,
            },
            {
              header: 'Stage',
              hash: 'stage',
              render: (item: ImportRunItem) => item.currentStage ?? '—',
            },
            {
              header: 'Attempts',
              hash: 'attempts',
              render: (item: ImportRunItem) => item.attemptCount,
            },
            {
              header: 'BC product',
              hash: 'product',
              render: (item: ImportRunItem) => item.bigcommerceProductId ?? '—',
            },
            {
              header: 'Created',
              hash: 'created',
              render: (item: ImportRunItem) => new Date(item.createdAt).toLocaleString(),
            },
            {
              header: 'Actions',
              hash: 'actions',
              render: (item: ImportRunItem) => (
                <Flex>
                  {RETRYABLE.has(item.status) && (
                    <Button
                      variant="secondary"
                      isLoading={busyId === item.id}
                      onClick={() => act(item.id, 'retry')}
                    >
                      Retry
                    </Button>
                  )}
                  {CANCELLABLE.has(item.status) && (
                    <Box marginLeft="xSmall">
                      <Button
                        variant="secondary"
                        actionType="destructive"
                        isLoading={busyId === item.id}
                        onClick={() => act(item.id, 'cancel')}
                      >
                        Cancel
                      </Button>
                    </Box>
                  )}
                </Flex>
              ),
            },
            ]}
            items={data}
            stickyHeader
          />
        </ScrollableTable>
      )}

      <Modal isOpen={detail !== null} onClose={() => setDetail(null)} header="Import details">
        {detail && (
          <Flex flexDirection="column">
            <Text>
              <strong>Design:</strong> {detail.kickflipDesignId}
            </Text>
            <Text>
              <strong>Operation:</strong> {detail.operation}
            </Text>
            <Text>
              <strong>Status:</strong> {detail.status}
            </Text>
            <Text>
              <strong>Stage:</strong> {detail.currentStage ?? '—'}
            </Text>
            <Text>
              <strong>Attempts:</strong> {detail.attemptCount}
            </Text>
            <Text>
              <strong>BigCommerce product:</strong> {detail.bigcommerceProductId ?? '—'}
            </Text>
            {detail.safeErrorMessage && (
              <Text color="danger60">
                <strong>Error:</strong> {detail.safeErrorMessage} ({detail.safeErrorCode})
              </Text>
            )}
            <Text color="secondary60">Correlation ID: {detail.correlationId}</Text>
            <Text color="secondary60">
              Started: {detail.startedAt ? new Date(detail.startedAt).toLocaleString() : '—'}
            </Text>
            <Text color="secondary60">
              Finished: {detail.finishedAt ? new Date(detail.finishedAt).toLocaleString() : '—'}
            </Text>
          </Flex>
        )}
      </Modal>
    </Box>
  );
}
