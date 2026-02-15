import { describe, test, expect } from 'bun:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { TabBar } from '../../src/tui/TabBar.js';

describe('TabBar', () => {
  test('renders all three tabs', () => {
    const { lastFrame } = render(<TabBar activeTab="details" />);

    const frame = lastFrame();
    expect(frame).toContain('Details');
    expect(frame).toContain('Logs');
    expect(frame).toContain('Metrics');
  });

  test('renders tab key numbers', () => {
    const { lastFrame } = render(<TabBar activeTab="details" />);

    const frame = lastFrame();
    expect(frame).toContain('1:');
    expect(frame).toContain('2:');
    expect(frame).toContain('3:');
  });

  test('details tab active by default', () => {
    const { lastFrame } = render(<TabBar activeTab="details" />);
    const frame = lastFrame();
    // Active tab should have Details visible
    expect(frame).toContain('Details');
  });

  test('logs tab can be active', () => {
    const { lastFrame } = render(<TabBar activeTab="logs" />);
    const frame = lastFrame();
    expect(frame).toContain('Logs');
  });

  test('metrics tab can be active', () => {
    const { lastFrame } = render(<TabBar activeTab="metrics" />);
    const frame = lastFrame();
    expect(frame).toContain('Metrics');
  });
});
