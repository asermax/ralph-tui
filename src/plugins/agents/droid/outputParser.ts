/**
 * ABOUTME: Parses Factory Droid JSONL streaming output for tracing metrics.
 * Extracts tool calls, assistant messages, result events, errors, and usage costs.
 */

import type { ClaudeJsonlMessage } from '../builtin/claude.js';

export interface DroidToolCall {
  id?: string;
  name: string;
  arguments?: Record<string, unknown> | string;
}

export interface DroidToolResult {
  toolUseId?: string;
  content?: string;
  isError?: boolean;
  status?: string;
}

export interface DroidCostEvent {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  totalUSD?: number;
}

export interface DroidCostSummary {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  totalUSD: number;
  events: number;
}

export interface DroidErrorInfo {
  message: string;
  code?: string;
  status?: number;
}

export interface DroidJsonlMessage {
  source: 'droid';
  type?: string;
  message?: string;
  result?: string;
  toolCalls?: DroidToolCall[];
  toolResults?: DroidToolResult[];
  error?: DroidErrorInfo;
  cost?: DroidCostEvent;
  raw: Record<string, unknown>;
}

export type DroidJsonlParseResult =
  | { success: true; message: DroidJsonlMessage }
  | { success: false; raw: string; error: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>;
  }
  return null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function extractTextFromContent(content: unknown): string | undefined {
  if (typeof content === 'string') {
    return content.trim() ? content : undefined;
  }

  if (Array.isArray(content)) {
    const parts = content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        const record = asRecord(item);
        return readString(record?.text) ?? readString(record?.content);
      })
      .filter((item): item is string => !!item);

    if (parts.length > 0) {
      return parts.join('');
    }
  }

  const record = asRecord(content);
  if (record) {
    return readString(record.text) ?? readString(record.content);
  }

  return undefined;
}

function extractMessageText(payload: Record<string, unknown>): string | undefined {
  const directMessage = extractTextFromContent(payload.message);
  if (directMessage) {
    return directMessage;
  }

  const contentMessage = extractTextFromContent(payload.content);
  if (contentMessage) {
    return contentMessage;
  }

  const deltaMessage = extractTextFromContent(payload.delta);
  if (deltaMessage) {
    return deltaMessage;
  }

  return readString(payload.text);
}

function extractResultText(payload: Record<string, unknown>): string | undefined {
  const resultText = extractTextFromContent(payload.result);
  if (resultText) {
    return resultText;
  }

  const outputText = extractTextFromContent(payload.output);
  if (outputText) {
    return outputText;
  }

  const finalText = extractTextFromContent(payload.finalText ?? payload.final_text);
  if (finalText) {
    return finalText;
  }

  return undefined;
}

function parseToolCall(value: unknown): DroidToolCall | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const name =
    readString(record.name) ??
    readString(record.tool_name) ??
    readString(record.toolName) ??
    readString(record.tool_id) ??
    readString(record.toolId);

  if (!name) {
    return null;
  }

  const args = record.arguments ?? record.args ?? record.input ?? record.parameters;
  const id =
    readString(record.id) ??
    readString(record.tool_use_id) ??
    readString(record.toolUseId) ??
    readString(record.call_id) ??
    readString(record.callId);

  if (typeof args === 'string' || (typeof args === 'object' && args !== null)) {
    return {
      id,
      name,
      arguments: typeof args === 'string' ? args : (args as Record<string, unknown>),
    };
  }

  return { id, name };
}

function extractToolCalls(payload: Record<string, unknown>): DroidToolCall[] {
  const calls: DroidToolCall[] = [];
  const toolCalls = payload.tool_calls ?? payload.toolCalls;

  if (Array.isArray(toolCalls)) {
    for (const call of toolCalls) {
      const parsed = parseToolCall(call);
      if (parsed) {
        calls.push(parsed);
      }
    }
  }

  const singleTool = payload.tool_call ?? payload.toolCall ?? payload.tool;
  const parsedSingle = parseToolCall(singleTool);
  if (parsedSingle) {
    calls.push(parsedSingle);
  }

  return calls;
}

function parseToolResult(value: unknown): DroidToolResult | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const toolUseId =
    readString(record.tool_use_id) ??
    readString(record.toolUseId) ??
    readString(record.tool_call_id) ??
    readString(record.toolCallId) ??
    readString(record.id);

  const content =
    extractTextFromContent(record.content) ??
    extractTextFromContent(record.result) ??
    extractTextFromContent(record.output) ??
    extractTextFromContent(record.value);

  const isError =
    record.is_error === true ||
    record.isError === true ||
    (typeof record.status === 'string' && record.status.toLowerCase() === 'error');

  const status = readString(record.status);

  if (toolUseId || content) {
    return {
      toolUseId,
      content,
      isError,
      status,
    };
  }

  return null;
}

