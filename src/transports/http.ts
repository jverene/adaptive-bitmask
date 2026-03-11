/**
 * HTTP/REST transport layer for adaptive-bitmask
 * 
 * Simple REST API for multi-agent coordination over HTTP
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { BitmaskMessage } from '../message.js';
import { Logger, MetricsCollector, CircuitBreaker, TimeoutManager } from '../index.js';
import { AdaptiveBitmaskError, ValidationError, TimeoutError } from '../errors.js';

export interface HttpTransportConfig {
  /** HTTP server port */
  port: number;
  /** Request timeout in milliseconds */
  requestTimeoutMs?: number;
  /** Maximum request body size */
  maxBodySize?: number;
  /** Enable CORS */
  enableCors?: boolean;
  /** Circuit breaker failure threshold */
  circuitBreakerThreshold?: number;
  /** Rate limiting requests per minute */
  rateLimitPerMinute?: number;
}

export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Buffer;
  timestamp: number;
}

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body?: string | Buffer;
  timestamp: number;
}

export class HttpTransport {
  private server: ReturnType<typeof createServer>;
  private logger = Logger.getInstance();
  private metrics: MetricsCollector;
  private circuitBreaker: CircuitBreaker;
  private config: Required<HttpTransportConfig>;
  private requestCounts = new Map<string, number[]>();
  private isShuttingDown = false;

  constructor(config: HttpTransportConfig) {
    this.config = {
      requestTimeoutMs: 10000,
      maxBodySize: 1024 * 1024, // 1MB
      enableCors: true,
      circuitBreakerThreshold: 20,
      rateLimitPerMinute: 1000,
      ...config
    };

    this.metrics = new MetricsCollector();
    this.circuitBreaker = new CircuitBreaker(this.config.circuitBreakerThreshold);
    
    this.server = createServer((req, res) => {
      this.handleRequest(req, res);
    });

    this.startRateLimitCleanup();
    
    this.logger.info('HttpTransport', `Server started on port ${this.config.port}`);
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.isShuttingDown) {
      this.sendResponse(res, 503, JSON.stringify({ error: 'Server shutting down' }));
      return;
    }

    const clientIP = req.socket.remoteAddress || 'unknown';
    const url = req.url || '/';
    
    // Rate limiting
    if (this.isRateLimited(clientIP)) {
      this.sendResponse(res, 429, JSON.stringify({ error: 'Rate limit exceeded' }));
      this.logger.warn('HttpTransport', `Rate limit exceeded for ${clientIP}`);
      return;
    }

