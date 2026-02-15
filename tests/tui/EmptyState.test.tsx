import { describe, test, expect } from 'bun:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { EmptyState } from '../../src/tui/EmptyState.js';

describe('EmptyState', () => {
  test('renders no tunnels message', () => {
    const { lastFrame } = render(<EmptyState width={80} height={24} />);

    const frame = lastFrame();
    expect(frame).toContain('No tunnels configured yet');
  });

  test('renders add prompt', () => {
    const { lastFrame } = render(<EmptyState width={80} height={24} />);

    const frame = lastFrame();
    expect(frame).toContain('a');
    expect(frame).toContain('add your first tunnel');
  });

  test('renders quit shortcut', () => {
    const { lastFrame } = render(<EmptyState width={80} height={24} />);

    const frame = lastFrame();
    expect(frame).toContain('Quit');
  });
});
