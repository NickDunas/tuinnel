import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Select, StatusMessage, TextInput } from '@inkjs/ui';
import { Modal } from './Modal.js';
import { suggestSubdomain } from '../config/port-map.js';
import { validatePort, validateSubdomain } from '../utils/validation.js';

export interface AddWizardProps {
  defaultZone: string;
  zones: Array<{ id: string; name: string }>;
  onSubmit: (config: { port: number; subdomain: string; zone: string }) => void;
  onCancel: () => void;
}

type Step = 'port' | 'subdomain' | 'zone';

export function AddWizard({ defaultZone, zones, onSubmit, onCancel }: AddWizardProps) {
  const [step, setStep] = useState<Step>('port');
  const [port, setPort] = useState('');
  const [portError, setPortError] = useState<string | null>(null);
  const [subdomain, setSubdomain] = useState('');

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
  });

  function handlePortSubmit(value: string) {
    const num = validatePort(value, false);
    if (num === null) {
      setPortError('Port must be 1-65535');
      return;
    }
    setPortError(null);
    setPort(value);
    // Suggest subdomain based on port
    const suggestion = suggestSubdomain(num, process.cwd());
    setSubdomain(suggestion);
    setStep('subdomain');
  }

  function handleSubdomainSubmit(value: string) {
    if (!value.trim()) return;
    const normalized = validateSubdomain(value, false);
    if (normalized === null) return;
    setSubdomain(normalized);
    // Skip zone selection if only one zone
    if (zones.length <= 1) {
      onSubmit({
        port: parseInt(port, 10),
        subdomain: normalized,
        zone: zones.length === 1 ? zones[0].name : defaultZone,
      });
    } else {
      setStep('zone');
    }
  }

  const stepNumber = step === 'port' ? 1 : step === 'subdomain' ? 2 : 3;
  const totalSteps = zones.length <= 1 ? 2 : 3;

  return (
    <Modal title="Add Tunnel" visible>
      <Box marginBottom={1}>
        <Text dimColor>Step {stepNumber} of {totalSteps}</Text>
      </Box>

      {step === 'port' && (
        <Box flexDirection="column">
          <Text bold>Local port number:</Text>
          <Box marginTop={1}>
            <Text color="cyan">&gt; </Text>
            <TextInput
              defaultValue={port}
              placeholder="e.g. 3000"
              onSubmit={handlePortSubmit}
            />
          </Box>
          {portError && (
            <Box marginTop={1}>
              <StatusMessage variant="error">{portError}</StatusMessage>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>Enter port, Esc to cancel</Text>
          </Box>
        </Box>
      )}

      {step === 'subdomain' && (
        <Box flexDirection="column">
          <Text bold>Subdomain:</Text>
          <Box marginTop={1}>
            <Text color="cyan">&gt; </Text>
            <TextInput
              defaultValue={subdomain}
              placeholder="my-app"
              onSubmit={handleSubdomainSubmit}
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Enter subdomain, Esc to cancel</Text>
          </Box>
        </Box>
      )}

      {step === 'zone' && (
        <Box flexDirection="column">
          <Text bold>Select zone:</Text>
          <Box marginTop={1}>
            <Select
              options={zones.map(z => ({ label: z.name, value: z.name }))}
              defaultValue={defaultZone}
              onChange={(value) => {
                onSubmit({
                  port: parseInt(port, 10),
                  subdomain,
                  zone: value,
                });
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
