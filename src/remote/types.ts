/**
 * ABOUTME: Type definitions for the ralph-tui remote listener feature.
 * Defines configuration, authentication tokens, and WebSocket message types.
 */

/**
 * Remote listener configuration stored in ~/.config/ralph-tui/remote.json
 */
export interface RemoteConfig {
  /** Authentication token (generated on first run) */
  token: string;

  /** When the token was created (ISO 8601) */
  tokenCreatedAt: string;

  /** Token version for tracking rotation */
  tokenVersion: number;
}

/**
 * Options for the listen command
 */
export interface ListenOptions {
  /** Port to bind to (default: 7890) */
  port: number;

  /** Run as a background daemon */
  daemon: boolean;

  /** Rotate the authentication token */
  rotateToken: boolean;
}

/**
 * Default listen options
 */
export const DEFAULT_LISTEN_OPTIONS: ListenOptions = {
  port: 7890,
  daemon: false,
  rotateToken: false,
};

/**
 * WebSocket message base type
 */
export interface WSMessage {
  /** Message type identifier */
  type: string;

  /** Unique message ID for request/response correlation */
  id: string;

  /** Timestamp of the message (ISO 8601) */
  timestamp: string;
}

/**
 * Authentication request sent by client
 */
export interface AuthMessage extends WSMessage {
  type: 'auth';
  token: string;
}

/**
 * Authentication response sent by server
 */
export interface AuthResponseMessage extends WSMessage {
  type: 'auth_response';
  success: boolean;
  error?: string;
}

/**
 * Server status information
 */
export interface ServerStatusMessage extends WSMessage {
  type: 'server_status';
  version: string;
  uptime: number;
  connectedClients: number;
}

/**
 * Error message sent by server
 */
export interface ErrorMessage extends WSMessage {
  type: 'error';
  code: string;
  message: string;
}

/**
 * Ping/pong for connection health check
 */
export interface PingMessage extends WSMessage {
  type: 'ping';
}

export interface PongMessage extends WSMessage {
  type: 'pong';
}

/**
 * All possible WebSocket message types
 */
export type WSMessageType =
  | AuthMessage
  | AuthResponseMessage
  | ServerStatusMessage
  | ErrorMessage
  | PingMessage
  | PongMessage;

/**
 * Audit log entry for remote actions
 */
export interface AuditLogEntry {
  /** Timestamp of the action (ISO 8601) */
  timestamp: string;

  /** Client identifier (IP address or identifier) */
  clientId: string;

  /** Action that was performed */
  action: string;

  /** Additional details about the action */
  details?: Record<string, unknown>;

  /** Whether the action succeeded */
  success: boolean;

  /** Error message if action failed */
  error?: string;
}

/**
 * Remote server state
 */
export interface RemoteServerState {
  /** Whether the server is running */
  running: boolean;

  /** Port the server is bound to */
  port: number;

  /** Host the server is bound to */
  host: string;

  /** When the server started (ISO 8601) */
  startedAt: string;

  /** Number of currently connected clients */
  connectedClients: number;

  /** PID of the server process (for daemon mode) */
  pid?: number;
}

// ============================================================================
// US-4: Full Remote Control Message Types
// ============================================================================

import type { TrackerTask } from '../plugins/trackers/types.js';
import type {
  EngineEvent,
  EngineStatus,
  IterationResult,
  ActiveAgentState,
  RateLimitState,
} from '../engine/types.js';

/**
 * Subscribe to engine events from remote instance.
 * After subscribing, the server will forward all engine events to the client.
 */
export interface SubscribeMessage extends WSMessage {
  type: 'subscribe';
  /** Optional filter for specific event types (if empty, subscribes to all) */
  eventTypes?: string[];
}

/**
 * Unsubscribe from engine events.
 */
export interface UnsubscribeMessage extends WSMessage {
  type: 'unsubscribe';
}

/**
 * Engine event forwarded from server to subscribed clients.
 * Wraps the original engine event with message metadata.
 */
export interface EngineEventMessage extends WSMessage {
  type: 'engine_event';
  /** The original engine event */
  event: EngineEvent;
}

/**
 * Request current engine state snapshot.
 */
export interface GetStateMessage extends WSMessage {
  type: 'get_state';
}

/**
 * Response with engine state snapshot.
 */
export interface StateResponseMessage extends WSMessage {
  type: 'state_response';
  /** Engine state snapshot */
  state: RemoteEngineState;
}

/**
 * Serializable engine state for remote transport.
 * Based on EngineState but with Map converted to array for JSON serialization.
 */
export interface RemoteEngineState {
  status: EngineStatus;
  currentIteration: number;
  currentTask: TrackerTask | null;
  totalTasks: number;
  tasksCompleted: number;
  iterations: IterationResult[];
  startedAt: string | null;
  currentOutput: string;
  currentStderr: string;
  activeAgent: ActiveAgentState | null;
  rateLimitState: RateLimitState | null;
  maxIterations: number;
  /** Tasks list (replaces tracker access) */
  tasks: TrackerTask[];
}

/**
 * Request to get all tasks from the tracker.
 */
export interface GetTasksMessage extends WSMessage {
  type: 'get_tasks';
}

/**
 * Response with task list.
 */
export interface TasksResponseMessage extends WSMessage {
  type: 'tasks_response';
  tasks: TrackerTask[];
}

/**
 * Request to pause the engine.
 */
export interface PauseMessage extends WSMessage {
  type: 'pause';
}

/**
 * Request to resume the engine.
 */
export interface ResumeMessage extends WSMessage {
  type: 'resume';
}

/**
 * Request to interrupt/cancel the current iteration.
 */
export interface InterruptMessage extends WSMessage {
  type: 'interrupt';
}

/**
 * Request to refresh task list from tracker.
 */
export interface RefreshTasksMessage extends WSMessage {
  type: 'refresh_tasks';
}

/**
 * Request to add iterations to the engine.
 */
export interface AddIterationsMessage extends WSMessage {
  type: 'add_iterations';
  count: number;
}

/**
 * Request to remove iterations from the engine.
 */
export interface RemoveIterationsMessage extends WSMessage {
  type: 'remove_iterations';
  count: number;
}

/**
 * Request to continue execution (after pause or stop).
 */
export interface ContinueMessage extends WSMessage {
  type: 'continue';
}

/**
 * Generic operation result response.
 */
export interface OperationResultMessage extends WSMessage {
  type: 'operation_result';
  /** The operation that was requested */
  operation: string;
  /** Whether the operation succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Additional result data */
  data?: unknown;
}

/**
 * All possible remote control message types (extending base types).
 */
export type RemoteWSMessageType =
  | WSMessageType
  | SubscribeMessage
  | UnsubscribeMessage
  | EngineEventMessage
  | GetStateMessage
  | StateResponseMessage
  | GetTasksMessage
  | TasksResponseMessage
  | PauseMessage
  | ResumeMessage
  | InterruptMessage
  | RefreshTasksMessage
  | AddIterationsMessage
  | RemoveIterationsMessage
  | ContinueMessage
  | OperationResultMessage;
