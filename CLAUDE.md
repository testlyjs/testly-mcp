# testly-mcp — CLAUDE.md

MCP server for Testly. Lets AI coding tools (Claude Code, Cursor, Windsurf, Lovable) create and manage A/B experiments without leaving the editor.

See workspace root [`CLAUDE.md`](../CLAUDE.md) for the full system context.

## Package Info

- **npm name:** `@testlyjs/mcp`
- **version:** `0.1.0` (published to npm 2026-04-28)
- **runtime:** Node.js ≥18, ESM
- **entry:** `dist/index.js` (compiled from `src/index.ts`)
- **bin:** `testly-mcp`

## How Users Install It

### Claude Code
```bash
claude mcp add testly -e TESTLY_API_KEY=tk_live_... -- npx @testlyjs/mcp
```

### Cursor / Windsurf (mcp.json)
```json
{
  "mcpServers": {
    "testly": {
      "command": "npx",
      "args": ["@testlyjs/mcp"],
      "env": { "TESTLY_API_KEY": "tk_live_..." }
    }
  }
}
```

API key is available at: https://app.testly.com.br/settings

## MCP Tools

| Tool | Description |
|------|-------------|
| `create_experiment` | Creates an experiment, returns key + ready-to-paste React code |
| `list_experiments` | Lists all experiments with status and impression count |
| `get_results` | Returns stats, conversion rates, uplift, verdict (winner/no-winner) |
| `start_experiment` | Sets experiment status to `running` |
| `stop_experiment` | Sets experiment status to `paused` |

## Environment Variables

| Var | Required | Default | Description |
|-----|----------|---------|-------------|
| `TESTLY_API_KEY` | ✅ | — | `tk_live_` key from Testly dashboard |
| `TESTLY_API_URL` | ❌ | prod URL | Override to point at staging |

**Staging override:**
```
TESTLY_API_URL=https://dmfxwugjxevbrpuzgeqb.supabase.co/functions/v1/manage-experiments
```

## Backend: manage-experiments Edge Function

The MCP server calls `supabase/functions/manage-experiments/index.ts` — deployed on both prod and staging with `--no-verify-jwt`.

| Method | Path | Action |
|--------|------|--------|
| `GET` | `/manage-experiments` | List experiments |
| `POST` | `/manage-experiments` | Create experiment |
| `GET` | `/manage-experiments/:key/results` | Stats + verdict |
| `PATCH` | `/manage-experiments/:key/start` | Start experiment |
| `PATCH` | `/manage-experiments/:key/stop` | Stop experiment |

Auth: `x-testly-auth: tk_live_...` header.

## Dev Scripts

```bash
npm install        # Install deps
npm run build      # tsc → dist/
npm run dev        # Watch mode
```

## Publishing to npm

Automated via GitHub Actions (`.github/workflows/publish.yml`). Trigger: create a GitHub Release.

The workflow runs `npm ci && npm run build && npm publish --provenance --access public` using npm Trusted Publishers (OIDC) — no `NPM_TOKEN` secret needed.

**To publish a new version:**
1. Bump version in `package.json` and commit
2. Create a GitHub Release with a new tag (e.g. `v0.1.1`)
3. The workflow publishes automatically with provenance

## Key Source Files

| File | Purpose |
|------|---------|
| `src/index.ts` | MCP server — all tools defined here |
| `dist/index.js` | Compiled output (gitignored, built on publish) |
