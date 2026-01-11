/**
 * ABOUTME: Progress Dashboard component for the Ralph TUI.
 * Displays overall progress, time estimates, and execution status.
 * Auto-updates every second when running.
 */

import type { ReactNode } from 'react';
import { colors, statusIndicators, formatElapsedTime, type RalphStatus } from '../theme.js';

/**
 * Props for the ProgressDashboard component
 */
export interface ProgressDashboardProps {
  /** Current Ralph execution status */
  status: RalphStatus;
  /** Number of tasks completed */
  completedTasks: number;
  /** Total number of tasks */
  totalTasks: number;
  /** Current iteration number (1-indexed) */
  currentIteration: number;
  /** Maximum number of iterations */
  maxIterations: number;
  /** Elapsed time in seconds since start */
  elapsedTimeSeconds: number;
  /** Name of the agent being used */
  agentName: string;
  /** Name of the tracker being used */
  trackerName: string;
  /** Epic or project name */
  epicName?: string;
  /** Number of completed iterations for ETA calculation */
  completedIterations?: number;
}

/**
 * Get status display configuration
 */
function getStatusDisplay(status: RalphStatus): { label: string; color: string; indicator: string } {
  switch (status) {
    case 'running':
      return { label: 'Running', color: colors.status.success, indicator: statusIndicators.running };
    case 'paused':
      return { label: 'Paused', color: colors.status.warning, indicator: statusIndicators.paused };
    case 'stopped':
      return { label: 'Completed', color: colors.fg.muted, indicator: statusIndicators.done };
    case 'error':
      return { label: 'Failed', color: colors.status.error, indicator: statusIndicators.blocked };
  }
}

/**
 * Calculate estimated time remaining based on average iteration duration
 */
function calculateETA(
  elapsedSeconds: number,
  completedIterations: number,
  maxIterations: number,
  currentIteration: number
): string {
  // Need at least one completed iteration to estimate
  if (completedIterations <= 0 || elapsedSeconds <= 0) {
    return 'Calculating...';
  }

  // Average time per iteration
  const avgTimePerIteration = elapsedSeconds / completedIterations;

  // Remaining iterations (include current if not done)
  const remainingIterations = maxIterations - currentIteration + 1;

  if (remainingIterations <= 0) {
    return 'Done';
  }

  const remainingSeconds = Math.round(avgTimePerIteration * remainingIterations);
  return formatElapsedTime(remainingSeconds);
}

/**
 * Progress bar with percentage
 */
function ProgressBar({
  current,
  total,
  width,
  label,
}: {
  current: number;
  total: number;
  width: number;
  label?: string;
}): ReactNode {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
  const filledWidth = Math.floor((percentage / 100) * width);
  const emptyWidth = width - filledWidth;

  const filledBar = '█'.repeat(filledWidth);
  const emptyBar = '░'.repeat(emptyWidth);

  return (
    <box style={{ flexDirection: 'row', gap: 1 }}>
      {label && <text fg={colors.fg.secondary}>{label}</text>}
      <text>
        <span fg={colors.status.success}>{filledBar}</span>
        <span fg={colors.fg.dim}>{emptyBar}</span>
      </text>
      <text fg={colors.fg.secondary}>
        {current}/{total} ({percentage}%)
      </text>
    </box>
  );
}

/**
 * Progress Dashboard component showing comprehensive execution status
 */
export function ProgressDashboard({
  status,
  completedTasks,
  totalTasks,
  currentIteration,
  maxIterations,
  elapsedTimeSeconds,
  agentName,
  trackerName,
  epicName,
  completedIterations = 0,
}: ProgressDashboardProps): ReactNode {
  const statusDisplay = getStatusDisplay(status);
  const eta = calculateETA(elapsedTimeSeconds, completedIterations, maxIterations, currentIteration);
  const taskProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <box
      style={{
        width: '100%',
        flexDirection: 'column',
        backgroundColor: colors.bg.secondary,
        padding: 1,
        border: true,
        borderColor: colors.border.normal,
        gap: 1,
      }}
    >
      {/* Top row: Status and Epic name */}
      <box style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <box style={{ flexDirection: 'row', gap: 2 }}>
          <text>
            <span fg={statusDisplay.color}>{statusDisplay.indicator}</span>
            <span fg={statusDisplay.color}> {statusDisplay.label}</span>
          </text>
          {epicName && (
            <text fg={colors.accent.primary}>{epicName}</text>
          )}
        </box>
        <box style={{ flexDirection: 'row', gap: 2 }}>
          <text fg={colors.fg.secondary}>Agent: </text>
          <text fg={colors.accent.tertiary}>{agentName}</text>
          <text fg={colors.fg.muted}> | </text>
          <text fg={colors.fg.secondary}>Tracker: </text>
          <text fg={colors.accent.tertiary}>{trackerName}</text>
        </box>
      </box>

      {/* Progress bars row */}
      <box style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 2 }}>
        {/* Task progress */}
        <box style={{ flexGrow: 1 }}>
          <ProgressBar
            current={completedTasks}
            total={totalTasks}
            width={15}
            label="Tasks:"
          />
        </box>

        {/* Iteration progress */}
        <box style={{ flexGrow: 1 }}>
          <ProgressBar
            current={currentIteration}
            total={maxIterations}
            width={15}
            label="Iterations:"
          />
        </box>
      </box>

      {/* Time row */}
      <box style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <text fg={colors.fg.secondary}>
          ⏱ Elapsed: <span fg={colors.fg.primary}>{formatElapsedTime(elapsedTimeSeconds)}</span>
        </text>
        <text fg={colors.fg.secondary}>
          ⏳ ETA: <span fg={status === 'running' ? colors.accent.primary : colors.fg.muted}>{eta}</span>
        </text>
        <text fg={colors.fg.muted}>
          {taskProgress}% complete
        </text>
      </box>
    </box>
  );
}
