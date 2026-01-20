/**
 * ABOUTME: Beads-rust tracker plugin (br CLI) for projects using the Rust beads fork.
 * Provides environment detection for beads-rust by checking for a .beads directory
 * and the presence of the br executable.
 */

import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { BaseTrackerPlugin } from '../../base.js';
import type {
  TaskCompletionResult,
  TrackerPluginFactory,
  TrackerPluginMeta,
  TrackerTask,
  TrackerTaskStatus,
} from '../../types.js';

/**
 * Result of detect() operation.
 */
export interface BeadsRustDetectResult {
  available: boolean;
  beadsDir?: string;
  brPath?: string;
  brVersion?: string;
  error?: string;
}

/**
 * Execute a br command and return the output.
 */
async function execBr(
  args: string[],
  cwd?: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn('br', args, {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on('error', (err) => {
      stderr += err.message;
      resolve({ stdout, stderr, exitCode: 1 });
    });
  });
}

/**
 * Extract a version string from br --version output.
 *
 * Expected formats may include:
 * - "br version 1.2.3"
 * - "br 1.2.3"
 */
function extractBrVersion(stdout: string): string {
  const trimmed = stdout.trim();
  const match = trimmed.match(/\bbr\b(?:\s+version)?\s+(\S+)/i);
  return match?.[1] ?? 'unknown';
}

/**
 * Beads-rust tracker plugin implementation.
 *
 * Note: This initial implementation focuses on detection only.
 * Task operations are implemented incrementally in subsequent user stories.
 */
export class BeadsRustTrackerPlugin extends BaseTrackerPlugin {
  readonly meta: TrackerPluginMeta = {
    id: 'beads-rust',
    name: 'Beads Rust Issue Tracker',
    description: 'Track issues using the br (beads-rust) CLI',
    version: '1.0.0',
    supportsBidirectionalSync: true,
    supportsHierarchy: true,
    supportsDependencies: true,
  };

  /** Last detected br version (if available). */
  brVersion: string | undefined;

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    // Default readiness to false until we can detect beads-rust.
    const detection = await this.detect();
    this.ready = detection.available;
    this.brVersion = detection.brVersion;
  }

  /**
   * Detect if beads-rust is available in the current environment.
   * Checks for .beads/ directory and br binary.
   */
  async detect(): Promise<BeadsRustDetectResult> {
    const workingDir =
      typeof this.config.workingDir === 'string' ? this.config.workingDir : process.cwd();
    const beadsDir =
      typeof this.config.beadsDir === 'string' ? this.config.beadsDir : '.beads';

    // Check for .beads directory
    const beadsDirPath = join(workingDir, beadsDir);
    try {
      await access(beadsDirPath, constants.R_OK);
    } catch {
      return {
        available: false,
        error: `Beads directory not found: ${beadsDirPath}`,
      };
    }

    // Check for br binary
    const { stdout, stderr, exitCode } = await execBr(['--version'], workingDir);
    if (exitCode !== 0) {
      return {
        available: false,
        error: `br binary not available: ${stderr || stdout}`,
      };
    }

    const version = extractBrVersion(stdout);
    this.brVersion = version;

    return {
      available: true,
      beadsDir: beadsDirPath,
      brPath: 'br',
      brVersion: version,
    };
  }

  override async isReady(): Promise<boolean> {
    if (!this.ready) {
      const detection = await this.detect();
      this.ready = detection.available;
      this.brVersion = detection.brVersion;
    }
    return this.ready;
  }

  async getTasks(): Promise<TrackerTask[]> {
    // Implemented in US-2.
    return [];
  }

  async completeTask(id: string): Promise<TaskCompletionResult> {
    return {
      success: false,
      message: `beads-rust tracker is not yet able to close tasks (${id})`,
      error: 'Not implemented',
    };
  }

  async updateTaskStatus(
    _id: string,
    _status: TrackerTaskStatus
  ): Promise<TrackerTask | undefined> {
    // Implemented in US-5.
    return undefined;
  }
}

/**
 * Factory function for the Beads-rust tracker plugin.
 */
const createBeadsRustTracker: TrackerPluginFactory = () => new BeadsRustTrackerPlugin();

export default createBeadsRustTracker;
