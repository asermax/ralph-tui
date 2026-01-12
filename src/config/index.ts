/**
 * ABOUTME: Configuration loading and validation for Ralph TUI.
 * Handles loading global and project configs, merging them, and validating the result.
 * Supports: ~/.config/ralph-tui/config.toml (global) and .ralph-tui/config.toml (project).
 */

import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { readFile, access, constants, mkdir } from 'node:fs/promises';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import type {
  StoredConfig,
  RalphConfig,
  RuntimeOptions,
  ConfigValidationResult,
} from './types.js';
import { DEFAULT_CONFIG, DEFAULT_ERROR_HANDLING } from './types.js';
import type { ErrorHandlingConfig } from '../engine/types.js';
import type { AgentPluginConfig } from '../plugins/agents/types.js';
import type { TrackerPluginConfig } from '../plugins/trackers/types.js';
import { getAgentRegistry } from '../plugins/agents/registry.js';
import { getTrackerRegistry } from '../plugins/trackers/registry.js';
import {
  validateStoredConfig,
  formatConfigErrors,
  type ConfigParseResult,
} from './schema.js';

/**
 * Global config file path (~/.config/ralph-tui/config.toml)
 */
const GLOBAL_CONFIG_PATH = join(homedir(), '.config', 'ralph-tui', 'config.toml');

/**
 * Project config directory name (.ralph-tui in project root)
 */
const PROJECT_CONFIG_DIR = '.ralph-tui';

/**
 * Project config file name (config.toml inside .ralph-tui directory)
 */
const PROJECT_CONFIG_FILENAME = 'config.toml';

/**
 * Config source information for debugging
 */
export interface ConfigSource {
  /** Path to the global config (if it exists) */
  globalPath: string | null;
  /** Path to the project config (if it exists) */
  projectPath: string | null;
  /** Whether global config was loaded */
  globalLoaded: boolean;
  /** Whether project config was loaded */
  projectLoaded: boolean;
}

/**
 * Result of loading a config file
 */
interface LoadConfigResult {
  config: StoredConfig;
  exists: boolean;
  errors?: string;
}

/**
 * Load and validate a single TOML config file.
 * @param configPath Path to the config file
 * @returns Parsed and validated config, or empty object if file doesn't exist
 */
async function loadConfigFile(configPath: string): Promise<LoadConfigResult> {
  try {
    await access(configPath, constants.R_OK);
    const content = await readFile(configPath, 'utf-8');

    // Handle empty file
    if (!content.trim()) {
      return { config: {}, exists: true };
    }

    const parsed = parseToml(content);

    // Validate with Zod
    const result: ConfigParseResult = validateStoredConfig(parsed);
    if (!result.success) {
      const errorMsg = formatConfigErrors(result.errors ?? [], configPath);
      return { config: {}, exists: true, errors: errorMsg };
    }

    return { config: result.data as StoredConfig, exists: true };
  } catch {
    // File doesn't exist or can't be read
    return { config: {}, exists: false };
  }
}

/**
 * Find the project config file by searching up from cwd.
 * Looks for .ralph-tui/config.toml in each directory up to root.
 * @param startDir Directory to start searching from
 * @returns Path to project config if found, null otherwise
 */
async function findProjectConfigPath(startDir: string): Promise<string | null> {
  let dir = startDir;
  const root = dirname(dir);

  while (dir !== root) {
    const configPath = join(dir, PROJECT_CONFIG_DIR, PROJECT_CONFIG_FILENAME);
    try {
      await access(configPath, constants.R_OK);
      return configPath;
    } catch {
      // Not found, go up one level
      dir = dirname(dir);
    }
  }

  // Check root as well
  const rootConfig = join(root, PROJECT_CONFIG_DIR, PROJECT_CONFIG_FILENAME);
  try {
    await access(rootConfig, constants.R_OK);
    return rootConfig;
  } catch {
    return null;
  }
}

/**
 * Deep merge two config objects. Project config overrides global config.
 * Arrays are replaced (not merged) to give project full control.
 */
