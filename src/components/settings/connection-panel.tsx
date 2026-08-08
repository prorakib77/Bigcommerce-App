'use client';

import { useState } from 'react';
import {
  Panel,
  Form,
  FormGroup,
  Input,
  Button,
  Text,
  Flex,
  Box,
  Badge,
  Modal,
} from '@bigcommerce/big-design';
import { useApiData } from '@/components/shared/use-api-data';
import { apiClient, ApiClientError } from '@/components/shared/api-client';
import { useSession } from '@/components/app-shell/session-context';

interface ConnectionView {
  status: 'NOT_CONFIGURED' | 'CONNECTED' | 'ERROR' | 'DISCONNECTED';
  tenantId: string | null;
  maskedToken: string | null;
  lastVerifiedAt: string | null;
  lastErrorCode: string | null;
}

export function ConnectionPanel(): React.JSX.Element {
  const { isOwner } = useSession();
  const { data, loading, reload } = useApiData<ConnectionView>('/api/v1/kickflip/connection');

  const [tenantId, setTenantId] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  async function handleTest() {
    setBusy(true);
    setTestResult(null);
    try {
      await apiClient.post('/api/v1/kickflip/connection/test', { tenantId, apiToken });
      setTestResult('Connection successful.');
    } catch (err) {
      setTestResult(err instanceof ApiClientError ? err.message : 'Connection test failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    setBusy(true);
    setSaveMessage(null);
    try {
      await apiClient.put('/api/v1/kickflip/connection', { tenantId, apiToken });
      setSaveMessage('Kickflip connection saved.');
      setApiToken('');
      reload();
    } catch (err) {
      setSaveMessage(
        err instanceof ApiClientError ? err.message : 'Could not save the connection.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await apiClient.delete('/api/v1/kickflip/connection');
      setConfirmDisconnect(false);
      reload();
    } catch (err) {
      setSaveMessage(err instanceof ApiClientError ? err.message : 'Could not disconnect.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel header="Kickflip connection">
      {loading && <Text>Loading…</Text>}

      {data && data.status === 'CONNECTED' && (
        <Box marginBottom="medium">
          <Flex alignItems="center">
            <Badge variant="success" label="Connected" />
            <Box marginLeft="small">
              <Text marginBottom="none">
                Tenant: {data.tenantId} · Token: {data.maskedToken}
              </Text>
            </Box>
          </Flex>
          {data.lastVerifiedAt && (
            <Text color="secondary60">
              Last verified: {new Date(data.lastVerifiedAt).toLocaleString()}
            </Text>
          )}
        </Box>
      )}

      {data && data.status !== 'CONNECTED' && (
        <Box marginBottom="medium">
          <Badge
            variant={data.status === 'ERROR' ? 'danger' : 'secondary'}
            label={data.status.replace('_', ' ')}
          />
        </Box>
      )}

      {!isOwner && (
        <Text color="secondary60" marginBottom="medium">
          Only the store owner can change the Kickflip connection.
        </Text>
      )}

      {isOwner && (
        <Form>
          <FormGroup>
            <Input
              label="Tenant ID"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder={data?.tenantId ?? 'example-tenant'}
            />
          </FormGroup>
          <FormGroup>
            <Input
              label="API token"
              type="password"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              placeholder={data?.maskedToken ?? 'Enter a new token to replace the current one'}
            />
          </FormGroup>

          <Flex>
            <Button
              variant="secondary"
              disabled={!tenantId || !apiToken || busy}
              isLoading={busy}
              onClick={handleTest}
              type="button"
            >
              Test connection
            </Button>
            <Box marginLeft="small">
              <Button
                disabled={!tenantId || !apiToken || busy}
                isLoading={busy}
                onClick={handleSave}
                type="button"
              >
                Save
              </Button>
            </Box>
            {data && data.status === 'CONNECTED' && (
              <Box marginLeft="small">
                <Button
                  variant="secondary"
                  actionType="destructive"
                  disabled={busy}
                  onClick={() => setConfirmDisconnect(true)}
                  type="button"
                >
                  Disconnect
                </Button>
              </Box>
            )}
          </Flex>

          {testResult && <Text marginTop="small">{testResult}</Text>}
          {saveMessage && <Text marginTop="small">{saveMessage}</Text>}
        </Form>
      )}

      <Modal
        isOpen={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        header="Disconnect Kickflip?"
        actions={[
          { text: 'Cancel', variant: 'subtle', onClick: () => setConfirmDisconnect(false) },
          {
            text: 'Disconnect',
            actionType: 'destructive',
            onClick: handleDisconnect,
            isLoading: busy,
          },
        ]}
      >
        <Text>
          This clears the stored Kickflip credential and stops new imports until reconnected.
          Previously imported BigCommerce products and import history are not affected.
        </Text>
      </Modal>
    </Panel>
  );
}
