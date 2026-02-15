import React from 'react';
import { Box, Text } from 'ink';

export type TabName = 'details' | 'logs' | 'metrics';

export interface TabBarProps {
  activeTab: TabName;
}

const TABS: { key: string; label: string; name: TabName }[] = [
  { key: '1', label: 'Details', name: 'details' },
  { key: '2', label: 'Logs', name: 'logs' },
  { key: '3', label: 'Metrics', name: 'metrics' },
];

export function TabBar({ activeTab }: TabBarProps) {
  return (
    <Box>
      <Text> </Text>
      {TABS.map((tab, i) => {
        const isActive = tab.name === activeTab;
        return (
          <React.Fragment key={tab.name}>
            {i > 0 && <Text>  </Text>}
            {isActive ? (
              <Text bold inverse>[{tab.key}:{tab.label}]</Text>
            ) : (
              <Text dimColor>[{tab.key}:{tab.label}]</Text>
            )}
          </React.Fragment>
        );
      })}
    </Box>
  );
}
