/**
 * ABOUTME: WebSocket server for remote ralph-tui control.
 * Handles client connections, authentication, and message routing.
 * Binds to localhost if no token configured, all interfaces if token is set.
 * US-4: Extended with full remote control (pause, resume, cancel, state queries, subscriptions).
 */

import type { Server, ServerWebSocket, WebSocketHandler } from 'bun';
import type {
  WSMessage,
  AuthMessage,
  AuthResponseMessage,
  ErrorMessage,
  PongMessage,
  ServerStatusMessage,
  RemoteServerState,
  RemoteEngineState,
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
} from './types.js';
import { validateToken, getOrCreateToken } from './token.js';
import { createAuditLogger, type AuditLogger } from './audit.js';
import type { ExecutionEngine, EngineEvent } from '../engine/index.js';
import type { TrackerPlugin } from '../plugins/trackers/types.js';

/**
 * WebSocket data attached to each connection
 */
interface WebSocketData {
  ip: string;
}

/**
 * Connected client state
 */
interface ClientState {
  /** Unique client identifier */
  id: string;

  /** Client IP address */
  ip: string;

  /** Whether the client has authenticated */
  authenticated: boolean;

  /** When the client connected (ISO 8601) */
  connectedAt: string;

  /** Whether the client is subscribed to engine events */
  subscribed: boolean;

  /** Event types to forward (empty means all) */
  subscribedEventTypes?: string[];
}

/**
 * Server options
 */
export interface RemoteServerOptions {
  /** Port to bind to */
  port: number;

  /** Whether a token is configured (determines bind host) */
  hasToken: boolean;

  /** Callback when server starts */
  onStart?: (state: RemoteServerState) => void;

  /** Callback when server stops */
  onStop?: () => void;

  /** Callback when a client connects */
  onConnect?: (clientId: string) => void;

  /** Callback when a client disconnects */
  onDisconnect?: (clientId: string) => void;

  /** Execution engine for remote control (US-4) */
  engine?: ExecutionEngine;

  /** Tracker plugin for task queries (US-4) */
  tracker?: TrackerPlugin;
}

/**
 * Generate a unique client ID
 */
function generateClientId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Generate a unique message ID
 */
function generateMessageId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Create a WebSocket message with common fields
 */
function createMessage<T extends WSMessage>(type: T['type'], data: Omit<T, 'type' | 'id' | 'timestamp'>): T {
  return {
    type,
    id: generateMessageId(),
    timestamp: new Date().toISOString(),
    ...data,
  } as T;
}

/**
 * RemoteServer class for handling WebSocket connections.
 * US-4: Supports full remote control via engine integration.
 */
export class RemoteServer {
  private server: Server<WebSocketData> | null = null;
  private clients: Map<ServerWebSocket<WebSocketData>, ClientState> = new Map();
  private options: RemoteServerOptions;
  private auditLogger: AuditLogger;
  private startedAt: string | null = null;
  /** Engine event listener unsubscribe function */
  private engineUnsubscribe: (() => void) | null = null;

  constructor(options: RemoteServerOptions) {
    this.options = options;
    this.auditLogger = createAuditLogger();
    // Subscribe to engine events if engine is provided
    if (this.options.engine) {
      this.setupEngineSubscription();
    }
  }

  /**
   * Set the execution engine for remote control.
   * Can be called after construction to attach an engine.
   */
  setEngine(engine: ExecutionEngine): void {
    // Unsubscribe from old engine if present
    if (this.engineUnsubscribe) {
      this.engineUnsubscribe();
      this.engineUnsubscribe = null;
    }
    this.options.engine = engine;
    this.setupEngineSubscription();
  }

  /**
   * Set the tracker plugin for task queries.
   */
  setTracker(tracker: TrackerPlugin): void {
    this.options.tracker = tracker;
  }

  /**
   * Subscribe to engine events and forward to subscribed clients.
   */
  private setupEngineSubscription(): void {
    if (!this.options.engine) return;

    this.engineUnsubscribe = this.options.engine.on((event: EngineEvent) => {
      this.broadcastEngineEvent(event);
    });
  }

