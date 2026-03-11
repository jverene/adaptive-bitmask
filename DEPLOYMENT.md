# Production Deployment Guide

## Overview

This guide covers deploying `adaptive-bitmask` in production environments with proper monitoring, scaling, and operational considerations.

## Table of Contents

1. [System Requirements](#system-requirements)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [Deployment Options](#deployment-options)
5. [Monitoring & Observability](#monitoring--observability)
6. [Scaling Considerations](#scaling-considerations)
7. [Security](#security)
8. [Troubleshooting](#troubleshooting)

## System Requirements

### Minimum Requirements
- **Node.js**: >= 18.0.0
- **Memory**: 512MB RAM
- **CPU**: 1 core
- **Disk**: 100MB

### Recommended for Production
- **Node.js**: >= 20.0.0
- **Memory**: 2GB RAM
- **CPU**: 2+ cores
- **Disk**: 1GB SSD
- **Network**: Low latency (< 1ms intra-datacenter)

## Installation

### Production Install
```bash
# Install the stable version
npm install adaptive-bitmask

# Or install with optional dependencies
npm install adaptive-bitmask ws @types/ws
```

### Development Install
```bash
# Install from source
git clone https://github.com/jverene/adaptive-bitmask.git
cd adaptive-bitmask
npm install
npm run build
npm pack
```

## Configuration

### Environment Variables
```bash
# Core configuration
ADAPTIVE_BITMASK_LOG_LEVEL=info
ADAPTIVE_BITMASK_MAX_AGENTS=1000
ADAPTIVE_BITMASK_DEADLINE_MS=15

# Transport configuration
ADAPTIVE_BITMASK_WS_PORT=8080
ADAPTIVE_BITMASK_HTTP_PORT=8081
ADAPTIVE_BITMASK_ENABLE_COMPRESSION=true

# Monitoring
ADAPTIVE_BITMASK_METRICS_INTERVAL=30000
ADAPTIVE_BITMASK_HEALTH_CHECK_INTERVAL=60000
```

### Configuration File
```typescript
// config/production.ts
export const config = {
  // Core engine
  schema: {
    maxFeatures: 64,
    emergencyPrefix: 'EMERGENCY_'
  },
  
  coordinator: {
    expectedAgents: 1000,
    deadlineMs: 15,
    staleMessagePolicy: 'warn' as const
  },
  
  arbiter: {
    executeThreshold: 0.55,
    synthesizeThreshold: 0.40,
    emergencyOverride: true
  },
  
  // Transport layers
  websocket: {
    port: 8080,
    maxConnections: 1000,
    connectionTimeoutMs: 30000,
    enableCompression: true
  },
  
  http: {
    port: 8081,
    requestTimeoutMs: 10000,
    enableCors: true,
    rateLimitPerMinute: 1000
  },
  
  // Logging & monitoring
  logging: {
    level: 'info' as const,
    enableConsole: false,
    maxLogSize: 10000
  },
  
  metrics: {
    autoUpdateMs: 30000
  }
};
```

## Deployment Options

### Option 1: Docker Container

#### Dockerfile
```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY adaptive-bitmask-*.tgz ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY dist/ ./dist/
COPY config/ ./config/

# Create non-root user
RUN addgroup -g 1001 -S bitmask
RUN adduser -S bitmask -u 1001

USER bitmask

EXPOSE 8080 8081

CMD ["node", "dist/index.js"]
```

#### Docker Compose
```yaml
version: '3.8'

services:
  adaptive-bitmask:
    build: .
    ports:
      - "8080:8080"  # WebSocket
      - "8081:8081"  # HTTP API
    environment:
      - NODE_ENV=production
      - ADAPTIVE_BITMASK_LOG_LEVEL=info
      - ADAPTIVE_BITMASK_MAX_AGENTS=1000
    resources:
      limits:
        memory: 1G
        cpus: '0.5'
      reservations:
        memory: 512M
        cpus: '0.25'
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8081/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped

  # Optional: Redis for distributed coordination
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    resources:
      limits:
        memory: 256M
      cpus: '0.1'
```

### Option 2: Kubernetes

#### Deployment Manifest
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: adaptive-bitmask
  labels:
    app: adaptive-bitmask
spec:
  replicas: 3
  selector:
    matchLabels:
      app: adaptive-bitmask
  template:
    metadata:
      labels:
        app: adaptive-bitmask
    spec:
      containers:
      - name: adaptive-bitmask
        image: your-registry/adaptive-bitmask:latest
        ports:
        - containerPort: 8080
          name: websocket
        - containerPort: 8081
          name: http
        env:
        - name: NODE_ENV
          value: "production"
        - name: ADAPTIVE_BITMASK_LOG_LEVEL
          value: "info"
        - name: ADAPTIVE_BITMASK_MAX_AGENTS
          value: "1000"
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /api/health
            port: 8081
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /api/health
            port: 8081
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: adaptive-bitmask-service
spec:
  selector:
    app: adaptive-bitmask
  ports:
  - name: websocket
    port: 8080
    targetPort: 8080
  - name: http
    port: 8081
    targetPort: 8081
  type: ClusterIP
```

### Option 3: PM2 Process Manager

#### Ecosystem Config
```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'adaptive-bitmask',
    script: 'dist/index.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      ADAPTIVE_BITMASK_LOG_LEVEL: 'info'
    },
    max_memory_restart: '1G',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    autorestart: true,
    watch: false,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
```

#### Start Commands
```bash
# Install PM2
npm install -g pm2

# Start the application
pm2 start ecosystem.config.js

# Save the process list
pm2 save

# Setup startup script
pm2 startup
```

## Monitoring & Observability

### Health Checks

#### HTTP Health Endpoint
```bash
curl http://localhost:8081/api/health
```

Response:
```json
{
  "status": "HEALTHY",
  "uptime": 3600000,
  "timestamp": 1641024000000,
  "version": "1.0.0",
  "metrics": {
    "messagesProcessed": 1000000,
    "memoryUsageMB": 256,
    "avgLatencyUs": 85
  }
}
```

### Metrics Collection

#### Prometheus Metrics
```typescript
import { register, Counter, Histogram, Gauge } from 'prom-client';

// Create metrics
const messagesProcessed = new Counter({
  name: 'adaptive_bitmask_messages_processed_total',
  help: 'Total number of messages processed'
});

const coordinationLatency = new Histogram({
  name: 'adaptive_bitmask_coordination_latency_us',
  help: 'Coordination latency in microseconds',
  buckets: [10, 50, 100, 500, 1000, 5000, 10000]
});

const activeConnections = new Gauge({
  name: 'adaptive_bitmask_active_connections',
  help: 'Number of active agent connections'
});

// Register metrics with your transport layer
transport.on('message', () => {
  messagesProcessed.inc();
});
```

#### Structured Logging
```typescript
import { Logger, LogLevel } from 'adaptive-bitmask';

const logger = Logger.getInstance();
logger.setLogLevel(LogLevel.INFO);

// Set up external log aggregation
logger.setLogCallback((entry) => {
  // Send to your logging service
  sendToLogService(entry);
});
```

### Alerting Rules

#### Prometheus Alerts
```yaml
groups:
- name: adaptive-bitmask
  rules:
  - alert: HighLatency
    expr: adaptive_bitmask_coordination_latency_us_p99 > 10000
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "High coordination latency detected"
      
  - alert: HighMemoryUsage
    expr: adaptive_bitmask_memory_usage_mb > 800
    for: 5m
    labels:
      severity: critical
    annotations:
      summary: "High memory usage detected"
      
  - alert: HighErrorRate
    expr: rate(adaptive_bitmask_errors_total[5m]) > 0.01
    for: 2m
    labels:
      severity: warning
    annotations:
      summary: "High error rate detected"
```

## Scaling Considerations

### Horizontal Scaling

#### Load Balancer Configuration
```nginx
upstream adaptive_bitmask_ws {
    ip_hash;
    server adaptive-bitmask-1:8080;
    server adaptive-bitmask-2:8080;
    server adaptive-bitmask-3:8080;
}

upstream adaptive_bitmask_http {
    least_conn;
    server adaptive-bitmask-1:8081;
    server adaptive-bitmask-2:8081;
    server adaptive-bitmask-3:8081;
}

# WebSocket proxy
server {
    listen 80;
    location /ws {
        proxy_pass http://adaptive_bitmask_ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
    
    # HTTP API proxy
    location /api {
        proxy_pass http://adaptive_bitmask_http;
        proxy_set_header Host $host;
    }
}
```

#### Session Affinity
- Use `ip_hash` for WebSocket connections to maintain agent affinity
- Consider Redis for distributed session storage
- Implement consistent hashing for large deployments

### Vertical Scaling

#### Performance Tuning
```typescript
// Optimize for high throughput
const config = {
  coordinator: {
    expectedAgents: 5000,  // Increase for more agents
    deadlineMs: 10,        // Reduce for lower latency
  },
  
  websocket: {
    maxConnections: 10000,  // Increase connection limit
    connectionTimeoutMs: 15000,  // Reduce timeout
  },
  
  // Enable performance profiling
  profiling: true
};
```

#### Memory Optimization
```typescript
// Monitor and optimize memory usage
setInterval(() => {
  const metrics = collector.getMetrics();
  if (metrics.memoryUsageMB > 800) {
    logger.warn('Memory', 'High memory usage detected', {
      usage: metrics.memoryUsageMB
    });
    
    // Trigger cleanup
    gc(); // Force garbage collection if available
  }
}, 30000);
```

## Security

### Network Security

#### TLS Configuration
```typescript
import { createServer } from 'https';
import { readFileSync } from 'fs';

const httpsServer = createServer({
  key: readFileSync('path/to/private.key'),
  cert: readFileSync('path/to/certificate.crt'),
  ca: readFileSync('path/to/ca-bundle.crt')
});

// Use HTTPS server for WebSocket transport
const wss = new WebSocketServer({ 
  server: httpsServer,
  verifyClient: (info) => {
    // Implement client verification
    return verifyClient(info);
  }
});
```

#### Rate Limiting
```typescript
// Configure strict rate limiting
const config = {
  http: {
    rateLimitPerMinute: 100,  // Conservative limit
    maxBodySize: 1024 * 100,   // 100KB max body
  },
  
  websocket: {
    maxConnections: 1000,
    connectionTimeoutMs: 30000,
    circuitBreakerThreshold: 5  // Lower threshold
  }
};
```

### Input Validation

#### Message Validation
```typescript
import { Validator, ValidationError } from 'adaptive-bitmask';

// Validate all incoming messages
transport.on('message', (data) => {
  try {
    // Validate message format
    Validator.validateMessageSize(data.length);
    Validator.validateMessageFormat(data);
    
    // Process message
    processMessage(data);
  } catch (error) {
    if (error instanceof ValidationError) {
      logger.warn('Security', 'Invalid message rejected', { error: error.message });
    } else {
      throw error;
    }
  }
});
```

### Authentication

#### API Key Authentication
```typescript
const apiKeys = new Set(['key1', 'key2', 'key3']);

function authenticate(req: HttpRequest): boolean {
  const apiKey = req.headers['x-api-key'];
  return apiKeys.has(apiKey);
}

// Apply authentication middleware
server.use((req, res, next) => {
  if (!authenticate(req)) {
    res.writeHead(401);
    res.end('Unauthorized');
    return;
  }
  next();
});
```

## Troubleshooting

### Common Issues

#### High Latency
```bash
# Check coordination latency
curl http://localhost:8081/api/metrics | jq '.latencyStats'

# Common causes:
# - High agent count (> 1000)
# - Network congestion
# - Memory pressure
# - Schema version mismatches
```

#### Memory Leaks
```bash
# Monitor memory usage
watch -n 5 'ps aux | grep adaptive-bitmask'

# Check for memory leaks
node --inspect dist/index.js
# Then connect with Chrome DevTools
```

#### Connection Issues
```bash
# Check WebSocket connections
curl -i -N -H "Connection: Upgrade" \
     -H "Upgrade: websocket" \
     -H "Sec-WebSocket-Key: test" \
     -H "Sec-WebSocket-Version: 13" \
     http://localhost:8080/

# Check HTTP endpoints
curl -v http://localhost:8081/api/health
```

### Debug Mode

#### Enable Debug Logging
```typescript
import { Logger, LogLevel } from 'adaptive-bitmask';

const logger = Logger.getInstance();
logger.setLogLevel(LogLevel.DEBUG);

// Enable performance profiling
import { Profiler } from 'adaptive-bitmask';

Profiler.startSession('debug-session');
// ... your code ...
const events = Profiler.endSession('debug-session');
console.log('Profile events:', events);
```

#### Stack Traces
```bash
# Enable stack traces
export NODE_OPTIONS="--trace-warnings"

# Run with debugging
node --inspect-brk dist/index.js
```

### Performance Analysis

#### Benchmarking
```bash
# Run production benchmarks
npm run benchmark:production

# Custom benchmark
node benchmarks/custom-benchmark.js
```

#### Profiling
```bash
# CPU profiling
node --prof dist/index.js
node --prof-process isolate-*.log > profile.txt

# Heap profiling
node --heap-prof dist/index.js
```

## Emergency Procedures

### Graceful Shutdown
```typescript
const shutdown = async () => {
  logger.info('Shutdown', 'Starting graceful shutdown...');
  
  // Stop accepting new connections
  await transport.shutdown();
  
  // Wait for in-flight requests to complete
  await waitForCompletion();
  
  // Close database connections
  await db.close();
  
  logger.info('Shutdown', 'Graceful shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

### Circuit Breaker Recovery
```typescript
// Monitor circuit breaker status
setInterval(() => {
  const status = circuitBreaker.getStatus();
  if (!status.isHealthy) {
    logger.warn('CircuitBreaker', 'Circuit breaker is open', status);
    
    // Implement recovery strategy
    implementRecoveryStrategy();
  }
}, 10000);
```

### Backup and Recovery
```bash
# Backup schema and configuration
cp -r config/ backup/config-$(date +%Y%m%d-%H%M%S)/
cp -r logs/ backup/logs-$(date +%Y%m%d-%H%M%S)/

# Restore from backup
cp backup/config-20240101-120000/ config/
cp backup/logs-20240101-120000/ logs/
```
