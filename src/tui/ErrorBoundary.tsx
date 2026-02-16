import React, { Component } from 'react';
import { Box, Text } from 'ink';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    process.stderr.write(`TUI Error: ${error.message}\n${error.stack ?? ''}\n`);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text color="red" bold>TUI Error</Text>
          <Text color="red">{this.state.error?.message ?? 'Unknown error'}</Text>
          <Text dimColor>Press Ctrl+C to exit.</Text>
        </Box>
      );
    }
    return this.props.children;
  }
}
