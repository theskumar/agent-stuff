# Setup and troubleshooting

## ntn

- **Install and log in**: `curl -fsSL https://ntn.dev | bash`, then `ntn login`, then `ntn whoami` to verify.
- **Other workspaces**: run `ntn login` once per workspace. `~/.config/notion/workspaces.json` lists the workspace ids.
- **Token storage**: ntn keeps tokens in the OS keychain. With `NOTION_KEYRING=0` it uses `~/.config/notion/auth.json`.
- **After `ntn update`**: run `node scripts/coverage.mjs`. It warns when a command, flag or endpoint the skill names no longer exists in ntn or the scripts.
- **Visibility**: the ntn integration sees only pages and databases shared with it. For anything else, use `notion-mcp.mjs`, which runs as the user.

## notion-mcp.mjs

- **Credentials**: the script reads Claude OAuth from `CLAUDE_CODE_OAUTH_TOKEN`, then the macOS Keychain item `Claude Code-credentials`, then `~/.claude/.credentials.json`. The token needs the `user:mcp_servers` scope. The script never refreshes a token, so on an expired token ask the user to sign in to Claude Code once.
- **Check**: `node scripts/notion-mcp.mjs auth` reports the credential source and whether the Notion connector is eligible, without printing secrets.
- **`MCP server requires authentication but no OAuth token is configured`** → ask the user to connect Notion at <https://claude.ai/customize/connectors>.
- **Registry or proxy errors (404, unknown beta)**: the script calls Anthropic's private connector registry and MCP proxy. Tell the user the script needs an update.
- **Overrides**: `NOTION_MCP_CONNECTOR_ID` picks a registry entry, `ANTHROPIC_MCP_PROXY_URL` changes the proxy base, and `NOTION_MCP_DEBUG=1` prints HTTP error details.
- **Write guard**: the script lists the connector's read-only tools. Any other tool, including a new one, needs `--confirm-write`. `tools` marks each tool READ or WRITE.

## Plan limits

- `fetch self` returns `current_tool_access`, which marks each tool `available`, `available_with_limit` or `not_enabled` for this workspace.
- Search across connected sources needs Notion AI with connectors. Without it, `search` returns `"type": "workspace_search"` results from Notion alone, and it switches on its own once Notion AI is on.
- `notion-search-agents` needs Notion AI with custom agents. SQL across data sources in `notion-query-data-sources` needs Enterprise with Notion AI. These tools return `entitlement_required` or `not_enabled` otherwise.
