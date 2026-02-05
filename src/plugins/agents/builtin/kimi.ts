/**
 * ABOUTME: Kimi Code CLI agent plugin for Moonshot AI's kimi-cli command.
 * Integrates with Kimi Code CLI for AI-assisted coding.
 * Supports: print mode execution, model selection, streaming JSONL output.
 */

import { spawn } from 'node:child_process';
import { BaseAgentPlugin, findCommandPath, quoteForWindowsShell } from '../base.js';
import { processAgentEvents, processAgentEventsToSegments, type AgentDisplayEvent } from '../output-formatting.js';
import type {
  AgentPluginMeta,
  AgentPluginFactory,
  AgentFileContext,
  AgentExecuteOptions,
  AgentSetupQuestion,
  AgentDetectResult,
  AgentExecutionHandle,
} from '../types.js';

/**
 * Represents a parsed JSONL message from Kimi Code CLI output.
 * Kimi Code CLI emits various event types as JSON objects, one per line.
 */
export interface KimiJsonlMessage {
  /** The type of message (e.g., 'assistant', 'user', 'result', 'system') */
  type?: string;
  /** Message content for text messages */
  message?: string;
  /** Tool use information if applicable */
  tool?: {
    name?: string;
    input?: Record<string, unknown>;
  };
  /** Result data for completion messages */
  result?: unknown;
  /** Cost information if provided */
  cost?: {
    inputTokens?: number;
    outputTokens?: number;
    totalUSD?: number;
  };
  /** Session ID for conversation tracking */
  sessionId?: string;
  /** Raw parsed JSON for custom handling */
  raw: Record<string, unknown>;
}

/**
 * Result of parsing a JSONL line.
 * Success contains the parsed message, failure contains the raw text.
 */
export type KimiJsonlParseResult =
  | { success: true; message: KimiJsonlMessage }
  | { success: false; raw: string; error: string };

/**
 * Valid Kimi model names for the --model flag.
 * Only kimi-for-coding is supported for programmatic use.
 * Empty string means use default (configured in kimi config).
 */
const VALID_KIMI_MODELS = [
  '',
  'kimi-for-coding',
] as const;

/**
 * Kimi Code CLI agent plugin implementation.
 * Uses the `kimi` CLI to execute AI coding tasks.
 *
 * Key features:
 * - Auto-detects kimi binary using `which`
 * - Executes in print mode (--print) for non-interactive use
 * - Supports model selection via --model flag
 * - Timeout handling with graceful SIGINT before SIGTERM
 * - Streaming stdout/stderr capture
 * - JSONL output parsing for subagent tracing
 */
