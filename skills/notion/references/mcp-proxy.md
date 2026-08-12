# Notion MCP fallback (auth + protocol notes)

`scripts/notion-mcp.mjs` is a **fallback**. The primary Notion interface is the
direct REST API via `ntn` (`scripts/notion.js`). Reach for MCP only when the
REST API can't practically do the job.

## When to use MCP vs. direct API

| Task | Use |
|---|---|
| Read/write pages, blocks, comments; query databases; upload files; raw API | **`notion.js` (REST/ntn)** — default |
| **Ranked search** as the user (workspace-wide; *and* across connected sources like Slack/Drive/GitHub/Jira/Linear **when the workspace has Notion AI**) | `notion-mcp.mjs search` |
| **People search** (by name/email) | `notion-mcp.mjs search --user` |
| The user's **sidebar** (private / shared / favorite / recent pages) | `notion-mcp.mjs list` |
| Reaching content **not shared with the PAT integration** | `notion-mcp.mjs` (runs as the user's OAuth identity) |

Why the divide exists: the `ntn` PAT integration only sees pages/databases
explicitly shared with it, and `v1/search` is keyword + workspace-only. The MCP
connector runs as the **user's Claude OAuth identity**, so it sees everything
the user sees and returns ranked results — routinely surfacing (and able to
`fetch`) pages the PAT can't. Notion's semantic/AI search *across connected
sources* is an additional tier that requires Notion AI (see entitlement limits).

## Architecture

The CLI uses two Anthropic endpoints (identical pattern to the Slack skill):

1. Connector discovery: `GET https://api.anthropic.com/v1/mcp_servers?limit=1000`
2. Streamable HTTP MCP proxy: `https://mcp-proxy.anthropic.com/v1/mcp/{server_id}`

It authenticates to Anthropic with Claude OAuth. Notion OAuth stays on
Anthropic's servers and is never returned to the script. No model request occurs.

These connector registry/proxy endpoints and beta version are not a public
stable API. Anthropic changes may require script updates.

## Credential sources

Lookup order:

1. `CLAUDE_CODE_OAUTH_TOKEN`
2. macOS Keychain generic password with service `Claude Code-credentials`
3. `~/.claude/.credentials.json`

Required scope: `user:mcp_servers`. The CLI reads but never refreshes or prints
credentials. If a stored access token expires, sign in to Claude Code once.

## Write guard

`notion-mcp.mjs` allowlists the connector's read-only tools. Every unknown or
non-allowlisted tool requires `--confirm-write`, even if its name sounds
read-only. This fails closed when Notion adds tools. Inspect `tools --json`,
update the allowlist only after confirming semantics, and keep human
confirmation for writes.

## Connector authorization

If initialization returns `MCP server requires authentication but no OAuth
token is configured`, connect/reconnect Notion at:

<https://claude.ai/customize/connectors>

`auth` reports connector eligibility without printing credentials:

```bash
node "$HOME/.agents/skills/notion/scripts/notion-mcp.mjs" auth
```

## Overrides

- `NOTION_MCP_CONNECTOR_ID`: select a specific registry entry.
- `ANTHROPIC_MCP_PROXY_URL`: override proxy base URL for testing.
- `NOTION_MCP_DEBUG=1`: include bounded HTTP error details.

## Known entitlement limits

Some connector tools require a paid Notion plan / Notion AI. Check what the
current workspace allows with `call notion-fetch '{"id":"self"}'` (its
`current_tool_access` map lists `available` / `available_with_limit` /
`not_enabled` per tool).

- **Connected-source / AI search** (`content_search_mode: ai_search`) requires
  **Notion AI + connectors**. Without it, default `search` reports
  `"type": "workspace_search"` (Notion content only — no Slack/Drive/etc.).
  The backend is auto-selected, so `search` starts spanning connected sources
  automatically once Notion AI is enabled — no flag needed. (The CLI does not
  expose a backend override, since forcing `ai_search` errors where it's absent.)
- `notion-search-agents` → `entitlement_required` ("requires Notion AI and
  custom-agent access").
- Multi-data-source SQL in `notion-query-data-sources` needs Enterprise + Notion AI.

> Observed on a Business (no-AI) workspace: `ai_search` unavailable;
> `query_data_sources` available_with_limit; `query_meeting_notes` and
> `convert_page_to_skill` not_enabled. `search` (workspace) and `list` work fully.

## Escape hatch

`search` and `list` are the only predefined MCP capabilities. For any other read
tool (e.g. `notion-fetch`, `notion-query-meeting-notes`) use the generic form:

```bash
node scripts/notion-mcp.mjs tools                    # discover current tools
node scripts/notion-mcp.mjs call notion-fetch '{"id":"https://notion.so/..."}'
node scripts/notion-mcp.mjs call notion-get-comments '{"page_id":"<uuid>"}'
```

Entitlement-gated tools (`notion-query-meeting-notes`, `notion-search-agents`,
etc.) are reachable via `call` too, but return `entitlement_required` /
`not_enabled` on workspaces without Notion AI.
