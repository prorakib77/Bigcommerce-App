'use client';

import { useMemo, useState } from 'react';
import {
  Box,
  Flex,
  H1,
  Button,
  Checkbox,
  Input,
  Select,
  Table,
  Text,
  ProgressCircle,
  Panel,
  Message,
} from '@bigcommerce/big-design';
import { apiClient, ApiClientError } from '@/components/shared/api-client';
import { ScrollableTable } from '@/components/shared/scrollable-table';
import type { DesignListItem } from './types';
import { MappingBadge } from './mapping-badge';
import { PreviewModal } from './preview-modal';
import { useDesignsPage } from './use-designs-page';

const PAGE_SIZES = [10, 20, 50];

export function DesignsView(): React.JSX.Element {
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null]);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewItem, setPreviewItem] = useState<DesignListItem | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cursor = cursorStack[cursorStack.length - 1] ?? null;
  const { items, nextCursor, loading, error, reload } = useDesignsPage(cursor, limit);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const term = search.trim().toLowerCase();
    return items.filter(
      (item) =>
        item.design.name.toLowerCase().includes(term) ||
        item.design.externalId.toLowerCase().includes(term),
    );
  }, [items, search]);

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  async function runImport(designIds: string[], recreate = false) {
    setBusy(true);
    setActionMessage(null);
    try {
      await apiClient.post('/api/v1/imports', { kickflipDesignIds: designIds, recreate });
      setActionMessage(
        designIds.length === 1 ? 'Import started.' : `${designIds.length} imports started.`,
      );
      setSelected(new Set());
      reload();
    } catch (err) {
      setActionMessage(err instanceof ApiClientError ? err.message : 'Could not start the import.');
    } finally {
      setBusy(false);
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
        <H1 marginBottom="none">Designs</H1>
        <Button variant="secondary" onClick={() => reload()} isLoading={loading}>
          Refresh
        </Button>
      </Flex>

      <Flex marginBottom="medium" alignItems="center" flexWrap="wrap" flexGap="0.5rem">
        <Box style={{ flexGrow: 1, flexBasis: '14rem' }}>
          <Input
            placeholder="Search loaded designs by name or ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Box>
        <Select
          options={PAGE_SIZES.map((size) => ({ value: size, content: `${size} / page` }))}
          value={limit}
          onOptionChange={(value) => {
            setLimit(Number(value));
            setCursorStack([null]);
          }}
        />
        <Button
          disabled={selected.size === 0 || busy}
          isLoading={busy}
          onClick={() => runImport(Array.from(selected))}
        >
          Import selected ({selected.size})
        </Button>
      </Flex>

      {actionMessage && (
        <Box marginBottom="medium">
          <Message messages={[{ text: actionMessage }]} />
        </Box>
      )}

      {error && (
        <Panel header="Could not load designs">
          <Text>{error}</Text>
        </Panel>
      )}

      {loading && (
        <Flex justifyContent="center" padding="xLarge">
          <ProgressCircle size="large" />
        </Flex>
      )}

      {!loading && filtered.length === 0 && !error && (
        <Panel>
          <Text color="secondary60">No designs found.</Text>
        </Panel>
      )}

      {!loading && filtered.length > 0 && (
        <ScrollableTable>
        <Table
          columns={[
            {
              header: '',
              hash: 'select',
              render: (item: DesignListItem) => (
                <Checkbox
                  checked={selected.has(item.design.externalId)}
                  onChange={() => toggleSelected(item.design.externalId)}
                  label=""
                />
              ),
            },
            {
              header: 'Design',
              hash: 'name',
              render: (item: DesignListItem) => (
                <Box>
                  <Text
                    bold
                    marginBottom="none"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setPreviewItem(item)}
                  >
                    {item.design.name}
                  </Text>
                  <Text color="secondary60" style={{ fontSize: '0.8rem' }}>
                    {item.design.externalId}
                  </Text>
                </Box>
              ),
            },
            {
              header: 'Price',
              hash: 'price',
              render: (item: DesignListItem) =>
                `${item.design.price} ${item.design.currencyCode ?? ''}`,
            },
            {
              header: 'Updated',
              hash: 'updated',
              render: (item: DesignListItem) =>
                item.design.updatedAt ? new Date(item.design.updatedAt).toLocaleDateString() : '—',
            },
            {
              header: 'Status',
              hash: 'status',
              render: (item: DesignListItem) => <MappingBadge status={item.mapping.status} />,
            },
            {
              header: 'Actions',
              hash: 'actions',
              render: (item: DesignListItem) =>
                item.mapping.status === 'ORPHANED' ? (
                  <Button
                    variant="secondary"
                    onClick={() => runImport([item.design.externalId], true)}
                    disabled={busy}
                  >
                    Recreate product
                  </Button>
                ) : (
                  <Button
                    variant={item.mapping.status === 'CHANGED' ? 'primary' : 'secondary'}
                    onClick={() => runImport([item.design.externalId])}
                    disabled={busy}
                  >
                    {item.mapping.status === 'NONE'
                      ? 'Import'
                      : item.mapping.status === 'CHANGED'
                        ? 'Update'
                        : 'Re-import'}
                  </Button>
                ),
            },
          ]}
          items={filtered}
          stickyHeader
        />
        </ScrollableTable>
      )}

      <Flex justifyContent="flex-end" marginTop="medium">
        <Button
          variant="secondary"
          disabled={cursorStack.length <= 1}
          onClick={() => setCursorStack((stack) => stack.slice(0, -1))}
        >
          Previous
        </Button>
        <Box marginLeft="small">
          <Button
            variant="secondary"
            disabled={!nextCursor}
            onClick={() => setCursorStack((stack) => [...stack, nextCursor])}
          >
            Next
          </Button>
        </Box>
      </Flex>

      <PreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
    </Box>
  );
}
