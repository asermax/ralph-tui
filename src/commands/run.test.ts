/**
 * ABOUTME: Tests for the run command utilities.
 * Covers task range filtering and related utilities.
 */

import { describe, test, expect } from 'bun:test';
import { filterTasksByRange, type TaskRangeFilter } from './run.js';
import type { TrackerTask } from '../plugins/trackers/types.js';

/**
 * Helper to create mock tasks for testing.
 */
function createTasks(count: number): TrackerTask[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `task-${i + 1}`,
    title: `Task ${i + 1}`,
    status: 'open' as const,
    priority: 2 as const,
  }));
}

describe('filterTasksByRange', () => {
  describe('basic filtering', () => {
    test('filters tasks within explicit range (1-3)', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { start: 1, end: 3 };

      const result = filterTasksByRange(tasks, range);

      expect(result.filteredTasks).toHaveLength(3);
      expect(result.filteredTasks.map((t) => t.id)).toEqual(['task-1', 'task-2', 'task-3']);
      expect(result.message).toContain('1-3');
      expect(result.message).toContain('3 of 5');
    });

    test('filters tasks with only start specified (3-)', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { start: 3 };

      const result = filterTasksByRange(tasks, range);

      expect(result.filteredTasks).toHaveLength(3);
      expect(result.filteredTasks.map((t) => t.id)).toEqual(['task-3', 'task-4', 'task-5']);
      expect(result.message).toContain('3-');
    });

    test('filters tasks with only end specified (-2)', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { end: 2 };

      const result = filterTasksByRange(tasks, range);

      expect(result.filteredTasks).toHaveLength(2);
      expect(result.filteredTasks.map((t) => t.id)).toEqual(['task-1', 'task-2']);
      expect(result.message).toContain('-2');
    });

    test('returns all tasks when range is undefined/empty', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = {};

      const result = filterTasksByRange(tasks, range);

      expect(result.filteredTasks).toHaveLength(5);
      expect(result.message).toContain('all');
    });

    test('filters single task when start equals end', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { start: 3, end: 3 };

      const result = filterTasksByRange(tasks, range);

      expect(result.filteredTasks).toHaveLength(1);
      expect(result.filteredTasks[0].id).toBe('task-3');
      expect(result.message).toContain('3-3');
    });
  });

  describe('edge cases', () => {
    test('handles empty task list', () => {
      const tasks: TrackerTask[] = [];
      const range: TaskRangeFilter = { start: 1, end: 3 };

      const result = filterTasksByRange(tasks, range);

      expect(result.filteredTasks).toHaveLength(0);
      expect(result.message).toContain('0 of 0');
    });

    test('returns original tasks for invalid range (start < 1)', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { start: 0, end: 3 };

      const result = filterTasksByRange(tasks, range);

      expect(result.filteredTasks).toHaveLength(5);
      expect(result.message).toBe('Invalid task range, using all tasks');
    });

    test('returns original tasks for invalid range (end < start)', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { start: 4, end: 2 };

      const result = filterTasksByRange(tasks, range);

      expect(result.filteredTasks).toHaveLength(5);
      expect(result.message).toBe('Invalid task range, using all tasks');
    });

    test('handles range exceeding task count gracefully', () => {
      const tasks = createTasks(3);
      const range: TaskRangeFilter = { start: 1, end: 10 };

      const result = filterTasksByRange(tasks, range);

      // Should return all 3 tasks (doesn't fail on out-of-bounds)
      expect(result.filteredTasks).toHaveLength(3);
      expect(result.message).toContain('3 of 3');
    });

    test('handles start exceeding task count', () => {
      const tasks = createTasks(3);
      const range: TaskRangeFilter = { start: 10 };

      const result = filterTasksByRange(tasks, range);

      // No tasks match since start is beyond all tasks
      expect(result.filteredTasks).toHaveLength(0);
      expect(result.message).toContain('0 of 3');
    });
  });

  describe('message formatting', () => {
    test('formats message correctly for full range', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { start: 2, end: 4 };

      const result = filterTasksByRange(tasks, range);

      expect(result.message).toBe('Task range 2-4: 3 of 5 tasks selected');
    });

    test('formats message correctly for open-ended start', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { start: 3 };

      const result = filterTasksByRange(tasks, range);

      expect(result.message).toBe('Task range 3-: 3 of 5 tasks selected');
    });

    test('formats message correctly for open-ended end', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { end: 2 };

      const result = filterTasksByRange(tasks, range);

      expect(result.message).toBe('Task range -2: 2 of 5 tasks selected');
    });

    test('formats message correctly for all tasks', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = {};

      const result = filterTasksByRange(tasks, range);

      expect(result.message).toBe('Task range all: 5 of 5 tasks selected');
    });
  });
});
