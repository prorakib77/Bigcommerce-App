'use client';

import { useEffect, useState } from 'react';
import {
  Panel,
  Form,
  FormGroup,
  Input,
  Select,
  Checkbox,
  Button,
  Text,
  Flex,
  Box,
} from '@bigcommerce/big-design';
import { useApiData } from '@/components/shared/use-api-data';
import { apiClient, ApiClientError } from '@/components/shared/api-client';
import { useSession } from '@/components/app-shell/session-context';

interface StoreSettingsView {
  defaultCategoryIds: number[];
  defaultProductWeight: string;
  skuPrefix: string;
  defaultVisibility: boolean;
  importImages: boolean;
  updateImagesOnReimport: boolean;
  updateNameOnReimport: boolean;
  updatePriceOnReimport: boolean;
  updateDescriptionOnReimport: boolean;
  maxImagesPerDesign: number;
}

interface Category {
  id: number;
  name: string;
}

export function DefaultsPanel(): React.JSX.Element {
  const { isOwner } = useSession();
  const { data, loading, reload } = useApiData<StoreSettingsView>('/api/v1/settings');
  const { data: categories } = useApiData<Category[]>('/api/v1/bigcommerce/categories');

  const [form, setForm] = useState<StoreSettingsView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  async function save() {
    if (!form) return;
    setBusy(true);
    setMessage(null);
    try {
      await apiClient.put('/api/v1/settings', {
        ...form,
        defaultProductWeight: Number(form.defaultProductWeight),
      });
      setMessage('Settings saved.');
      reload();
    } catch (err) {
      setMessage(err instanceof ApiClientError ? err.message : 'Could not save settings.');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !form) {
    return (
      <Panel header="Import defaults">
        <Text>Loading…</Text>
      </Panel>
    );
  }

  const toggle = (key: keyof StoreSettingsView) => (checked: boolean) =>
    setForm((prev) => (prev ? { ...prev, [key]: checked } : prev));

  return (
    <Panel header="Import defaults">
      {!isOwner && (
        <Text color="secondary60" marginBottom="medium">
          Only the store owner can change import defaults.
        </Text>
      )}
      <Form>
        <FormGroup>
          <Select
            label="Default category"
            placeholder="No default category"
            options={(categories ?? []).map((c) => ({ value: c.id, content: c.name }))}
            value={form.defaultCategoryIds[0]}
            onOptionChange={(value) =>
              setForm((p) => (p ? { ...p, defaultCategoryIds: value ? [Number(value)] : [] } : p))
            }
            disabled={!isOwner}
          />
        </FormGroup>
        <FormGroup>
          <Input
            label="Default weight"
            type="number"
            value={form.defaultProductWeight}
            onChange={(e) =>
              setForm((p) => (p ? { ...p, defaultProductWeight: e.target.value } : p))
            }
            disabled={!isOwner}
          />
        </FormGroup>
        <FormGroup>
          <Input
            label="SKU prefix"
            value={form.skuPrefix}
            onChange={(e) => setForm((p) => (p ? { ...p, skuPrefix: e.target.value } : p))}
            disabled={!isOwner}
          />
        </FormGroup>
        <FormGroup>
          <Input
            label="Maximum images per design"
            type="number"
            value={form.maxImagesPerDesign}
            onChange={(e) =>
              setForm((p) => (p ? { ...p, maxImagesPerDesign: Number(e.target.value) } : p))
            }
            disabled={!isOwner}
          />
        </FormGroup>

        <FormGroup>
          <Checkbox
            label="Publish imported products immediately (otherwise kept hidden for review)"
            checked={form.defaultVisibility}
            onChange={(e) => toggle('defaultVisibility')(e.target.checked)}
            disabled={!isOwner}
          />
          <Checkbox
            label="Import images"
            checked={form.importImages}
            onChange={(e) => toggle('importImages')(e.target.checked)}
            disabled={!isOwner}
          />
          <Checkbox
            label="Update images on re-import"
            checked={form.updateImagesOnReimport}
            onChange={(e) => toggle('updateImagesOnReimport')(e.target.checked)}
            disabled={!isOwner}
          />
          <Checkbox
            label="Update name on re-import"
            checked={form.updateNameOnReimport}
            onChange={(e) => toggle('updateNameOnReimport')(e.target.checked)}
            disabled={!isOwner}
          />
          <Checkbox
            label="Update price on re-import"
            checked={form.updatePriceOnReimport}
            onChange={(e) => toggle('updatePriceOnReimport')(e.target.checked)}
            disabled={!isOwner}
          />
          <Checkbox
            label="Update description on re-import"
            checked={form.updateDescriptionOnReimport}
            onChange={(e) => toggle('updateDescriptionOnReimport')(e.target.checked)}
            disabled={!isOwner}
          />
        </FormGroup>
      </Form>

      {isOwner && (
        <Flex>
          <Button isLoading={busy} onClick={save}>
            Save settings
          </Button>
        </Flex>
      )}
      {message && (
        <Box marginTop="small">
          <Text>{message}</Text>
        </Box>
      )}
    </Panel>
  );
}
