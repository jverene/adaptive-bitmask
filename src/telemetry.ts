/**
 * Production-grade logging and telemetry for adaptive-bitmask
 * 
 * Provides structured logging, metrics collection, and observability
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4
}

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  component: string;
  message: string;
  metadata?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
}

export interface Metrics {
  // Performance metrics
  coordinationLatencyUs: number[];
  messageProcessingTimeUs: number[];
  encodingTimeUs: number[];
  decodingTimeUs: number[];
  
  // Volume metrics
  messagesProcessed: number;
  agentsConnected: number;
  featuresActive: number;
  schemaVersion: number;
  
  // Error metrics
  errorsByType: Record<string, number>;
  timeouts: number;
  circuitBreakerTrips: number;
  
  // Memory metrics
  memoryUsageMB: number;
  bufferUtilization: number;
  
  // Timestamps
  lastReset: number;
  uptimeMs: number;
}

export interface HealthStatus {
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  uptime: number;
  version: string;
  timestamp: number;
  checks: {
    memory: boolean;
    latency: boolean;
    errorRate: boolean;
    circuitBreakers: boolean;
  };
  metrics: {
    messagesProcessed: number;
    agentsConnected: number;
    coordinationLatencyUs: {
      mean: number;
      p50: number;
      p95: number;
      p99: number;
      max: number;
      min: number;
    };
    memoryUsageMB: number;
    errorsByType: Record<string, number>;
  };
}

export class Logger {
  private static instance: Logger;
  private logLevel: LogLevel = LogLevel.INFO;
  private logs: LogEntry[] = [];
  private maxLogSize: number = 10000;
  private onLog?: (entry: LogEntry) => void;

  private constructor() {}

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  setLogCallback(callback: (entry: LogEntry) => void): void {
    this.onLog = callback;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.logLevel;
  }

  private createLogEntry(
    level: LogLevel,
    component: string,
    message: string,
    metadata?: Record<string, unknown>,
    error?: Error
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      component,
      message,
      metadata
    };

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: (error as any).code
      };
    }

    return entry;
  }

  private addLog(entry: LogEntry): void {
    this.logs.push(entry);
    
    // Trim logs if they exceed max size
    if (this.logs.length > this.maxLogSize) {
      this.logs = this.logs.slice(-this.maxLogSize);
    }

    // Call external callback if set
    if (this.onLog) {
      this.onLog(entry);
    }

    // Console output for development
    if (this.shouldLog(entry.level)) {
      const levelName = LogLevel[entry.level];
      const message = `[${new Date(entry.timestamp).toISOString()}] ${levelName} [${entry.component}] ${entry.message}`;
      
      switch (entry.level) {
        case LogLevel.DEBUG:
          console.debug(message, entry.metadata || '');
          break;
        case LogLevel.INFO:
          console.info(message, entry.metadata || '');
          break;
        case LogLevel.WARN:
          console.warn(message, entry.metadata || '');
          break;
        case LogLevel.ERROR:
        case LogLevel.FATAL:
          console.error(message, entry.error || entry.metadata || '');
          break;
      }
    }
  }

  debug(component: string, message: string, metadata?: Record<string, unknown>): void {
    const entry = this.createLogEntry(LogLevel.DEBUG, component, message, metadata);
    this.addLog(entry);
  }

  info(component: string, message: string, metadata?: Record<string, unknown>): void {
    const entry = this.createLogEntry(LogLevel.INFO, component, message, metadata);
    this.addLog(entry);
  }

  warn(component: string, message: string, metadata?: Record<string, unknown>): void {
    const entry = this.createLogEntry(LogLevel.WARN, component, message, metadata);
    this.addLog(entry);
  }

  error(component: string, message: string, error?: Error, metadata?: Record<string, unknown>): void {
    const entry = this.createLogEntry(LogLevel.ERROR, component, message, metadata, error);
    this.addLog(entry);
  }

  fatal(component: string, message: string, error?: Error, metadata?: Record<string, unknown>): void {
    const entry = this.createLogEntry(LogLevel.FATAL, component, message, metadata, error);
    this.addLog(entry);
  }

  getRecentLogs(count: number = 100): LogEntry[] {
    return this.logs.slice(-count);
  }

  getLogsByLevel(level: LogLevel): LogEntry[] {
    return this.logs.filter(log => log.level === level);
  }

  clearLogs(): void {
    this.logs = [];
  }
}

export class MetricsCollector {
  private metrics: Metrics;
  private startTime: number;
  private logger = Logger.getInstance();

  constructor() {
    this.startTime = Date.now();
    this.metrics = this.initializeMetrics();
  }

  private initializeMetrics(): Metrics {
    return {
      coordinationLatencyUs: [],
      messageProcessingTimeUs: [],
      encodingTimeUs: [],
      decodingTimeUs: [],
      messagesProcessed: 0,
      agentsConnected: 0,
      featuresActive: 0,
      schemaVersion: 0,
      errorsByType: {},
      timeouts: 0,
      circuitBreakerTrips: 0,
      memoryUsageMB: 0,
      bufferUtilization: 0,
      lastReset: Date.now(),
      uptimeMs: 0
    };
  }

  recordCoordinationLatency(latencyUs: number): void {
    this.metrics.coordinationLatencyUs.push(latencyUs);
    this.logger.debug('Metrics', 'Coordination latency recorded', { latencyUs });
  }

  recordMessageProcessingTime(timeUs: number): void {
    this.metrics.messageProcessingTimeUs.push(timeUs);
  }

  recordEncodingTime(timeUs: number): void {
    this.metrics.encodingTimeUs.push(timeUs);
  }

  recordDecodingTime(timeUs: number): void {
    this.metrics.decodingTimeUs.push(timeUs);
  }

  incrementMessagesProcessed(): void {
    this.metrics.messagesProcessed++;
  }

  setAgentsConnected(count: number): void {
    this.metrics.agentsConnected = count;
  }

  setFeaturesActive(count: number): void {
    this.metrics.featuresActive = count;
  }

  setSchemaVersion(version: number): void {
    this.metrics.schemaVersion = version;
  }

  recordError(errorType: string): void {
    this.metrics.errorsByType[errorType] = (this.metrics.errorsByType[errorType] || 0) + 1;
  }

  recordTimeout(): void {
    this.metrics.timeouts++;
  }

  recordCircuitBreakerTrip(): void {
    this.metrics.circuitBreakerTrips++;
  }

  updateMemoryUsage(): void {
    if (typeof process !== 'undefined' && (process as any).memoryUsage) {
      const usage = (process as any).memoryUsage();
      this.metrics.memoryUsageMB = usage.heapUsed / 1024 / 1024;
    }
  }

  setBufferUtilization(utilization: number): void {
    this.metrics.bufferUtilization = Math.min(1, Math.max(0, utilization));
  }

  getMetrics(): Metrics {
    this.metrics.uptimeMs = Date.now() - this.startTime;
    return { ...this.metrics };
  }

  getLatencyStats(): {
    mean: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
    min: number;
  } {
    const latencies = this.metrics.coordinationLatencyUs;
    if (latencies.length === 0) {
      return { mean: 0, p50: 0, p95: 0, p99: 0, max: 0, min: 0 };
    }

    const sorted = [...latencies].sort((a, b) => a - b);
    const sum = latencies.reduce((a, b) => a + b, 0);

    return {
      mean: sum / latencies.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
      max: sorted[sorted.length - 1],
      min: sorted[0]
    };
  }

  reset(): void {
    this.metrics = this.initializeMetrics();
    this.logger.info('Metrics', 'Metrics reset');
  }
}

export class HealthChecker {
  private metrics: MetricsCollector;
  private logger = Logger.getInstance();
  private version: string = '0.2.0-rc.0';

  constructor(metrics: MetricsCollector) {
    this.metrics = metrics;
  }

  getHealthStatus(): HealthStatus {
    const metrics = this.metrics.getMetrics();
    const latencyStats = this.metrics.getLatencyStats();
    
    // Health checks
    const memoryHealthy = metrics.memoryUsageMB < 500; // 500MB limit
    const latencyHealthy = latencyStats.p99 < 10000; // 10ms p99 latency
    const errorRateHealthy = this.getErrorRate() < 0.01; // < 1% error rate
    const circuitBreakersHealthy = metrics.circuitBreakerTrips === 0;

    const allHealthy = memoryHealthy && latencyHealthy && errorRateHealthy && circuitBreakersHealthy;
    const someHealthy = memoryHealthy && latencyHealthy;

    let status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
    if (allHealthy) {
      status = 'HEALTHY';
    } else if (someHealthy) {
      status = 'DEGRADED';
    } else {
      status = 'UNHEALTHY';
    }

    return {
      status,
      uptime: metrics.uptimeMs,
      version: this.version,
      timestamp: Date.now(),
      checks: {
        memory: memoryHealthy,
        latency: latencyHealthy,
        errorRate: errorRateHealthy,
        circuitBreakers: circuitBreakersHealthy
      },
      metrics: {
        messagesProcessed: metrics.messagesProcessed,
        agentsConnected: metrics.agentsConnected,
        coordinationLatencyUs: latencyStats,
        memoryUsageMB: metrics.memoryUsageMB,
        errorsByType: metrics.errorsByType
      }
    };
  }

  private getErrorRate(): number {
    const metrics = this.metrics.getMetrics();
    const totalErrors = Object.values(metrics.errorsByType).reduce((sum, count) => sum + count, 0);
    const totalOperations = metrics.messagesProcessed + totalErrors;
    return totalOperations > 0 ? totalErrors / totalOperations : 0;
  }

  startHealthCheck(intervalMs: number = 30000): void {
    setInterval(() => {
      const status = this.getHealthStatus();
      this.logger.info('Health', `Health status: ${status.status}`, {
        uptime: status.uptime,
        checks: status.checks,
        messagesProcessed: status.metrics.messagesProcessed
      });

      if (status.status === 'UNHEALTHY') {
        this.logger.error('Health', 'System is unhealthy', undefined, {
          checks: status.checks,
          metrics: status.metrics
        });
      }
    }, intervalMs);
  }
}

// Performance profiler for deep debugging
export class Profiler {
  private static sessions = new Map<string, { startTime: number; events: Array<{ time: number; event: string; data?: unknown }> }>();
  private logger = Logger.getInstance();

  static startSession(sessionId: string): void {
    this.sessions.set(sessionId, {
      startTime: performance.now(),
      events: []
    });
    this.getLogger().debug('Profiler', `Started profiling session: ${sessionId}`);
  }

  static recordEvent(sessionId: string, event: string, data?: unknown): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.getLogger().warn('Profiler', `No active session: ${sessionId}`);
      return;
    }

    session.events.push({
      time: performance.now() - session.startTime,
      event,
      data
    });
  }

  static endSession(sessionId: string): Array<{ event: string; time: number; data?: unknown }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.getLogger().warn('Profiler', `No active session: ${sessionId}`);
      return [];
    }

    this.sessions.delete(sessionId);
    this.getLogger().debug('Profiler', `Ended profiling session: ${sessionId}`, {
      duration: performance.now() - session.startTime,
      eventCount: session.events.length
    });

    return session.events;
  }

  private static getLogger() {
    return Logger.getInstance();
  }
}

// Utility function to create a production-ready logger instance
export function createProductionLogger(config?: {
  level?: LogLevel;
  maxLogSize?: number;
  enableConsole?: boolean;
}): Logger {
  const logger = Logger.getInstance();
  
  if (config?.level !== undefined) {
    logger.setLogLevel(config.level);
  }
  
  if (config?.enableConsole === false) {
    logger.setLogCallback(() => {}); // Disable console output
  }
  
  return logger;
}

// Utility function to create metrics collector with auto-updates
export function createMetricsCollector(autoUpdateMs?: number): MetricsCollector {
  const collector = new MetricsCollector();
  
  if (autoUpdateMs) {
    setInterval(() => {
      collector.updateMemoryUsage();
    }, autoUpdateMs);
  }
  
  return collector;
}