function mergeConfigs(global: StoredConfig, project: StoredConfig): StoredConfig {
  const merged: StoredConfig = { ...global };

  // Override scalar values from project
  if (project.defaultAgent !== undefined) merged.defaultAgent = project.defaultAgent;
  if (project.defaultTracker !== undefined) merged.defaultTracker = project.defaultTracker;
  if (project.maxIterations !== undefined) merged.maxIterations = project.maxIterations;
  if (project.iterationDelay !== undefined) merged.iterationDelay = project.iterationDelay;
  if (project.outputDir !== undefined) merged.outputDir = project.outputDir;
  if (project.agent !== undefined) merged.agent = project.agent;
  if (project.tracker !== undefined) merged.tracker = project.tracker;

  // Replace arrays entirely if present in project config
  if (project.agents !== undefined) merged.agents = project.agents;
  if (project.trackers !== undefined) merged.trackers = project.trackers;

  // Merge nested objects
  if (project.agentOptions !== undefined) {
    merged.agentOptions = { ...merged.agentOptions, ...project.agentOptions };
  }
  if (project.trackerOptions !== undefined) {
    merged.trackerOptions = { ...merged.trackerOptions, ...project.trackerOptions };
  }
  if (project.errorHandling !== undefined) {
    merged.errorHandling = { ...merged.errorHandling, ...project.errorHandling };
  }

  // Override prompt template
  if (project.prompt_template !== undefined) {
    merged.prompt_template = project.prompt_template;
  }

  return merged;
}

/**
 * Load stored configuration from global and project YAML files.
 * Project config (.ralph-tui/config.toml) overrides global config (~/.config/ralph-tui/config.toml).
 * @param cwd Working directory for finding project config
 * @param globalConfigPath Override global config path (for testing)
 * @returns Merged configuration
 */
export async function loadStoredConfig(
  cwd: string = process.cwd(),
  globalConfigPath: string = GLOBAL_CONFIG_PATH
): Promise<StoredConfig> {
  // Load global config
  const globalResult = await loadConfigFile(globalConfigPath);
  if (globalResult.errors) {
    console.error(globalResult.errors);
  }

  // Find and load project config
  const projectPath = await findProjectConfigPath(cwd);
  let projectResult: LoadConfigResult = { config: {}, exists: false };
  if (projectPath) {
    projectResult = await loadConfigFile(projectPath);
    if (projectResult.errors) {
      console.error(projectResult.errors);
    }
  }

  // Merge configs (project overrides global)
  return mergeConfigs(globalResult.config, projectResult.config);
}

/**
 * Load stored configuration with source information.
 * Useful for debugging and the 'config show' command.
 * @param cwd Working directory for finding project config
 * @param globalConfigPath Override global config path (for testing)
 * @returns Config and source information
 */
export async function loadStoredConfigWithSource(
  cwd: string = process.cwd(),
  globalConfigPath: string = GLOBAL_CONFIG_PATH
): Promise<{ config: StoredConfig; source: ConfigSource }> {
  // Load global config
  const globalResult = await loadConfigFile(globalConfigPath);
  if (globalResult.errors) {
    console.error(globalResult.errors);
  }

  // Find and load project config
  const projectPath = await findProjectConfigPath(cwd);
  let projectResult: LoadConfigResult = { config: {}, exists: false };
  if (projectPath) {
    projectResult = await loadConfigFile(projectPath);
    if (projectResult.errors) {
      console.error(projectResult.errors);
    }
  }

  // Build source info
  const source: ConfigSource = {
    globalPath: globalResult.exists ? globalConfigPath : null,
    projectPath: projectResult.exists && projectPath ? projectPath : null,
    globalLoaded: globalResult.exists,
    projectLoaded: projectResult.exists,
  };

  // Merge configs (project overrides global)
  return {
    config: mergeConfigs(globalResult.config, projectResult.config),
    source,
  };
}

/**
 * Serialize configuration to TOML string.
 * @param config Configuration to serialize
 * @returns TOML string
 */
export function serializeConfig(config: StoredConfig): string {
  return stringifyToml(config);
}

/**
 * Get default agent configuration based on available plugins
 */
