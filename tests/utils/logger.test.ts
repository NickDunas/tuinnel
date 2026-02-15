import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { logger } from '../../src/utils/logger.js';

describe('logger', () => {
  let stderrOutput: string;
  let stdoutOutput: string;
  const originalStderrWrite = process.stderr.write;
  const originalStdoutWrite = process.stdout.write;

  beforeEach(() => {
    stderrOutput = '';
    stdoutOutput = '';

    // Intercept stderr
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrOutput += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stderr.write;

    // Intercept stdout
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutOutput += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stderr.write = originalStderrWrite;
    process.stdout.write = originalStdoutWrite;
  });

  test('info outputs to stderr not stdout', () => {
    logger.info('test message');
    expect(stderrOutput).toContain('test message');
    expect(stdoutOutput).toBe('');
  });

  test('warn outputs to stderr not stdout', () => {
    logger.warn('warning message');
    expect(stderrOutput).toContain('warning message');
    expect(stdoutOutput).toBe('');
  });

  test('error outputs to stderr not stdout', () => {
    logger.error('error message');
    expect(stderrOutput).toContain('error message');
    expect(stdoutOutput).toBe('');
  });

  test('success outputs to stderr not stdout', () => {
    logger.success('success message');
    expect(stderrOutput).toContain('success message');
    expect(stdoutOutput).toBe('');
  });

  test('info includes level prefix', () => {
    logger.info('hello');
    expect(stderrOutput).toContain('info');
    expect(stderrOutput).toContain('hello');
  });

  test('warn includes level prefix', () => {
    logger.warn('caution');
    expect(stderrOutput).toContain('warn');
    expect(stderrOutput).toContain('caution');
  });

  test('error includes level prefix', () => {
    logger.error('failed');
    expect(stderrOutput).toContain('error');
    expect(stderrOutput).toContain('failed');
  });

  test('success includes ok prefix', () => {
    logger.success('done');
    expect(stderrOutput).toContain('ok');
    expect(stderrOutput).toContain('done');
  });

  test('output ends with newline', () => {
    logger.info('line');
    expect(stderrOutput.endsWith('\n')).toBe(true);
  });
});
