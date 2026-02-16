import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Spinner, Select, PasswordInput, StatusMessage } from '@inkjs/ui';
import { Modal } from './Modal.js';
import { color } from './use-color.js';
import { validateToken } from '../cloudflare/api.js';

export interface OnboardingWizardProps {
  onComplete: (config: { apiToken: string; defaultZone: string; accountId: string }) => void;
  onCancel: () => void;
}

type Step = 'token' | 'validating' | 'zone';

interface ZoneInfo {
  id: string;
  name: string;
  accountId: string;
}

export function OnboardingWizard({ onComplete, onCancel }: OnboardingWizardProps) {
  const [step, setStep] = useState<Step>('token');
  const [token, setToken] = useState('');
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [zones, setZones] = useState<ZoneInfo[]>([]);

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  async function handleTokenSubmit(value: string) {
    if (!value.trim()) {
      setTokenError('API token is required');
      return;
    }

    setToken(value);
    setTokenError(null);
    setStep('validating');

    const result = await validateToken(value);

    if (!result.valid) {
      setTokenError(result.error ?? 'Invalid token');
      setStep('token');
      return;
    }

    if (result.zones.length === 0) {
      setTokenError('No zones found. Ensure your token has Zone:Read permission.');
      setStep('token');
      return;
    }

    const zoneInfos: ZoneInfo[] = result.zones.map(z => ({
      id: z.id,
      name: z.name,
      accountId: z.account.id,
    }));
    setZones(zoneInfos);

    if (zoneInfos.length === 1) {
      // Auto-select single zone
      onComplete({
        apiToken: value,
        defaultZone: zoneInfos[0].name,
        accountId: zoneInfos[0].accountId,
      });
    } else {
      setStep('zone');
    }
  }

  const stepNumber = step === 'zone' ? 2 : 1;
  const totalSteps = 2;

  return (
    <Modal title="Setup" visible>
      <Box marginBottom={1}>
        <Text dimColor>Step {stepNumber} of {totalSteps}</Text>
      </Box>

      {step === 'token' && (
        <Box flexDirection="column">
          <Text bold>Cloudflare API Token:</Text>
          <Box marginTop={1}>
            <Text dimColor>Create a token at </Text>
            <Text color={color('cyan')}>dash.cloudflare.com/profile/api-tokens</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Required permissions: Zone:Read, DNS:Edit, Cloudflare Tunnel:Edit</Text>
          </Box>
          <Box marginTop={1}>
            <PasswordInput placeholder="paste token here" onSubmit={handleTokenSubmit} />
          </Box>
          {tokenError && (
            <Box marginTop={1}>
              <StatusMessage variant="error">{tokenError}</StatusMessage>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>Enter to validate, Esc to cancel</Text>
          </Box>
        </Box>
      )}

      {step === 'validating' && (
        <Box flexDirection="column" alignItems="center" marginTop={2}>
          <Box>
            <Spinner label="Validating token..." />
          </Box>
        </Box>
      )}

      {step === 'zone' && (
        <Box flexDirection="column">
          <Text bold>Select your default zone:</Text>
          <Box marginTop={1}>
            <Select
              options={zones.map(z => ({ label: z.name, value: z.name }))}
              onChange={(value) => {
                const zone = zones.find(z => z.name === value);
                if (zone) onComplete({ apiToken: token, defaultZone: zone.name, accountId: zone.accountId });
              }}
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Up/Down to select, Enter to confirm, Esc to cancel</Text>
          </Box>
        </Box>
      )}
    </Modal>
  );
}