function getDefaultAgentConfig(
  storedConfig: StoredConfig,
  options: RuntimeOptions
): AgentPluginConfig | undefined {
  const registry = getAgentRegistry();
  const plugins = registry.getRegisteredPlugins();

  // Helper to apply agentOptions shorthand to config
  const applyAgentOptions = (config: AgentPluginConfig): AgentPluginConfig => {
    if (storedConfig.agentOptions) {
      return {
        ...config,
        options: { ...config.options, ...storedConfig.agentOptions },
      };
    }
    return config;
  };

  // Check CLI override first
  if (options.agent) {
    const found = storedConfig.agents?.find(
      (a) => a.name === options.agent || a.plugin === options.agent
    );
    if (found) return applyAgentOptions(found);

    // Create minimal config for the specified plugin
    if (registry.hasPlugin(options.agent)) {
      return applyAgentOptions({
        name: options.agent,
        plugin: options.agent,
        options: {},
      });
    }
    return undefined;
  }

  // Check shorthand agent field (e.g., agent = "claude" in TOML)
  if (storedConfig.agent) {
    // First check if it matches a configured agent in agents array
    const found = storedConfig.agents?.find(
      (a) => a.name === storedConfig.agent || a.plugin === storedConfig.agent
    );
    if (found) return applyAgentOptions(found);

    // Create config for the shorthand plugin
    if (registry.hasPlugin(storedConfig.agent)) {
      return applyAgentOptions({
        name: storedConfig.agent,
        plugin: storedConfig.agent,
        options: {},
      });
    }
  }

  // Check stored default
  if (storedConfig.defaultAgent) {
    const found = storedConfig.agents?.find(
      (a) => a.name === storedConfig.defaultAgent
    );
    if (found) return applyAgentOptions(found);
  }

  // Use first available agent from config
  if (storedConfig.agents && storedConfig.agents.length > 0) {
    const defaultAgent = storedConfig.agents.find((a) => a.default);
    return applyAgentOptions(defaultAgent ?? storedConfig.agents[0]!);
  }

  // Fall back to first built-in plugin (claude)
  const firstPlugin = plugins.find((p) => p.id === 'claude') ?? plugins[0];
  if (firstPlugin) {
    return applyAgentOptions({
      name: firstPlugin.id,
      plugin: firstPlugin.id,
      options: {},
    });
  }

  return undefined;
}

/**
 * Get default tracker configuration based on available plugins
 */
function getDefaultTrackerConfig(
  storedConfig: StoredConfig,
  options: RuntimeOptions
): TrackerPluginConfig | undefined {
  const registry = getTrackerRegistry();
  const plugins = registry.getRegisteredPlugins();

  // Helper to apply trackerOptions shorthand to config
  const applyTrackerOptions = (config: TrackerPluginConfig): TrackerPluginConfig => {
    if (storedConfig.trackerOptions) {
      return {
        ...config,
        options: { ...config.options, ...storedConfig.trackerOptions },
      };
    }
    return config;
  };

  // Check CLI override first
  if (options.tracker) {
    const found = storedConfig.trackers?.find(
      (t) => t.name === options.tracker || t.plugin === options.tracker
    );
    if (found) return applyTrackerOptions(found);

    // Create minimal config for the specified plugin
    if (registry.hasPlugin(options.tracker)) {
      return applyTrackerOptions({
        name: options.tracker,
        plugin: options.tracker,
        options: {},
      });
    }
    return undefined;
  }

  // Check shorthand tracker field (e.g., tracker = "beads-bv" in TOML)
  if (storedConfig.tracker) {
    // First check if it matches a configured tracker in trackers array
    const found = storedConfig.trackers?.find(
      (t) => t.name === storedConfig.tracker || t.plugin === storedConfig.tracker
    );
    if (found) return applyTrackerOptions(found);

    // Create config for the shorthand plugin
    if (registry.hasPlugin(storedConfig.tracker)) {
      return applyTrackerOptions({
        name: storedConfig.tracker,
        plugin: storedConfig.tracker,
        options: {},
      });
    }
  }

  // Check stored default
  if (storedConfig.defaultTracker) {
    const found = storedConfig.trackers?.find(
      (t) => t.name === storedConfig.defaultTracker
    );
    if (found) return applyTrackerOptions(found);
  }

  // Use first available tracker from config
  if (storedConfig.trackers && storedConfig.trackers.length > 0) {
    const defaultTracker = storedConfig.trackers.find((t) => t.default);
    return applyTrackerOptions(defaultTracker ?? storedConfig.trackers[0]!);
  }

  // Fall back to first built-in plugin (beads-bv)
  const firstPlugin = plugins.find((p) => p.id === 'beads-bv') ?? plugins[0];
  if (firstPlugin) {
    return applyTrackerOptions({
      name: firstPlugin.id,
      plugin: firstPlugin.id,
      options: {},
    });
  }

  return undefined;
}

/**
 * Build runtime configuration by merging stored config with CLI options.
 * Loads both global (~/.config/ralph-tui/config.toml) and project (.ralph-tui/config.toml) configs.
 */
