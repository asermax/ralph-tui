/**
 * ABOUTME: WebSocket client for connecting to remote ralph-tui instances.
 * Manages connection lifecycle, authentication, and reconnection on tab selection.
 * Connection strategy: reconnect on tab selection only, no auto-reconnect on startup.
 * US-4: Extended with full remote control capabilities (pause, resume, cancel, state queries).
 */

import type {
  AuthMessage,
  AuthResponseMessage,
  PingMessage,
  WSMessage,
  SubscribeMessage,
  UnsubscribeMessage,
  GetStateMessage,
  GetTasksMessage,
  PauseMessage,
  ResumeMessage,
  InterruptMessage,
  RefreshTasksMessage,
  AddIterationsMessage,
  RemoveIterationsMessage,
  ContinueMessage,
  StateResponseMessage,
  TasksResponseMessage,
  OperationResultMessage,
  EngineEventMessage,
  RemoteEngineState,
} from './types.js';
import type { TrackerTask } from '../plugins/trackers/types.js';
import type { EngineEvent } from '../engine/types.js';

/**
 * Connection status for a remote instance.
 * Forms a state machine: disconnected -> connecting -> connected -> disconnected (on error)
 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

/**
 * Represents a tab for an instance (local or remote)
 */
export interface InstanceTab {
  /** Unique identifier for the tab */
  id: string;

  /** Display label (alias for remotes, "Local" for local) */
  label: string;

  /** Whether this is the local instance */
  isLocal: boolean;

  /** Connection status (always 'connected' for local) */
  status: ConnectionStatus;

  /** Remote alias (undefined for local) */
  alias?: string;

  /** Host for remote connections */
  host?: string;

  /** Port for remote connections */
  port?: number;

  /** Last error message (if status is disconnected due to error) */
  lastError?: string;
}

/**
 * Events emitted by RemoteClient
 */
export type RemoteClientEvent =
  | { type: 'connecting' }
  | { type: 'connected' }
  | { type: 'disconnected'; error?: string }
  | { type: 'message'; message: WSMessage }
  | { type: 'engine_event'; event: EngineEvent };

/**
 * Callback for remote client events
 */
export type RemoteClientEventHandler = (event: RemoteClientEvent) => void;

/**
 * Pending request waiting for a response.
 */
interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * WebSocket client for connecting to a remote ralph-tui instance.
 * Handles authentication, message passing, and full remote control.
 * US-4: Extended with request/response correlation and engine control methods.
 */
export class RemoteClient {
  private ws: WebSocket | null = null;
  private host: string;
  private port: number;
  private token: string;
  private eventHandler: RemoteClientEventHandler;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private _status: ConnectionStatus = 'disconnected';
  /** Pending requests waiting for responses, keyed by message ID */
  private pendingRequests: Map<string, PendingRequest<unknown>> = new Map();
  /** Whether subscribed to engine events */
  private _subscribed = false;
  /** Request timeout in milliseconds */
  private requestTimeout = 30000;

  constructor(
    host: string,
    port: number,
    token: string,
    eventHandler: RemoteClientEventHandler
  ) {
    this.host = host;
    this.port = port;
    this.token = token;
    this.eventHandler = eventHandler;
  }

  /**
   * Current connection status
   */
  get status(): ConnectionStatus {
    return this._status;
  }

