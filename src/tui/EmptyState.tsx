import React from 'react';
import { Box, Text } from 'ink';

export interface EmptyStateProps {
  width: number;
  height: number;
}

export function EmptyState({ width, height }: EmptyStateProps) {
  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      alignItems="center"
      justifyContent="center"
    >
      <Box
        flexDirection="column"
        alignItems="center"
        borderStyle="single"
        borderColor="gray"
        paddingX={4}
        paddingY={1}
      >
        <Text>No tunnels configured yet.</Text>
        <Text> </Text>
        <Text>Press <Text bold>a</Text> to add your first tunnel.</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          <Text bold dimColor>a</Text> Add  <Text bold dimColor>q</Text> Quit
        </Text>
      </Box>
    </Box>
  );
}
