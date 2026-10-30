# fixture: agent-config

Agent configuration with positive, negative and suppressed cases for GSK-AGENT-001..005 (Track A1, docs/SPRINT_5.md 3.3). Every value is synthetic; the inline MCP secret is listed in `../secrets.json` as `mcp-inline`. Domains use the reserved `.invalid` TLD.

| Rule | Positive | Negative | Suppressed |
|---|---|---|---|
| GSK-AGENT-001 | `.claude/settings.json`: `Bash(*)` and `bypassPermissions` | `Read`, `Bash(npm run test:*)` | `.codex/config.toml` |
| GSK-AGENT-002 | settings hook `curl … \| bash`; `.claude/hooks/format.sh` `npx -y prettier@latest`; `.cursor/environment.json` install step | commented-out line; `npx prettier` | `.claude/hooks/format.sh` second installer |
| GSK-AGENT-003 | `.mcp.json`: unpinned `fs`, `remote` over http, `api` with an inline secret | `pinned`, `localdev` (localhost), `ref` (${API_TOKEN}) | `.vscode/mcp.json` (JSON with comments) |
| GSK-AGENT-004 | `CLAUDE.md`: zero-width and bidi characters, tag characters, an HTML comment with instructions; `AGENTS.md` long encoded run | `<!-- TOC -->` | `CLAUDE.md` emoji with a joiner |
| GSK-AGENT-005 | `CLAUDE.md` "always … --no-verify"; `package.json` script; workflow `HUSKY=0` | "Never use --no-verify" | `AGENTS.md` emergency procedure |
