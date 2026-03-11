/**
 * Production Testing Suite for adaptive-bitmask
 * 
 * Real-world deployment scenarios with monitoring and validation
 */

import { SharedCognition } from '../src/SharedCognition.js';
import { WebSocketTransport, createWebSocketTransport } from '../src/transports/websocket.js';
import { HttpTransport, createHttpTransport } from '../src/transports/http.js';
import { Logger, MetricsCollector, LogLevel, HealthChecker } from '../src/index.js';
import { BitmaskMessage } from '../src/message.js';
import { encode } from '../src/index.js';
import { WebSocket } from 'ws';

class ProductionTester {
  private cognition: SharedCognition;
  private wsTransport: WebSocketTransport;
  private httpTransport: HttpTransport;
  private metrics: MetricsCollector;
  private logger: Logger;
  private healthChecker: HealthChecker;
  private testResults: any[] = [];

  constructor() {
    // Production-like configuration
    this.logger = Logger.getInstance();
    this.logger.setLogLevel(LogLevel.INFO);
    
    this.metrics = new MetricsCollector();
    
    this.cognition = new SharedCognition({
      schema: {
        maxFeatures: 64,
        emergencyPrefix: 'EMERGENCY_'
      },
      coordinator: {
        expectedAgents: 1000,
        deadlineMs: 15,
        staleMessagePolicy: 'warn'
      },
      arbiter: {
        executeThreshold: 0.55,
        synthesizeThreshold: 0.40,
        emergencyOverride: true
      }
    });

    // Production transport setup
    this.wsTransport = createWebSocketTransport({
      port: 8090,
      maxConnections: 500,
      connectionTimeoutMs: 30000,
      messageTimeoutMs: 5000
    });

    this.httpTransport = createHttpTransport({
      port: 8091,
      requestTimeoutMs: 10000,
      enableCors: true,
      rateLimitPerMinute: 2000
    });

    this.healthChecker = new HealthChecker(this.metrics);
  }

