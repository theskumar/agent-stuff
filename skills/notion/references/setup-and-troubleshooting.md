# Notion skill — setup & troubleshooting

Read this when installing `ntn`, first-time auth, switching workspaces, or when a
command errors. Day-to-day usage lives in `SKILL.md`.

## Prerequisites

```bash
curl -fsSL https://ntn.dev | bash
ntn login                              # opens browser, stores token in OS keychain
ntn whoami                             # verify
```

Multiple workspaces: log in to each (`ntn login` again), then per-invocation
override the active one with `NOTION_WORKSPACE_ID=<uuid>`. List workspaces with
`cat ~/.config/notion/workspaces.json`.

## Error playbook

```bash
# ntn missing
curl -fsSL https://ntn.dev | bash

# not logged in / wrong workspace
ntn login
ntn doctor

# switch active workspace (per-invocation, no logout)
NOTION_WORKSPACE_ID=<uuid> node scripts/notion.js whoami
cat ~/.config/notion/workspaces.json   # find workspace UUIDs

# PAT permission limits
# Some endpoints (e.g. v1/users) are disallowed for personal tokens; use a different identity if needed.
# A PAT integration only sees pages/databases explicitly shared with it. For content the
# user can see but the PAT can't (or semantic search / sidebar), use the MCP fallback:
node scripts/notion-mcp.mjs auth        # verify Claude OAuth + Notion connector
node scripts/notion-mcp.mjs search '<query>'
```

Common cases:

- **`No auth token` / "not authenticated"** → run `ntn login`.
- **`object_not_found`** → either the active workspace is wrong (`ntn doctor` /
  `NOTION_WORKSPACE_ID=<uuid>`), or the page isn't shared with the PAT
  integration. For a sharing/visibility gap, the MCP fallback
  (`notion-mcp.mjs`, runs as the user's OAuth identity) can usually reach it.
- **MCP auth/connector failures** → see [mcp-proxy.md](mcp-proxy.md).

## Setup notes

- Auth, workspace registry, and tokens are owned by ntn (`~/.config/notion/`).
- ntn keychain mode is default. Use `NOTION_KEYRING=0` to fall back to `~/.config/notion/auth.json`.
- `NOTION_WORKSPACE_ID=<uuid>` selects a non-default workspace for any invocation.
</content>
