/**
 * ABOUTME: Run command implementation for ralph-tui.
 * Handles CLI argument parsing, configuration loading, session management,
 * and starting the execution engine with TUI.
 * Implements graceful interruption with Ctrl+C confirmation dialog.
 */

import { useState } from 'react';
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { buildConfig, validateConfig } from '../config/index.js';
import type { RuntimeOptions } from '../config/types.js';
import {
  checkSession,
  createSession,
  resumeSession,
  endSession,
  hasPersistedSession,
  loadPersistedSession,
  savePersistedSession,
  deletePersistedSession,
  createPersistedSession,
  updateSessionAfterIteration,
  pauseSession,
  completeSession,
  failSession,
  isSessionResumable,
  getSessionSummary,
  acquireLockWithPrompt,
  releaseLockNew,
  registerLockCleanupHandlers,
  type PersistedSessionState,
} from '../session/index.js';
import { ExecutionEngine } from '../engine/index.js';
import { registerBuiltinAgents } from '../plugins/agents/builtin/index.js';
import { registerBuiltinTrackers } from '../plugins/trackers/builtin/index.js';
import { getAgentRegistry } from '../plugins/agents/registry.js';
import { getTrackerRegistry } from '../plugins/trackers/registry.js';
import { RunApp } from '../tui/components/RunApp.js';
import type { TrackerTask } from '../plugins/trackers/types.js';
import type { RalphConfig } from '../config/types.js';
import { projectConfigExists, runSetupWizard } from '../setup/index.js';
import { createInterruptHandler } from '../interruption/index.js';
import type { InterruptHandler } from '../interruption/types.js';

/**
 * Extended runtime options with noSetup flag
 */
interface ExtendedRuntimeOptions extends RuntimeOptions {
  noSetup?: boolean;
}

/**
 * Parse CLI arguments for the run command
 */
export function parseRunArgs(args: string[]): ExtendedRuntimeOptions {
  const options: ExtendedRuntimeOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--epic':
        if (nextArg && !nextArg.startsWith('-')) {
          options.epicId = nextArg;
          i++;
        }
        break;

      case '--prd':
        if (nextArg && !nextArg.startsWith('-')) {
          options.prdPath = nextArg;
          i++;
        }
        break;

      case '--agent':
        if (nextArg && !nextArg.startsWith('-')) {
          options.agent = nextArg;
          i++;
        }
        break;

      case '--model':
        if (nextArg && !nextArg.startsWith('-')) {
          options.model = nextArg;
          i++;
        }
        break;

      case '--tracker':
        if (nextArg && !nextArg.startsWith('-')) {
          options.tracker = nextArg;
          i++;
        }
        break;

      case '--iterations':
        if (nextArg && !nextArg.startsWith('-')) {
          const parsed = parseInt(nextArg, 10);
          if (!isNaN(parsed)) {
            options.iterations = parsed;
          }
          i++;
        }
        break;

      case '--delay':
        if (nextArg && !nextArg.startsWith('-')) {
          const parsed = parseInt(nextArg, 10);
          if (!isNaN(parsed)) {
            options.iterationDelay = parsed;
          }
          i++;
        }
        break;

      case '--cwd':
        if (nextArg && !nextArg.startsWith('-')) {
          options.cwd = nextArg;
          i++;
        }
        break;

      case '--resume':
        options.resume = true;
        break;

      case '--force':
        options.force = true;
        break;

      case '--headless':
        options.headless = true;
        break;

      case '--no-setup':
        options.noSetup = true;
        break;
    }
  }

  return options;
}

/**
 * Print run command help
 */
export function printRunHelp(): void {
  console.log(`
ralph-tui run - Start Ralph execution

Usage: ralph-tui run [options]

Options:
  --epic <id>         Epic ID for beads tracker
  --prd <path>        PRD file path for json tracker
  --agent <name>      Override agent plugin (e.g., claude, opencode)
  --model <name>      Override model (e.g., opus, sonnet)
  --tracker <name>    Override tracker plugin (e.g., beads, beads-bv, json)
  --iterations <n>    Maximum iterations (0 = unlimited)
  --delay <ms>        Delay between iterations in milliseconds
  --cwd <path>        Working directory
  --resume            Resume existing session
  --force             Force start even if locked
  --headless          Run without TUI
  --no-setup          Skip interactive setup even if no config exists

Examples:
  ralph-tui run                              # Start with defaults
  ralph-tui run --epic ralph-tui-45r         # Run with specific epic
  ralph-tui run --prd ./prd.json             # Run with PRD file
  ralph-tui run --agent claude --model opus  # Override agent settings
  ralph-tui run --tracker beads-bv           # Use beads-bv tracker
  ralph-tui run --iterations 20              # Limit to 20 iterations
  ralph-tui run --resume                     # Resume previous session
`);
}

