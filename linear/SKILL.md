---
name: linear
description: "Read/write Linear issues, search, comment, and run raw GraphQL queries. Wraps Linear's GraphQL API via a Node.js script — no external deps."
---

# Linear

Use this skill for Linear tasks: read issues, search, create/update issues, add comments, run raw GraphQL queries.

## Architecture

Pure Node.js (stdlib only) wrapper over Linear's GraphQL API (`https://api.linear.app/graphql`). Zero npm deps. Requires `node` on PATH.

## Prerequisites

1. Create a Personal API key in Linear:
   **Settings → Account → Security & Access → Personal API keys → Create key**

2. Store the key (pick one):
   ```bash
   # Option A: env var (add to shell profile)
   export LINEAR_API_KEY="lin_api_..."

   # Option B: file
   mkdir -p ~/.config/linear
   echo "lin_api_..." > ~/.config/linear/api-key
   ```

## CLI

```bash
node scripts/linear.cjs me                              # authenticated user
node scripts/linear.cjs teams                            # list teams
node scripts/linear.cjs issue CSL-24                     # get issue by key
node scripts/linear.cjs search "setup" --team CSL        # search issues
node scripts/linear.cjs find "project setup"             # full-text search
node scripts/linear.cjs create --team CSL --title "..."  # create issue
node scripts/linear.cjs update CSL-24 --state "In Progress"  # update issue
node scripts/linear.cjs comment CSL-24 "comment body"    # add comment
node scripts/linear.cjs query '{ viewer { id name } }'   # raw GraphQL
```

### Commands

| Command | Description |
|---|---|
| `me` | Show authenticated user info |
| `teams` | List all teams (id, name, key) |
| `issue <KEY>` | Get full issue details including children, comments |
| `search [query]` | Filter issues. Flags: `--team`, `--state`, `--limit` |
| `find <term>` | Full-text search across all issues |
| `create` | Create issue. Flags: `--team` (required), `--title` (required), `--description`, `--priority` (0-4), `--parent CSL-24` |
| `update <KEY>` | Update issue. Flags: `--title`, `--description`, `--state`, `--priority` |
| `comment <KEY> <body>` | Add comment. Body from arg, `--body`, or stdin |
| `query <graphql>` | Raw GraphQL query. `--vars '{}'` for variables |

### Priority values
- 0: No priority
- 1: Urgent
- 2: High
- 3: Medium
- 4: Low

## Agent guidance

1. **Get issue details** → `node scripts/linear.cjs issue CSL-24`
2. **Find issues** → `find` for full-text, `search` for filtered listing
3. **Update status** → `update CSL-24 --state "In Progress"` (state names are workspace-specific)
4. **Create sub-issues** → `create --team CSL --title "..." --parent CSL-24`
5. **Raw queries** → `query` command for anything not covered by convenience commands
6. **Auth errors** → tell user to create/check their API key (see Prerequisites)
7. All commands accept issue keys (e.g. `CSL-24`) or Linear UUIDs

## Error playbook

```bash
# No API key
export LINEAR_API_KEY="lin_api_..."
# or
echo "lin_api_..." > ~/.config/linear/api-key

# Permission denied
# Check API key permissions in Linear settings — needs Read scope minimum, Write for mutations

# Issue not found
# Verify team key and issue number: node scripts/linear.cjs teams
```
