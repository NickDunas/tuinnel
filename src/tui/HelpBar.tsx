import React from 'react';
import { Box, Text } from 'ink';
import { StatusMessage } from '@inkjs/ui';

export interface HelpBarProps {
  focusedPanel: 'sidebar' | 'main';
  notification: string | null;
  activeModal?: string | null;
  activeTab?: 'details' | 'logs' | 'metrics';
  hasSelection?: boolean;
  mode?: 'dashboard' | 'empty' | 'onboarding' | 'quitting';
}

interface Shortcut {
  key: string;
  action: string;
}

const EMPTY_SHORTCUTS: Shortcut[] = [
  { key: 'a', action: 'Add' },
  { key: 'q', action: 'Quit' },
];

const MODAL_SHORTCUTS: Shortcut[] = [
  { key: '\u2191\u2193', action: 'Navigate' },
  { key: 'Tab', action: 'Next' },
  { key: 'Enter', action: 'Confirm' },
  { key: 'Esc', action: 'Cancel' },
];

const SIDEBAR_SHORTCUTS: Shortcut[] = [
  { key: '\u2191\u2193', action: 'Navigate' },
  { key: 'a', action: 'Add' },
  { key: 'd', action: 'Delete' },
  { key: 'e', action: 'Edit' },
  { key: 's', action: 'Start/Stop' },
  { key: 'r', action: 'Restart' },
  { key: 'Tab', action: 'Focus' },
  { key: 'q', action: 'Quit' },
];

const DETAILS_SHORTCUTS: Shortcut[] = [
  { key: 'c', action: 'Copy URL' },
  { key: 'o', action: 'Open' },
  { key: 'Tab', action: 'Focus' },
  { key: 'q', action: 'Quit' },
];

const LOGS_SHORTCUTS: Shortcut[] = [
  { key: '\u2191\u2193', action: 'Scroll' },
  { key: '/', action: 'Filter' },
  { key: 'Esc', action: 'Clear' },
  { key: 'Tab', action: 'Focus' },
  { key: 'q', action: 'Quit' },
];

const METRICS_SHORTCUTS: Shortcut[] = [
  { key: 'Tab', action: 'Focus' },
  { key: 'q', action: 'Quit' },
];

function getShortcuts(props: HelpBarProps): Shortcut[] {
  const { focusedPanel, activeModal, activeTab, mode } = props;

  // Empty or onboarding mode
  if (mode === 'empty' || mode === 'onboarding') {
    return EMPTY_SHORTCUTS;
  }

  // Modal open
  if (activeModal) {
    return MODAL_SHORTCUTS;
  }

  // Sidebar focused
  if (focusedPanel === 'sidebar') {
    return SIDEBAR_SHORTCUTS;
  }

  // Main panel focused — depends on tab
  switch (activeTab) {
    case 'logs':
      return LOGS_SHORTCUTS;
    case 'metrics':
      return METRICS_SHORTCUTS;
    case 'details':
    default:
      return DETAILS_SHORTCUTS;
  }
}

export function HelpBar(props: HelpBarProps) {
  const { notification } = props;

  if (notification) {
    const isError = notification.startsWith('Error:');
    return (
      <Box>
        <StatusMessage variant={isError ? 'error' : 'success'}>
          {notification}
        </StatusMessage>
      </Box>
    );
  }

  const shortcuts = getShortcuts(props);

  return (
    <Box>
      <Text dimColor>
        {' '}{shortcuts.map(s => `${s.key} ${s.action}`).join('  ')}
      </Text>
    </Box>
  );
}
