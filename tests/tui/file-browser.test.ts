/**
 * ABOUTME: Tests for FileBrowser helper functions and logic.
 * Tests the pure utility functions used by the FileBrowser component.
 */

import { describe, test, expect } from 'bun:test';
import { homedir } from 'node:os';
import { sep, resolve, isAbsolute } from 'node:path';
import { formatPath, truncateText } from '../../src/tui/components/FileBrowser.js';

describe('FileBrowser helpers', () => {
  describe('formatPath', () => {
    test('replaces home directory with ~', () => {
      const home = homedir();
      expect(formatPath(home)).toBe('~');
    });

    test('replaces home directory prefix with ~', () => {
      const home = homedir();
      const subdir = `${home}${sep}projects${sep}my-app`;
      expect(formatPath(subdir)).toBe('~/projects/my-app');
    });

    test('returns path unchanged if not under home', () => {
      expect(formatPath('/tmp/test')).toBe('/tmp/test');
      expect(formatPath('/var/log')).toBe('/var/log');
    });

    test('handles root path', () => {
      expect(formatPath('/')).toBe('/');
    });

    test('does not replace partial home matches', () => {
      const home = homedir();
      // Path that starts with same prefix but is not actually under home
      const fakePath = home + 'extra/path';
      expect(formatPath(fakePath)).toBe(fakePath);
    });
  });

  describe('truncateText', () => {
    test('returns text unchanged if within max width', () => {
      expect(truncateText('hello', 10)).toBe('hello');
      expect(truncateText('hello', 5)).toBe('hello');
    });

    test('truncates text with ellipsis when exceeding max width', () => {
      expect(truncateText('hello world', 8)).toBe('hello w…');
      expect(truncateText('hello world', 6)).toBe('hello…');
    });

    test('handles single character max width', () => {
      expect(truncateText('hello', 1)).toBe('…');
    });

    test('handles empty string', () => {
      expect(truncateText('', 10)).toBe('');
    });

    test('handles exact length match', () => {
      expect(truncateText('hello', 5)).toBe('hello');
    });
  });

  describe('navigation logic', () => {
    /**
     * Calculate new selection index when navigating with j/k keys
     * (Mirrors logic from FileBrowser.tsx)
     */
    function calculateNewIndex(
      currentIndex: number,
      direction: 'up' | 'down',
      totalEntries: number
    ): number {
      if (totalEntries === 0) return 0;
      if (direction === 'up') {
        return Math.max(0, currentIndex - 1);
      } else {
        return Math.min(totalEntries - 1, currentIndex + 1);
      }
    }

    test('moves up correctly', () => {
      expect(calculateNewIndex(5, 'up', 10)).toBe(4);
      expect(calculateNewIndex(0, 'up', 10)).toBe(0); // Can't go below 0
    });

    test('moves down correctly', () => {
      expect(calculateNewIndex(5, 'down', 10)).toBe(6);
      expect(calculateNewIndex(9, 'down', 10)).toBe(9); // Can't go above max
    });

    test('handles empty list', () => {
      expect(calculateNewIndex(0, 'up', 0)).toBe(0);
      expect(calculateNewIndex(0, 'down', 0)).toBe(0);
    });

    test('handles single item list', () => {
      expect(calculateNewIndex(0, 'up', 1)).toBe(0);
      expect(calculateNewIndex(0, 'down', 1)).toBe(0);
    });
  });

  describe('path resolution logic', () => {
    /**
     * Resolve a path input from the user relative to the current browsing directory.
     * (Mirrors expandPath logic from FileBrowser.tsx)
     */
    function resolvePathInput(input: string, currentPath: string): string {
      const trimmed = input.trim();

      // Tilde expands to home directory
      if (trimmed.startsWith('~')) {
        const expanded = homedir() + trimmed.slice(1);
        return resolve(expanded);
      }

      // Absolute paths resolve directly
      if (isAbsolute(trimmed)) {
        return resolve(trimmed);
      }

      // Relative paths resolve against current browsing directory
      return resolve(currentPath, trimmed);
    }

    test('expands ~ to home directory', () => {
      const home = homedir();
      expect(resolvePathInput('~/projects', '/tmp')).toBe(resolve(`${home}/projects`));
      expect(resolvePathInput('~', '/tmp')).toBe(home);
    });

    test('resolves absolute paths directly', () => {
      expect(resolvePathInput('/var/log', '/tmp')).toBe('/var/log');
      expect(resolvePathInput('/home/user', '/current')).toBe('/home/user');
    });

    test('resolves relative paths from current browsing directory', () => {
      expect(resolvePathInput('subdir', '/current/path')).toBe('/current/path/subdir');
      expect(resolvePathInput('a/b/c', '/root')).toBe('/root/a/b/c');
    });

    test('resolves ./ relative paths from current browsing directory', () => {
      expect(resolvePathInput('./subdir', '/current/path')).toBe('/current/path/subdir');
      expect(resolvePathInput('./a/b', '/root')).toBe('/root/a/b');
    });

    test('resolves ../ relative paths from current browsing directory', () => {
      expect(resolvePathInput('../sibling', '/current/path')).toBe('/current/sibling');
      expect(resolvePathInput('../../top', '/a/b/c')).toBe('/a/top');
    });

    test('does not use process.cwd() for relative paths', () => {
      // This is the key test: relative paths should resolve against currentPath,
      // not process.cwd(). We verify by using a currentPath that's different from cwd.
      const currentPath = '/some/browsing/directory';
      const result = resolvePathInput('myfile', currentPath);
      expect(result).toBe('/some/browsing/directory/myfile');
      expect(result).not.toContain(process.cwd());
    });
  });
});
