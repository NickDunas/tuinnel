import { describe, test, expect } from 'bun:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { Modal } from '../../src/tui/Modal.js';

describe('Modal', () => {
  test('renders title and children when visible', () => {
    const { lastFrame } = render(
      <Modal title="Test Modal" visible>
        <Text>Hello World</Text>
      </Modal>
    );

    const frame = lastFrame();
    expect(frame).toContain('Test Modal');
    expect(frame).toContain('Hello World');
  });

  test('renders nothing when not visible', () => {
    const { lastFrame } = render(
      <Modal title="Hidden" visible={false}>
        <Text>Should not appear</Text>
      </Modal>
    );

    expect(lastFrame()).toBe('');
  });

  test('renders with custom width', () => {
    const { lastFrame } = render(
      <Modal title="Wide" visible width={60}>
        <Text>Content</Text>
      </Modal>
    );

    const frame = lastFrame();
    expect(frame).toContain('Wide');
    expect(frame).toContain('Content');
  });
});
