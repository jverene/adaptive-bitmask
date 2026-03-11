/**
 * WebSocket transport layer for adaptive-bitmask
 * 
 * Real-time bidirectional communication for multi-agent coordination
 */

import { WebSocketServer, WebSocket } from 'ws';
import { BitmaskMessage } from '../message.js';
import { Logger, MetricsCollector, CircuitBreaker, TimeoutManager } from '../index.js';
import { AdaptiveBitmaskError, NetworkError, TimeoutError } from '../errors.js';

export interface WebSocketTransportConfig {
  /** WebSocket server port */
  port: number;
  /** Maximum concurrent connections */
  maxConnections?: number;
  /** Connection timeout in milliseconds */
  connectionTimeoutMs?: number;
  /** Message timeout in milliseconds */
  messageTimeoutMs?: number;
  /** Enable compression */
  enableCompression?: boolean;
  /** Circuit breaker failure threshold */
  circuitBreakerThreshold?: number;
  /** Health check interval */
  healthCheckIntervalMs?: number;
}

export interface ConnectedAgent {
  id: number;
  socket: WebSocket;
  lastSeen: number;
  messagesReceived: number;
  messagesSent: number;
  schemaVersion: number;
}

export interface TransportMessage {
  type: 'BITMASK_MESSAGE' | 'HEARTBEAT' | 'ERROR' | 'SCHEMA_UPDATE';
  payload: Uint8Array | object;
  timestamp: number;
  agentId?: number;
}

export class WebSocketTransport {
  private server: WebSocketServer;
  private agents = new Map<number, ConnectedAgent>();
  private nextAgentId = 1;
  private logger = Logger.getInstance();
  private metrics: MetricsCollector;
  private circuitBreaker: CircuitBreaker;
  private config: Required<WebSocketTransportConfig>;
  private isShuttingDown = false;

  constructor(config: WebSocketTransportConfig) {
    this.config = {
      maxConnections: 1000,
      connectionTimeoutMs: 30000,
      messageTimeoutMs: 5000,
      enableCompression: true,
      circuitBreakerThreshold: 10,
      healthCheckIntervalMs: 30000,
      ...config
    };

    this.metrics = new MetricsCollector();
    this.circuitBreaker = new CircuitBreaker(this.config.circuitBreakerThreshold);
    
    this.server = new WebSocketServer({
      port: this.config.port,
      perMessageDeflate: this.config.enableCompression
    });

    this.setupEventHandlers();
    this.startHealthChecks();
    
    this.logger.info('WebSocketTransport', `Server started on port ${this.config.port}`);
  }

  private setupEventHandlers(): void {
    this.server.on('connection', (socket: WebSocket, req: any) => {
      this.handleConnection(socket, req);
    });

    this.server.on('error', (error: Error) => {
      this.logger.error('WebSocketTransport', 'Server error', error);
      this.metrics.recordError('WebSocketServerError');
    });

    this.server.on('listening', () => {
      this.logger.info('WebSocketTransport', `Server listening on port ${this.config.port}`);
    });
  }

  private handleConnection(socket: WebSocket, req: any): void {
    if (this.isShuttingDown) {
      socket.close(1013, 'Server shutting down');
      return;
    }

    if (this.agents.size >= this.config.maxConnections) {
      socket.close(1013, 'Server at capacity');
      this.logger.warn('WebSocketTransport', 'Connection rejected: server at capacity');
      return;
    }

    const agentId = this.nextAgentId++;
    const agent: ConnectedAgent = {
      id: agentId,
      socket,
      lastSeen: Date.now(),
      messagesReceived: 0,
      messagesSent: 0,
      schemaVersion: 0
    };

    this.agents.set(agentId, agent);
    this.metrics.setAgentsConnected(this.agents.size);

    this.logger.info('WebSocketTransport', `Agent connected: ${agentId}`, {
      remoteAddress: req.socket?.remoteAddress,
      totalAgents: this.agents.size
    });

    // Setup socket handlers
    socket.on('message', (data: Buffer) => {
      this.handleMessage(agentId, data);
    });

    socket.on('close', (code: number, reason: Buffer) => {
      this.handleDisconnection(agentId, code, reason.toString());
    });

    socket.on('error', (error: Error) => {
      this.logger.error('WebSocketTransport', `Socket error for agent ${agentId}`, error);
      this.metrics.recordError('SocketError');
    });

    socket.on('pong', () => {
      agent.lastSeen = Date.now();
    });

    // Send welcome message
    this.sendMessage(agentId, {
      type: 'HEARTBEAT',
      payload: { agentId, timestamp: Date.now() },
      timestamp: Date.now()
    });

    // Start heartbeat for this connection
    this.startHeartbeat(agentId);
  }

