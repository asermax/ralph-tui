/**
 * ABOUTME: Configuration constants for the Factory Droid agent plugin.
 * Defines default command and non-interactive CLI flags.
 */

export const DROID_DEFAULT_COMMAND = 'droid';

/**
 * The subcommand for non-interactive execution.
 * droid exec runs prompts without the interactive REPL.
 */
export const DROID_EXEC_SUBCOMMAND = 'exec';

/**
 * Flags always passed in non-interactive mode.
 * Empty array since exec subcommand handles non-interactive behavior.
 */
export const DROID_NON_INTERACTIVE_FLAGS = [] as const;