    // CORS headers
    if (this.config.enableCors) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    try {
      await TimeoutManager.withTimeout(
        this.processRequest(req, res),
        this.config.requestTimeoutMs,
        `HTTP request from ${clientIP}`
      );
    } catch (error) {
      if (error instanceof TimeoutError) {
        this.sendResponse(res, 408, JSON.stringify({ error: 'Request timeout' }));
        this.metrics.recordTimeout();
      } else {
        this.logger.error('HttpTransport', 'Request processing error', error as Error);
        this.sendResponse(res, 500, JSON.stringify({ error: 'Internal server error' }));
        this.metrics.recordError('HttpRequestError');
      }
    }
  }

  private async processRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const startTime = performance.now();
    const method = req.method || 'GET';
    const url = req.url || '/';
    
    // Parse request body for POST/PUT
    let body: Buffer | undefined;
    if (method === 'POST' || method === 'PUT') {
      body = await this.parseRequestBody(req);
    }

    const request: HttpRequest = {
      method,
      url,
      headers: req.headers as Record<string, string>,
      body,
      timestamp: Date.now()
    };

    this.logger.debug('HttpTransport', `Incoming ${method} ${url}`, {
      contentLength: body?.length,
      userAgent: request.headers['user-agent']
    });

    // Route handling
    let response: HttpResponse;
    
    try {
      response = await this.routeRequest(request);
    } catch (error) {
      if (error instanceof ValidationError) {
        response = {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: error.message, code: error.code }),
          timestamp: Date.now()
        };
      } else if (error instanceof AdaptiveBitmaskError) {
        response = {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: error.message, code: error.code }),
          timestamp: Date.now()
        };
      } else {
        throw error;
      }
    }

    // Send response
    this.sendResponse(res, response.statusCode, response.body, response.headers);

    // Record metrics
    const processingTime = (performance.now() - startTime) * 1000; // microseconds
    this.metrics.recordMessageProcessingTime(processingTime);
    this.metrics.incrementMessagesProcessed();

    this.logger.debug('HttpTransport', `Response sent`, {
      statusCode: response.statusCode,
      processingTimeUs: processingTime
    });
  }

  private async parseRequestBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalSize = 0;

      req.on('data', (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > this.config.maxBodySize) {
          reject(new ValidationError(`Request body too large: ${totalSize} bytes`));
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        resolve(Buffer.concat(chunks));
      });

      req.on('error', reject);
    });
  }

  private async routeRequest(request: HttpRequest): Promise<HttpResponse> {
    const { method, url, body } = request;

    // API Routes
    if (url === '/api/coordinate' && method === 'POST') {
      return await this.handleCoordinate(body);
    }

    if (url === '/api/health' && method === 'GET') {
      return await this.handleHealth();
    }

    if (url === '/api/metrics' && method === 'GET') {
      return await this.handleMetrics();
    }

    if (url === '/api/schema' && method === 'GET') {
      return await this.handleGetSchema();
    }

    if (url === '/api/schema' && method === 'POST') {
      return await this.handleUpdateSchema(body);
    }

    // Default 404
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Not found' }),
      timestamp: Date.now()
    };
  }

  private async handleCoordinate(body?: Buffer): Promise<HttpResponse> {
    if (!body) {
      throw new ValidationError('Missing request body');
    }

    try {
      const bitmaskMsg = BitmaskMessage.deserialize(body);
      
      this.logger.info('HttpTransport', 'Received bitmask message', {
        agentId: bitmaskMsg.agentId,
        schemaVersion: bitmaskMsg.schemaVersion,
        messageSize: body.length
      });

      // Emit message for external handlers
      this.emit('message', { message: bitmaskMsg });

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          success: true, 
          received: true,
          timestamp: Date.now()
        }),
        timestamp: Date.now()
      };
    } catch (error) {
      throw new ValidationError('Invalid bitmask message format');
    }
  }

  private async handleHealth(): Promise<HttpResponse> {
    const metrics = this.metrics.getMetrics();
    const latencyStats = this.metrics.getLatencyStats();
    
    const health = {
      status: 'HEALTHY',
      uptime: metrics.uptimeMs,
      timestamp: Date.now(),
      version: '0.2.0-rc.0',
      metrics: {
        messagesProcessed: metrics.messagesProcessed,
        memoryUsageMB: metrics.memoryUsageMB,
        avgLatencyUs: latencyStats.mean
      }
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(health),
      timestamp: Date.now()
    };
  }

  private async handleMetrics(): Promise<HttpResponse> {
    const metrics = this.metrics.getMetrics();
    const latencyStats = this.metrics.getLatencyStats();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...metrics,
        latencyStats
      }),
      timestamp: Date.now()
    };
  }

  private async handleGetSchema(): Promise<HttpResponse> {
    // This would typically return the current schema
    // For now, return a placeholder
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: 1,
        features: [],
        timestamp: Date.now()
      }),
      timestamp: Date.now()
    };
  }

  private async handleUpdateSchema(body?: Buffer): Promise<HttpResponse> {
    // Schema update logic would go here
    return {
      statusCode: 501,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Schema updates not implemented yet' }),
      timestamp: Date.now()
    };
  }

  private sendResponse(res: ServerResponse, statusCode: number, body?: string | Buffer, headers?: Record<string, string>): void {
    if (headers) {
      Object.entries(headers).forEach(([key, value]) => {
        res.setHeader(key, value);
      });
    }

    if (body && !res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'application/json');
    }

    res.writeHead(statusCode);
    res.end(body);
  }

  private isRateLimited(clientIP: string): boolean {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Get existing requests for this IP
    let requests = this.requestCounts.get(clientIP) || [];
    
    // Filter out old requests
    requests = requests.filter(timestamp => timestamp > oneMinuteAgo);
    
    // Add current request
    requests.push(now);
    
    // Update stored requests
    this.requestCounts.set(clientIP, requests);
    
    // Check if over limit
    return requests.length > this.config.rateLimitPerMinute;
  }

  private startRateLimitCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      const oneMinuteAgo = now - 60000;

      for (const [ip, requests] of this.requestCounts) {
        const filtered = requests.filter(timestamp => timestamp > oneMinuteAgo);
        if (filtered.length === 0) {
          this.requestCounts.delete(ip);
        } else {
          this.requestCounts.set(ip, filtered);
        }
      }
    }, 60000); // Clean up every minute
  }

  // Public API methods
  
  start(): void {
    this.server.listen(this.config.port);
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info('HttpTransport', 'Shutting down server...');

    return new Promise((resolve) => {
      this.server.close(() => {
        this.logger.info('HttpTransport', 'Server shutdown complete');
        resolve();
      });
    });
  }

  getMetrics(): MetricsCollector {
    return this.metrics;
  }

  // Event emitter functionality (simple implementation)
  private listeners = new Map<string, Function[]>();

  private emit(event: string, data: any): void {
    const eventListeners = this.listeners.get(event) || [];
    for (const listener of eventListeners) {
      try {
        listener(data);
      } catch (error) {
        this.logger.error('HttpTransport', `Event listener error for ${event}`, error as Error);
      }
    }
  }

  on(event: 'message', listener: Function): void {
    const eventListeners = this.listeners.get(event) || [];
    eventListeners.push(listener);
    this.listeners.set(event, eventListeners);
  }

  off(event: 'message', listener: Function): void {
    const eventListeners = this.listeners.get(event) || [];
    const index = eventListeners.indexOf(listener);
    if (index > -1) {
      eventListeners.splice(index, 1);
    }
  }
}

// Factory function for easy setup
export function createHttpTransport(config: HttpTransportConfig): HttpTransport {
  const transport = new HttpTransport(config);
  transport.start();
  return transport;
}
