import { SharedCognition } from './dist/index.js';

// Initialize the engine
const cognition = new SharedCognition();

// Test with sample observations
const { decision, activeFeatures, latencyMs } = cognition.processSwarmTick([
  ['price_up', 'volume_spike', 'momentum_strong'],
  ['price_up', 'breakout_detected'],
  ['volume_spike', 'EMERGENCY_halt']
]);

console.log(`🤖 Swarm Decision: ${decision}`);
console.log(`⚡ Latency: ${latencyMs.toFixed(2)}ms`);
console.log(`📊 Active Features:`, activeFeatures);
