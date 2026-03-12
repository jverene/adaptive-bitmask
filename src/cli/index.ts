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

  const useDashboard = await confirm({
    message: 'Scaffold a Live Dashboard / Control Plane (WebSocket)?',
    initialValue: true,
  });

  if (isCancel(useDashboard) || typeof useDashboard !== 'boolean') {
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

  if (useDashboard) {
    (pkg.dependencies as any)['ws'] = '^8.17.0';
    (pkg.devDependencies as any)['@types/ws'] = '^8.5.10';
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
    useDashboard: useDashboard as boolean,
    deployment: deployment as string,
  });
  fs.writeFileSync(path.join(projectPath, 'index.ts'), indexTs);

  s.stop(`Project ${projectName} scaffolded!`);

  outro(`
  ${pc.green('Success!')} Your swarm is ready.
  ${useDashboard ? pc.blue('🖥️ Dashboard active at: http://localhost:3000') : ''}
  
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
  useDashboard: boolean;
  deployment: string;
}) {
  const { intent, agentCount, useAiSdk, useDashboard, deployment } = config;

  let imports = `import 'dotenv/config';
import { SharedCognition } from 'adaptive-bitmask';
import pLimit from 'p-limit';`;

  if (useAiSdk) {
    imports += `\nimport { CoordinationSession } from 'adaptive-bitmask/ai';\nimport { openai } from '@ai-sdk/openai';\nimport { generateText } from 'ai';`;
  }

  if (useDashboard) {
    imports += `\nimport { WebSocketServer } from 'ws';\nimport { createServer } from 'http';`;
  }

  const concurrency = Math.min(agentCount, 10);
  
  let dashboardCode = '';
  if (useDashboard) {
    dashboardCode = `
/**
 * 🖥️ DASHBOARD / CONTROL PLANE
 * Real-time monitoring of agent "thinking", bandwidth, and coordination.
 */
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(\`
    <html>
      <head>
        <title>Shared Cognition Dashboard</title>
        <style>
          body { font-family: system-ui; background: #0f172a; color: #f8fafc; margin: 0; padding: 2rem; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
          .card { background: #1e293b; padding: 1.5rem; border-radius: 0.5rem; border: 1px solid #334155; }
          .log { font-family: monospace; height: 300px; overflow-y: auto; background: #000; padding: 1rem; border-radius: 0.25rem; font-size: 0.8rem; }
          .agent-thinking { color: #38bdf8; }
          .decision { color: #4ade80; font-weight: bold; }
          .feature { display: inline-block; background: #334155; padding: 0.2rem 0.5rem; border-radius: 1rem; margin-right: 0.5rem; font-size: 0.7rem; }
          h1 { margin-top: 0; color: #e2e8f0; }
        </style>
      </head>
      <body>
        <h1>🧠 Shared Cognition Dashboard</h1>
        <div class="grid">
          <div class="card">
            <h2>Swarm Status</h2>
            <div id="status">Waiting for round...</div>
            <h3>Active Consensus Features</h3>
            <div id="features"></div>
          </div>
          <div class="card">
            <h2>Real-time Analytics</h2>
            <p>Coordination Latency: <span id="latency">0</span>ms</p>
            <p>Total Agents: ${agentCount}</p>
            <p>Bandwidth Reduction: 85x (Bitmask Protocol)</p>
          </div>
        </div>
        <div class="card" style="margin-top: 1rem;">
          <h2>Live Agent Logs ("Thinking")</h2>
          <div id="logs" class="log"></div>
        </div>
        <script>
          const ws = new WebSocket('ws://localhost:3001');
          const logEl = document.getElementById('logs');
          const statusEl = document.getElementById('status');
          const featuresEl = document.getElementById('features');
          const latencyEl = document.getElementById('latency');

          ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'log') {
              const div = document.createElement('div');
              const time = new Date(data.timestamp).toLocaleTimeString();
              div.innerHTML = \\\`[\${time}] <b>\${data.agentId}:</b> \${data.content}\\\`;
              if (data.logType === 'thinking') div.className = 'agent-thinking';
              if (data.logType === 'decision') div.className = 'decision';
              logEl.prepend(div);
            } else if (data.type === 'update') {
              statusEl.innerText = \\\`Round Complete: \${data.decision}\\\`;
              featuresEl.innerHTML = data.features.map(f => \\\`<span class="feature">\${f}</span>\\\`).join('');
              latencyEl.innerText = data.latency.toFixed(2);
            }
          };
        </script>
      </body>
    </html>
  \`);
});

const wss = new WebSocketServer({ port: 3001 });
server.listen(3000);

function broadcast(data: any) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => c.send(msg));
}
`;
  }

  const concurrencyLimit = Math.min(agentCount, 10);
  
  let agentLogic = '';
  
  if (deployment === 'sim') {
    agentLogic = `
/**
 * SIMULATION MODE: Parallel Mock Agent Execution
 */
const mockFeatures = ['price_up', 'volume_spike', 'momentum_strong', 'breakout_detected', 'EMERGENCY_halt'];

async function runAgent(id: number${useAiSdk ? ', session: any' : ''}) {
  const agentName = \`Agent-\${id}\`;
  
  // Simulate "Thinking"
  ${useAiSdk ? `session.logThinking(agentName, 'Analyzing market indicators...');` : useDashboard ? `broadcast({ type: 'log', agentId: agentName, logType: 'thinking', content: 'Analyzing market indicators...', timestamp: Date.now() });` : ''}
  
  await new Promise(r => setTimeout(r, 10 + Math.random() * 50));
  
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
  const agentName = \`Agent-\${id}\`;
  session.logThinking(agentName, 'Prompting LLM for observation...');
  
  const { text } = await generateText({
    model: openai('gpt-4o-mini'),
    system: \`You are a \${intent} agent. Analyze the situation and output 1-3 relevant features from the schema as comma-separated strings.\`,
    prompt: 'Current state analysis...',
  });
  
  const features = text.split(',').map(f => f.trim());
  return features;
}`;
  } else {
    agentLogic = `
/**
 * BASIC MODE: Parallel fetch execution
 */
async function runAgent(id: number) {
  const agentName = \`Agent-\${id}\`;
  ${useDashboard ? `broadcast({ type: 'log', agentId: agentName, logType: 'thinking', content: 'Fetching data...', timestamp: Date.now() });` : ''}
  return ['feature_a', 'feature_b'];
}`;
  }

  return `${imports}

const intent = "${intent}";
const agentCount = ${agentCount};
const limit = pLimit(${concurrencyLimit});

${dashboardCode}

${useAiSdk ? `const session = new CoordinationSession({
  features: ['price_up', 'volume_spike', 'trend_up', 'volatility_high'],
  onLog: (log) => {
    ${useDashboard ? "broadcast({ type: 'log', agentId: log.agentId, logType: log.type, content: log.content, timestamp: log.timestamp });" : "console.log(`[${new Date(log.timestamp).toLocaleTimeString()}] ${log.agentId}: ${log.content}`);"}
  }
});` : `const cognition = new SharedCognition();`}

${agentLogic}

async function runSwarm() {
  console.log(\`🚀 Starting swarm: "\${intent}" with \${agentCount} agents...\`);
  
  while (true) {
    const start = performance.now();
    ${useAiSdk ? "session.startRound();" : ""}

    const agentTasks = Array.from({ length: agentCount }, (_, i) => 
      limit(() => runAgent(i${useAiSdk ? ', session' : ''}))
    );

    const allObservations = await Promise.all(agentTasks);
    const llmTime = performance.now() - start;

    const coordStart = performance.now();
    ${useAiSdk ? `
    allObservations.forEach((obs, i) => session.report(\`agent-\${i}\`, obs));
    const { decision, result, aggregatedFeatures } = session.decide();
    const finalScore = result.finalScore;
    ` : `
    const { decision, finalScore, activeFeatures: aggregatedFeatures } = cognition.processSwarmTick(allObservations);
    `}
    const coordTime = performance.now() - coordStart;

    ${useDashboard ? `
    broadcast({ 
      type: 'update', 
      decision, 
      features: aggregatedFeatures, 
      latency: coordTime,
      totalLatency: performance.now() - start
    });
    ` : ""}

    console.log(\`\\nDecision: \${decision} (Coord: \${coordTime.toFixed(2)}ms, Total: \${(performance.now() - start).toFixed(2)}ms)\`);
    
    // Pause between ticks
    await new Promise(r => setTimeout(r, 2000));
  }
}

runSwarm().catch(console.error);
`;
}

main().catch(console.error);