/**
 * Initialize plugin registries
 */
async function initializePlugins(): Promise<void> {
  // Register built-in plugins
  registerBuiltinAgents();
  registerBuiltinTrackers();

  // Initialize registries (discovers user plugins)
  const agentRegistry = getAgentRegistry();
  const trackerRegistry = getTrackerRegistry();

  await Promise.all([agentRegistry.initialize(), trackerRegistry.initialize()]);
}

/**
 * Handle session resume prompt
 * Checks for persisted session state and prompts user
 */
async function promptResumeOrNew(cwd: string): Promise<'resume' | 'new' | 'abort'> {
  // Check for persisted session file first
  const hasPersistedSessionFile = await hasPersistedSession(cwd);

  if (!hasPersistedSessionFile) {
    return 'new';
  }

  const persistedState = await loadPersistedSession(cwd);
  if (!persistedState) {
    return 'new';
  }

  const summary = getSessionSummary(persistedState);
  const resumable = isSessionResumable(persistedState);

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                  Existing Session Found                        ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  Status:      ${summary.status.toUpperCase()}`);
  console.log(`  Started:     ${new Date(summary.startedAt).toLocaleString()}`);
  console.log(`  Progress:    ${summary.tasksCompleted}/${summary.totalTasks} tasks complete`);
  console.log(`  Iteration:   ${summary.currentIteration}${summary.maxIterations > 0 ? `/${summary.maxIterations}` : ''}`);
  console.log(`  Agent:       ${summary.agentPlugin}`);
  console.log(`  Tracker:     ${summary.trackerPlugin}`);
  if (summary.epicId) {
    console.log(`  Epic:        ${summary.epicId}`);
  }
  console.log('');

  // Check for lock conflict
  const sessionCheck = await checkSession(cwd);
  if (sessionCheck.isLocked && !sessionCheck.isStale) {
    console.log('  WARNING: Session is currently locked by another process.');
    console.log(`           PID: ${sessionCheck.lock?.pid}`);
    console.log('');
    console.log('Cannot start while another instance is running.');
    return 'abort';
  }

  if (resumable) {
    console.log('This session can be resumed.');
    console.log('');
    console.log('  To resume:  ralph-tui resume');
    console.log('  To start fresh: ralph-tui run --force');
    console.log('');
    console.log('Starting fresh session...');
    console.log('(Use --resume flag or "ralph-tui resume" command to continue)');
    return 'new';
  } else {
    console.log('This session has completed and cannot be resumed.');
    console.log('Starting fresh session...');
    return 'new';
  }
}

/**
 * Props for the RunAppWrapper component
 */
interface RunAppWrapperProps {
  engine: ExecutionEngine;
  interruptHandler: InterruptHandler;
  onQuit: () => Promise<void>;
  onInterruptConfirmed: () => Promise<void>;
}

/**
 * Wrapper component that manages interrupt dialog state and passes it to RunApp.
 * This is needed because we need React state management for the dialog visibility.
 */
function RunAppWrapper({
  engine,
  interruptHandler,
  onQuit,
  onInterruptConfirmed,
}: RunAppWrapperProps) {
  const [showInterruptDialog, setShowInterruptDialog] = useState(false);

  // These callbacks are passed to the interrupt handler
  const handleShowDialog = () => setShowInterruptDialog(true);
  const handleHideDialog = () => setShowInterruptDialog(false);
  const handleCancelled = () => setShowInterruptDialog(false);

  // Set up the interrupt handler callbacks
  // Note: We use a ref-like pattern here since these need to be stable references
  // that the handler can call, but the handler was created before this component mounted
  (interruptHandler as { _showDialog?: () => void })._showDialog = handleShowDialog;
  (interruptHandler as { _hideDialog?: () => void })._hideDialog = handleHideDialog;
  (interruptHandler as { _cancelled?: () => void })._cancelled = handleCancelled;

  return (
    <RunApp
      engine={engine}
      onQuit={onQuit}
      showInterruptDialog={showInterruptDialog}
      onInterruptConfirm={async () => {
        setShowInterruptDialog(false);
        await onInterruptConfirmed();
      }}
      onInterruptCancel={() => {
        setShowInterruptDialog(false);
        interruptHandler.reset();
      }}
    />
  );
}

/**
 * Run the execution engine with TUI
 */
async function runWithTui(
  engine: ExecutionEngine,
  persistedState: PersistedSessionState,
  _config: RalphConfig
): Promise<PersistedSessionState> {
  let currentState = persistedState;
  let showDialogCallback: (() => void) | null = null;
  let hideDialogCallback: (() => void) | null = null;
  let cancelledCallback: (() => void) | null = null;

  const renderer = await createCliRenderer({
    exitOnCtrlC: false, // We handle this ourselves
  });

  const root = createRoot(renderer);

  // Subscribe to engine events to save state
  engine.on((event) => {
    if (event.type === 'iteration:completed') {
      currentState = updateSessionAfterIteration(currentState, event.result);
      savePersistedSession(currentState).catch(() => {
        // Log but don't fail on save errors
      });
    } else if (event.type === 'engine:paused') {
      // Save paused state to session file
      currentState = pauseSession(currentState);
      savePersistedSession(currentState).catch(() => {
        // Log but don't fail on save errors
      });
    } else if (event.type === 'engine:resumed') {
      // Clear paused state when resuming
      currentState = { ...currentState, status: 'running', isPaused: false, pausedAt: undefined };
      savePersistedSession(currentState).catch(() => {
        // Log but don't fail on save errors
      });
    }
  });

  // Create cleanup function
  const cleanup = async (): Promise<void> => {
    interruptHandler.dispose();
    await engine.dispose();
    renderer.destroy();
  };

  // Graceful shutdown: stop engine, save state, clean up
  const gracefulShutdown = async (): Promise<void> => {
    // Save interrupted state
    currentState = { ...currentState, status: 'interrupted' };
    await savePersistedSession(currentState);
    await cleanup();
    process.exit(0);
  };

  // Force quit: immediate exit
  const forceQuit = (): void => {
    // Synchronous cleanup - just exit immediately
    process.exit(1);
  };

  // Create interrupt handler with callbacks
  const interruptHandler = createInterruptHandler({
    doublePressWindowMs: 1000,
    onConfirmed: gracefulShutdown,
    onCancelled: () => {
      cancelledCallback?.();
    },
    onShowDialog: () => {
      showDialogCallback?.();
    },
    onHideDialog: () => {
      hideDialogCallback?.();
    },
    onForceQuit: forceQuit,
  });

  // Handle SIGTERM separately (always graceful)
  process.on('SIGTERM', gracefulShutdown);

  // Render the TUI with wrapper that manages dialog state
  root.render(
    <RunAppWrapper
      engine={engine}
      interruptHandler={interruptHandler}
      onQuit={gracefulShutdown}
      onInterruptConfirmed={gracefulShutdown}
    />
  );

  // Extract callback setters from the wrapper component
  // The wrapper will set these when it mounts
  const checkCallbacks = setInterval(() => {
    const handler = interruptHandler as {
      _showDialog?: () => void;
      _hideDialog?: () => void;
      _cancelled?: () => void;
    };
    if (handler._showDialog) {
      showDialogCallback = handler._showDialog;
    }
    if (handler._hideDialog) {
      hideDialogCallback = handler._hideDialog;
    }
    if (handler._cancelled) {
      cancelledCallback = handler._cancelled;
    }
  }, 10);

  // Start the engine (this will run the loop)
  await engine.start();

  // Clean up
  clearInterval(checkCallbacks);
  await cleanup();

  return currentState;
}

/**
 * Run in headless mode (no TUI)
 * In headless mode, Ctrl+C immediately triggers graceful shutdown (no confirmation dialog).
 * Double Ctrl+C within 1 second forces immediate exit.
 */
async function runHeadless(
  engine: ExecutionEngine,
  persistedState: PersistedSessionState,
  _config: RalphConfig
): Promise<PersistedSessionState> {
  let currentState = persistedState;
  let lastSigintTime = 0;
  const DOUBLE_PRESS_WINDOW_MS = 1000;

  // Subscribe to events for console output and state persistence
  engine.on((event) => {
    switch (event.type) {
      case 'engine:started':
        console.log(`\nRalph started. Total tasks: ${event.totalTasks}`);
        break;

      case 'iteration:started':
        console.log(`\n--- Iteration ${event.iteration}: ${event.task.title} ---`);
        break;

      case 'iteration:completed':
        console.log(
          `Iteration ${event.result.iteration} completed. ` +
            `Task ${event.result.taskCompleted ? 'DONE' : 'in progress'}. ` +
            `Duration: ${Math.round(event.result.durationMs / 1000)}s`
        );
        // Save state after each iteration
        currentState = updateSessionAfterIteration(currentState, event.result);
        savePersistedSession(currentState).catch(() => {
          // Log but don't fail on save errors
        });
        break;

      case 'iteration:failed':
        console.error(`Iteration ${event.iteration} FAILED: ${event.error}`);
        break;

      case 'engine:paused':
        console.log('\nPaused. Use "ralph-tui resume" to continue.');
        currentState = pauseSession(currentState);
        savePersistedSession(currentState).catch(() => {
          // Log but don't fail on save errors
        });
        break;

      case 'engine:resumed':
        console.log('\nResumed...');
        currentState = { ...currentState, status: 'running', isPaused: false, pausedAt: undefined };
        savePersistedSession(currentState).catch(() => {
          // Log but don't fail on save errors
        });
        break;

      case 'engine:stopped':
        console.log(`\nRalph stopped. Reason: ${event.reason}`);
        console.log(`Total iterations: ${event.totalIterations}`);
        console.log(`Tasks completed: ${event.tasksCompleted}`);
        break;

      case 'all:complete':
        console.log('\nAll tasks complete!');
        break;
    }
  });

  // Graceful shutdown handler
  const gracefulShutdown = async (): Promise<void> => {
    console.log('\nInterrupted, stopping gracefully...');
    console.log('(Press Ctrl+C again within 1s to force quit)');
    // Save interrupted state
    currentState = { ...currentState, status: 'interrupted' };
    await savePersistedSession(currentState);
    await engine.dispose();
    process.exit(0);
  };

  // Handle SIGINT with double-press detection
  const handleSigint = async (): Promise<void> => {
    const now = Date.now();
    const timeSinceLastSigint = now - lastSigintTime;
    lastSigintTime = now;

    // Check for double-press - force quit immediately
    if (timeSinceLastSigint < DOUBLE_PRESS_WINDOW_MS) {
      console.log('\nForce quit!');
      process.exit(1);
    }

    // Single press - graceful shutdown
    await gracefulShutdown();
  };

  // Handle SIGTERM (always graceful, no double-press)
  const handleSigterm = async (): Promise<void> => {
    console.log('\nReceived SIGTERM, stopping gracefully...');
    currentState = { ...currentState, status: 'interrupted' };
    await savePersistedSession(currentState);
    await engine.dispose();
    process.exit(0);
  };

  process.on('SIGINT', handleSigint);
  process.on('SIGTERM', handleSigterm);

  // Start the engine
  await engine.start();
  await engine.dispose();

  return currentState;
}

/**
 * Execute the run command
 */
export async function executeRunCommand(args: string[]): Promise<void> {
  // Check for help
  if (args.includes('--help') || args.includes('-h')) {
    printRunHelp();
    return;
  }

  // Parse arguments
  const options = parseRunArgs(args);
  const cwd = options.cwd ?? process.cwd();

  // Check if project config exists
  const configExists = await projectConfigExists(cwd);

  if (!configExists && !options.noSetup) {
    // No config found - offer to run setup
    console.log('');
    console.log('No .ralph-tui.yaml configuration found in this project.');
    console.log('');

    // Run the setup wizard
    const result = await runSetupWizard({ cwd });

    if (!result.success) {
      if (result.cancelled) {
        console.log('Run "ralph-tui setup" to configure later,');
        console.log('or use "ralph-tui run --no-setup" to skip setup.');
        return;
      }
      console.error('Setup failed:', result.error);
      process.exit(1);
    }

    // Setup completed, continue with run
    console.log('');
    console.log('Setup complete! Starting Ralph...');
    console.log('');
  } else if (!configExists && options.noSetup) {
    console.log('No .ralph-tui.yaml found. Using default configuration.');
  }

  console.log('Initializing Ralph TUI...');

  // Initialize plugins
  await initializePlugins();

  // Build configuration
  const config = await buildConfig(options);
  if (!config) {
    process.exit(1);
  }

  // Validate configuration
  const validation = await validateConfig(config);
  if (!validation.valid) {
    console.error('\nConfiguration errors:');
    for (const error of validation.errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  // Show warnings
  for (const warning of validation.warnings) {
    console.warn(`Warning: ${warning}`);
  }

  // Check for existing persisted session file
  const sessionCheck = await checkSession(config.cwd);
  const hasPersistedSessionFile = await hasPersistedSession(config.cwd);

  // Handle existing persisted session prompt first (before lock acquisition)
  if (hasPersistedSessionFile && !options.force && !options.resume) {
    const choice = await promptResumeOrNew(config.cwd);
    if (choice === 'abort') {
      process.exit(1);
    }
    // Delete old session file if starting fresh
    if (choice === 'new') {
      await deletePersistedSession(config.cwd);
    }
  }

  // Generate session ID early for lock acquisition
  const { randomUUID } = await import('node:crypto');
  const newSessionId = randomUUID();

  // Acquire lock with proper error messages and stale lock handling
  const lockResult = await acquireLockWithPrompt(config.cwd, newSessionId, {
    force: options.force,
    nonInteractive: options.headless,
  });

  if (!lockResult.acquired) {
    console.error(`\nError: ${lockResult.error}`);
    if (lockResult.existingPid) {
      console.error('  Use --force to override.');
    }
    process.exit(1);
  }

  // Register cleanup handlers to release lock on exit/crash
  const cleanupLockHandlers = registerLockCleanupHandlers(config.cwd);

  // Handle resume or new session
  let session;
  if (options.resume && sessionCheck.hasSession) {
    console.log('Resuming previous session...');
    session = await resumeSession(config.cwd);
    if (!session) {
      console.error('Failed to resume session');
      await releaseLockNew(config.cwd);
      cleanupLockHandlers();
      process.exit(1);
    }
  } else {
    // Create new session (task count will be updated after tracker init)
    // Note: Lock already acquired above, so createSession won't re-acquire
    session = await createSession({
      agentPlugin: config.agent.plugin,
      trackerPlugin: config.tracker.plugin,
      epicId: config.epicId,
      prdPath: config.prdPath,
      maxIterations: config.maxIterations,
      totalTasks: 0, // Will be updated
      cwd: config.cwd,
    });
  }

  console.log(`Session: ${session.id}`);
  console.log(`Agent: ${config.agent.plugin}`);
  console.log(`Tracker: ${config.tracker.plugin}`);
  if (config.epicId) {
    console.log(`Epic: ${config.epicId}`);
  }
  if (config.prdPath) {
    console.log(`PRD: ${config.prdPath}`);
  }
  console.log(`Max iterations: ${config.maxIterations || 'unlimited'}`);
  console.log('');

  // Create and initialize engine
  const engine = new ExecutionEngine(config);

  let tasks: TrackerTask[] = [];
  try {
    await engine.initialize();
    // Get tasks for persisted state
    const trackerRegistry = getTrackerRegistry();
    const tracker = await trackerRegistry.getInstance(config.tracker);
    tasks = await tracker.getTasks({ status: ['open', 'in_progress'] });
  } catch (error) {
    console.error(
      'Failed to initialize engine:',
      error instanceof Error ? error.message : error
    );
    await endSession(config.cwd, 'failed');
    await releaseLockNew(config.cwd);
    cleanupLockHandlers();
    process.exit(1);
  }

  // Create persisted session state
  let persistedState = createPersistedSession({
    sessionId: session.id,
    agentPlugin: config.agent.plugin,
    model: config.model,
    trackerPlugin: config.tracker.plugin,
    epicId: config.epicId,
    prdPath: config.prdPath,
    maxIterations: config.maxIterations,
    tasks,
    cwd: config.cwd,
  });

  // Save initial state
  await savePersistedSession(persistedState);

  // Run with TUI or headless
  try {
    if (config.showTui) {
      persistedState = await runWithTui(engine, persistedState, config);
    } else {
      persistedState = await runHeadless(engine, persistedState, config);
    }
  } catch (error) {
    console.error(
      'Execution error:',
      error instanceof Error ? error.message : error
    );
    // Save failed state
    persistedState = failSession(persistedState);
    await savePersistedSession(persistedState);
    await endSession(config.cwd, 'failed');
    await releaseLockNew(config.cwd);
    cleanupLockHandlers();
    process.exit(1);
  }

  // Check if all tasks completed successfully
  const finalState = engine.getState();
  const allComplete = finalState.tasksCompleted >= finalState.totalTasks ||
    finalState.status === 'idle';

  if (allComplete) {
    // Mark as completed and clean up session file
    persistedState = completeSession(persistedState);
    await savePersistedSession(persistedState);
    // Delete session file on successful completion
    await deletePersistedSession(config.cwd);
    console.log('\nSession completed successfully. Session file cleaned up.');
  } else {
    // Save current state (session remains resumable)
    await savePersistedSession(persistedState);
    console.log('\nSession state saved. Use "ralph-tui resume" to continue.');
  }

  // End session and clean up lock
  await endSession(config.cwd, allComplete ? 'completed' : 'interrupted');
  await releaseLockNew(config.cwd);
  cleanupLockHandlers();
  console.log('\nRalph TUI finished.');
}
