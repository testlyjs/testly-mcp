#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createInterface } from 'readline';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';

// ─── Config ───────────────────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), '.testly');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

interface TestlyConfig {
  prodKey?: string;
  devKey?: string;
}

function readConfig(): TestlyConfig | null {
  try {
    if (!existsSync(CONFIG_PATH)) return null;
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as TestlyConfig;
  } catch {
    return null;
  }
}

function writeConfig(config: TestlyConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

function resolveApiKey(): string {
  // Backward compat: explicit env var always wins (Cursor/Windsurf mcp.json users)
  if (process.env.TESTLY_API_KEY) return process.env.TESTLY_API_KEY;

  const config = readConfig();
  if (!config || (!config.prodKey && !config.devKey)) {
    process.stderr.write(
      'Testly: nenhuma chave configurada.\n' +
      'Execute: npx @testlyjs/mcp setup\n',
    );
    process.exit(1);
  }

  // Dev mode: use devKey when TESTLY_ENV=development (or when only devKey exists)
  if (process.env.TESTLY_ENV === 'development') {
    if (config.devKey) return config.devKey;
    process.stderr.write('Testly: TESTLY_ENV=development mas nenhuma chave dev configurada. Execute: npx @testlyjs/mcp setup\n');
    process.exit(1);
  }

  if (config.prodKey) return config.prodKey;

  process.stderr.write('Testly: chave de produção não encontrada. Execute: npx @testlyjs/mcp setup\n');
  process.exit(1);
}

// ─── API ──────────────────────────────────────────────────────────────────────

const BASE_URL = process.env.TESTLY_API_URL
  || 'https://lfhltqrtfwxoirjmhcdz.supabase.co/functions/v1/manage-experiments';

async function fetchApi(path: string, method = 'GET', key: string, body?: unknown) {
  const url = path ? `${BASE_URL}/${path}` : BASE_URL;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-testly-auth': key },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as any).error || `HTTP ${res.status}`);
  return data;
}

async function validateKey(key: string): Promise<{ ok: boolean; org_name?: string; env?: string; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/me`, {
      headers: { 'x-testly-auth': key, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as any;
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    const data = await res.json() as any;
    return { ok: true, org_name: data.org_name, env: data.env };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ─── Setup Wizard ─────────────────────────────────────────────────────────────

async function runSetup(): Promise<void> {
  const c = {
    reset:   '\x1b[0m',
    bold:    '\x1b[1m',
    dim:     '\x1b[2m',
    green:   '\x1b[32m',
    cyan:    '\x1b[36m',
    yellow:  '\x1b[33m',
    red:     '\x1b[31m',
    bgGreen: '\x1b[42;30m',
  };

  const print = (s: string) => process.stdout.write(s);
  const println = (s = '') => process.stdout.write(s + '\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise(resolve => rl.question(q, answer => resolve(answer)));

  print('\x1b[2J\x1b[H'); // clear screen

  println();
  println(`  ${c.bold}${c.green}Testly${c.reset}  ${c.dim}—  A/B testing para devs que fazem vibe coding${c.reset}`);
  println();
  println(`  ${c.dim}${'─'.repeat(54)}${c.reset}`);
  println(`  ${c.bold}Configuração do MCP Server${c.reset}`);
  println(`  ${c.dim}${'─'.repeat(54)}${c.reset}`);
  println();
  println(`  Suas chaves estão em: ${c.cyan}app.testly.com.br/settings${c.reset}`);
  println();

  const existing = readConfig() || {};
  const newConfig: TestlyConfig = { ...existing };

  // ── Chave de produção ──
  const prodHint = existing.prodKey
    ? `${c.dim} [Enter para manter]${c.reset}`
    : `${c.dim} (tk_live_...)${c.reset}`;
  const prodInput = await ask(`  ${c.bold}Chave de produção${c.reset}${prodHint}: `);

  if (prodInput.trim()) {
    newConfig.prodKey = prodInput.trim();
  } else if (!existing.prodKey) {
    println();
    println(`  ${c.red}✗ Chave de produção é obrigatória.${c.reset}`);
    rl.close();
    process.exit(1);
  }

  if (newConfig.prodKey) {
    print(`  ${c.dim}Validando...${c.reset}`);
    const result = await validateKey(newConfig.prodKey);
    if (!result.ok) {
      println(` ${c.red}✗ Chave inválida: ${result.error}${c.reset}`);
      println();
      rl.close();
      process.exit(1);
    }
    println(` ${c.green}✓${c.reset}  ${c.dim}${result.org_name} · produção${c.reset}`);
  }

  println();

  // ── Chave de desenvolvimento ──
  const devHint = existing.devKey
    ? `${c.dim} [Enter para manter]${c.reset}`
    : `${c.dim} (tk_test_...) [opcional]${c.reset}`;
  const devInput = await ask(`  ${c.bold}Chave de desenvolvimento${c.reset}${devHint}: `);

  if (devInput.trim()) {
    newConfig.devKey = devInput.trim();
    print(`  ${c.dim}Validando...${c.reset}`);
    const result = await validateKey(newConfig.devKey);
    if (!result.ok) {
      println(` ${c.yellow}⚠ Chave inválida (salva mesmo assim): ${result.error}${c.reset}`);
    } else {
      println(` ${c.green}✓${c.reset}  ${c.dim}${result.org_name} · desenvolvimento${c.reset}`);
    }
  }

  writeConfig(newConfig);

  println();
  println(`  ${c.dim}${'─'.repeat(54)}${c.reset}`);
  println(`  ${c.green}${c.bold}✓ Configuração salva${c.reset}  ${c.dim}~/.testly/config.json${c.reset}`);
  println(`  ${c.dim}${'─'.repeat(54)}${c.reset}`);
  println();

  // ── Auto-add to Claude Code if CLI is available ──
  const claudeCheck = spawnSync('which', ['claude'], { encoding: 'utf8' });
  const claudeAvailable = claudeCheck.status === 0;

  if (claudeAvailable) {
    const answer = await ask(`  Adicionar ao ${c.bold}Claude Code${c.reset} automaticamente? ${c.dim}[S/n]${c.reset}: `);
    const confirmed = !answer.trim() || answer.trim().toLowerCase() === 's';
    if (confirmed) {
      const result = spawnSync('claude', ['mcp', 'add', 'testly', '--', 'npx', '@testlyjs/mcp'], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
      const alreadyExists = (result.stderr || '').includes('already exists') || (result.stdout || '').includes('already exists');
      if (result.status === 0 || alreadyExists) {
        println(`  ${c.green}✓ Claude Code configurado${c.reset}${alreadyExists ? c.dim + ' (já estava adicionado)' + c.reset : ''}`);
      } else {
        println(`  ${c.yellow}⚠ Não foi possível adicionar automaticamente.${c.reset}`);
        println(`    Execute: ${c.dim}claude mcp add testly -- npx @testlyjs/mcp${c.reset}`);
      }
    } else {
      println(`  Execute quando quiser:`);
      println(`  ${c.bgGreen}  claude mcp add testly -- npx @testlyjs/mcp  ${c.reset}`);
    }
  } else {
    println(`  Adicione ao seu editor:`);
    println();
    println(`  ${c.bold}Claude Code:${c.reset}`);
    println(`  ${c.bgGreen}  claude mcp add testly -- npx @testlyjs/mcp  ${c.reset}`);
    println();
    println(`  ${c.bold}Cursor / Windsurf${c.reset} ${c.dim}(mcp.json):${c.reset}`);
    println(`  ${c.dim}{ "testly": { "command": "npx", "args": ["@testlyjs/mcp"] } }${c.reset}`);
  }

  println();
  println(`  ${c.dim}A chave fica armazenada localmente — nunca no histórico do shell.${c.reset}`);
  println();

  if (newConfig.devKey) {
    println(`  ${c.dim}Modo dev (chave tk_test_): defina TESTLY_ENV=development no env do MCP.${c.reset}`);
    println();
  }

  println(`  ${c.dim}Docs: docs.testly.com.br/ai-tools/claude-code${c.reset}`);
  println();

  rl.close();
}

// ─── Entry point ──────────────────────────────────────────────────────────────

if (process.argv[2] === 'setup') {
  await runSetup();
  process.exit(0);
}

const API_KEY = resolveApiKey();
const callApi = (path: string, method = 'GET', body?: unknown) =>
  fetchApi(path, method, API_KEY, body);

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new McpServer({ name: 'testly', version: '0.2.0' });

// ─── Tool: create_experiment ──────────────────────────────────────────────────
server.tool(
  'create_experiment',
  'Create a new A/B test experiment in Testly. Returns the experiment key, variant names (control + variant-b), and ready-to-paste React integration code.',
  {
    name: z.string().describe('Human-readable name for the experiment. E.g. "Hero CTA button color"'),
    description: z.string().optional().describe('Hypothesis: what you expect to learn. E.g. "A green button will increase clicks by 20%"'),
    goal: z.string().optional().describe('Conversion event to track. E.g. "button_clicked", "purchase", "signup". Defaults to "conversion"'),
  },
  async ({ name, description, goal }) => {
    const data = await callApi('', 'POST', { name, description, goal });
    const { experiment, integration } = data;
    const text = [
      `✅ Experiment created: "${experiment.name}"`,
      ``,
      `Key: ${experiment.key}`,
      `Status: ${experiment.status}`,
      `Env: ${experiment.env}`,
      `Variants: ${experiment.variants.join(', ')}`,
      `Dashboard: ${experiment.dashboard_url}`,
      ``,
      `── Integration ──`,
      ``,
      `1. Install the SDK:`,
      `   ${integration.install}`,
      ``,
      `2. Wrap your app:`,
      `${integration.provider}`,
      ``,
      `3. Use in your component:`,
      `${integration.experiment}`,
      ``,
      `Docs: ${integration.docs}`,
    ].join('\n');
    return { content: [{ type: 'text', text }] };
  },
);

// ─── Tool: list_experiments ───────────────────────────────────────────────────
server.tool(
  'list_experiments',
  'List all A/B test experiments in your Testly account with their status and impression counts.',
  {},
  async () => {
    const data = await callApi('');
    if (data.count === 0) {
      return {
        content: [{ type: 'text', text: `No experiments found in ${data.env || 'production'}. Create your first with create_experiment.` }],
      };
    }
    const lines = [
      `Found ${data.count} experiment(s) [${data.env || 'production'}]:`,
      ``,
      ...data.experiments.map((exp: any) => {
        const status = exp.status.toUpperCase().padEnd(10);
        const impressions = `${exp.total_impressions.toLocaleString()} impressions`;
        const winner = exp.winner ? ` 🏆 winner: ${exp.winner}` : '';
        return `• [${status}] ${exp.key} — ${impressions}${winner}`;
      }),
    ];
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
);

// ─── Tool: get_results ────────────────────────────────────────────────────────
server.tool(
  'get_results',
  'Get the statistical results for an experiment. Returns conversion rates, uplift, p-value, and a verdict on whether there is a winner.',
  {
    key: z.string().describe('The experiment key. E.g. "hero-cta-button-color"'),
  },
  async ({ key }) => {
    const data = await callApi(`${key}/results`);
    const verdictLabel: Record<string, string> = {
      WINNER_FOUND:      '🏆 Winner found',
      NO_WINNER_YET:     '⏳ No winner yet — keep collecting data',
      INSUFFICIENT_DATA: '📊 Not enough data yet',
    };
    const lines = [
      `Experiment: ${data.experiment.name} (${data.experiment.key})`,
      `Status: ${data.experiment.status} | Started: ${data.experiment.started_at ? new Date(data.experiment.started_at).toLocaleDateString('pt-BR') : 'N/A'}`,
      `Total impressions: ${data.total_impressions.toLocaleString()}`,
      ``,
      `Verdict: ${verdictLabel[data.verdict] || data.verdict}`,
      data.winner ? `Winner: ${data.winner}` : '',
      ``,
      `── Variants ──`,
      ``,
      ...data.variants.map((v: any) => {
        const tag = v.is_control ? ' (control)' : '';
        const uplift = v.uplift_vs_control !== null
          ? ` | uplift: ${v.uplift_vs_control > 0 ? '+' : ''}${v.uplift_vs_control}%`
          : '';
        const sig = v.is_significant ? ' ✓ significant' : '';
        return `• ${v.variant}${tag}: ${v.conversion_rate}% CR | ${v.total_impressions} impressions${uplift}${sig}`;
      }),
      ``,
      `Dashboard: ${data.dashboard_url}`,
    ].filter(l => l !== '');
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
);

// ─── Tool: start_experiment ───────────────────────────────────────────────────
server.tool(
  'start_experiment',
  'Start a paused or draft experiment (set status to running).',
  { key: z.string().describe('The experiment key to start.') },
  async ({ key }) => {
    const data = await callApi(`${key}/start`, 'PATCH');
    return { content: [{ type: 'text', text: `▶️ Experiment "${key}" is now ${data.status}.` }] };
  },
);

// ─── Tool: stop_experiment ────────────────────────────────────────────────────
server.tool(
  'stop_experiment',
  'Stop a running experiment (set status to paused).',
  { key: z.string().describe('The experiment key to stop.') },
  async ({ key }) => {
    const data = await callApi(`${key}/stop`, 'PATCH');
    return { content: [{ type: 'text', text: `⏸️ Experiment "${key}" is now ${data.status}.` }] };
  },
);

// ─── Start ────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