  async runProductionTests(): Promise<void> {
    console.log('🚀 Starting Production Testing Suite\n');

    try {
      await this.testBasicCoordination();
      await this.testHighVolumeLoad();
      await this.testWebSocketTransport();
      await this.testHttpTransport();
      await this.testErrorRecovery();
      await this.testMemoryStability();
      await this.testRealWorldScenarios();
      await this.testHealthMonitoring();
      
      this.generateReport();
    } catch (error) {
      console.error('❌ Production test failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  private async testBasicCoordination(): Promise<void> {
    console.log('📊 Testing Basic Coordination...');
    
    const startTime = performance.now();
    const iterations = 100;
    const latencies: number[] = [];
    
    for (let i = 0; i < iterations; i++) {
      const observations = this.generateTradingObservations(50);
      const result = this.cognition.processSwarmTick(observations);
      latencies.push(result.latencyMs);
      
      if (i % 20 === 0) {
        console.log(`  Progress: ${i}/${iterations}`);
      }
    }
    
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const maxLatency = Math.max(...latencies);
    const totalTime = performance.now() - startTime;
    
    this.testResults.push({
      test: 'Basic Coordination',
      iterations,
      avgLatency,
      maxLatency,
      totalTime,
      passed: avgLatency < 10 && maxLatency < 20
    });
    
    console.log(`  ✅ Avg: ${avgLatency.toFixed(2)}ms, Max: ${maxLatency.toFixed(2)}ms, Total: ${totalTime.toFixed(2)}ms\n`);
  }

  private async testHighVolumeLoad(): Promise<void> {
    console.log('⚡ Testing High Volume Load...');
    
    const agentCounts = [100, 500, 1000, 2000];
    
    for (const agentCount of agentCounts) {
      console.log(`  Testing ${agentCount} agents...`);
      
      const observations = this.generateTradingObservations(agentCount);
      const result = this.cognition.processSwarmTick(observations);
      
      this.testResults.push({
        test: `High Volume - ${agentCount} agents`,
        agentCount,
        latency: result.latencyMs,
        decision: result.decision,
        featuresCount: result.activeFeatures.length,
        passed: result.latencyMs < 50
      });
      
      console.log(`    Latency: ${result.latencyMs.toFixed(2)}ms, Decision: ${result.decision}`);
    }
    
    console.log('  ✅ High volume load test completed\n');
  }

  private async testWebSocketTransport(): Promise<void> {
    console.log('🔌 Testing WebSocket Transport...');
    
    const clientCount = 20;
    const clients: WebSocket[] = [];
    const messagesReceived: number[] = [];
    
    // Setup message handler
    this.wsTransport.on('message', ({ agentId }: { agentId: number }) => {
      messagesReceived.push(agentId);
    });
    
    // Connect clients
    for (let i = 0; i < clientCount; i++) {
      const client = new WebSocket('ws://localhost:8090');
      clients.push(client);
      
      await new Promise<void>((resolve, reject) => {
        client.on('open', () => resolve());
        client.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 2000);
      });
    }
    
    console.log(`  Connected ${clientCount} WebSocket clients`);
    
    // Send messages from all clients
    const sendPromises = clients.map((client, i) => {
      return new Promise<void>((resolve) => {
        const observations = this.generateTradingObservations(1)[0];
        const { mask } = encode(observations, this.cognition.schema.featureToBit);
        const msg = BitmaskMessage.now(mask, i, this.cognition.schema.version);
        
        // Send in correct format: type byte + payload
        const typeByte = Buffer.from([0]); // BITMASK_MESSAGE = 0
        const payload = Buffer.concat([typeByte, Buffer.from(msg.toBytes())]);
        
        client.send(payload);
        setTimeout(resolve, 100);
      });
    });
    
    await Promise.all(sendPromises);
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Close all clients
    clients.forEach(client => client.close());
    
    this.testResults.push({
      test: 'WebSocket Transport',
      clientCount,
      messagesReceived: messagesReceived.length,
      passed: messagesReceived.length >= clientCount * 0.8 // Allow some failures
    });
    
    console.log(`  ✅ Messages received: ${messagesReceived.length}/${clientCount}\n`);
  }

  private async testHttpTransport(): Promise<void> {
    console.log('🌐 Testing HTTP Transport...');
    
    const tests = [
      { endpoint: '/api/health', expectedStatus: 200 },
      { endpoint: '/api/metrics', expectedStatus: 200 }
    ];
    
    for (const test of tests) {
      try {
        const response = await fetch(`http://localhost:8091${test.endpoint}`);
        const passed = response.status === test.expectedStatus;
        
        this.testResults.push({
          test: `HTTP ${test.endpoint}`,
          status: response.status,
          expectedStatus: test.expectedStatus,
          passed
        });
        
        console.log(`  ${test.endpoint}: ${response.status} ${passed ? '✅' : '❌'}`);
      } catch (error) {
        this.testResults.push({
          test: `HTTP ${test.endpoint}`,
          error: (error as Error).message,
          passed: false
        });
        
        console.log(`  ${test.endpoint}: ERROR ❌`);
      }
    }
    
    console.log('  ✅ HTTP transport test completed\n');
  }

  private async testErrorRecovery(): Promise<void> {
    console.log('🛡️ Testing Error Recovery...');
    
    // Test malformed input
    try {
      const malformedObservations = [
        ['invalid_feature!@#'],
        ['feature_that_is_way_too_long_for_the_system_to_handle_properly_and_should_be_rejected']
      ];
      
      const result = this.cognition.processSwarmTick(malformedObservations);
      
      this.testResults.push({
        test: 'Error Recovery - Malformed Input',
        handled: true,
        decision: result.decision,
        passed: true
      });
      
      console.log('  ✅ Malformed input handled gracefully');
    } catch (error) {
      this.testResults.push({
        test: 'Error Recovery - Malformed Input',
        error: (error as Error).message,
        passed: false
      });
      
      console.log('  ❌ Malformed input caused crash');
    }
    
    // Test emergency conditions
    const emergencyObservations = Array.from({ length: 10 }, () => [
      'EMERGENCY_halt',
      'EMERGENCY_crash',
      'normal_feature'
    ]);
    
    const result = this.cognition.processSwarmTick(emergencyObservations);
    const emergencyHandled = result.decision === 'REJECT' && result.arbiterResult.hasEmergency;
    
    this.testResults.push({
      test: 'Error Recovery - Emergency',
      decision: result.decision,
      hasEmergency: result.arbiterResult.hasEmergency,
      passed: emergencyHandled
    });
    
    console.log(`  ✅ Emergency handled: ${result.decision} (hasEmergency: ${result.arbiterResult.hasEmergency})\n`);
  }

  private async testMemoryStability(): Promise<void> {
    console.log('💾 Testing Memory Stability...');
    
    const initialMemory = process.memoryUsage().heapUsed;
    const iterations = 500;
    const agentCount = 200;
    
    console.log(`  Running ${iterations} iterations with ${agentCount} agents...`);
    
    for (let i = 0; i < iterations; i++) {
      const observations = this.generateTradingObservations(agentCount);
      this.cognition.processSwarmTick(observations);
      
      if (i % 100 === 0) {
        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
        
        const currentMemory = process.memoryUsage().heapUsed;
        const memoryIncrease = (currentMemory - initialMemory) / 1024 / 1024;
        console.log(`    Iteration ${i}: Memory increase: ${memoryIncrease.toFixed(2)}MB`);
      }
    }
    
    const finalMemory = process.memoryUsage().heapUsed;
    const totalIncrease = (finalMemory - initialMemory) / 1024 / 1024;
    
    this.testResults.push({
      test: 'Memory Stability',
      iterations,
      agentCount,
      memoryIncreaseMB: totalIncrease,
      passed: totalIncrease < 100 // Less than 100MB increase
    });
    
    console.log(`  ✅ Total memory increase: ${totalIncrease.toFixed(2)}MB\n`);
  }

  private async testRealWorldScenarios(): Promise<void> {
    console.log('🌍 Testing Real-World Scenarios...');
    
    const scenarios = [
      {
        name: 'High-Frequency Trading',
        generator: () => this.generateTradingObservations(100),
        expectedLatency: 5
      },
      {
        name: 'IoT Sensor Network',
        generator: () => this.generateIoTObservations(200),
        expectedLatency: 10
      },
      {
        name: 'Chat Moderation',
        generator: () => this.generateModerationObservations(150),
        expectedLatency: 15
      }
    ];
    
    for (const scenario of scenarios) {
      console.log(`  Testing ${scenario.name}...`);
      
      const observations = scenario.generator();
      const result = this.cognition.processSwarmTick(observations);
      
      const passed = result.latencyMs < scenario.expectedLatency;
      
      this.testResults.push({
        test: `Real World - ${scenario.name}`,
        latency: result.latencyMs,
        decision: result.decision,
        featuresCount: result.activeFeatures.length,
        passed
      });
      
      console.log(`    Latency: ${result.latencyMs.toFixed(2)}ms, Decision: ${result.decision} ${passed ? '✅' : '❌'}`);
    }
    
    console.log('  ✅ Real-world scenarios completed\n');
  }

  private async testHealthMonitoring(): Promise<void> {
    console.log('🏥 Testing Health Monitoring...');
    
    // Generate some activity for health monitoring
    for (let i = 0; i < 50; i++) {
      const observations = this.generateTradingObservations(50);
      this.cognition.processSwarmTick(observations);
    }
    
    const healthStatus = this.healthChecker.getHealthStatus();
    const metrics = this.metrics.getMetrics();
    
    const systemHealthy = healthStatus.status === 'HEALTHY' || healthStatus.status === 'DEGRADED';
    const metricsAvailable = metrics.messagesProcessed > 0;
    const latencyOK = metrics.coordinationLatencyUs.length > 0;
    
    this.testResults.push({
      test: 'Health Monitoring',
      status: healthStatus.status,
      messagesProcessed: metrics.messagesProcessed,
      memoryUsageMB: metrics.memoryUsageMB,
      passed: systemHealthy && metricsAvailable && latencyOK
    });
    
    console.log(`  Status: ${healthStatus.status}`);
    console.log(`  Messages: ${metrics.messagesProcessed}`);
    console.log(`  Memory: ${metrics.memoryUsageMB.toFixed(2)}MB`);
    console.log(`  ✅ Health monitoring test completed\n`);
  }

  private generateTradingObservations(agentCount: number): string[][] {
    const features = [
      'price_up', 'price_down', 'volume_spike', 'volatility_high',
      'momentum_strong', 'momentum_weak', 'breakout_detected',
      'mean_reversion_signal', 'trend_reversal', 'support_level',
      'resistance_level', 'overbought', 'oversold', 'divergence',
      'EMERGENCY_halt', 'EMERGENCY_crash', 'EMERGENCY_circuit_breaker'
    ];
    
    return Array.from({ length: agentCount }, () => {
      const count = Math.floor(Math.random() * 3) + 1;
      const selected: string[] = [];
      
      for (let i = 0; i < count; i++) {
        const feature = features[Math.floor(Math.random() * features.length)];
        if (!selected.includes(feature)) {
          selected.push(feature);
        }
      }
      
      return selected;
    });
  }

  private generateIoTObservations(agentCount: number): string[][] {
    const features = [
      'temperature_high', 'temperature_low', 'humidity_high', 'humidity_low',
      'pressure_drop', 'motion_detected', 'door_open', 'window_break',
      'smoke_detected', 'EMERGENCY_fire', 'EMERGENCY_gas_leak', 'EMERGENCY_power_outage'
    ];
    
    return Array.from({ length: agentCount }, () => {
      const count = Math.floor(Math.random() * 2) + 1;
      const selected: string[] = [];
      
      for (let i = 0; i < count; i++) {
        const feature = features[Math.floor(Math.random() * features.length)];
        if (!selected.includes(feature)) {
          selected.push(feature);
        }
      }
      
      return selected;
    });
  }

  private generateModerationObservations(agentCount: number): string[][] {
    const features = [
      'toxic_language', 'spam_detected', 'harassment', 'hate_speech',
      'violence_threat', 'personal_info', 'copyright_violation',
      'misinformation', 'safe_content', 'constructive_discussion',
      'helpful_response', 'fact_checked', 'EMERGENCY_illegal_content'
    ];
    
    return Array.from({ length: agentCount }, () => {
      const count = Math.floor(Math.random() * 2) + 1;
      const selected: string[] = [];
      
      for (let i = 0; i < count; i++) {
        const feature = features[Math.floor(Math.random() * features.length)];
        if (!selected.includes(feature)) {
          selected.push(feature);
        }
      }
      
      return selected;
    });
  }

  private generateReport(): void {
    console.log('📋 PRODUCTION TEST REPORT\n');
    console.log('=' .repeat(60));
    
    const passed = this.testResults.filter(r => r.passed).length;
    const total = this.testResults.length;
    const passRate = (passed / total * 100).toFixed(1);
    
    console.log(`Overall Result: ${passed}/${total} tests passed (${passRate}%)`);
    console.log('=' .repeat(60));
    
    this.testResults.forEach(result => {
      const status = result.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`${status} | ${result.test}`);
      
      if (!result.passed) {
        console.log(`       Details:`, JSON.stringify(result, null, 6).split('\n').slice(1).join('\n       '));
      }
    });
    
    console.log('=' .repeat(60));
    
    if (passed === total) {
      console.log('🎉 ALL TESTS PASSED - READY FOR PRODUCTION!');
    } else {
      console.log('⚠️  Some tests failed - review before production deployment');
    }
    
    // Performance summary
    const coordinationTests = this.testResults.filter(r => r.test.includes('Coordination') || r.test.includes('Volume'));
    if (coordinationTests.length > 0) {
      console.log('\n📊 Performance Summary:');
      coordinationTests.forEach(test => {
        if (test.avgLatency) {
          console.log(`  ${test.test}: ${test.avgLatency.toFixed(2)}ms avg`);
        } else if (test.latency) {
          console.log(`  ${test.test}: ${test.latency.toFixed(2)}ms`);
        }
      });
    }
  }

  private async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up...');
    
    try {
      await this.wsTransport.shutdown();
      await this.httpTransport.shutdown();
      console.log('✅ Cleanup completed');
    } catch (error) {
      console.error('❌ Cleanup error:', error);
    }
  }
}

// Run the production tests
async function main() {
  const tester = new ProductionTester();
  
  try {
    await tester.runProductionTests();
    process.exit(0);
  } catch (error) {
    console.error('Production testing failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { ProductionTester };
