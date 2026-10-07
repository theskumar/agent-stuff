# Slack MCP auth and protocol notes

## Architecture

The CLI uses two Anthropic endpoints:

1. Connector discovery: `GET https://api.anthropic.com/v1/mcp_servers?limit=1000`
2. Streamable HTTP MCP proxy: `https://mcp-proxy.anthropic.com/v1/mcp/{server_id}`

It authenticates to Anthropic with Claude OAuth. Slack OAuth remains on Anthropic's servers and is never returned to the script. Requests go directly to MCP; no model request occurs.

These connector registry/proxy endpoints and beta version are not a public stable API. Anthropic changes may require script updates.

## Credential sources

Lookup order:

1. `CLAUDE_CODE_OAUTH_TOKEN`
2. macOS Keychain generic password with service `Claude Code-credentials`
3. `~/.claude/.credentials.json`

Required scope: `user:mcp_servers`.

The CLI reads but does not refresh or modify credential storage. If a stored short-lived access token expires, refresh it by using Claude Code's login once. For unattended environments, inject a current `CLAUDE_CODE_OAUTH_TOKEN` through the environment or secret manager.

Never print credential JSON, access tokens, refresh tokens, or Authorization headers. Set `SLACK_MCP_DEBUG=1` only when diagnosing non-secret response bodies.

## Write guard

The CLI explicitly allowlists current read-only Slack tools. Every unknown or non-allowlisted tool requires `--confirm-write`, even if its name sounds read-only. This intentionally fails closed when Slack adds tools. Inspect `tools --json`, update the allowlist only after confirming semantics, and keep human confirmation for writes.

## Connector authorization

If initialization returns `MCP server requires authentication but no OAuth token is configured`, connect/reconnect Slack at:

<https://claude.ai/customize/connectors>

`auth` reports connector eligibility without printing credentials:

```bash
node "$HOME/.agents/skills/slack/scripts/slack.mjs" auth
```

## Overrides

- `SLACK_MCP_CONNECTOR_ID`: select a specific registry entry.
- `ANTHROPIC_MCP_PROXY_URL`: override proxy base URL for testing.
- `SLACK_MCP_DEBUG=1`: include bounded HTTP error details.

## Known limitation: unread state

Slack connector tools expose message/channel search and reads but not `last_read`, unread markers, or unread counts. Querying `is:unread` performs a keyword search for “unread”; it does not return unread messages. Use recent mentions/DM searches as an approximation or browser automation for true UI unread state.