function extractToolResults(payload: Record<string, unknown>): DroidToolResult[] {
  const results: DroidToolResult[] = [];
  const toolResults = payload.tool_results ?? payload.toolResults;

  if (Array.isArray(toolResults)) {
    for (const result of toolResults) {
      const parsed = parseToolResult(result);
      if (parsed) {
        results.push(parsed);
      }
    }
  }

  const singleResult = payload.tool_result ?? payload.toolResult;
  const parsedSingle = parseToolResult(singleResult);
  if (parsedSingle) {
    results.push(parsedSingle);
  }

  return results;
}

function extractErrorInfo(payload: Record<string, unknown>): DroidErrorInfo | undefined {
  const errorObj = asRecord(payload.error);
  const message =
    readString(errorObj?.message) ??
    readString(payload.error_message) ??
    readString(payload.errorMessage) ??
    readString(payload.message);

  const status = readNumber(errorObj?.status ?? payload.status ?? payload.status_code ?? payload.statusCode);
  const code = readString(errorObj?.code ?? payload.code);

  if (message) {
    return {
      message,
      status,
      code,
    };
  }

  const exitCode = readNumber(payload.code ?? payload.exitCode);
  if (payload.type === 'exit' && exitCode !== undefined && exitCode !== 0) {
    return {
      message: `Process exited with code ${exitCode}`,
      status: exitCode,
      code,
    };
  }

  return undefined;
}

function extractCost(payload: Record<string, unknown>): DroidCostEvent | undefined {
  const usageObj =
    asRecord(payload.usage) ??
    asRecord(payload.cost) ??
    asRecord(payload.metrics) ??
    asRecord(payload.usage_stats);

  if (!usageObj) {
    return undefined;
  }

  const inputTokens =
    readNumber(usageObj.inputTokens) ??
    readNumber(usageObj.input_tokens) ??
    readNumber(usageObj.prompt_tokens) ??
    readNumber(usageObj.promptTokens);

  const outputTokens =
    readNumber(usageObj.outputTokens) ??
    readNumber(usageObj.output_tokens) ??
    readNumber(usageObj.completion_tokens) ??
    readNumber(usageObj.completionTokens);

  const cacheReadTokens =
    readNumber(usageObj.cacheReadTokens) ??
    readNumber(usageObj.cache_read_input_tokens) ??
    readNumber(usageObj.cache_read_tokens) ??
    readNumber(usageObj.cacheReadInputTokens);

  const cacheWriteTokens =
    readNumber(usageObj.cacheWriteTokens) ??
    readNumber(usageObj.cache_creation_input_tokens) ??
    readNumber(usageObj.cache_creation_tokens) ??
    readNumber(usageObj.cacheCreationInputTokens);

  const totalTokens =
    readNumber(usageObj.totalTokens) ??
    readNumber(usageObj.total_tokens);

  const totalUSD =
    readNumber(usageObj.totalUSD) ??
    readNumber(usageObj.total_usd) ??
    readNumber(usageObj.total_cost_usd) ??
    readNumber(usageObj.total_cost);

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    cacheReadTokens === undefined &&
    cacheWriteTokens === undefined &&
    totalTokens === undefined &&
    totalUSD === undefined
  ) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    totalUSD,
  };
}

function normalizeToolInput(
  argumentsValue?: Record<string, unknown> | string
): Record<string, unknown> | undefined {
  if (!argumentsValue) {
    return undefined;
  }

  if (typeof argumentsValue === 'string') {
    try {
      const parsed = JSON.parse(argumentsValue) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      return { arguments: argumentsValue };
    }
    return { arguments: argumentsValue };
  }

  return argumentsValue;
}

function formatToolArguments(argumentsValue?: Record<string, unknown> | string): string {
  if (!argumentsValue) {
    return '';
  }

  if (typeof argumentsValue === 'string') {
    return argumentsValue.trim();
  }

  try {
    return JSON.stringify(argumentsValue);
  } catch {
    return '[unserializable arguments]';
  }
}

