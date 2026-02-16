import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Select, StatusMessage, TextInput } from '@inkjs/ui';
import { Modal } from './Modal.js';

export interface EditFormProps {
  tunnel: { name: string; port: number; subdomain: string; zone: string };
  zones: Array<{ id: string; name: string }>;
  onSubmit: (changes: { port: number; subdomain: string; zone: string }) => void;
  onCancel: () => void;
}

type Field = 'port' | 'subdomain' | 'zone';
const FIELDS: Field[] = ['port', 'subdomain', 'zone'];

export function EditForm({ tunnel, zones, onSubmit, onCancel }: EditFormProps) {
  const [activeField, setActiveField] = useState<Field>('port');
  const [port, setPort] = useState(String(tunnel.port));
  const [subdomain, setSubdomain] = useState(tunnel.subdomain);
  const [zoneIndex, setZoneIndex] = useState(() => {
    const idx = zones.findIndex(z => z.name === tunnel.zone);
    return idx >= 0 ? idx : 0;
  });
  const [error, setError] = useState<string | null>(null);

  const activeIndex = FIELDS.indexOf(activeField);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.tab) {
      const next = (activeIndex + 1) % FIELDS.length;
      setActiveField(FIELDS[next]);
      setError(null);
      return;
    }

  });

  function submitForm() {
    const num = parseInt(port, 10);
    if (isNaN(num) || num < 1 || num > 65535) {
      setActiveField('port');
      setError('Port must be 1-65535');
      return;
    }
    if (!subdomain.trim()) {
      setActiveField('subdomain');
      setError('Subdomain is required');
      return;
    }
    setError(null);
    onSubmit({
      port: num,
      subdomain: subdomain.trim(),
      zone: zones[zoneIndex]?.name ?? tunnel.zone,
    });
  }

  function handlePortSubmit(value: string) {
    setPort(value);
    setActiveField('subdomain');
  }

  function handleSubdomainSubmit(value: string) {
    setSubdomain(value);
    if (zones.length <= 1) {
      // Auto-submit since zone can't change
      const num = parseInt(port, 10);
      if (isNaN(num) || num < 1 || num > 65535) {
        setActiveField('port');
        setError('Port must be 1-65535');
        return;
      }
      if (!value.trim()) {
        setError('Subdomain is required');
        return;
      }
      onSubmit({
        port: num,
        subdomain: value.trim(),
        zone: zones.length === 1 ? zones[0].name : tunnel.zone,
      });
    } else {
      setActiveField('zone');
    }
  }

  function fieldColor(field: Field): string | undefined {
    return field === activeField ? 'cyan' : 'gray';
  }

  return (
    <Modal title={`Edit: ${tunnel.name}`} visible>
      <Box flexDirection="column">
        {error && (
          <Box marginBottom={1}>
            <StatusMessage variant="error">{error}</StatusMessage>
          </Box>
        )}

        {/* Port field */}
        <Box marginBottom={1} flexDirection="column">
          <Text color={fieldColor('port')} bold={activeField === 'port'}>
            Port:
          </Text>
          {activeField === 'port' ? (
            <Box>
              <Text color="cyan">&gt; </Text>
              <TextInput
                defaultValue={port}
                onSubmit={handlePortSubmit}
              />
            </Box>
          ) : (
            <Text>  {port}</Text>
          )}
        </Box>

        {/* Subdomain field */}
        <Box marginBottom={1} flexDirection="column">
          <Text color={fieldColor('subdomain')} bold={activeField === 'subdomain'}>
            Subdomain:
          </Text>
          {activeField === 'subdomain' ? (
            <Box>
              <Text color="cyan">&gt; </Text>
              <TextInput
                defaultValue={subdomain}
                onSubmit={handleSubdomainSubmit}
              />
            </Box>
          ) : (
            <Text>  {subdomain}</Text>
          )}
        </Box>

        {/* Zone field */}
        <Box marginBottom={1} flexDirection="column">
          <Text color={fieldColor('zone')} bold={activeField === 'zone'}>
            Zone:
          </Text>
          {activeField === 'zone' && zones.length > 1 ? (
            <Select
              options={zones.map(z => ({ label: z.name, value: z.name }))}
              defaultValue={zones[zoneIndex]?.name}
              onChange={(value) => {
                const idx = zones.findIndex(z => z.name === value);
                if (idx >= 0) setZoneIndex(idx);
                const num = parseInt(port, 10);
                if (isNaN(num) || num < 1 || num > 65535) {
                  setActiveField('port');
                  setError('Port must be 1-65535');
                  return;
                }
                if (!subdomain.trim()) {
                  setActiveField('subdomain');
                  setError('Subdomain is required');
                  return;
                }
                onSubmit({ port: num, subdomain: subdomain.trim(), zone: value });
              }}
            />
          ) : (
            <Text>  {zones[zoneIndex]?.name ?? tunnel.zone}</Text>
          )}
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Tab to switch fields, Enter to save, Esc to cancel</Text>
        </Box>
      </Box>
    </Modal>
  );
}