export class KimiAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'kimi',
    name: 'Kimi Code',
    description: 'Moonshot AI Kimi Code CLI for AI-assisted coding',
    version: '1.0.0',
    author: 'Moonshot AI',
    defaultCommand: 'kimi',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: false, // Kimi doesn't support file context flags
    supportsSubagentTracing: true,
    structuredOutputFormat: 'jsonl',
    // Kimi CLI supports skills in ~/.kimi/skills/ (personal) and .kimi/skills/ (repo)
    skillsPaths: {
      personal: '~/.kimi/skills',
      repo: '.kimi/skills',
    },
  };

  /** Output mode: text or stream-json */
  private outputMode: 'text' | 'stream-json' = 'text';

  /** Model to use (e.g., 'kimi-k2-0711-preview') */
  private model?: string;

  /** Enable thinking mode */
  private thinking?: boolean;

  /** Timeout in milliseconds (0 = no timeout) */
  protected override defaultTimeout = 0;

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    if (
      typeof config.outputMode === 'string' &&
      ['text', 'stream-json'].includes(config.outputMode)
    ) {
      this.outputMode = config.outputMode as 'text' | 'stream-json';
    }

    if (typeof config.model === 'string' && config.model.length > 0) {
      this.model = config.model;
    }

    if (typeof config.thinking === 'boolean') {
      this.thinking = config.thinking;
    }

    if (typeof config.timeout === 'number' && config.timeout > 0) {
      this.defaultTimeout = config.timeout;
    }
  }

  /**
   * Detect kimi CLI availability.
   * Uses platform-appropriate command (where on Windows, which on Unix).
   */
  override async detect(): Promise<AgentDetectResult> {
    const command = this.commandPath ?? this.meta.defaultCommand;

    // First, try to find the binary in PATH
    const findResult = await findCommandPath(command);

    if (!findResult.found) {
      return {
        available: false,
        error: `Kimi CLI not found in PATH. Install with: uv tool install kimi-cli`,
      };
    }

    // Store the resolved path for execute() to use
    this.commandPath = findResult.path;

    // Verify the binary works by running --version
    const versionResult = await this.runVersion(findResult.path);

    if (!versionResult.success) {
      return {
        available: false,
        executablePath: findResult.path,
        error: versionResult.error,
      };
    }

    return {
      available: true,
      version: versionResult.version,
      executablePath: findResult.path,
    };
  }

  override getSandboxRequirements() {
    return {
      authPaths: ['~/.kimi'],
      binaryPaths: ['~/.local/bin', '~/.cargo/bin'],
      runtimePaths: ['~/.uv', '~/.local/share/uv'],
      requiresNetwork: true,
    };
  }

  /**
   * Run --version to verify binary and extract version number
   */
  private runVersion(
    command: string
  ): Promise<{ success: boolean; version?: string; error?: string }> {
    return new Promise((resolve) => {
      const useShell = process.platform === 'win32';
      const proc = spawn(useShell ? quoteForWindowsShell(command) : command, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: useShell,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        resolve({
          success: false,
          error: `Failed to execute: ${error.message}`,
        });
      });

      proc.on('close', (code) => {
        if (code === 0) {
          // Extract version from output (e.g., "kimi 1.0.0")
          const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
          resolve({
            success: true,
            version: versionMatch?.[1],
          });
        } else {
          resolve({
            success: false,
            error: stderr || `Exited with code ${code}`,
          });
        }
      });

      // Timeout after 15 seconds
      setTimeout(() => {
        proc.kill();
        resolve({ success: false, error: 'Timeout waiting for --version' });
      }, 15000);
    });
  }

  override getSetupQuestions(): AgentSetupQuestion[] {
    const baseQuestions = super.getSetupQuestions();
    return [
      ...baseQuestions,
      {
        id: 'outputMode',
        prompt: 'Output mode:',
        type: 'select',
        choices: [
          {
            value: 'text',
            label: 'Text',
            description: 'Plain text output (default)',
          },
          {
            value: 'stream-json',
            label: 'Stream JSON',
            description: 'Streaming JSONL for real-time feedback and subagent tracing',
          },
        ],
        default: 'text',
        required: false,
        help: 'How Kimi should output its responses',
      },
      {
        id: 'model',
        prompt: 'Model to use:',
        type: 'select',
        choices: [
          { value: '', label: 'Default', description: 'Use configured default model' },
          {
            value: 'kimi-for-coding',
            label: 'Kimi for Coding',
            description: 'Optimized for coding tasks',
          },
        ],
        default: '',
        required: false,
        help: 'Kimi model variant to use for this agent',
      },
      {
        id: 'thinking',
        prompt: 'Enable thinking mode?',
        type: 'boolean',
        default: false,
        required: false,
        help: 'Enable thinking mode for models that support it',
      },
    ];
  }

  protected buildArgs(
    prompt: string,
    _files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): string[] {
    const args: string[] = [];

    // Add print mode flag for non-interactive output (--print implies --yolo)
    args.push('--print');

    // Add output format for structured JSONL streaming
    const useStreamJson =
      options?.subagentTracing || this.outputMode === 'stream-json';
    if (useStreamJson) {
      args.push('--output-format', 'stream-json');
    } else {
      args.push('--output-format', 'text');
    }

    // Add model if specified (from config or passed in options)
    const modelToUse = options?.flags?.find((f) => f.startsWith('--model'))
      ? undefined // Model passed via flags
      : this.model;
    if (modelToUse) {
      args.push('--model', modelToUse);
    }

    // Add thinking mode if specified
    if (this.thinking === true) {
      args.push('--thinking');
    } else if (this.thinking === false) {
      args.push('--no-thinking');
    }

    // Add prompt directly as argument
    // Kimi CLI doesn't support stdin with --prompt -, so we pass it directly
    args.push('--prompt', prompt);

    return args;
  }

  /**
   * Parse a Kimi JSONL line into standardized display events.
   * Returns AgentDisplayEvent[] - the shared processAgentEvents decides what to show.
   *
   * Kimi CLI stream-json format is similar to Claude's:
   * - "assistant": AI responses with content
   * - "user": Tool results
   * - "system": System events
   * - "result": Final result summary
   * - "error": Error messages
   */
  private parseKimiJsonLine(jsonLine: string): AgentDisplayEvent[] {
    if (!jsonLine || jsonLine.length === 0) return [];

    try {
      const event = JSON.parse(jsonLine) as Record<string, unknown>;
      const events: AgentDisplayEvent[] = [];

      // Parse assistant messages
      if (event.type === 'assistant' && event.message) {
        const message = event.message as { content?: Array<Record<string, unknown>>; text?: string };
        if (message.content && Array.isArray(message.content)) {
          for (const block of message.content) {
            if (block.type === 'text' && typeof block.text === 'string') {
              events.push({ type: 'text', content: block.text });
            } else if (block.type === 'tool_use' && typeof block.name === 'string') {
              events.push({
                type: 'tool_use',
                name: block.name,
                input: block.input as Record<string, unknown>,
              });
            }
          }
        } else if (typeof message.text === 'string') {
          // Simple text format
          events.push({ type: 'text', content: message.text });
        }
      }

      // Parse user/tool_result events
      if (event.type === 'user') {
        const message = event.message as { content?: Array<Record<string, unknown>> } | undefined;
        if (message?.content && Array.isArray(message.content)) {
          for (const block of message.content) {
            if (block.type === 'tool_result' && block.is_error === true) {
              const errorContent =
                typeof block.content === 'string'
                  ? block.content
                  : 'tool execution failed';
              events.push({ type: 'error', message: errorContent });
            }
          }
        }
        events.push({ type: 'tool_result' });
      }

      // Parse system events
      if (event.type === 'system') {
        events.push({ type: 'system', subtype: event.subtype as string });
      }

      // Parse error events
      if (event.type === 'error' || event.error) {
        const errorMsg =
          typeof event.error === 'string'
            ? event.error
            : (event.error as { message?: string })?.message ?? 'Unknown error';
        events.push({ type: 'error', message: errorMsg });
      }

      return events;
    } catch {
      // Not valid JSON - skip
      return [];
    }
  }

  /**
   * Parse Kimi stream output into display events.
   */
  private parseKimiOutputToEvents(data: string): AgentDisplayEvent[] {
    const allEvents: AgentDisplayEvent[] = [];
    for (const line of data.split('\n')) {
      const events = this.parseKimiJsonLine(line.trim());
      allEvents.push(...events);
    }
    return allEvents;
  }

  /**
   * Override execute to parse Kimi JSONL output for display.
   * Wraps the onStdout/onStdoutSegments callbacks to format tool calls and messages.
   */
  override execute(
    prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): AgentExecutionHandle {
    // Determine if we're using streaming JSON
    const isStreamingJson =
      options?.subagentTracing || this.outputMode === 'stream-json';

    const parsedOptions: AgentExecuteOptions = {
      ...options,
      // Wrap stdout callback to parse JSONL events when using stream-json output
      onStdout: isStreamingJson && (options?.onStdout || options?.onStdoutSegments || options?.onJsonlMessage)
        ? (data: string) => {
            // Parse each line for JSONL messages and display events
            for (const line of data.split('\n')) {
              const trimmed = line.trim();
              if (!trimmed) continue;

              // Try to parse as JSON and call the raw JSONL message callback
              if (options?.onJsonlMessage) {
                try {
                  const rawJson = JSON.parse(trimmed) as Record<string, unknown>;
                  options.onJsonlMessage(rawJson);
                } catch {
                  // Not valid JSON, skip for JSONL callback
                }
              }
            }

            // Also parse for display events
            const events = this.parseKimiOutputToEvents(data);
            if (events.length > 0) {
              // Call TUI-native segments callback if provided
              if (options?.onStdoutSegments) {
                const segments = processAgentEventsToSegments(events);
                if (segments.length > 0) {
                  options.onStdoutSegments(segments);
                }
              }
              // Also call legacy string callback if provided
              if (options?.onStdout) {
                const parsed = processAgentEvents(events);
                if (parsed.length > 0) {
                  options.onStdout(parsed);
                }
              }
            }
          }
        : options?.onStdout,
    };

    return super.execute(prompt, files, parsedOptions);
  }

  override async validateSetup(
    answers: Record<string, unknown>
  ): Promise<string | null> {
    // Validate output mode
    const outputMode = answers.outputMode;
    if (
      outputMode !== undefined &&
      outputMode !== '' &&
      !['text', 'stream-json'].includes(String(outputMode))
    ) {
      return 'Invalid output mode. Must be one of: text, stream-json';
    }

    // Validate model if provided
    const model = answers.model;
    if (
      model !== undefined &&
      model !== '' &&
      !VALID_KIMI_MODELS.includes(model as typeof VALID_KIMI_MODELS[number])
    ) {
      return `Invalid model. Must be one of: ${VALID_KIMI_MODELS.filter((m) => m).join(', ')} (or leave empty for default)`;
    }

    return null;
  }

  /**
   * Validate a model name for the Kimi agent.
   */
  override validateModel(model: string): string | null {
    if (model === '' || model === undefined) {
      return null; // Empty is valid (uses default)
    }
    if (!VALID_KIMI_MODELS.includes(model as typeof VALID_KIMI_MODELS[number])) {
      return `Invalid model "${model}". Kimi agent accepts: ${VALID_KIMI_MODELS.filter((m) => m).join(', ')}`;
    }
    return null;
  }

  /**
   * Get Kimi-specific suggestions for preflight failures.
   */
  protected override getPreflightSuggestion(): string {
    return (
      'Common fixes for Kimi Code:\n' +
      '  1. Test Kimi CLI directly: kimi "hello"\n' +
      '  2. Verify your Kimi account: kimi login\n' +
      '  3. Check Kimi CLI is installed: kimi --version\n' +
      '  4. Ensure you have a valid API key configured in ~/.kimi/config.toml\n' +
      '  5. Install via: uv tool install kimi-cli'
    );
  }

  /**
   * Parse a single line of JSONL output from Kimi Code CLI.
   */
  static parseJsonlLine(line: string): KimiJsonlParseResult {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      return { success: false, raw: line, error: 'Empty line' };
    }

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;

      // Build the structured message from parsed JSON
      const message: KimiJsonlMessage = {
        raw: parsed,
      };

      // Extract common fields if present
      if (typeof parsed.type === 'string') {
        message.type = parsed.type;
      }
      if (typeof parsed.message === 'string') {
        message.message = parsed.message;
      }
      if (typeof parsed.sessionId === 'string') {
        message.sessionId = parsed.sessionId;
      }
      if (parsed.result !== undefined) {
        message.result = parsed.result;
      }

      // Extract tool information if present
      if (parsed.tool && typeof parsed.tool === 'object') {
        const toolObj = parsed.tool as Record<string, unknown>;
        message.tool = {
          name: typeof toolObj.name === 'string' ? toolObj.name : undefined,
          input:
            toolObj.input && typeof toolObj.input === 'object'
              ? (toolObj.input as Record<string, unknown>)
              : undefined,
        };
      }

      // Extract cost information if present
      if (parsed.cost && typeof parsed.cost === 'object') {
        const costObj = parsed.cost as Record<string, unknown>;
        message.cost = {
          inputTokens:
            typeof costObj.inputTokens === 'number'
              ? costObj.inputTokens
              : undefined,
          outputTokens:
            typeof costObj.outputTokens === 'number'
              ? costObj.outputTokens
              : undefined,
          totalUSD:
            typeof costObj.totalUSD === 'number' ? costObj.totalUSD : undefined,
        };
      }

      return { success: true, message };
    } catch (err) {
      return {
        success: false,
        raw: line,
        error: err instanceof Error ? err.message : 'Parse error',
      };
    }
  }

  /**
   * Parse a complete JSONL output string from Kimi Code CLI.
   */
  static parseJsonlOutput(output: string): {
    messages: KimiJsonlMessage[];
    fallback: string[];
  } {
    const messages: KimiJsonlMessage[] = [];
    const fallback: string[] = [];

    const lines = output.split('\n');

    for (const line of lines) {
      const result = KimiAgentPlugin.parseJsonlLine(line);
      if (result.success) {
        messages.push(result.message);
      } else if (result.raw.trim()) {
        fallback.push(result.raw);
      }
    }

    return { messages, fallback };
  }

  /**
   * Create a streaming JSONL parser that accumulates partial lines.
   */
  static createStreamingJsonlParser(): {
    push: (chunk: string) => KimiJsonlParseResult[];
    flush: () => KimiJsonlParseResult[];
    getState: () => { messages: KimiJsonlMessage[]; fallback: string[] };
  } {
    let buffer = '';
    const messages: KimiJsonlMessage[] = [];
    const fallback: string[] = [];

    return {
      push(chunk: string): KimiJsonlParseResult[] {
        buffer += chunk;
        const results: KimiJsonlParseResult[] = [];

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          const result = KimiAgentPlugin.parseJsonlLine(line);
          results.push(result);

          if (result.success) {
            messages.push(result.message);
          } else if (result.raw.trim()) {
            fallback.push(result.raw);
          }
        }

        return results;
      },

      flush(): KimiJsonlParseResult[] {
        if (!buffer.trim()) {
          buffer = '';
          return [];
        }

        const result = KimiAgentPlugin.parseJsonlLine(buffer);
        buffer = '';

        if (result.success) {
          messages.push(result.message);
        } else if (result.raw.trim()) {
          fallback.push(result.raw);
        }

        return [result];
      },

      getState(): { messages: KimiJsonlMessage[]; fallback: string[] } {
        return { messages, fallback };
      },
    };
  }
}

/**
 * Factory function for the Kimi Code agent plugin.
 */
const createKimiAgent: AgentPluginFactory = () => new KimiAgentPlugin();

export default createKimiAgent;
