#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_KEY = process.env.TESTLY_API_KEY;
const BASE_URL = process.env.TESTLY_API_URL || 'https://lfhltqrtfwxoirjmhcdz.supabase.co/functions/v1/manage-experiments';

if (!API_KEY) {
  console.error('Error: TESTLY_API_KEY environment variable is required.');
  console.error('Get your API key at: https://app.testly.com.br/settings');
  process.exit(1);
}

async function callApi(path: string, method = 'GET', body?: unknown) {
  const url = path ? `${BASE_URL}/${path}` : BASE_URL;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-testly-auth': API_KEY!,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const server = new McpServer({
  name: 'testly',
  version: '0.1.0',
});

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
        content: [{
          type: 'text',
          text: 'No experiments found. Create your first with create_experiment.',
        }],
      };
    }

    const lines = [
      `Found ${data.count} experiment(s):`,
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
      WINNER_FOUND: '🏆 Winner found',
      NO_WINNER_YET: '⏳ No winner yet — keep collecting data',
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
        const uplift = v.uplift_vs_control !== null ? ` | uplift: ${v.uplift_vs_control > 0 ? '+' : ''}${v.uplift_vs_control}%` : '';
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
  {
    key: z.string().describe('The experiment key to start.'),
  },
  async ({ key }) => {
    const data = await callApi(`${key}/start`, 'PATCH');
    return {
      content: [{ type: 'text', text: `▶️ Experiment "${key}" is now ${data.status}.` }],
    };
  },
);

// ─── Tool: stop_experiment ────────────────────────────────────────────────────
server.tool(
  'stop_experiment',
  'Stop a running experiment (set status to paused).',
  {
    key: z.string().describe('The experiment key to stop.'),
  },
  async ({ key }) => {
    const data = await callApi(`${key}/stop`, 'PATCH');
    return {
      content: [{ type: 'text', text: `⏸️ Experiment "${key}" is now ${data.status}.` }],
    };
  },
);

// ─── Start ────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
