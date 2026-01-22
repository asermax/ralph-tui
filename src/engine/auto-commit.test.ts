/**
 * ABOUTME: Tests for the auto-commit utility module.
 * Verifies git staging/commit behavior after task completion using real temporary git repos.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hasUncommittedChanges, performAutoCommit } from './auto-commit.js';
import { runProcess } from '../utils/process.js';

let tempDir: string;

async function initGitRepo(dir: string): Promise<void> {
  await runProcess('git', ['init'], { cwd: dir });
  await runProcess('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  await runProcess('git', ['config', 'user.name', 'Test'], { cwd: dir });
  // Create initial commit so HEAD exists
  await writeFile(join(dir, '.gitkeep'), '');
  await runProcess('git', ['add', '-A'], { cwd: dir });
  await runProcess('git', ['commit', '-m', 'initial'], { cwd: dir });
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'ralph-autocommit-'));
  await initGitRepo(tempDir);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('hasUncommittedChanges', () => {
  test('returns false when working tree is clean', async () => {
    const result = await hasUncommittedChanges(tempDir);
    expect(result).toBe(false);
  });

  test('returns true when there are untracked files', async () => {
    await writeFile(join(tempDir, 'newfile.txt'), 'content');
    const result = await hasUncommittedChanges(tempDir);
    expect(result).toBe(true);
  });

  test('returns true when there are modified files', async () => {
    await writeFile(join(tempDir, '.gitkeep'), 'modified');
    const result = await hasUncommittedChanges(tempDir);
    expect(result).toBe(true);
  });

  test('throws for non-git directory', async () => {
    const nonGitDir = await mkdtemp(join(tmpdir(), 'ralph-nogit-'));
    try {
      await expect(hasUncommittedChanges(nonGitDir)).rejects.toThrow('git status failed');
    } finally {
      await rm(nonGitDir, { recursive: true, force: true });
    }
  });
});

describe('performAutoCommit', () => {
  test('creates commit with correct message format', async () => {
    await writeFile(join(tempDir, 'task-output.txt'), 'done');

    const result = await performAutoCommit(tempDir, 'TASK-42', 'Fix the login bug');

    expect(result.committed).toBe(true);
    expect(result.commitMessage).toBe('feat: TASK-42 - Fix the login bug');
    expect(result.commitSha).toBeDefined();
    expect(result.commitSha!.length).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();
    expect(result.skipReason).toBeUndefined();
  });

  test('skips when there are no changes', async () => {
    const result = await performAutoCommit(tempDir, 'TASK-1', 'No-op task');

    expect(result.committed).toBe(false);
    expect(result.skipReason).toBe('no uncommitted changes');
    expect(result.error).toBeUndefined();
  });

  test('includes all file types in commit', async () => {
    await writeFile(join(tempDir, 'new.ts'), 'export const x = 1;');
    await writeFile(join(tempDir, '.gitkeep'), 'modified');

    const result = await performAutoCommit(tempDir, 'TASK-5', 'Multi-file change');

    expect(result.committed).toBe(true);

    // Verify both files are in the commit
    const showResult = await runProcess('git', ['show', '--name-only', '--format='], { cwd: tempDir });
    expect(showResult.stdout).toContain('new.ts');
    expect(showResult.stdout).toContain('.gitkeep');
  });

  test('commit SHA matches HEAD after commit', async () => {
    await writeFile(join(tempDir, 'file.txt'), 'content');

    const result = await performAutoCommit(tempDir, 'TASK-10', 'Verify SHA');

    expect(result.committed).toBe(true);

    const headResult = await runProcess('git', ['rev-parse', '--short', 'HEAD'], { cwd: tempDir });
    expect(result.commitSha).toBe(headResult.stdout.trim());
  });

  test('handles git failures gracefully', async () => {
    // Non-git directory triggers hasUncommittedChanges to throw,
    // which performAutoCommit catches and returns in the error field
    const nonGitDir = await mkdtemp(join(tmpdir(), 'ralph-broken-'));
    await writeFile(join(nonGitDir, 'file.txt'), 'content');

    try {
      const result = await performAutoCommit(nonGitDir, 'TASK-99', 'Should fail');
      // Should not throw - returns error in result
      expect(result.committed).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('git status failed');
    } finally {
      await rm(nonGitDir, { recursive: true, force: true });
    }
  });

  test('leaves working tree clean after commit', async () => {
    await writeFile(join(tempDir, 'file.txt'), 'content');

    await performAutoCommit(tempDir, 'TASK-7', 'Clean tree');

    const hasChanges = await hasUncommittedChanges(tempDir);
    expect(hasChanges).toBe(false);
  });
});
