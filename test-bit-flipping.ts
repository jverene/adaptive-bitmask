import { SharedCognition } from './dist/index.js';
import { encode, decode } from './dist/index.js';

const cognition = new SharedCognition();

// Register some features to see bit assignments
cognition.schema.register('price_up');
cognition.schema.register('volume_spike');
cognition.schema.register('momentum_strong');

console.log('Feature to bit mappings:');
for (const [feature, bit] of cognition.schema.featureToBit) {
  console.log(`  ${feature} → bit ${bit}`);
}

// Encode features - this actually flips bits
const features = ['price_up', 'volume_spike'];
const { mask } = encode(features, cognition.schema.featureToBit);

console.log('\nOriginal mask (BigInt):', mask);
console.log('Binary representation:');
console.log(mask.toString(2).padStart(64, '0'));

// Show which bits are set
console.log('\nBit positions set:');
for (let i = 0; i < 64; i++) {
  if (mask & (1n << BigInt(i))) {
    console.log(`  Bit ${i} is ON (1)`);
  }
}

// Decode back to features
const decoded = decode(mask, cognition.schema.bitToFeatures);
console.log('\nDecoded features:', decoded);

// Show actual bit manipulation
console.log('\n=== Bit Flipping Demo ===');
console.log('Starting with: 0b0 (all bits off)');

let demoMask = 0n;
console.log('After setting bit 2:', (demoMask |= 1n << 2n).toString(2).padStart(64, '0'));
console.log('After setting bit 5:', (demoMask |= 1n << 5n).toString(2).padStart(64, '0'));
console.log('After setting bit 7:', (demoMask |= 1n << 7n).toString(2).padStart(64, '0'));

// Show OR aggregation (how coordinator combines masks)
console.log('\n=== OR Aggregation (Coordinator) ===');
const mask1 = 1n << 2n;  // bit 2 set
const mask2 = 1n << 5n;  // bit 5 set  
const mask3 = 1n << 7n;  // bit 7 set

console.log('Mask 1:', mask1.toString(2).padStart(64, '0'));
console.log('Mask 2:', mask2.toString(2).padStart(64, '0'));
console.log('Mask 3:', mask3.toString(2).padStart(64, '0'));

const aggregated = mask1 | mask2 | mask3;
console.log('OR aggregated:', aggregated.toString(2).padStart(64, '0'));
console.log('Bits set:', [2, 5, 7]);
