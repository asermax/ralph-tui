/**
 * ABOUTME: Tests for BeadsRustTrackerPlugin detection logic.
 * Verifies .beads directory detection, br binary checks, and version parsing.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { EventEmitter } from 'node:events';

let mockAccessShouldFail = false;

let mockSpawnArgs: Array<{ cmd: string; args: string[] }> = [];
let mockSpawnExitCode = 0;
let mockSpawnStdout = '';
let mockSpawnStderr = '';

function createMockChildProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  setTimeout(() => {
    if (mockSpawnStdout) proc.stdout.emit('data', Buffer.from(mockSpawnStdout));
    if (mockSpawnStderr) proc.stderr.emit('data', Buffer.from(mockSpawnStderr));
    proc.emit('close', mockSpawnExitCode);
  }, 0);

  return proc;
}

mock.module('node:child_process', () => ({
  spawn: (cmd: string, args: string[]) => {
    mockSpawnArgs.push({ cmd, args });
    return createMockChildProcess();
  },
}));

mock.module('node:fs/promises', () => ({
  access: async () => {
    if (mockAccessShouldFail) {
      throw new Error('ENOENT');
    }
  },
  constants: {
    R_OK: 4,
  },
}));

const { BeadsRustTrackerPlugin } = await import('./index.js');

describe('BeadsRustTrackerPlugin', () => {
  beforeEach(() => {
    mockAccessShouldFail = false;
    mockSpawnArgs = [];
    mockSpawnExitCode = 0;
    mockSpawnStdout = '';
    mockSpawnStderr = '';
  });

  test('reports unavailable when .beads directory is missing', async () => {
    mockAccessShouldFail = true;

    const plugin = new BeadsRustTrackerPlugin();
    await plugin.initialize({ workingDir: '/test' });
    const result = await plugin.detect();

    expect(result.available).toBe(false);
    expect(result.error).toContain('Beads directory not found');
    expect(mockSpawnArgs.length).toBe(0);
  });

  test('reports unavailable when br --version fails', async () => {
    mockSpawnExitCode = 1;
    mockSpawnStderr = 'br: command not found';

    const plugin = new BeadsRustTrackerPlugin();
    await plugin.initialize({ workingDir: '/test' });
    const result = await plugin.detect();

    expect(result.available).toBe(false);
    expect(result.error).toContain('br binary not available');
    expect(mockSpawnArgs.some((c) => c.cmd === 'br')).toBe(true);
  });

  test('extracts version from br --version output', async () => {
    mockSpawnStdout = 'br version 0.4.1\n';

    const plugin = new BeadsRustTrackerPlugin();
    await plugin.initialize({ workingDir: '/test' });
    const result = await plugin.detect();

    expect(result.available).toBe(true);
    expect(result.brVersion).toBe('0.4.1');
    expect(result.brPath).toBe('br');
  });
});
