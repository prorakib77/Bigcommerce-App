'use client';

import { useEffect, useState } from 'react';
import {
  Modal,
  Panel,
  Form,
  FormGroup,
  Input,
  Textarea,
  Checkbox,
  Button,
  Text,
  Flex,
  Box,
  ProgressCircle,
} from '@bigcommerce/big-design';
import { useApiData } from '@/components/shared/use-api-data';
import { apiClient, ApiClientError } from '@/components/shared/api-client';
import type { ProductDetail } from './types';

interface BasicForm {
  name: string;
  price: string;
  description: string;
  isVisible: boolean;
}

interface CustomizeForm {
  enabled: boolean;
  customizeUrl: string;
  buttonLabel: string;
}

/**
 * Two independent sections with two independent save actions — they hit two
 * different routes (basic product fields vs. the Customize iframe config)
 * and are logically separable, unlike settings' single combined form.
 */
export function ProductEditDrawer({
  productId,
  onClose,
  onSaved,
}: {
  productId: number | null;
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const { data, loading, error, reload } = useApiData<ProductDetail>(
    productId !== null ? `/api/v1/bigcommerce/products/${productId}` : null,
  );

  const [basicForm, setBasicForm] = useState<BasicForm | null>(null);
  const [customizeForm, setCustomizeForm] = useState<CustomizeForm | null>(null);
  const [basicMessage, setBasicMessage] = useState<string | null>(null);
  const [customizeMessage, setCustomizeMessage] = useState<string | null>(null);
  const [basicBusy, setBasicBusy] = useState(false);
  const [customizeBusy, setCustomizeBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    setBasicForm({
      name: data.product.name,
      price: data.product.price !== undefined ? String(data.product.price) : '',
      description: data.product.description ?? '',
      isVisible: data.product.is_visible ?? false,
    });
    setCustomizeForm({
      enabled: data.customizeConfig?.enabled ?? false,
      customizeUrl: data.customizeConfig?.customizeUrl ?? '',
      buttonLabel: data.customizeConfig?.buttonLabel ?? 'Customize',
    });
    setBasicMessage(null);
    setCustomizeMessage(null);
  }, [data]);

  async function saveBasic(): Promise<void> {
    if (!basicForm || productId === null) return;
    setBasicBusy(true);
    setBasicMessage(null);
    try {
      await apiClient.put(`/api/v1/bigcommerce/products/${productId}`, basicForm);
      setBasicMessage('Details saved.');
      reload();
      onSaved();
    } catch (err) {
      setBasicMessage(err instanceof ApiClientError ? err.message : 'Could not save details.');
    } finally {
      setBasicBusy(false);
    }
  }

  async function saveCustomize(): Promise<void> {
    if (!customizeForm || productId === null) return;
    setCustomizeBusy(true);
    setCustomizeMessage(null);
    try {
      await apiClient.put(`/api/v1/bigcommerce/products/${productId}/customize`, {
        enabled: customizeForm.enabled,
        customizeUrl: customizeForm.customizeUrl.trim() || null,
        buttonLabel: customizeForm.buttonLabel.trim() || 'Customize',
      });
      setCustomizeMessage('Customize settings saved.');
      reload();
      onSaved();
    } catch (err) {
      setCustomizeMessage(
        err instanceof ApiClientError ? err.message : 'Could not save customize settings.',
      );
    } finally {
      setCustomizeBusy(false);
    }
  }

  return (
    <Modal
      isOpen={productId !== null}
      onClose={onClose}
      header={data?.product.name ?? 'Edit product'}
      closeOnEscKey
      closeOnClickOutside
    >
      {loading && (
        <Flex justifyContent="center" padding="large">
          <ProgressCircle size="large" />
        </Flex>
      )}

      {error && (
        <Box marginBottom="medium">
          <Text color="danger60">{error}</Text>
        </Box>
      )}

      {basicForm && (
        <Panel header="Basic details" marginBottom="medium">
          <Form>
            <FormGroup>
              <Input
                label="Name"
                value={basicForm.name}
                onChange={(e) => setBasicForm((p) => (p ? { ...p, name: e.target.value } : p))}
              />
            </FormGroup>
            <FormGroup>
              <Input
                label="Price"
                value={basicForm.price}
                onChange={(e) => setBasicForm((p) => (p ? { ...p, price: e.target.value } : p))}
              />
            </FormGroup>
            <FormGroup>
              <Textarea
                label="Description"
                rows={4}
                value={basicForm.description}
                onChange={(e) =>
                  setBasicForm((p) => (p ? { ...p, description: e.target.value } : p))
                }
              />
            </FormGroup>
            <FormGroup>
              <Checkbox
                label="Visible on storefront"
                checked={basicForm.isVisible}
                onChange={(e) =>
                  setBasicForm((p) => (p ? { ...p, isVisible: e.target.checked } : p))
                }
              />
            </FormGroup>
          </Form>
          <Flex>
            <Button isLoading={basicBusy} onClick={saveBasic}>
              Save details
            </Button>
          </Flex>
          {basicMessage && (
            <Box marginTop="small">
              <Text marginBottom="none">{basicMessage}</Text>
            </Box>
          )}
        </Panel>
      )}

      {customizeForm && (
        <Panel header="Customize (storefront iframe)">
          <Text color="secondary60" marginBottom="medium">
            When enabled, a Customize button appears under Add to Cart on this product&apos;s
            storefront page and opens the URL below in an overlay.
          </Text>
          <Form>
            <FormGroup>
              <Checkbox
                label="Show a Customize button on the storefront for this product"
                checked={customizeForm.enabled}
                onChange={(e) =>
                  setCustomizeForm((p) => (p ? { ...p, enabled: e.target.checked } : p))
                }
              />
            </FormGroup>
            <FormGroup>
              <Input
                label="Customize URL (iframe target, https only)"
                placeholder="https://…"
                value={customizeForm.customizeUrl}
                onChange={(e) =>
                  setCustomizeForm((p) => (p ? { ...p, customizeUrl: e.target.value } : p))
                }
              />
              {data?.suggestedCustomizeUrl && data.suggestedCustomizeUrl !== customizeForm.customizeUrl && (
                <Box marginTop="xSmall">
                  <Text
                    color="primary"
                    marginBottom="none"
                    style={{ cursor: 'pointer', fontSize: '0.85rem' }}
                    onClick={() => {
                      const suggested = data.suggestedCustomizeUrl;
                      if (!suggested) return;
                      setCustomizeForm((p) => (p ? { ...p, customizeUrl: suggested } : p));
                    }}
                  >
                    Use Kickflip&apos;s suggested URL: {data.suggestedCustomizeUrl}
                  </Text>
                </Box>
              )}
            </FormGroup>
            <FormGroup>
              <Input
                label="Button label"
                value={customizeForm.buttonLabel}
                onChange={(e) =>
                  setCustomizeForm((p) => (p ? { ...p, buttonLabel: e.target.value } : p))
                }
              />
            </FormGroup>
          </Form>
          <Flex>
            <Button isLoading={customizeBusy} onClick={saveCustomize}>
              Save customize settings
            </Button>
          </Flex>
          {customizeMessage && (
            <Box marginTop="small">
              <Text marginBottom="none">{customizeMessage}</Text>
            </Box>
          )}
        </Panel>
      )}
    </Modal>
  );
}
