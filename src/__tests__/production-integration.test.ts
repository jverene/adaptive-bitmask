/**
 * Production integration tests for real multi-agent scenarios
 * 
 * Tests the complete system with realistic workloads and edge cases
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SharedCognition } from '../SharedCognition.js';
import { WebSocketTransport, createWebSocketTransport } from '../transports/websocket.js';
import { HttpTransport, createHttpTransport } from '../transports/http.js';
import { Logger, MetricsCollector, LogLevel } from '../index.js';
import { BitmaskMessage } from '../message.js';
import { WebSocket } from 'ws';

describe('Production Integration Tests', () => {
  let cognition: SharedCognition;
  let wsTransport: WebSocketTransport;
  let httpTransport: HttpTransport;
  let metrics: MetricsCollector;
  let logger: Logger;

  beforeAll(async () => {
    // Setup production-like environment
    logger = Logger.getInstance();
    logger.setLogLevel(LogLevel.WARN); // Reduce noise in tests
    
    metrics = new MetricsCollector();
    
    cognition = new SharedCognition({
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

    // Setup transport layers on different ports
    wsTransport = createWebSocketTransport({
      port: 8082,
      maxConnections: 100,
      connectionTimeoutMs: 5000,
      messageTimeoutMs: 1000
    });

    httpTransport = createHttpTransport({
      port: 8083,
      requestTimeoutMs: 2000,
      rateLimitPerMinute: 1000
    });

    // Wait for servers to start
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterAll(async () => {
    await wsTransport.shutdown();
    await httpTransport.shutdown();
  });

  describe('High-Volume Multi-Agent Coordination', () => {
    it('should handle 100 agents with concurrent observations', async () => {
      const agentCount = 100;
      const observations = generateRealisticObservations(agentCount);
      
      const result = cognition.processSwarmTick(observations);
      
      expect(result.decision).toBeDefined();
      expect(result.latencyMs).toBeLessThan(50); // Should be very fast
      expect(result.activeFeatures).toBeDefined();
      
      console.log(`100-agent coordination completed in ${result.latencyMs.toFixed(2)}ms`);
    });

    it('should handle 1000 agents stress test', async () => {
      const agentCount = 1000;
      const observations = generateRealisticObservations(agentCount);
      
      const result = cognition.processSwarmTick(observations);
      
      expect(result.decision).toBeDefined();
      expect(result.latencyMs).toBeLessThan(100); // Still should be fast
      expect(result.activeFeatures.length).toBeGreaterThan(0);
      
      console.log(`1000-agent coordination completed in ${result.latencyMs.toFixed(2)}ms`);
    });

    it('should maintain performance under sustained load', async () => {
      const agentCount = 500;
      const iterations = 10;
      const latencies: number[] = [];
      
      for (let i = 0; i < iterations; i++) {
        const observations = generateRealisticObservations(agentCount);
        const result = cognition.processSwarmTick(observations);
        latencies.push(result.latencyMs);
      }
      
      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const maxLatency = Math.max(...latencies);
      
      expect(avgLatency).toBeLessThan(50);
      expect(maxLatency).toBeLessThan(100);
      
      console.log(`Sustained load: avg ${avgLatency.toFixed(2)}ms, max ${maxLatency.toFixed(2)}ms`);
    });
  });

  describe('Real-World Scenarios', () => {
    it('should simulate trading bot swarm', async () => {
      const tradingScenarios = [
        ['price_up', 'volume_spike', 'momentum_strong'],
        ['price_down', 'volatility_high', 'EMERGENCY_halt'],
        ['price_up', 'breakout_detected', 'volume_spike'],
        ['price_down', 'mean_reversion_signal'],
        ['price_up', 'momentum_weak', 'volume_spike']
      ];
      
      const agentObservations = Array.from({ length: 50 }, (_, i) => 
        tradingScenarios[i % tradingScenarios.length]
      );
      
      const result = cognition.processSwarmTick(agentObservations);
      
      expect(result.decision).toBeDefined();
      expect(result.activeFeatures).toContain('volume_spike');
      expect(result.latencyMs).toBeLessThan(20);
      
      console.log(`Trading swarm: ${result.decision}, features: ${result.activeFeatures.join(', ')}`);
    });

    it('should simulate IoT sensor network', async () => {
      const sensorScenarios = [
        ['temperature_high', 'humidity_low'],
        ['motion_detected', 'door_open'],
        ['EMERGENCY_smoke_detected', 'temperature_high'],
        ['light_on', 'motion_detected'],
        ['temperature_normal', 'humidity_normal']
      ];
      
      const agentObservations = Array.from({ length: 100 }, (_, i) => 
        sensorScenarios[i % sensorScenarios.length]
      );
      
      const result = cognition.processSwarmTick(agentObservations);
      
      expect(result.decision).toBeDefined();
      expect(result.latencyMs).toBeLessThan(15);
      
      // Should detect emergency
      if (result.activeFeatures.includes('EMERGENCY_smoke_detected')) {
        expect(result.decision).toBe('REJECT');
      }
      
      console.log(`IoT network: ${result.decision}, emergency: ${result.activeFeatures.some((f: string) => f.startsWith('EMERGENCY'))}`);
    });

    it('should simulate chat moderation system', async () => {
      const moderationScenarios = [
        ['toxic_language', 'spam_detected'],
        ['EMERGENCY_illegal_content', 'harassment'],
        ['safe_content', 'constructive_discussion'],
        ['spam_detected', 'repetitive_content'],
        ['safe_content', 'helpful_response']
      ];
      
      const agentObservations = Array.from({ length: 200 }, (_, i) => 
        moderationScenarios[i % moderationScenarios.length]
      );
      
      const result = cognition.processSwarmTick(agentObservations);
      
      expect(result.decision).toBeDefined();
      expect(result.latencyMs).toBeLessThan(25);
      
      // Should handle emergency content
      if (result.activeFeatures.includes('EMERGENCY_illegal_content')) {
        expect(result.decision).toBe('REJECT');
      }
      
      console.log(`Moderation system: ${result.decision}, toxic content detected: ${result.activeFeatures.includes('toxic_language')}`);
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle emergency conditions', async () => {
      const emergencyObservations = Array.from({ length: 10 }, () => [
        'EMERGENCY_halt',
        'EMERGENCY_crash',
        'normal_feature'
      ]);
      
      const result = cognition.processSwarmTick(emergencyObservations);
      
      // Should trigger emergency override
      expect(result.decision).toBe('REJECT');
      expect(result.arbiterResult.hasEmergency).toBe(true);
    });
  });

  describe('Memory and Performance', () => {
    it('should maintain sub-10ms coordination latency', async () => {
      const agentCount = 500;
      const samples = 20;
      const latencies: number[] = [];
      
      for (let i = 0; i < samples; i++) {
        const observations = generateRealisticObservations(agentCount);
        const result = cognition.processSwarmTick(observations);
        latencies.push(result.latencyMs);
      }
      
      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const p95Latency = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)];
      
      expect(avgLatency).toBeLessThan(10);
      expect(p95Latency).toBeLessThan(20);
      
      console.log(`Latency: avg ${avgLatency.toFixed(2)}ms, p95 ${p95Latency.toFixed(2)}ms`);
    });
  });
});

// Helper function to generate realistic observations
function generateRealisticObservations(agentCount: number): string[][] {
  const featurePool = [
    'price_up', 'price_down', 'volume_spike', 'volatility_high',
    'momentum_strong', 'momentum_weak', 'breakout_detected',
    'mean_reversion_signal', 'trend_reversal', 'support_level',
    'resistance_level', 'overbought', 'oversold', 'divergence',
    'convergence', 'channel_break', 'pattern_recognition',
    'EMERGENCY_halt', 'EMERGENCY_crash', 'EMERGENCY_circuit_breaker',
    'temperature_high', 'temperature_low', 'humidity_high',
    'humidity_low', 'pressure_drop', 'motion_detected',
    'door_open', 'window_break', 'smoke_detected',
    'EMERGENCY_fire', 'EMERGENCY_gas_leak', 'EMERGENCY_power_outage',
    'toxic_language', 'spam_detected', 'harassment',
    'hate_speech', 'violence_threat', 'personal_info',
    'copyright_violation', 'misinformation', 'safe_content',
    'constructive_discussion', 'helpful_response', 'fact_checked'
  ];
  
  return Array.from({ length: agentCount }, () => {
    const featureCount = Math.floor(Math.random() * 3) + 1; // 1-3 features per agent
    const selectedFeatures: string[] = [];
    
    for (let i = 0; i < featureCount; i++) {
      const randomIndex = Math.floor(Math.random() * featurePool.length);
      const feature = featurePool[randomIndex];
      
      if (!selectedFeatures.includes(feature)) {
        selectedFeatures.push(feature);
      }
    }
    
    return selectedFeatures;
  });
}
