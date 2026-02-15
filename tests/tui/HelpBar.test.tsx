import { describe, test, expect } from 'bun:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { HelpBar } from '../../src/tui/HelpBar.js';

describe('HelpBar', () => {
  test('shows sidebar shortcuts when sidebar focused in dashboard mode', () => {
    const { lastFrame } = render(
      <HelpBar focusedPanel="sidebar" notification={null} mode="dashboard" activeTab="details" hasSelection={true} />
    );

    const frame = lastFrame();
    expect(frame).toContain('Navigate');
    expect(frame).toContain('Add');
    expect(frame).toContain('Delete');
    expect(frame).toContain('Edit');
    expect(frame).toContain('Start/Stop');
    expect(frame).toContain('Quit');
  });

  test('shows details tab shortcuts when main panel focused', () => {
    const { lastFrame } = render(
      <HelpBar focusedPanel="main" notification={null} mode="dashboard" activeTab="details" hasSelection={true} />
    );

    const frame = lastFrame();
    expect(frame).toContain('Copy URL');
    expect(frame).toContain('Open');
    expect(frame).toContain('Focus');
    expect(frame).toContain('Quit');
  });

  test('shows log shortcuts when logs tab focused', () => {
    const { lastFrame } = render(
      <HelpBar focusedPanel="main" notification={null} mode="dashboard" activeTab="logs" hasSelection={true} />
    );

    const frame = lastFrame();
    expect(frame).toContain('Scroll');
    expect(frame).toContain('Filter');
    expect(frame).toContain('Clear');
    expect(frame).toContain('Quit');
  });

  test('shows metrics shortcuts when metrics tab focused', () => {
    const { lastFrame } = render(
      <HelpBar focusedPanel="main" notification={null} mode="dashboard" activeTab="metrics" hasSelection={true} />
    );

    const frame = lastFrame();
    expect(frame).toContain('Focus');
    expect(frame).toContain('Quit');
  });

  test('shows empty mode shortcuts', () => {
    const { lastFrame } = render(
      <HelpBar focusedPanel="sidebar" notification={null} mode="empty" activeTab="details" hasSelection={false} />
    );

    const frame = lastFrame();
    expect(frame).toContain('Add');
    expect(frame).toContain('Quit');
  });

  test('shows modal shortcuts when modal is open', () => {
    const { lastFrame } = render(
      <HelpBar focusedPanel="sidebar" notification={null} mode="dashboard" activeModal="add" activeTab="details" hasSelection={true} />
    );

    const frame = lastFrame();
    expect(frame).toContain('Navigate');
    expect(frame).toContain('Confirm');
    expect(frame).toContain('Cancel');
  });

  test('shows notification when set', () => {
    const { lastFrame } = render(
      <HelpBar focusedPanel="sidebar" notification="Copied: https://app.example.com" mode="dashboard" />
    );

    const frame = lastFrame();
    expect(frame).toContain('Copied: https://app.example.com');
  });

  test('notification hides shortcuts', () => {
    const { lastFrame } = render(
      <HelpBar focusedPanel="sidebar" notification="Some notification" mode="dashboard" />
    );

    const frame = lastFrame();
    expect(frame).toContain('Some notification');
    // Shortcuts should not be visible when notification is shown
    expect(frame).not.toContain('Navigate');
  });
});