export class DroidCostAccumulator {
  private summary: DroidCostSummary = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    totalUSD: 0,
    events: 0,
  };

  add(cost?: DroidCostEvent): void {
    if (!cost) {
      return;
    }

    if (cost.inputTokens) {
      this.summary.inputTokens += cost.inputTokens;
    }

    if (cost.outputTokens) {
      this.summary.outputTokens += cost.outputTokens;
    }

    if (cost.cacheReadTokens) {
      this.summary.cacheReadTokens += cost.cacheReadTokens;
    }

    if (cost.cacheWriteTokens) {
      this.summary.cacheWriteTokens += cost.cacheWriteTokens;
    }

    if (cost.totalUSD) {
      this.summary.totalUSD += cost.totalUSD;
    }

    if (cost.totalTokens) {
      this.summary.totalTokens += cost.totalTokens;
    }

    this.summary.events += 1;

    if (!cost.totalTokens) {
      // When totalTokens isn't provided, add the sum of this event's components
      const eventTotal =
        (cost.inputTokens ?? 0) +
        (cost.outputTokens ?? 0) +
        (cost.cacheReadTokens ?? 0) +
        (cost.cacheWriteTokens ?? 0);
      this.summary.totalTokens += eventTotal;
    }
  }

  hasData(): boolean {
    return (
      this.summary.events > 0 ||
      this.summary.inputTokens > 0 ||
      this.summary.outputTokens > 0 ||
      this.summary.cacheReadTokens > 0 ||
      this.summary.cacheWriteTokens > 0 ||
      this.summary.totalTokens > 0 ||
      this.summary.totalUSD > 0
    );
  }

  getSummary(): DroidCostSummary {
    return { ...this.summary };
  }
}

export function formatDroidCostSummary(summary: DroidCostSummary): string {
  const parts: string[] = [];

  if (summary.inputTokens > 0) {
    parts.push(`input ${summary.inputTokens}`);
  }
  if (summary.outputTokens > 0) {
    parts.push(`output ${summary.outputTokens}`);
  }
  if (summary.cacheReadTokens > 0) {
    parts.push(`cache read ${summary.cacheReadTokens}`);
  }
  if (summary.cacheWriteTokens > 0) {
    parts.push(`cache write ${summary.cacheWriteTokens}`);
  }
  if (summary.totalTokens > 0 && parts.length === 0) {
    parts.push(`total ${summary.totalTokens}`);
  }

  const costLine = parts.length > 0 ? parts.join(', ') : 'tokens unavailable';
  const usdSuffix = summary.totalUSD > 0 ? ` ($${summary.totalUSD.toFixed(4)})` : '';

  return `Cost: ${costLine}${usdSuffix}`;
}

export function formatDroidEventForDisplay(message: DroidJsonlMessage): string | undefined {
  // Skip user/input message events - these are just echoes of the prompt
  const eventType = message.type?.toLowerCase();
  const rawRole = typeof message.raw.role === 'string' ? message.raw.role.toLowerCase() : undefined;
  if (eventType === 'user' || eventType === 'input' || rawRole === 'user') {
    return undefined;
  }

  if (message.error) {
    const statusSuffix = message.error.status ? ` (status ${message.error.status})` : '';
    return `Error${statusSuffix}: ${message.error.message}`;
  }

  if (message.toolCalls && message.toolCalls.length > 0) {
    return message.toolCalls
      .map((call) => {
        const args = formatToolArguments(call.arguments);
        return args ? `Tool call: ${call.name} ${args}` : `Tool call: ${call.name}`;
      })
      .join('\n');
  }

  if (message.toolResults && message.toolResults.length > 0) {
    return message.toolResults
      .map((result) => {
        const status = result.status ? ` (${result.status})` : '';
        const content = result.content ? `: ${result.content}` : '';
        return `Tool result${status}${content}`;
      })
      .join('\n');
  }

  if (message.message) {
    return message.message;
  }

  if (message.result) {
    return message.result;
  }

  return undefined;
}

// Strip ANSI escape sequences from a string
// These can appear when using pseudo-TTY wrappers like `script`
// Matches: ESC[...letter, ESC]...BEL, and bare [...letter (without ESC)
const ANSI_REGEX = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][AB012]|\[\?[0-9;]*[a-zA-Z]/g;

function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '');
}

// Extract JSON object from a line that may have garbage prefix
function extractJson(str: string): string {
  const firstBrace = str.indexOf('{');
  if (firstBrace === -1) {
    return str;
  }
  return str.slice(firstBrace);
}

