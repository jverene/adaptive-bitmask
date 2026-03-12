#!/usr/bin/env node

import { intro, outro, text, select, confirm, spinner, isCancel, cancel } from '@clack/prompts';
import pc from 'picocolors';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

async function main() {
  intro(`${pc.bgCyan(pc.black(' create-swarm '))} ${pc.dim('v1.0.0')}`);

  const projectName = await text({
    message: 'What is your project name?',
    placeholder: 'my-agent-swarm',
    validate(value) {
      if (!value || value.length === 0) return 'Value is required';
      if (fs.existsSync(path.join(process.cwd(), value))) return 'Directory already exists';
    },
  });

  if (isCancel(projectName) || typeof projectName !== 'string') {
    cancel('Operation cancelled');
    process.exit(0);
  }

  const intent = await text({
    message: 'What is your swarm\'s primary intent?',
    placeholder: 'algorithmic trading',
    initialValue: 'algorithmic trading',
  });

  if (isCancel(intent) || typeof intent !== 'string') {
    cancel('Operation cancelled');
    process.exit(0);
  }

  const agentCount = await text({
    message: 'How many agents in the swarm?',
    placeholder: '10',
    initialValue: '10',
    validate(value) {
      if (!value) return 'Value is required';
      const num = parseInt(value);
      if (isNaN(num) || num <= 0) return 'Must be a positive number';
      if (num > 1000) return 'Let\'s start smaller (< 1000)';
    },
  });

  if (isCancel(agentCount) || typeof agentCount !== 'string') {
    cancel('Operation cancelled');
    process.exit(0);
  }

  const useAiSdk = await confirm({
    message: 'Integrate with Vercel AI SDK (CoordinationSession + Middleware)?',
    initialValue: true,
  });

  if (isCancel(useAiSdk) || typeof useAiSdk !== 'boolean') {
    cancel('Operation cancelled');
    process.exit(0);
  }

  const deployment = await select({
    message: 'Choose a deployment strategy:',
    options: [
      { value: 'cloud', label: 'Cloud LLMs (OpenAI/Anthropic)', hint: 'Fast, paid' },
      { value: 'local', label: 'Local Models (Ollama/Llama)', hint: 'Private, free' },
      { value: 'sim', label: 'Simulation / Mock', hint: 'Ultra-fast testing (no LLM latency)' },
    ],
  });

  if (isCancel(deployment) || typeof deployment !== 'string') {
    cancel('Operation cancelled');
    process.exit(0);
  }

  const s = spinner();
  s.start(`Scaffolding ${projectName}...`);

  const projectPath = path.join(process.cwd(), projectName);
  fs.mkdirSync(projectPath, { recursive: true });

  // 1. package.json
  const pkg = {
    name: projectName,
    version: '0.1.0',
    type: 'module',
    scripts: {
      start: 'tsx index.ts',
      dev: 'tsx --watch index.ts',
    },
    dependencies: {
      'adaptive-bitmask': '^1.0.0',
      'dotenv': '^16.4.5',
      'p-limit': '^5.0.0',
    },
    devDependencies: {
      'typescript': '^5.4.0',
      'tsx': '^4.10.0',
      '@types/node': '^20.0.0',
    }
  };

  if (useAiSdk) {
    (pkg.dependencies as any)['ai'] = '^4.0.0';
    (pkg.dependencies as any)['zod'] = '^3.23.0';
    (pkg.dependencies as any)['@ai-sdk/openai'] = 'latest'; // Default provider
  }

  fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify(pkg, null, 2));

  // 2. tsconfig.json
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
    }
  };
  fs.writeFileSync(path.join(projectPath, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));

  // 3. .env
  const envContent = deployment === 'cloud' 
    ? 'OPENAI_API_KEY=sk-your-key-here\n' 
    : deployment === 'local' 
    ? 'OLLAMA_BASE_URL=http://localhost:11434\n' 
    : '';
  fs.writeFileSync(path.join(projectPath, '.env'), envContent);
  fs.writeFileSync(path.join(projectPath, '.gitignore'), 'node_modules\n.env\ndist\n');

  // 4. index.ts (The "Meat")
  const indexTs = generateIndexTs({
    projectName: projectName as string,
    intent: intent as string,
    agentCount: parseInt(agentCount as string),
    useAiSdk: useAiSdk as boolean,
    deployment: deployment as string,
  });
  fs.writeFileSync(path.join(projectPath, 'index.ts'), indexTs);

  s.stop(`Project ${projectName} scaffolded!`);

  outro(`
  ${pc.green('Success!')} Your swarm is ready.
  
  ${pc.dim('Next steps:')}
  ${pc.cyan(`cd ${projectName}`)}
  ${pc.cyan('npm install')}
  ${pc.cyan('npm start')}
  
  ${pc.yellow('Note:')} Edit ${pc.bold('index.ts')} to customize agent prompts and scoring.
  `);
}

