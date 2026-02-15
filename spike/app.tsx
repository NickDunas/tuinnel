import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, useApp, useStdin } from 'ink';
import { TextInput, Select } from '@inkjs/ui';

type Mode = 'select' | 'input' | 'done';

function App() {
  const [mode, setMode] = useState<Mode>('select');
  const [selectedItem, setSelectedItem] = useState<string>('');
  const [inputText, setInputText] = useState<string>('');
  const { exit } = useApp();
  const { isRawModeSupported, setRawMode } = useStdin();

  // Bun workaround: keep process alive via raw mode
  useEffect(() => {
    if (isRawModeSupported) setRawMode(true);
    return () => { setRawMode(false); };
  }, []);

  // Keyboard handler
  useInput((input, key) => {
    if (input === 'q') {
      exit();
    }
  });

  if (mode === 'select') {
    return (
      <Box flexDirection="column">
        <Text bold>VT-1 Spike: Select a framework</Text>
        <Select
          options={[
            { label: 'React', value: 'react' },
            { label: 'Angular', value: 'angular' },
            { label: 'Vue', value: 'vue' },
          ]}
          onChange={(value) => {
            setSelectedItem(value);
            setMode('input');
          }}
        />
      </Box>
    );
  }

  if (mode === 'input') {
    return (
      <Box flexDirection="column">
        <Text>Selected: {selectedItem}</Text>
        <Text bold>Enter a subdomain:</Text>
        <TextInput
          placeholder="my-app"
          onSubmit={(value) => {
            setInputText(value);
            setMode('done');
          }}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="green">Done!</Text>
      <Text>Framework: {selectedItem}</Text>
      <Text>Subdomain: {inputText}</Text>
      <Text dimColor>Press q to quit</Text>
    </Box>
  );
}

const instance = render(<App />);
await instance.waitUntilExit();
console.log('Clean exit via waitUntilExit()');