  /**
   * Broadcast an engine event to all subscribed clients.
   */
  private broadcastEngineEvent(event: EngineEvent): void {
    for (const [ws, clientState] of this.clients) {
      if (!clientState.authenticated || !clientState.subscribed) continue;

      // Filter by event types if specified
      if (
        clientState.subscribedEventTypes &&
        clientState.subscribedEventTypes.length > 0 &&
        !clientState.subscribedEventTypes.includes(event.type)
      ) {
        continue;
      }

      const message = createMessage<EngineEventMessage>('engine_event', {
        event,
      });
      this.send(ws, message);
    }
  }

  /**
   * Start the WebSocket server.
   */
  async start(): Promise<RemoteServerState> {
    if (this.server) {
      throw new Error('Server is already running');
    }

    // Determine host based on token configuration
    // If no token is configured, bind only to localhost for security
    // If token is configured, bind to all interfaces for remote access
    const host = this.options.hasToken ? '0.0.0.0' : '127.0.0.1';

    // Store reference to this for use in websocket handlers
    const self = this;

    // Create WebSocket handler
    const websocketHandler: WebSocketHandler<WebSocketData> = {
      open(ws: ServerWebSocket<WebSocketData>) {
        const clientId = generateClientId();
        const clientIp = ws.data?.ip ?? 'unknown';

        const state: ClientState = {
          id: clientId,
          ip: clientIp,
          authenticated: false,
          connectedAt: new Date().toISOString(),
          subscribed: false,
        };

        self.clients.set(ws, state);
        self.auditLogger.logConnection(`${clientId}@${clientIp}`, 'connect');
        self.options.onConnect?.(clientId);
      },

      message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
        const clientState = self.clients.get(ws);
        if (!clientState) {
          return;
        }

        self.handleMessage(ws, clientState, message.toString());
      },

      close(ws: ServerWebSocket<WebSocketData>) {
        const clientState = self.clients.get(ws);
        if (clientState) {
          self.auditLogger.logConnection(
            `${clientState.id}@${clientState.ip}`,
            'disconnect'
          );
          self.options.onDisconnect?.(clientState.id);
          self.clients.delete(ws);
        }
      },
    };