function generateIndexTs(config: {
  projectName: string;
  intent: string;
  agentCount: number;
  useAiSdk: boolean;
  deployment: string;
}) {
  const { intent, agentCount, useAiSdk, deployment } = config;

  let imports = `import 'dotenv/config';
import { SharedCognition } from 'adaptive-bitmask';
import pLimit from 'p-limit';`;

  if (useAiSdk) {
    imports += `\nimport { CoordinationSession } from 'adaptive-bitmask/ai';\nimport { openai } from '@ai-sdk/openai';\nimport { generateText } from 'ai';`;
  }

  const concurrency = Math.min(agentCount, 10);
  
  let agentLogic = '';
  
  if (deployment === 'sim') {
    agentLogic = `
/**
 * SIMULATION MODE: Parallel Mock Agent Execution
 * Achieves <10ms coordination by bypassing LLM API calls.
 */
const mockFeatures = ['price_up', 'volume_spike', 'momentum_strong', 'breakout_detected', 'EMERGENCY_halt'];

async function runAgent(id: number) {
  // Simulate small random processing delay (1-5ms)
  await new Promise(r => setTimeout(r, Math.random() * 5));
  
  // Pick 1-3 random features
  const count = Math.floor(Math.random() * 3) + 1;
  const features = [];
  for(let i=0; i<count; i++) {
    features.push(mockFeatures[Math.floor(Math.random() * mockFeatures.length)]);
  }
  return features;
}`;
  } else if (useAiSdk) {
    agentLogic = `
/**
 * AI SDK MODE: Parallel LLM Execution
 */
async function runAgent(id: number, session: any) {
  const { text } = await generateText({
    model: openai('gpt-4o-mini'),
    system: \`You are a \${intent} agent. Analyze the situation and output 1-3 relevant features from the schema as comma-separated strings.\`,
    prompt: 'Current state analysis...',
  });
  
  return text.split(',').map(f => f.trim());
}`;
  } else {
    agentLogic = `
/**
 * BASIC MODE: Parallel fetch execution
 */
async function runAgent(id: number) {
  // Implementation for ${deployment} fetching...
  return ['feature_a', 'feature_b'];
}`;
  }

  return `${imports}

const intent = "${intent}";
const agentCount = ${agentCount};
const limit = pLimit(${concurrency});

${useAiSdk ? `const session = new CoordinationSession({
  features: ['price_up', 'volume_spike', 'trend_up', 'volatility_high'],
});` : `const cognition = new SharedCognition();`}

${agentLogic}

async function runSwarm() {
  console.log(\`🚀 Starting swarm: "\${intent}" with \${agentCount} agents...\`);
  const start = performance.now();

  // Parallel Execution with Concurrency Limit
  const agentTasks = Array.from({ length: agentCount }, (_, i) => 
    limit(() => runAgent(i${useAiSdk ? ', session' : ''}))
  );

  const allObservations = await Promise.all(agentTasks);
  const llmTime = performance.now() - start;

  // Bitmask Coordination (The Sub-10ms Part)
  const coordStart = performance.now();
  ${useAiSdk ? `
  allObservations.forEach((obs, i) => session.report(\`agent-\${i}\`, obs));
  const { decision, result, aggregatedFeatures } = session.decide();
  const finalScore = result.finalScore;
  ` : `
  const { decision, finalScore, activeFeatures: aggregatedFeatures } = cognition.processSwarmTick(allObservations);
  `}
  const coordTime = performance.now() - coordStart;

  console.log('\\n--- Coordination Round Complete ---');
  console.log(\`Decision:       \${decision}\`);
  console.log(\`Final Score:    \${(finalScore * 100).toFixed(1)}%\`);
  console.log(\`Consensus:      \${aggregatedFeatures.join(', ')}\`);
  console.log(\`LLM Parallel:   \${llmTime.toFixed(2)}ms\`);
  console.log(\`Bitmask Latency:\${coordTime.toFixed(2)}ms (Surgical)\`);
}

runSwarm().catch(console.error);
`;
}

main().catch(console.error);
