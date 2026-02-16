import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { color } from './use-color.js';

export interface ModalProps {
  title: string;
  children: React.ReactNode;
  visible: boolean;
  width?: number;
}

export function Modal({ title, children, visible, width = 45 }: ModalProps) {
  const { stdout } = useStdout();
  const columns = stdout.columns ?? 80;
  const rows = stdout.rows ?? 24;

  if (!visible) return null;

  const hPad = Math.max(0, Math.floor((columns - width) / 2));
  const titleHeight = 1;
  const marginBottom = 1;
  const borderHeight = 2;
  const contentHeight = Math.max(1, rows - titleHeight - marginBottom - borderHeight - 2);

  return (
    <Box
      flexDirection="column"
      width={columns}
      height={rows}
      alignItems="center"
      justifyContent="center"
    >
      <Box
        flexDirection="column"
        width={width}
        borderStyle="single"
        borderColor={color('cyan')}
        paddingX={1}
      >
        <Box justifyContent="center" marginBottom={1}>
          <Text bold color={color('cyan')}>{title}</Text>
        </Box>
        <Box flexDirection="column" height={contentHeight}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