  /**
   * Connect to the remote instance.
   * Authenticates immediately after connection.
   */
  async connect(): Promise<void> {
    if (this._status === 'connecting' || this._status === 'connected') {
      return;
    }

    this._status = 'connecting';
    this.eventHandler({ type: 'connecting' });

    return new Promise<void>((resolve, reject) => {
      try {
        const url = `ws://${this.host}:${this.port}`;
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          this.authenticate();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data as string) as WSMessage;
            this.handleMessage(message, resolve, reject);
          } catch {
            // Ignore invalid messages
          }
        };

        this.ws.onerror = () => {
          this._status = 'disconnected';
          this.eventHandler({ type: 'disconnected', error: 'Connection error' });
          reject(new Error('Connection error'));
        };

        this.ws.onclose = () => {
          this.cleanup();
          if (this._status === 'connected') {
            this._status = 'disconnected';
            this.eventHandler({ type: 'disconnected', error: 'Connection closed' });
          }
        };
      } catch (error) {
        this._status = 'disconnected';
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.eventHandler({ type: 'disconnected', error: errorMessage });
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the remote instance.
   */
  disconnect(): void {
    this.cleanup();
    this._status = 'disconnected';
    this.eventHandler({ type: 'disconnected' });
  }

  /**
   * Send a message to the remote instance.
   */
  send(message: WSMessage): void {
    if (this.ws && this._status === 'connected') {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send authentication message
   */
  private authenticate(): void {
    const authMessage: AuthMessage = {
      type: 'auth',
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      token: this.token,
    };
    this.ws?.send(JSON.stringify(authMessage));
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(
    message: WSMessage,
    resolveConnect: () => void,
    rejectConnect: (error: Error) => void
  ): void {
    // Check if this is a response to a pending request
    const pending = this.pendingRequests.get(message.id);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(message.id);
      pending.resolve(message);
      return;
    }

    switch (message.type) {
      case 'auth_response': {
        const authResponse = message as AuthResponseMessage;
        if (authResponse.success) {
          this._status = 'connected';
          this.eventHandler({ type: 'connected' });
          this.startPingInterval();
          resolveConnect();
        } else {
          this._status = 'disconnected';
          const error = authResponse.error ?? 'Authentication failed';
          this.eventHandler({ type: 'disconnected', error });
          this.cleanup();
          rejectConnect(new Error(error));
        }
        break;
      }

      case 'pong': {
        // Heartbeat acknowledged
        break;
      }

      case 'engine_event': {
        // Forward engine events to the event handler
        const engineEventMsg = message as EngineEventMessage;
        this.eventHandler({ type: 'engine_event', event: engineEventMsg.event });
        break;
      }

      default: {
        this.eventHandler({ type: 'message', message });
      }
    }
  }

  // ============================================================================
  // US-4: Remote Control Methods
  // ============================================================================

  /**
   * Send a request and wait for a response.
   * Uses message ID correlation to match responses to requests.
   */
  private async request<T extends WSMessage>(message: Omit<T, 'id' | 'timestamp'>): Promise<WSMessage> {
    if (this._status !== 'connected' || !this.ws) {
      throw new Error('Not connected');
    }

    const id = crypto.randomUUID();
    const fullMessage: WSMessage = {
      ...message,
      id,
      timestamp: new Date().toISOString(),
    } as WSMessage;

    return new Promise<WSMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }, this.requestTimeout);

      this.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject, timeout });
      this.ws!.send(JSON.stringify(fullMessage));
    });
  }

  /**
   * Subscribe to engine events from the remote instance.
   * After subscribing, engine events will be forwarded via the event handler.
   */
  async subscribe(eventTypes?: string[]): Promise<void> {
    const message: Omit<SubscribeMessage, 'id' | 'timestamp'> = {
      type: 'subscribe',
      eventTypes,
    };
    const response = await this.request<SubscribeMessage>(message);
    if (response.type === 'operation_result') {
      const result = response as OperationResultMessage;
      if (!result.success) {
        throw new Error(result.error ?? 'Subscribe failed');
      }
    }
    this._subscribed = true;
  }

  /**
   * Unsubscribe from engine events.
   */
  async unsubscribe(): Promise<void> {
    const message: Omit<UnsubscribeMessage, 'id' | 'timestamp'> = {
      type: 'unsubscribe',
    };
    await this.request<UnsubscribeMessage>(message);
    this._subscribed = false;
  }

  /**
   * Get the current engine state from the remote instance.
   */
  async getState(): Promise<RemoteEngineState> {
    const message: Omit<GetStateMessage, 'id' | 'timestamp'> = {
      type: 'get_state',
    };
    const response = await this.request<GetStateMessage>(message);
    if (response.type !== 'state_response') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return (response as StateResponseMessage).state;
  }

  /**
   * Get tasks from the remote instance's tracker.
   */
  async getTasks(): Promise<TrackerTask[]> {
    const message: Omit<GetTasksMessage, 'id' | 'timestamp'> = {
      type: 'get_tasks',
    };
    const response = await this.request<GetTasksMessage>(message);
    if (response.type !== 'tasks_response') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return (response as TasksResponseMessage).tasks;
  }

  /**
   * Pause the remote engine.
   */
  async pause(): Promise<boolean> {
    const message: Omit<PauseMessage, 'id' | 'timestamp'> = {
      type: 'pause',
    };
    const response = await this.request<PauseMessage>(message);
    if (response.type !== 'operation_result') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return (response as OperationResultMessage).success;
  }

  /**
   * Resume the remote engine.
   */
  async resume(): Promise<boolean> {
    const message: Omit<ResumeMessage, 'id' | 'timestamp'> = {
      type: 'resume',
    };
    const response = await this.request<ResumeMessage>(message);
    if (response.type !== 'operation_result') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return (response as OperationResultMessage).success;
  }

  /**
   * Interrupt/cancel the current iteration on the remote engine.
   */
  async interrupt(): Promise<boolean> {
    const message: Omit<InterruptMessage, 'id' | 'timestamp'> = {
      type: 'interrupt',
    };
    const response = await this.request<InterruptMessage>(message);
    if (response.type !== 'operation_result') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return (response as OperationResultMessage).success;
  }

  /**
   * Refresh task list from the remote tracker.
   */
  async refreshTasks(): Promise<boolean> {
    const message: Omit<RefreshTasksMessage, 'id' | 'timestamp'> = {
      type: 'refresh_tasks',
    };
    const response = await this.request<RefreshTasksMessage>(message);
    if (response.type !== 'operation_result') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return (response as OperationResultMessage).success;
  }

  /**
   * Add iterations to the remote engine.
   */
  async addIterations(count: number): Promise<boolean> {
    const message: Omit<AddIterationsMessage, 'id' | 'timestamp'> = {
      type: 'add_iterations',
      count,
    };
    const response = await this.request<AddIterationsMessage>(message);
    if (response.type !== 'operation_result') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return (response as OperationResultMessage).success;
  }

  /**
   * Remove iterations from the remote engine.
   */
  async removeIterations(count: number): Promise<boolean> {
    const message: Omit<RemoveIterationsMessage, 'id' | 'timestamp'> = {
      type: 'remove_iterations',
      count,
    };
    const response = await this.request<RemoveIterationsMessage>(message);
    if (response.type !== 'operation_result') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return (response as OperationResultMessage).success;
  }

  /**
   * Continue execution on the remote engine.
   */
  async continueExecution(): Promise<boolean> {
    const message: Omit<ContinueMessage, 'id' | 'timestamp'> = {
      type: 'continue',
    };
    const response = await this.request<ContinueMessage>(message);
    if (response.type !== 'operation_result') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return (response as OperationResultMessage).success;
  }

  /**
   * Whether currently subscribed to engine events.
   */
  get subscribed(): boolean {
    return this._subscribed;
  }

  /**
   * Start sending periodic ping messages
   */
  private startPingInterval(): void {
    this.stopPingInterval();
    this.pingInterval = setInterval(() => {
      if (this._status === 'connected' && this.ws) {
        const pingMessage: PingMessage = {
          type: 'ping',
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
        };
        this.ws.send(JSON.stringify(pingMessage));
      }
    }, 30000); // Ping every 30 seconds
  }

  /**
   * Stop the ping interval
   */
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    this.stopPingInterval();
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
      this.pendingRequests.delete(id);
    }
    this._subscribed = false;
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }
  }
}

/**
 * Create the local instance tab
 */
export function createLocalTab(): InstanceTab {
  return {
    id: 'local',
    label: 'Local',
    isLocal: true,
    status: 'connected',
  };
}

/**
 * Create a remote instance tab from configuration
 */
export function createRemoteTab(
  alias: string,
  host: string,
  port: number
): InstanceTab {
  return {
    id: `remote-${alias}`,
    label: alias,
    isLocal: false,
    status: 'disconnected',
    alias,
    host,
    port,
  };
}