export async function buildConfig(
  options: RuntimeOptions = {}
): Promise<RalphConfig | null> {
  const cwd = options.cwd ?? process.cwd();
  const storedConfig = await loadStoredConfig(cwd);

  // Get agent config
  const agentConfig = getDefaultAgentConfig(storedConfig, options);
  if (!agentConfig) {
    console.error('Error: No agent configured or available');
    return null;
  }

  // Get tracker config
  const trackerConfig = getDefaultTrackerConfig(storedConfig, options);
  if (!trackerConfig) {
    console.error('Error: No tracker configured or available');
    return null;
  }

  // Apply epic/prd options to tracker
  if (options.epicId) {
    trackerConfig.options = {
      ...trackerConfig.options,
      epicId: options.epicId,
    };
  }
  if (options.prdPath) {
    trackerConfig.options = {
      ...trackerConfig.options,
      prdPath: options.prdPath,
    };
  }

  // Build error handling config, applying CLI overrides
  const errorHandling: ErrorHandlingConfig = {
    ...DEFAULT_ERROR_HANDLING,
    ...(storedConfig.errorHandling ?? {}),
    ...(options.onError ? { strategy: options.onError } : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
  };

  return {
    agent: agentConfig,
    tracker: trackerConfig,
    maxIterations:
      options.iterations ??
      storedConfig.maxIterations ??
      DEFAULT_CONFIG.maxIterations,
    iterationDelay:
      options.iterationDelay ??
      storedConfig.iterationDelay ??
      DEFAULT_CONFIG.iterationDelay,
    cwd: options.cwd ?? DEFAULT_CONFIG.cwd,
    outputDir: options.outputDir ?? storedConfig.outputDir ?? DEFAULT_CONFIG.outputDir,
    epicId: options.epicId,
    prdPath: options.prdPath,
    model: options.model,
    showTui: !options.headless,
    errorHandling,
    // CLI --prompt takes precedence over config file prompt_template
    promptTemplate: options.promptPath ?? storedConfig.prompt_template,
  };
}

/**
 * Validate configuration before starting
 */
export async function validateConfig(
  config: RalphConfig
): Promise<ConfigValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate agent plugin exists
  const agentRegistry = getAgentRegistry();
  if (!agentRegistry.hasPlugin(config.agent.plugin)) {
    errors.push(`Agent plugin '${config.agent.plugin}' not found`);
  }

  // Validate tracker plugin exists
  const trackerRegistry = getTrackerRegistry();
  if (!trackerRegistry.hasPlugin(config.tracker.plugin)) {
    errors.push(`Tracker plugin '${config.tracker.plugin}' not found`);
  }

  // Validate tracker-specific requirements
  if (
    config.tracker.plugin === 'beads' ||
    config.tracker.plugin === 'beads-bv'
  ) {
    if (!config.epicId) {
      warnings.push(
        'No epic ID specified for beads tracker; will use current directory'
      );
    }
  }

  if (config.tracker.plugin === 'json') {
    if (!config.prdPath) {
      errors.push('PRD path required for json tracker');
    }
  }

  // Validate iterations
  if (config.maxIterations < 0) {
    errors.push('Max iterations must be 0 or greater');
  }

  // Validate delay
  if (config.iterationDelay < 0) {
    errors.push('Iteration delay must be 0 or greater');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// Re-export types
export type { StoredConfig, RalphConfig, RuntimeOptions, ConfigValidationResult };
export { DEFAULT_CONFIG };

// Export schema utilities
export {
  validateStoredConfig,
  formatConfigErrors,
  StoredConfigSchema,
  AgentPluginConfigSchema,
  TrackerPluginConfigSchema,
  ErrorHandlingConfigSchema,
} from './schema.js';
export type {
  ConfigParseResult,
  ConfigValidationError,
  StoredConfigValidated,
} from './schema.js';

/**
 * Save configuration to the project config file (.ralph-tui/config.toml).
 * Creates the directory and file if they don't exist, updates if they do.
 * @param config Configuration to save
 * @param cwd Working directory (config will be saved in this directory)
 */
export async function saveProjectConfig(
  config: StoredConfig,
  cwd: string = process.cwd()
): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  const configDir = join(cwd, PROJECT_CONFIG_DIR);
  const projectPath = join(configDir, PROJECT_CONFIG_FILENAME);

  // Ensure the .ralph-tui directory exists
  await mkdir(configDir, { recursive: true });

  const toml = serializeConfig(config);
  await writeFile(projectPath, toml, 'utf-8');
}

/**
 * Get the project config file path for a given working directory.
 * @param cwd Working directory
 * @returns Path to the project config file
 */
export function getProjectConfigPath(cwd: string = process.cwd()): string {
  return join(cwd, PROJECT_CONFIG_DIR, PROJECT_CONFIG_FILENAME);
}

/**
 * Get the project config directory path for a given working directory.
 * @param cwd Working directory
 * @returns Path to the project config directory
 */
export function getProjectConfigDir(cwd: string = process.cwd()): string {
  return join(cwd, PROJECT_CONFIG_DIR);
}

// Constants for external use
export const CONFIG_PATHS = {
  global: GLOBAL_CONFIG_PATH,
  projectDir: PROJECT_CONFIG_DIR,
  projectFilename: PROJECT_CONFIG_FILENAME,
} as const;
