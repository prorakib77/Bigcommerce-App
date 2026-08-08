'use client';

import { Modal, Panel, Text, Flex, Box, H4 } from '@bigcommerce/big-design';
import type { DesignListItem } from './types';
import { MappingBadge } from './mapping-badge';

export function PreviewModal({
  item,
  onClose,
}: {
  item: DesignListItem | null;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <Modal
      isOpen={item !== null}
      onClose={onClose}
      header={item?.design.name ?? ''}
      closeOnEscKey
      closeOnClickOutside
    >
      {item && (
        <Flex flexDirection="column">
          <Box marginBottom="medium">
            <MappingBadge status={item.mapping.status} />
          </Box>

          {item.design.imageUrls.length > 0 && (
            <Flex marginBottom="medium" flexWrap="wrap">
              {item.design.imageUrls.slice(0, 6).map((url) => (
                // Preview only — sourced from the authenticated Kickflip API response, not user input.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={url}
                  src={url}
                  alt=""
                  width={96}
                  height={96}
                  style={{ objectFit: 'cover', borderRadius: 4, marginRight: 8, marginBottom: 8 }}
                />
              ))}
            </Flex>
          )}

          <Text bold marginBottom="none">
            {item.design.price} {item.design.currencyCode ?? ''}
          </Text>
          <Text color="secondary60" marginBottom="medium">
            Design ID: {item.design.externalId}
          </Text>

          <Panel header="Customization summary">
            {item.design.summary.length === 0 ? (
              <Text color="secondary60">No summary provided.</Text>
            ) : (
              <Flex flexDirection="column">
                {item.design.summary.map((row) => (
                  <Text key={row.label} marginBottom="xxSmall">
                    <strong>{row.label}:</strong> {row.value}
                  </Text>
                ))}
              </Flex>
            )}
          </Panel>

          {item.mapping.bigcommerceProductId && (
            <Box marginTop="medium">
              <H4>Existing mapping</H4>
              <Text>BigCommerce product ID: {item.mapping.bigcommerceProductId}</Text>
              {item.mapping.lastSuccessfulImportAt && (
                <Text color="secondary60">
                  Last imported: {new Date(item.mapping.lastSuccessfulImportAt).toLocaleString()}
                </Text>
              )}
            </Box>
          )}
        </Flex>
      )}
    </Modal>
  );
}
