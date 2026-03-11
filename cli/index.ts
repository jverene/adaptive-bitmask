#!/usr/bin/env node

import { createInterface } from 'readline';
import * as fs from 'fs';
import * as path from 'path';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
};

async function main() {
  console.log('🧠 Welcome to create-shared-cognition!');
  console.log('Scaffolding a new Multi-Agent Swarm with sub-10ms coordination.\n');

  const intent = await question('What is your swarm\'s intent? (e.g., algorithmic trading, autonomous drones, web scraping): ');
  const agentCountRaw = await question('How many agents are in your swarm? (e.g., 100): ');
  
  const agentCount = parseInt(agentCountRaw, 10);
  if (isNaN(agentCount) || agentCount <= 0) {
    console.error('❌ Please enter a valid number of agents.');
    process.exit(1);
  }

  const projectName = intent.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const projectDir = path.join(process.cwd(), projectName);

  if (fs.existsSync(projectDir)) {
    console.error(`❌ Directory ${projectName} already exists.`);
    process.exit(1);
  }

  console.log(`\n🚀 Initializing swarm engine for "${intent}" with ${agentCount} agents in ./${projectName}...`);

  fs.mkdirSync(projectDir, { recursive: true });

  // Scaffold index.ts
  const indexCode = `import { SharedCognition } from 'adaptive-bitmask';

// Initialize the Shared Cognition engine
const cognition = new SharedCognition();

console.log('🤖 Swarm Initialized: ${intent}');
console.log('Agent Count: ${agentCount}\\n');

// Simulate a swarm tick with ${agentCount} agents
const mockObservations = Array.from({ length: ${agentCount} }).map((_, i) => {
  // Mock observations based on intent
  if (i % 3 === 0) return ['feature_alpha', 'feature_beta'];
  if (i % 3 === 1) return ['feature_beta', 'feature_gamma'];
  return ['feature_alpha', 'feature_gamma', 'EMERGENCY_halt'];
});

// Process observations and reach consensus
const { decision, activeFeatures, latencyMs } = cognition.processSwarmTick(mockObservations);

console.log(\`⚡ Swarm Decision: \${decision}\`);
console.log(\`⏱️  Latency: \${latencyMs.toFixed(2)}ms\`);
console.log(\`📊 Active Consensus Features:\`, activeFeatures);
`;

  fs.writeFileSync(path.join(projectDir, 'index.ts'), indexCode);

  // Scaffold package.json
  const pkgJson = {
    name: projectName,
    version: '1.0.0',
    description: `Multi-agent swarm for ${intent}`,
    main: 'index.ts',
    scripts: {
      start: 'npx tsx index.ts'
    },
    dependencies: {
      'adaptive-bitmask': 'latest' // This will fetch the published package
    },
    devDependencies: {
      'typescript': '^5.0.0',
      'tsx': '^4.0.0'
    }
  };

  fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify(pkgJson, null, 2));

  console.log('\n✅ Scaffold complete!');
  console.log(`\nNext steps:`);
  console.log(`  cd ${projectName}`);
  console.log(`  npm install`);
  console.log(`  npm start`);
  
  rl.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
