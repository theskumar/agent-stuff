---
name: notion
description: "Read/write Notion pages as markdown, query data sources, upload files, and make raw API calls. Thin JS sandbox over the official Notion CLI (`ntn`); auth and workspace selection are handled by ntn."
---

# Notion

Use this skill for Notion tasks: read/write pages as markdown, query databases, upload files, raw API calls, multi-step automations.

## Architecture

This skill is a thin JavaScript layer over the **official Notion CLI** (`ntn`):

- **Auth and workspace selection are fully delegated to ntn.** This skill stores nothing.
- **CLI subcommands** are convenience wrappers (URL parsing, stdin handling).
- **`exec` JS sandbox** lets the agent compose multi-step flows with ntn-backed helpers.

Zero npm deps. Requires `node` (stdlib) and `ntn` on PATH.

## Prerequisites

```bash
curl -fsSL https://ntn.dev | bash
ntn login                              # opens browser, stores token in OS keychain
ntn whoami                             # verify
```

Multiple workspaces: log in to each (`ntn login` again), then per-invocation override the active one with `NOTION_WORKSPACE_ID=<uuid>`. List workspaces with `cat ~/.config/notion/workspaces.json`.

## Files

- `scripts/notion.js` — CLI entry + `exec` sandbox
- `scripts/ntn.js` — ntn shellouts + page-id parsing

## CLI

```bash
node scripts/notion.js whoami                          # identity (parsed from `ntn whoami`)
node scripts/notion.js page get <id-or-url> [--json]   # markdown to stdout
node scripts/notion.js page create --parent <ref> [--content <md>]
node scripts/notion.js page update <id-or-url> [--content <md>] [--allow-deleting-content]
node scripts/notion.js page trash <id-or-url> [--no-yes]
node scripts/notion.js files list
node scripts/notion.js files get <upload-id>
node scripts/notion.js api <method> <path> [--content <json>]
node scripts/notion.js exec [--script '...'] [--timeout 30000]
```

`--parent` accepts `page:<id>`, `database:<id>`, or `data-source:<id>`. `page create/update` and `api` read body/content from stdin if `--content` is omitted. `page get` / `update` / `trash` accept either a UUID or a full Notion URL.

For file uploads (with content), use ntn directly:

```bash
ntn files create < image.png
ntn files create --external-url https://example.com/photo.png
```

## Exec (JS sandbox)

For multi-step flows. Pipe a script via stdin/heredoc, or pass `--script`.

```bash
node scripts/notion.js exec <<'JS'
const md = await notion.page.get('https://www.notion.so/...');
const search = await notion.api('POST', 'v1/search', { page_size: 5 });
return { chars: md.length, hits: search.results.map(r => r.url) };
JS
```

Bindings inside `exec`:

| Binding | Purpose |
|---|---|
| `notion.api(method, path, body, opts)` | Generic Notion API call via `ntn api`. Returns parsed JSON. `opts.query` for GET query params, `opts.notionVersion` to override. |
| `notion.api.help(path)` / `.spec(path)` / `.docs(path)` | Self-documenting endpoint metadata. **Use before guessing payload shape.** |
| `notion.whoAmI()` | Parsed `ntn whoami` (bot/workspace/user identity). |
| `notion.parsePageId(s)` | URL or id → canonical UUID. |
| `notion.page.get(idOrUrl, { json })` | Markdown string, or full JSON when `json: true`. |
| `notion.page.create({ parent, content })` | Create from markdown. Returns page JSON. |
| `notion.page.update(idOrUrl, { content, allowDeletingContent })` | Update body. |
| `notion.page.trash(idOrUrl, { yes })` | Move to trash. |
| `notion.datasources.resolve(databaseId)` | Database id → data source ids (tab-separated text). |
| `notion.datasources.query(dataSourceId, { limit, startCursor, sort, filter })` | Query pages. `filter` accepts object or JSON string. |
| `notion.files.list()` / `notion.files.get(uploadId)` | List/get uploads. |
| Globals: `fetch`, `Buffer`, `URL`, `console` (captured in `logs`) | |

**Rule of thumb:**
- Markdown read/write of pages → `notion.page.*`
- Database queries → `notion.datasources.query()` or `notion.api('POST', 'v1/data_sources/<id>/query', body)`
- Anything else → `notion.api(method, path, body)`
- Don't know the endpoint shape → `notion.api.help/spec/docs(path)` first

## Discovery

`ntn` is self-documenting. Use before guessing endpoint shapes:

```bash
ntn api ls                           # list every public endpoint
ntn api <path> --help                # methods, doc links, usage
ntn api <path> --docs                # full official docs
ntn api <path> --spec                # reduced OpenAPI fragment (request/response schema)
ntn <command> --help                 # help for any command
```

From inside `exec`: `notion.api.help(path)` / `.spec(path)` / `.docs(path)`.

## Markdown in comments

Comments support markdown via the `markdown` field on `POST /v1/comments`:

```js
await notion.api('POST', 'v1/comments', {
  parent: { page_id: 'abc...' },
  markdown: 'See the [spec](https://example.com) and **acknowledge**.',
});
```

Fall back to `rich_text` only for features markdown can't express (mentions, custom emoji, colors).

## Agent guidance

1. "Read/summarize this page" → `page get` (CLI) or `notion.page.get()` (exec).
2. "Create/update this page from markdown" → `page create` / `page update` (CLI) or `notion.page.create/update()` (exec).
3. For any other API endpoint inside `exec`, call `notion.api.help('v1/<path>')` or `notion.api.spec('v1/<path>')` **before** writing the call — the spec is authoritative; memorized shapes drift.
4. Databases: use `notion.datasources.query(dataSourceId, ...)`. If the user gave you a database id, resolve to a data source id with `notion.datasources.resolve(databaseId)` first.
5. Use `Promise.all` for independent requests.
6. If `notion.whoAmI()` errors with "No auth token", instruct the user to run `ntn login`.
7. On `object_not_found`: the active workspace can't see that page. Verify the right workspace is active (`ntn doctor` or `NOTION_WORKSPACE_ID=<uuid>`).

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
```

## Setup notes

- Auth, workspace registry, and tokens are owned by ntn (`~/.config/notion/`).
- ntn keychain mode is default. Use `NOTION_KEYRING=0` to fall back to `~/.config/notion/auth.json`.
- `NOTION_WORKSPACE_ID=<uuid>` selects a non-default workspace for any invocation.
