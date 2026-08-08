'use client';

import { useState } from 'react';
import {
  Box,
  Flex,
  H1,
  Badge,
  Button,
  Input,
  Select,
  Table,
  Text,
  ProgressCircle,
  Panel,
} from '@bigcommerce/big-design';
import { ScrollableTable } from '@/components/shared/scrollable-table';
import type { ProductListItem } from './types';
import { useProductsPage } from './use-products-page';
import { ProductEditDrawer } from './product-edit-drawer';

const PAGE_SIZES = [10, 20, 50];

export function ProductsView(): React.JSX.Element {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState('');
  const [editingProductId, setEditingProductId] = useState<number | null>(null);

  const { items, currentPage, totalPages, loading, error, reload } = useProductsPage(
    page,
    limit,
    search,
  );

  return (
    <Box>
      <Flex
        justifyContent="space-between"
        alignItems="center"
        flexWrap="wrap"
        flexGap="0.75rem"
        marginBottom="medium"
      >
        <H1 marginBottom="none">Products</H1>
        <Button variant="secondary" onClick={() => reload()} isLoading={loading}>
          Refresh
        </Button>
      </Flex>

      <Flex marginBottom="medium" alignItems="center" flexWrap="wrap" flexGap="0.5rem">
        <Box style={{ flexGrow: 1, flexBasis: '14rem' }}>
          <Input
            placeholder="Search products by name or SKU"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </Box>
        <Select
          options={PAGE_SIZES.map((size) => ({ value: size, content: `${size} / page` }))}
          value={limit}
          onOptionChange={(value) => {
            setLimit(Number(value));
            setPage(1);
          }}
        />
      </Flex>

      {error && (
        <Panel header="Could not load products">
          <Text>{error}</Text>
        </Panel>
      )}

      {loading && (
        <Flex justifyContent="center" padding="xLarge">
          <ProgressCircle size="large" />
        </Flex>
      )}

      {!loading && items.length === 0 && !error && (
        <Panel>
          <Text color="secondary60">No products found.</Text>
        </Panel>
      )}

      {!loading && items.length > 0 && (
        <ScrollableTable>
        <Table
          columns={[
            {
              header: '',
              hash: 'thumbnail',
              render: (item: ProductListItem) => {
                const thumbnail =
                  item.product.images?.find((image) => image.is_thumbnail) ??
                  item.product.images?.[0];
                return thumbnail?.image_url ? (
                  // Product thumbnails come from BigCommerce's own catalog API, not user input.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumbnail.image_url}
                    alt=""
                    width={40}
                    height={40}
                    style={{ objectFit: 'cover', borderRadius: 4 }}
                  />
                ) : (
                  <Box style={{ width: 40, height: 40, borderRadius: 4, background: '#f0f1f2' }} />
                );
              },
            },
            {
              header: 'Product',
              hash: 'name',
              render: (item: ProductListItem) => (
                <Box>
                  <Text
                    bold
                    marginBottom="none"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setEditingProductId(item.product.id)}
                  >
                    {item.product.name}
                  </Text>
                  {item.product.sku && (
                    <Text color="secondary60" style={{ fontSize: '0.8rem' }}>
                      {item.product.sku}
                    </Text>
                  )}
                </Box>
              ),
            },
            {
              header: 'Price',
              hash: 'price',
              render: (item: ProductListItem) => (item.product.price ? `$${item.product.price}` : '—'),
            },
            {
              header: 'Visibility',
              hash: 'visibility',
              render: (item: ProductListItem) =>
                item.product.is_visible ? (
                  <Badge variant="success" label="Visible" />
                ) : (
                  <Badge label="Hidden" />
                ),
            },
            {
              header: 'Customize',
              hash: 'customize',
              render: (item: ProductListItem) =>
                item.hasCustomizeConfig ? (
                  <Badge variant="success" label="Configured" />
                ) : (
                  <Badge label="Not configured" />
                ),
            },
            {
              header: 'Actions',
              hash: 'actions',
              render: (item: ProductListItem) => (
                <Button variant="secondary" onClick={() => setEditingProductId(item.product.id)}>
                  Edit
                </Button>
              ),
            },
          ]}
          items={items}
          stickyHeader
        />
        </ScrollableTable>
      )}

      <Flex
        justifyContent="flex-end"
        alignItems="center"
        flexWrap="wrap"
        flexGap="0.5rem"
        marginTop="medium"
      >
        <Text color="secondary60" marginRight="small" marginBottom="none">
          Page {currentPage} of {totalPages}
        </Text>
        <Button
          variant="secondary"
          disabled={currentPage <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          disabled={currentPage >= totalPages}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </Flex>

      <ProductEditDrawer
        productId={editingProductId}
        onClose={() => setEditingProductId(null)}
        onSaved={() => reload()}
      />
    </Box>
  );
}