    this.server = Bun.serve<WebSocketData>({
      port: this.options.port,
      hostname: host,

      fetch(req, server) {
        // Upgrade HTTP request to WebSocket
        const clientIp = server.requestIP(req)?.address ?? 'unknown';

        if (server.upgrade(req, { data: { ip: clientIp } })) {
          return; // Upgrade successful
        }

        // Non-WebSocket request - return simple info
        return new Response(JSON.stringify({
          service: 'ralph-tui-remote',
          version: '0.2.1',
          websocket: true,
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },

      websocket: websocketHandler,
    });

    this.startedAt = new Date().toISOString();

    const state: RemoteServerState = {
      running: true,
      port: this.options.port,
      host,
      startedAt: this.startedAt,
      connectedClients: 0,
      pid: process.pid,
    };

    await this.auditLogger.logServerEvent('start', {
      port: this.options.port,
      host,
      pid: process.pid,
    });

    this.options.onStart?.(state);
    return state;
  }

  /**
   * Stop the WebSocket server.
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    // Unsubscribe from engine events
    if (this.engineUnsubscribe) {
      this.engineUnsubscribe();
      this.engineUnsubscribe = null;
    }

    // Close all client connections
    for (const [ws] of this.clients) {
      try {
        ws.close();
      } catch {
        // Ignore close errors
      }
    }
    this.clients.clear();

    this.server.stop();
    this.server = null;

    await this.auditLogger.logServerEvent('stop');
    this.options.onStop?.();
  }

  /**
   * Get current server state.
   */
  getState(): RemoteServerState | null {
    if (!this.server || !this.startedAt) {
      return null;
    }

    return {
      running: true,
      port: this.options.port,
      host: this.options.hasToken ? '0.0.0.0' : '127.0.0.1',
      startedAt: this.startedAt,
      connectedClients: this.clients.size,
      pid: process.pid,
    };
  }

  /**
   * Handle an incoming WebSocket message.
   */
  private async handleMessage(
    ws: ServerWebSocket<WebSocketData>,
    clientState: ClientState,
    rawMessage: string
  ): Promise<void> {
    const clientId = `${clientState.id}@${clientState.ip}`;
    let message: WSMessage;

    try {
      message = JSON.parse(rawMessage) as WSMessage;
    } catch {
      this.sendError(ws, 'INVALID_JSON', 'Invalid JSON message');
      await this.auditLogger.logFailure(clientId, 'message_parse', 'Invalid JSON');
      return;
    }

    // Handle authentication
    if (message.type === 'auth') {
      await this.handleAuth(ws, clientState, message as AuthMessage);
      return;
    }

    // Handle ping (allowed without auth for connection health checks)
    if (message.type === 'ping') {
      this.sendPong(ws, message.id);
      return;
    }

    // All other messages require authentication
    if (!clientState.authenticated) {
      this.sendError(ws, 'NOT_AUTHENTICATED', 'Authentication required');
      await this.auditLogger.logFailure(
        clientId,
        'unauthorized_message',
        'Not authenticated',
        { messageType: message.type }
      );
      return;
    }

    // Handle authenticated messages
    switch (message.type) {
      case 'status':
        this.sendStatus(ws);
        break;

      // US-4: Subscription management
      case 'subscribe':
        this.handleSubscribe(ws, clientState, message as SubscribeMessage);
        break;
      case 'unsubscribe':
        this.handleUnsubscribe(ws, clientState, message as UnsubscribeMessage);
        break;

      // US-4: State queries
      case 'get_state':
        this.handleGetState(ws, message as GetStateMessage);
        break;
      case 'get_tasks':
        await this.handleGetTasks(ws, message as GetTasksMessage);
        break;

      // US-4: Engine control operations
      case 'pause':
        this.handlePause(ws, message as PauseMessage);
        break;
      case 'resume':
        this.handleResume(ws, message as ResumeMessage);
        break;
      case 'interrupt':
        this.handleInterrupt(ws, message as InterruptMessage);
        break;
      case 'refresh_tasks':
        this.handleRefreshTasks(ws, message as RefreshTasksMessage);
        break;
      case 'add_iterations':
        await this.handleAddIterations(ws, message as AddIterationsMessage);
        break;
      case 'remove_iterations':
        await this.handleRemoveIterations(ws, message as RemoveIterationsMessage);
        break;
      case 'continue':
        this.handleContinue(ws, message as ContinueMessage);
        break;

      default:
        this.sendError(ws, 'UNKNOWN_MESSAGE', `Unknown message type: ${message.type}`);
    }
  }

  // ============================================================================
  // US-4: Remote Control Message Handlers
  // ============================================================================

  /**
   * Handle subscribe request - start forwarding engine events to client.
   */
  private handleSubscribe(
    ws: ServerWebSocket<WebSocketData>,
    clientState: ClientState,
    message: SubscribeMessage
  ): void {
    clientState.subscribed = true;
    clientState.subscribedEventTypes = message.eventTypes;

    const response = createMessage<OperationResultMessage>('operation_result', {
      operation: 'subscribe',
      success: true,
    });
    response.id = message.id; // Correlate response with request
    this.send(ws, response);
  }

  /**
   * Handle unsubscribe request - stop forwarding engine events.
   */
  private handleUnsubscribe(
    ws: ServerWebSocket<WebSocketData>,
    clientState: ClientState,
    message: UnsubscribeMessage
  ): void {
    clientState.subscribed = false;
    clientState.subscribedEventTypes = undefined;

    const response = createMessage<OperationResultMessage>('operation_result', {
      operation: 'unsubscribe',
      success: true,
    });
    response.id = message.id;
    this.send(ws, response);
  }

  /**
   * Handle get_state request - return current engine state.
   */
  private handleGetState(ws: ServerWebSocket<WebSocketData>, message: GetStateMessage): void {
    if (!this.options.engine) {
      const response = createMessage<OperationResultMessage>('operation_result', {
        operation: 'get_state',
        success: false,
        error: 'No engine attached to server',
      });
      response.id = message.id;
      this.send(ws, response);
      return;
    }

    const engineState = this.options.engine.getState();
    const iterationInfo = this.options.engine.getIterationInfo();

    // Convert to remote-serializable state (Map → array not needed for subagents in current usage)
    const remoteState: RemoteEngineState = {
      status: engineState.status,
      currentIteration: engineState.currentIteration,
      currentTask: engineState.currentTask,
      totalTasks: engineState.totalTasks,
      tasksCompleted: engineState.tasksCompleted,
      iterations: engineState.iterations,
      startedAt: engineState.startedAt,
      currentOutput: engineState.currentOutput,
      currentStderr: engineState.currentStderr,
      activeAgent: engineState.activeAgent,
      rateLimitState: engineState.rateLimitState,
      maxIterations: iterationInfo.maxIterations,
      tasks: [], // Will be populated by get_tasks
    };

    const response = createMessage<StateResponseMessage>('state_response', {
      state: remoteState,
    });
    response.id = message.id;
    this.send(ws, response);
  }

  /**
   * Handle get_tasks request - return task list from tracker.
   */
  private async handleGetTasks(ws: ServerWebSocket<WebSocketData>, message: GetTasksMessage): Promise<void> {
    if (!this.options.tracker) {
      const response = createMessage<OperationResultMessage>('operation_result', {
        operation: 'get_tasks',
        success: false,
        error: 'No tracker attached to server',
      });
      response.id = message.id;
      this.send(ws, response);
      return;
    }

    try {
      const tasks = await this.options.tracker.getTasks();
      const response = createMessage<TasksResponseMessage>('tasks_response', {
        tasks,
      });
      response.id = message.id;
      this.send(ws, response);
    } catch (error) {
      const response = createMessage<OperationResultMessage>('operation_result', {
        operation: 'get_tasks',
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get tasks',
      });
      response.id = message.id;
      this.send(ws, response);
    }
  }

  /**
   * Handle pause request - pause the engine.
   */
  private handlePause(ws: ServerWebSocket<WebSocketData>, message: PauseMessage): void {
    if (!this.options.engine) {
      this.sendOperationError(ws, message.id, 'pause', 'No engine attached');
      return;
    }

    this.options.engine.pause();
    const response = createMessage<OperationResultMessage>('operation_result', {
      operation: 'pause',
      success: true,
    });
    response.id = message.id;
    this.send(ws, response);
  }

  /**
   * Handle resume request - resume the engine.
   */
  private handleResume(ws: ServerWebSocket<WebSocketData>, message: ResumeMessage): void {
    if (!this.options.engine) {
      this.sendOperationError(ws, message.id, 'resume', 'No engine attached');
      return;
    }

    this.options.engine.resume();
    const response = createMessage<OperationResultMessage>('operation_result', {
      operation: 'resume',
      success: true,
    });
    response.id = message.id;
    this.send(ws, response);
  }

  /**
   * Handle interrupt request - interrupt/cancel current iteration.
   * Uses engine.stop() which interrupts the current execution.
   */
  private handleInterrupt(ws: ServerWebSocket<WebSocketData>, message: InterruptMessage): void {
    if (!this.options.engine) {
      this.sendOperationError(ws, message.id, 'interrupt', 'No engine attached');
      return;
    }

    // stop() interrupts the current execution and emits engine:stopped with reason: 'interrupted'
    this.options.engine.stop().then(() => {
      const response = createMessage<OperationResultMessage>('operation_result', {
        operation: 'interrupt',
        success: true,
      });
      response.id = message.id;
      this.send(ws, response);
    }).catch((error) => {
      this.sendOperationError(
        ws,
        message.id,
        'interrupt',
        error instanceof Error ? error.message : 'Failed to interrupt'
      );
    });
  }

  /**
   * Handle refresh_tasks request - refresh task list from tracker.
   */
  private handleRefreshTasks(ws: ServerWebSocket<WebSocketData>, message: RefreshTasksMessage): void {
    if (!this.options.engine) {
      this.sendOperationError(ws, message.id, 'refresh_tasks', 'No engine attached');
      return;
    }

    this.options.engine.refreshTasks();
    const response = createMessage<OperationResultMessage>('operation_result', {
      operation: 'refresh_tasks',
      success: true,
    });
    response.id = message.id;
    this.send(ws, response);
  }

  /**
   * Handle add_iterations request - add iterations to engine.
   */
  private async handleAddIterations(
    ws: ServerWebSocket<WebSocketData>,
    message: AddIterationsMessage
  ): Promise<void> {
    if (!this.options.engine) {
      this.sendOperationError(ws, message.id, 'add_iterations', 'No engine attached');
      return;
    }

    try {
      const shouldContinue = await this.options.engine.addIterations(message.count);
      const response = createMessage<OperationResultMessage>('operation_result', {
        operation: 'add_iterations',
        success: true,
        data: { shouldContinue },
      });
      response.id = message.id;
      this.send(ws, response);
    } catch (error) {
      this.sendOperationError(
        ws,
        message.id,
        'add_iterations',
        error instanceof Error ? error.message : 'Failed to add iterations'
      );
    }
  }

  /**
   * Handle remove_iterations request - remove iterations from engine.
   */
  private async handleRemoveIterations(
    ws: ServerWebSocket<WebSocketData>,
    message: RemoveIterationsMessage
  ): Promise<void> {
    if (!this.options.engine) {
      this.sendOperationError(ws, message.id, 'remove_iterations', 'No engine attached');
      return;
    }

    try {
      const success = await this.options.engine.removeIterations(message.count);
      const response = createMessage<OperationResultMessage>('operation_result', {
        operation: 'remove_iterations',
        success,
        error: success ? undefined : 'Cannot reduce below current iteration or minimum',
      });
      response.id = message.id;
      this.send(ws, response);
    } catch (error) {
      this.sendOperationError(
        ws,
        message.id,
        'remove_iterations',
        error instanceof Error ? error.message : 'Failed to remove iterations'
      );
    }
  }

  /**
   * Handle continue request - continue execution after pause/stop.
   */
  private handleContinue(ws: ServerWebSocket<WebSocketData>, message: ContinueMessage): void {
    if (!this.options.engine) {
      this.sendOperationError(ws, message.id, 'continue', 'No engine attached');
      return;
    }

    this.options.engine.continueExecution();
    const response = createMessage<OperationResultMessage>('operation_result', {
      operation: 'continue',
      success: true,
    });
    response.id = message.id;
    this.send(ws, response);
  }

  /**
   * Helper to send an operation error response.
   */
  private sendOperationError(
    ws: ServerWebSocket<WebSocketData>,
    requestId: string,
    operation: string,
    error: string
  ): void {
    const response = createMessage<OperationResultMessage>('operation_result', {
      operation,
      success: false,
      error,
    });
    response.id = requestId;
    this.send(ws, response);
  }

  /**
   * Handle authentication request.
   */
  private async handleAuth(
    ws: ServerWebSocket<WebSocketData>,
    clientState: ClientState,
    message: AuthMessage
  ): Promise<void> {
    const clientId = `${clientState.id}@${clientState.ip}`;

    const isValid = await validateToken(message.token);

    if (isValid) {
      clientState.authenticated = true;

      const response = createMessage<AuthResponseMessage>('auth_response', {
        success: true,
      });
      this.send(ws, response);

      await this.auditLogger.logAuth(clientId, true);
    } else {
      const response = createMessage<AuthResponseMessage>('auth_response', {
        success: false,
        error: 'Invalid token',
      });
      this.send(ws, response);

      await this.auditLogger.logAuth(clientId, false, 'Invalid token');
    }
  }

  /**
   * Send a pong response.
   */
  private sendPong(ws: ServerWebSocket<WebSocketData>, requestId: string): void {
    const response = createMessage<PongMessage>('pong', {});
    // Keep the same ID as the ping request
    response.id = requestId;
    this.send(ws, response);
  }

  /**
   * Send server status.
   */
  private sendStatus(ws: ServerWebSocket<WebSocketData>): void {
    const uptime = this.startedAt
      ? (Date.now() - new Date(this.startedAt).getTime()) / 1000
      : 0;

    const response = createMessage<ServerStatusMessage>('server_status', {
      version: '0.2.1',
      uptime,
      connectedClients: this.clients.size,
    });
    this.send(ws, response);
  }

  /**
   * Send an error message.
   */
  private sendError(ws: ServerWebSocket<WebSocketData>, code: string, message: string): void {
    const response = createMessage<ErrorMessage>('error', {
      code,
      message,
    });
    this.send(ws, response);
  }

  /**
   * Send a message to a WebSocket client.
   */
  private send(ws: ServerWebSocket<WebSocketData>, message: WSMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Client may have disconnected
    }
  }
}

/**
 * Create and start a remote server.
 */
export async function createRemoteServer(
  options: Partial<RemoteServerOptions> = {}
): Promise<RemoteServer> {
  // Check if token exists
  const { token, isNew } = await getOrCreateToken();
  const hasToken = !isNew || token.length > 0;

  const serverOptions: RemoteServerOptions = {
    port: options.port ?? 7890,
    hasToken,
    onStart: options.onStart,
    onStop: options.onStop,
    onConnect: options.onConnect,
    onDisconnect: options.onDisconnect,
  };

  return new RemoteServer(serverOptions);
}
