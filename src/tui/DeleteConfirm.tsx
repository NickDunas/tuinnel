import React from 'react';
import { Box, Text } from 'ink';
import { ConfirmInput } from '@inkjs/ui';
import { Modal } from './Modal.js';

export interface DeleteConfirmProps {
  tunnelName: string;
  subdomain: string;
  zone: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirm({ tunnelName, subdomain, zone, onConfirm, onCancel }: DeleteConfirmProps) {
  return (
    <Modal title="Delete Tunnel" visible>
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text color="red" bold>Warning: This action cannot be undone.</Text>
        </Box>

        <Text>The following will be deleted:</Text>
        <Box flexDirection="column" marginLeft={2} marginY={1}>
          <Text>Tunnel:   <Text bold>{tunnelName}</Text></Text>
          <Text>DNS:      <Text bold>{subdomain}.{zone}</Text></Text>
        </Box>

        <Text>This will remove the tunnel from Cloudflare and</Text>
        <Text>delete the associated DNS CNAME record.</Text>

        <Box marginTop={1}>
          <ConfirmInput defaultChoice="cancel" onConfirm={onConfirm} onCancel={onCancel} />
        </Box>
      </Box>
    </Modal>
  );
}