  private async handleMessage(agentId: number, data: Buffer): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    try {
      await TimeoutManager.withTimeout(
        this.processMessage(agentId, data),
        this.config.messageTimeoutMs,
        `process message from agent ${agentId}`
      );
    } catch (error) {
      if (error instanceof TimeoutError) {
        this.logger.warn('WebSocketTransport', `Message timeout for agent ${agentId}`);
        this.metrics.recordTimeout();
      } else {
        this.logger.error('WebSocketTransport', `Message processing error for agent ${agentId}`, error as Error);
        this.metrics.recordError('MessageProcessingError');
      }
    }
  }

  private async processMessage(agentId: number, data: Buffer): Promise<void> {
    const startTime = performance.now();
    const agent = this.agents.get(agentId);
    if (!agent) return;

    try {
      // Parse message
      const message = this.parseMessage(data);
      
      if (message.type === 'BITMASK_MESSAGE') {
        // Validate and deserialize bitmask message
        const bitmaskMsg = BitmaskMessage.deserialize(message.payload as Uint8Array);
        
        // Update agent schema version
        agent.schemaVersion = bitmaskMsg.schemaVersion;
        
        // Record metrics
        agent.messagesReceived++;
        agent.lastSeen = Date.now();
        this.metrics.incrementMessagesProcessed();
        
        const processingTime = (performance.now() - startTime) * 1000; // microseconds
        this.metrics.recordMessageProcessingTime(processingTime);
        
        this.logger.debug('WebSocketTransport', `Received bitmask from agent ${agentId}`, {
          messageSize: data.length,
          processingTimeUs: processingTime,
          schemaVersion: bitmaskMsg.schemaVersion
        });
        
        // Emit message for external handlers
        this.emit('message', { agentId, message: bitmaskMsg });
      } else if (message.type === 'HEARTBEAT') {
        agent.lastSeen = Date.now();
        this.logger.debug('WebSocketTransport', `Heartbeat from agent ${agentId}`);
      }
    } catch (error) {
      this.logger.error('WebSocketTransport', `Invalid message from agent ${agentId}`, error as Error);
      
      // Send error response
      this.sendMessage(agentId, {
        type: 'ERROR',
        payload: { error: 'Invalid message format' },
        timestamp: Date.now()
      });
      
      throw error;
    }
  }

  private parseMessage(data: Buffer): TransportMessage {
    try {
      // First byte indicates message type
      const typeByte = data.readUInt8(0);
      const type = ['BITMASK_MESSAGE', 'HEARTBEAT', 'ERROR', 'SCHEMA_UPDATE'][typeByte];
      
      if (!type) {
        throw new Error(`Unknown message type: ${typeByte}`);
      }
      
      // Rest is payload
      const payload = data.subarray(1);
      
      return {
        type: type as any,
        payload: type === 'BITMASK_MESSAGE' ? payload : JSON.parse(payload.toString()),
        timestamp: Date.now()
      };
    } catch (error) {
      throw new AdaptiveBitmaskError('Failed to parse message', 'PARSE_ERROR', 'RUNTIME');
    }
  }

  private sendMessage(agentId: number, message: TransportMessage): void {
    const agent = this.agents.get(agentId);
    if (!agent || agent.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      let payload: Buffer;
      
      if (message.type === 'BITMASK_MESSAGE') {
        // Type byte + payload
        const typeByte = Buffer.from([0]); // BITMASK_MESSAGE = 0
        payload = Buffer.concat([typeByte, Buffer.from(message.payload as Uint8Array)]);
      } else {
        // Type byte + JSON payload
        const typeByte = Buffer.from([['BITMASK_MESSAGE', 'HEARTBEAT', 'ERROR', 'SCHEMA_UPDATE'].indexOf(message.type)]);
        const jsonPayload = Buffer.from(JSON.stringify(message.payload));
        payload = Buffer.concat([typeByte, jsonPayload]);
      }

      agent.socket.send(payload);
      agent.messagesSent++;
      agent.lastSeen = Date.now();
      
      this.logger.debug('WebSocketTransport', `Sent message to agent ${agentId}`, {
        type: message.type,
        size: payload.length
      });
    } catch (error) {
      this.logger.error('WebSocketTransport', `Failed to send message to agent ${agentId}`, error as Error);
      this.metrics.recordError('SendMessageError');
    }
  }

  private handleDisconnection(agentId: number, code: number, reason: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    this.agents.delete(agentId);
    this.metrics.setAgentsConnected(this.agents.size);

    this.logger.info('WebSocketTransport', `Agent disconnected: ${agentId}`, {
      code,
      reason,
      duration: Date.now() - agent.lastSeen,
      messagesExchanged: agent.messagesReceived + agent.messagesSent
    });

    // Emit disconnection event
    this.emit('disconnection', { agentId, code, reason });
  }

  private startHeartbeat(agentId: number): void {
    const interval = setInterval(() => {
      const agent = this.agents.get(agentId);
      if (!agent) {
        clearInterval(interval);
        return;
      }

      if (agent.socket.readyState !== WebSocket.OPEN) {
        clearInterval(interval);
        return;
      }

      // Check if connection is stale
      if (Date.now() - agent.lastSeen > this.config.connectionTimeoutMs) {
        this.logger.warn('WebSocketTransport', `Agent ${agentId} connection stale, closing`);
        agent.socket.terminate();
        clearInterval(interval);
        return;
      }

      // Send ping
      try {
        agent.socket.ping();
      } catch (error) {
        this.logger.error('WebSocketTransport', `Failed to ping agent ${agentId}`, error as Error);
        clearInterval(interval);
      }
    }, this.config.healthCheckIntervalMs);
  }

  private startHealthChecks(): void {
    setInterval(() => {
      const now = Date.now();
      const staleAgents: number[] = [];

      for (const [agentId, agent] of this.agents) {
        if (now - agent.lastSeen > this.config.connectionTimeoutMs) {
          staleAgents.push(agentId);
        }
      }

      // Clean up stale connections
      for (const agentId of staleAgents) {
        const agent = this.agents.get(agentId);
        if (agent) {
          this.logger.warn('WebSocketTransport', `Cleaning up stale agent ${agentId}`);
          agent.socket.terminate();
        }
      }

      this.metrics.updateMemoryUsage();
    }, this.config.healthCheckIntervalMs);
  }

  // Public API methods
  
  broadcast(message: TransportMessage): void {
    for (const agentId of this.agents.keys()) {
      this.sendMessage(agentId, message);
    }
  }

  sendToAgent(agentId: number, message: TransportMessage): void {
    this.sendMessage(agentId, message);
  }

  getConnectedAgents(): ConnectedAgent[] {
    return Array.from(this.agents.values());
  }

  getAgentCount(): number {
    return this.agents.size;
  }

  getMetrics(): MetricsCollector {
    return this.metrics;
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info('WebSocketTransport', 'Shutting down server...');

    // Close all connections
    const closePromises = Array.from(this.agents.values()).map(agent => {
      return new Promise<void>((resolve) => {
        if (agent.socket.readyState === WebSocket.OPEN) {
          agent.socket.close(1013, 'Server shutting down');
          agent.socket.on('close', () => resolve());
        } else {
          resolve();
        }
      });
    });

    await Promise.all(closePromises);

    // Close server
    return new Promise((resolve) => {
      this.server.close(() => {
        this.logger.info('WebSocketTransport', 'Server shutdown complete');
        resolve();
      });
    });
  }

  // Event emitter functionality (simple implementation)
  private listeners = new Map<string, Function[]>();

  private emit(event: string, data: any): void {
    const eventListeners = this.listeners.get(event) || [];
    for (const listener of eventListeners) {
      try {
        listener(data);
      } catch (error) {
        this.logger.error('WebSocketTransport', `Event listener error for ${event}`, error as Error);
      }
    }
  }

  on(event: 'message' | 'disconnection', listener: Function): void {
    const eventListeners = this.listeners.get(event) || [];
    eventListeners.push(listener);
    this.listeners.set(event, eventListeners);
  }

  off(event: 'message' | 'disconnection', listener: Function): void {
    const eventListeners = this.listeners.get(event) || [];
    const index = eventListeners.indexOf(listener);
    if (index > -1) {
      eventListeners.splice(index, 1);
    }
  }
}

// Factory function for easy setup
export function createWebSocketTransport(config: WebSocketTransportConfig): WebSocketTransport {
  return new WebSocketTransport(config);
}
