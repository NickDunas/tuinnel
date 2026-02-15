import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { render } from 'ink-testing-library';

// Simple component for testing
function Counter() {
  const [count, setCount] = useState(0);

  useInput((input, key) => {
    if (input === '+') setCount(c => c + 1);
    if (input === '-') setCount(c => c - 1);
  });

  return (
    <Box flexDirection="column">
      <Text bold>Counter: {count}</Text>
      <Text dimColor>Press + or - to change</Text>
    </Box>
  );
}

// Simple text component
function Greeting({ name }: { name: string }) {
  return <Text>Hello, {name}!</Text>;
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.log(`  FAIL: ${message}`);
    failed++;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('VT-1 ink-testing-library validation\n');

  // Test 1: Basic render
  console.log('Test 1: Basic render');
  try {
    const { lastFrame, unmount } = render(<Greeting name="World" />);
    const frame = lastFrame();
    assert(frame !== undefined && frame.includes('Hello, World!'), 'Renders text correctly');
    unmount();
  } catch (e: any) {
    console.log(`  FAIL: Basic render threw: ${e.message}`);
    failed++;
  }

  // Test 2: Counter component with useInput (async to allow React state updates)
  console.log('Test 2: Counter with useInput');
  try {
    const { lastFrame, stdin, unmount } = render(<Counter />);
    await delay(50);
    const initial = lastFrame();
    assert(initial !== undefined && initial.includes('Counter: 0'), 'Initial count is 0');

    stdin.write('+');
    await delay(50);
    const afterPlus = lastFrame();
    assert(afterPlus !== undefined && afterPlus.includes('Counter: 1'), 'Count increments to 1');

    stdin.write('+');
    await delay(50);
    const afterTwo = lastFrame();
    assert(afterTwo !== undefined && afterTwo.includes('Counter: 2'), 'Count increments to 2');

    stdin.write('-');
    await delay(50);
    const afterMinus = lastFrame();
    assert(afterMinus !== undefined && afterMinus.includes('Counter: 1'), 'Count decrements to 1');

    unmount();
  } catch (e: any) {
    console.log(`  FAIL: Counter test threw: ${e.message}`);
    failed++;
  }

  // Test 3: Box layout
  console.log('Test 3: Box layout');
  try {
    const { lastFrame, unmount } = render(
      <Box flexDirection="column">
        <Text>Line 1</Text>
        <Text>Line 2</Text>
      </Box>
    );
    const frame = lastFrame();
    assert(frame !== undefined && frame.includes('Line 1'), 'Box renders line 1');
    assert(frame !== undefined && frame.includes('Line 2'), 'Box renders line 2');
    unmount();
  } catch (e: any) {
    console.log(`  FAIL: Box layout threw: ${e.message}`);
    failed++;
  }

  // Test 4: Re-render
  console.log('Test 4: Re-render');
  try {
    const { lastFrame, rerender, unmount } = render(<Greeting name="Alice" />);
    assert(lastFrame()?.includes('Hello, Alice!') ?? false, 'Initial render');

    rerender(<Greeting name="Bob" />);
    await delay(50);
    assert(lastFrame()?.includes('Hello, Bob!') ?? false, 'After rerender');

    unmount();
  } catch (e: any) {
    console.log(`  FAIL: Re-render threw: ${e.message}`);
    failed++;
  }

  // Test 5: frames() history
  console.log('Test 5: Frame history');
  try {
    const { frames, rerender, unmount } = render(<Greeting name="First" />);
    rerender(<Greeting name="Second" />);
    await delay(50);
    assert(frames.length >= 2, `Has multiple frames (got ${frames.length})`);
    unmount();
  } catch (e: any) {
    console.log(`  FAIL: Frame history threw: ${e.message}`);
    failed++;
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.log('\nVT-1 PARTIAL — some tests failed (see above)');
    process.exit(1);
  } else {
    console.log('\nVT-1 PASSED — ink-testing-library works with Ink v6 + React 19');
    process.exit(0);
  }
}

run();
