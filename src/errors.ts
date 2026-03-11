/**
 * Production-grade error handling for adaptive-bitmask
 * 
 * Provides structured error classes, validation, and graceful degradation
 */

// Base error class for all adaptive-bitmask errors
export class AdaptiveBitmaskError extends Error {
  public readonly code: string;
  public readonly category: 'VALIDATION' | 'RUNTIME' | 'NETWORK' | 'SYSTEM';
  public readonly context?: Record<string, unknown>;
  public readonly timestamp: number;

  constructor(
    message: string,
    code: string,
    category: 'VALIDATION' | 'RUNTIME' | 'NETWORK' | 'SYSTEM',
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AdaptiveBitmaskError';
    this.code = code;
    this.category = category;
    this.context = context;
    this.timestamp = Date.now();
    
    // Maintains proper stack trace for where our error was thrown (Node.js only)
    if (typeof (Error as any).captureStackTrace === 'function') {
      (Error as any).captureStackTrace(this, AdaptiveBitmaskError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      category: this.category,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack
    };
  }
}

// Validation errors
export class ValidationError extends AdaptiveBitmaskError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 'VALIDATION', context);
    this.name = 'ValidationError';
  }
}

export class SchemaValidationError extends ValidationError {
  constructor(message: string, schemaVersion?: number, feature?: string) {
    super(message, { schemaVersion, feature });
    this.name = 'SchemaValidationError';
  }
}

export class MessageValidationError extends ValidationError {
  constructor(message: string, agentId?: number, messageSize?: number) {
    super(message, { agentId, messageSize });
    this.name = 'MessageValidationError';
  }
}

// Runtime errors
export class RuntimeError extends AdaptiveBitmaskError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'RUNTIME_ERROR', 'RUNTIME', context);
    this.name = 'RuntimeError';
  }
}

export class CoordinatorError extends RuntimeError {
  constructor(message: string, agentCount?: number, deadlineMs?: number) {
    super(message, { agentCount, deadlineMs });
    this.name = 'CoordinatorError';
  }
}

export class ArbiterError extends RuntimeError {
  constructor(message: string, score?: number, decision?: string) {
    super(message, { score, decision });
    this.name = 'ArbiterError';
  }
}

// Network/Transport errors
export class NetworkError extends AdaptiveBitmaskError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'NETWORK_ERROR', 'NETWORK', context);
    this.name = 'NetworkError';
  }
}

export class TimeoutError extends NetworkError {
  constructor(message: string, timeoutMs?: number, operation?: string) {
    super(message, { timeoutMs, operation });
    this.name = 'TimeoutError';
  }
}

// System errors
export class SystemError extends AdaptiveBitmaskError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'SYSTEM_ERROR', 'SYSTEM', context);
    this.name = 'SystemError';
  }
}

export class MemoryError extends SystemError {
  constructor(message: string, memoryUsage?: number, limit?: number) {
    super(message, { memoryUsage, limit });
    this.name = 'MemoryError';
  }
}

// Validation utilities
export class Validator {
  static validateAgentId(agentId: number): void {
    if (!Number.isInteger(agentId) || agentId < 0 || agentId > 0xFFFFFFFF) {
      throw new MessageValidationError(
        `Invalid agent ID: ${agentId}. Must be a non-negative integer <= 4294967295`,
        agentId
      );
    }
  }

  static validateFeatureName(feature: string): void {
    if (typeof feature !== 'string' || feature.length === 0) {
      throw new ValidationError(
        `Invalid feature name: must be a non-empty string`,
        { feature }
      );
    }
    
    if (feature.length > 100) {
      throw new ValidationError(
        `Feature name too long: ${feature.length} chars. Max: 100`,
        { feature, length: feature.length }
      );
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(feature)) {
      throw new ValidationError(
        `Invalid feature name format: ${feature}. Only alphanumeric, underscore, and hyphen allowed`,
        { feature }
      );
    }
  }

  static validateFeatureArray(features: string[]): void {
    if (!Array.isArray(features)) {
      throw new ValidationError(
        `Features must be an array`,
        { type: typeof features }
      );
    }

    if (features.length > 64) {
      throw new ValidationError(
        `Too many features: ${features.length}. Max: 64`,
        { count: features.length }
      );
    }

    const seen = new Set<string>();
    for (const feature of features) {
      this.validateFeatureName(feature);
      
      if (seen.has(feature)) {
        throw new ValidationError(
          `Duplicate feature: ${feature}`,
          { feature }
        );
      }
      seen.add(feature);
    }
  }

  static validateSchemaVersion(version: number): void {
    if (!Number.isInteger(version) || version < 0 || version > 0xFFFFFFFF) {
      throw new SchemaValidationError(
        `Invalid schema version: ${version}. Must be a non-negative integer <= 4294967295`,
        version
      );
    }
  }

  static validateDeadlineMs(deadlineMs: number): void {
    if (!Number.isInteger(deadlineMs) || deadlineMs < 0 || deadlineMs > 60000) {
      throw new ValidationError(
        `Invalid deadline: ${deadlineMs}ms. Must be 0-60000ms`,
        { deadlineMs }
      );
    }
  }

  static validateTimeout(timeoutMs: number, operation: string): void {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 300000) {
      throw new ValidationError(
        `Invalid timeout for ${operation}: ${timeoutMs}ms. Must be 0-300000ms`,
        { operation, timeoutMs }
      );
    }
  }
}

// Circuit breaker for graceful degradation
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

  constructor(
    private readonly failureThreshold: number = 5,
    private readonly recoveryTimeoutMs: number = 60000,
    private readonly monitoringPeriodMs: number = 10000
  ) {}

  async execute<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.recoveryTimeoutMs) {
        this.state = 'HALF_OPEN';
      } else {
        throw new RuntimeError(
          `Circuit breaker OPEN for ${operationName}. Too many failures.`,
          { 
            failures: this.failures,
            state: this.state,
            nextRetry: this.lastFailureTime + this.recoveryTimeoutMs
          }
        );
      }
    }

    try {
      const result = await operation();
      
      if (this.state === 'HALF_OPEN') {
        this.reset();
      }
      
      return result;
    } catch (error) {
      this.recordFailure();
      
      if (this.failures >= this.failureThreshold) {
        this.state = 'OPEN';
        this.lastFailureTime = Date.now();
      }
      
      throw error;
    }
  }

  private recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
  }

  private reset(): void {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  getStatus() {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime,
      isHealthy: this.state !== 'OPEN'
    };
  }
}

// Timeout wrapper
export class TimeoutManager {
  static async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operation: string
  ): Promise<T> {
    Validator.validateTimeout(timeoutMs, operation);

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new TimeoutError(
          `Operation timed out: ${operation}`,
          timeoutMs,
          operation
        ));
      }, timeoutMs);

      // Clear timeout if promise resolves
      promise.finally(() => clearTimeout(timeoutId));
    });

    return Promise.race([promise, timeoutPromise]);
  }
}

// Error recovery utilities
export class RecoveryManager {
  static async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelayMs: number = 1000,
    operationName: string = 'operation'
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (attempt === maxRetries) {
          throw new RuntimeError(
            `Operation failed after ${maxRetries + 1} attempts: ${operationName}`,
            { 
              attempts: attempt + 1,
              maxRetries: maxRetries + 1,
              lastError: lastError.message
            }
          );
        }

        // Exponential backoff with jitter
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError!;
  }
}