export function parseDroidJsonlLine(line: string): DroidJsonlParseResult {
  // Strip ANSI escape sequences that may be injected by pseudo-TTY
  const stripped = stripAnsi(line);
  // Extract JSON starting from first '{' (handles any remaining garbage prefix)
  const jsonPart = extractJson(stripped);
  const trimmed = jsonPart.trim();

  if (!trimmed) {
    return { success: false, raw: line, error: 'Empty line' };
  }

  try {
    const parsed = JSON.parse(trimmed);
    const payload = asRecord(parsed);

    if (!payload) {
      return { success: false, raw: line, error: 'Invalid JSON object' };
    }

    const message: DroidJsonlMessage = {
      source: 'droid',
      type:
        readString(payload.type) ??
        readString(payload.event) ??
        readString(payload.kind),
      message: extractMessageText(payload),
      result: extractResultText(payload),
      toolCalls: undefined,
      toolResults: undefined,
      error: undefined,
      cost: undefined,
      raw: payload,
    };

    const toolCalls = extractToolCalls(payload);
    if (toolCalls.length > 0) {
      message.toolCalls = toolCalls;
    }

    const toolResults = extractToolResults(payload);
    if (toolResults.length > 0) {
      message.toolResults = toolResults;
    }

    const errorInfo = extractErrorInfo(payload);
    if (errorInfo) {
      message.error = errorInfo;
    }

    const cost = extractCost(payload);
    if (cost) {
      message.cost = cost;
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

export function createDroidStreamingJsonlParser(): {
  push: (chunk: string) => DroidJsonlParseResult[];
  flush: () => DroidJsonlParseResult[];
  getState: () => { messages: DroidJsonlMessage[]; fallback: string[]; costSummary: DroidCostSummary };
} {
  let buffer = '';
  const messages: DroidJsonlMessage[] = [];
  const fallback: string[] = [];
  const costAccumulator = new DroidCostAccumulator();

  return {
    push(chunk: string): DroidJsonlParseResult[] {
      buffer += chunk;
      const results: DroidJsonlParseResult[] = [];

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        const result = parseDroidJsonlLine(line);
        results.push(result);

        if (result.success) {
          messages.push(result.message);
          if (result.message.cost) {
            costAccumulator.add(result.message.cost);
          }
        } else if (result.raw.trim()) {
          fallback.push(result.raw);
        }
      }

      return results;
    },

    flush(): DroidJsonlParseResult[] {
      if (!buffer.trim()) {
        buffer = '';
        return [];
      }

      const result = parseDroidJsonlLine(buffer);
      buffer = '';

      if (result.success) {
        messages.push(result.message);
        if (result.message.cost) {
          costAccumulator.add(result.message.cost);
        }
      } else if (result.raw.trim()) {
        fallback.push(result.raw);
      }

      return [result];
    },

    getState(): { messages: DroidJsonlMessage[]; fallback: string[]; costSummary: DroidCostSummary } {
      return {
        messages,
        fallback,
        costSummary: costAccumulator.getSummary(),
      };
    },
  };
}

export function isDroidJsonlMessage(message: unknown): message is DroidJsonlMessage {
  return typeof message === 'object' && message !== null && (message as DroidJsonlMessage).source === 'droid';
}

export function toClaudeJsonlMessages(message: DroidJsonlMessage): ClaudeJsonlMessage[] {
  const base: ClaudeJsonlMessage = {
    raw: message.raw,
  };

  if (message.type) {
    base.type = message.type;
  }

  if (message.message) {
    base.message = message.message;
  }

  if (message.result) {
    base.result = message.result;
  }

  if (message.cost) {
    base.cost = {
      inputTokens: message.cost.inputTokens,
      outputTokens: message.cost.outputTokens,
      totalUSD: message.cost.totalUSD,
    };
  }

  const normalizedMessages: ClaudeJsonlMessage[] = [];

  if (message.toolCalls && message.toolCalls.length > 0) {
    for (const call of message.toolCalls) {
      normalizedMessages.push({
        ...base,
        tool: {
          name: call.name,
          input: normalizeToolInput(call.arguments),
        },
        raw: {
          ...message.raw,
          type: 'assistant',
          tool_use_id: call.id ?? message.raw.tool_use_id,
        },
      });
    }
  }

  if (message.toolResults && message.toolResults.length > 0) {
    for (const result of message.toolResults) {
      normalizedMessages.push({
        ...base,
        type: 'result',
        raw: {
          ...message.raw,
          type: 'tool_result',
          tool_use_id: result.toolUseId ?? message.raw.tool_use_id,
          content: result.content,
          is_error: result.isError,
        },
      });
    }
  }

  if (normalizedMessages.length === 0) {
    normalizedMessages.push(base);
  }

  return normalizedMessages;
}
