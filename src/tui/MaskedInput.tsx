import { useState } from 'react';
import { Text, useInput } from 'ink';
import { color } from './use-color.js';

interface MaskedInputProps {
  placeholder?: string;
  onSubmit: (value: string) => void;
  mask?: string;
}

export function MaskedInput({ placeholder, onSubmit, mask = '*' }: MaskedInputProps) {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (key.return) { onSubmit(value); return; }
    if (key.backspace || key.delete) { setValue(v => v.slice(0, -1)); return; }
    if (input && !key.ctrl && !key.meta) { setValue(v => v + input); }
  });

  return (
    <Text>
      {value ? <Text>{mask.repeat(value.length)}</Text> : <Text dimColor>{placeholder}</Text>}
      <Text color={color('cyan')}>|</Text>
    </Text>
  );
}
