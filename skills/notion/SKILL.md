---
name: notion
description: "Read, write, and organize Notion: pages and blocks as markdown, surgical edits to part of a page, comments, database queries and filters, file uploads, and any other Notion API operation. Also ranked workspace search (and people search, sidebar browsing of private/shared/favorite/recent pages. Use for any Notion task: reading, summarizing, creating, updating, searching, or automating."
---

# Notion

Use this skill for Notion tasks: read/write pages as markdown, query databases, upload files, raw API calls, multi-step automations.

## Architecture

This skill is a thin JavaScript layer over the **official Notion CLI** (`ntn`):

- **Auth and workspace selection are fully delegated to ntn.** This skill stores nothing.
- **CLI subcommands** are convenience wrappers (URL parsing, stdin handling).
- **`exec` JS sandbox** lets the agent compose multi-step flows with ntn-backed helpers.

Zero npm deps. Requires `node` (stdlib) and `ntn` on PATH.

**Setup, auth, workspace switching, and error recovery:** [references/setup-and-troubleshooting.md](references/setup-and-troubleshooting.md) (read on demand). First run: `curl -fsSL https://ntn.dev | bash && ntn login`.

## Files

- `scripts/notion.js` — CLI entry + `exec` sandbox (direct REST via ntn — **primary**)
- `scripts/ntn.js` — ntn shellouts + page-id parsing + REST helpers
- `scripts/notion-mcp.mjs` — MCP fallback CLI (semantic search + sidebar lists only)
- `references/mcp-proxy.md` — MCP auth/protocol + when-to-use notes
- `references/setup-and-troubleshooting.md` — install, auth, workspace switching, error playbook

**Favour the direct API (`notion.js`).** Reach for `notion-mcp.mjs` only for the two things REST can't practically do: search as the user's identity (ranked, sees pages the PAT can't; spans connected sources only where the workspace has Notion AI), and the user's sidebar lists (see "When to fall back to MCP").

## CLI

```bash
node scripts/notion.js whoami                          # identity (parsed from `ntn whoami`)
node scripts/notion.js page get <id-or-url> [--json]   # markdown to stdout
node scripts/notion.js page create --parent <ref> [--content <md>]
node scripts/notion.js page update <id-or-url> [--content <md>] [--allow-deleting-content]
node scripts/notion.js page trash <id-or-url> [--no-yes]
node scripts/notion.js blocks list <id-or-url> [--limit N] [--json]     # id + type + text preview
node scripts/notion.js blocks append <id-or-url> [--after <block-id>]   # children JSON via --content/stdin
node scripts/notion.js blocks update <block-id>                         # payload JSON via --content/stdin
node scripts/notion.js blocks delete <block-id>
node scripts/notion.js db resolve <database-id>                         # database id → data source ids
node scripts/notion.js db query <data-source-id> [--filter <json|->] [--sort <s>] [--limit N]
node scripts/notion.js comment list <id-or-url> [--json]
node scripts/notion.js comment add <id-or-url> [--markdown <text>]      # stdin if --markdown omitted
node scripts/notion.js search <query...> [--limit N] [--json]           # keyword, workspace-only
node scripts/notion.js files list
node scripts/notion.js files get <upload-id>
node scripts/notion.js files create <path> | files create --external-url <url>
node scripts/notion.js api <method> <path> [--content <json>]
node scripts/notion.js exec [--script '...'] [--timeout 30000]
```

The `blocks`, `db`, `comment`, `search`, and `files create` subcommands make common flows first-class instead of hand-written `exec`. `blocks append`/`update` read JSON from stdin when `--content` is omitted; `blocks append --after` auto-sets the `2022-06-28` API version required by the `after` param.

`--parent` accepts `page:<id>`, `database:<id>`, or `data-source:<id>`. `page create/update` and `api` read body/content from stdin if `--content` is omitted. `page get` / `update` / `trash` accept either a UUID or a full Notion URL.

> ⚠️ **`page update` REPLACES the entire page body — it is destructive, not append.** Passing `--content` overwrites every existing block on the page (and drops comment/discussion anchors). **Never use `page update` to add or tweak a section on an existing page you didn't just create.** For any surgical change to an existing page, use the block-level API (see "Surgical block edits" below) — do not round-trip the whole page through markdown.

For file uploads use the `files create` subcommand (or `ntn files create` directly):

```bash
node scripts/notion.js files create ./image.png
node scripts/notion.js files create --external-url https://example.com/photo.png
```

## When to fall back to MCP (`notion-mcp.mjs`)

The direct API is the default. Use the MCP fallback **only** for capabilities REST can't practically do. Both run as the user's Claude OAuth identity, so they see everything the user sees — a PAT integration only sees explicitly-shared pages, so MCP `search` routinely surfaces (and can `fetch`) pages the PAT `search`/`blocks` calls return empty for.

> **AI vs workspace search:** connected-source search (Slack/Drive/GitHub/Jira/Linear) needs **Notion AI + connectors**. This workspace lacks it, so `search` runs the Notion-only `workspace_search` backend (its value here is OAuth visibility + ranking, not connected sources). The backend is auto-selected; it will start including connected sources automatically if Notion AI is enabled. Check entitlements with `call notion-fetch '{"id":"self"}'`.

```bash
MCP="scripts/notion-mcp.mjs"
node "$MCP" auth                                          # verify connector + credentials
node "$MCP" search 'Q3 revenue plan' --limit 5           # ranked search as the user (Notion-only here; +connected sources with Notion AI)
node "$MCP" search jane@example.com --user               # people search
node "$MCP" list recent --limit 10                       # sidebar: private|shared|favorite|recent
node "$MCP" tools                                        # discover connector tools
node "$MCP" call notion-fetch '{"id":"https://notion.so/..."}'   # generic read escape hatch
```

`search` and `list` are the only predefined MCP capabilities; anything else goes through `call` (writes require `--confirm-write`). Auth is Claude OAuth (`CLAUDE_CODE_OAUTH_TOKEN` → macOS Keychain → `~/.claude/.credentials.json`). Details and entitlement limits: [references/mcp-proxy.md](references/mcp-proxy.md).

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
| `notion.blocks.list(idOrUrl, { pageSize, startCursor })` | List child blocks (raw list response). |
| `notion.blocks.append(idOrUrl, { children, after })` | Insert blocks; `after` auto-sets `2022-06-28`. |
| `notion.blocks.update(blockId, payload)` / `notion.blocks.delete(blockId)` | Edit/archive one block. |
| `notion.comments.list(idOrUrl, { startCursor })` / `notion.comments.add(idOrUrl, { markdown })` | Read/add comments. |
| `notion.search(query, { filter, sort, pageSize, startCursor })` | Keyword `v1/search`. |
| `notion.datasources.resolve(databaseId)` | Database id → data source ids (tab-separated text). |
| `notion.datasources.query(dataSourceId, { limit, startCursor, sort, filter })` | Query pages. `filter` accepts object or JSON string. |
| `notion.files.list()` / `notion.files.get(uploadId)` / `notion.files.create({ filePath, externalUrl })` | List/get/create uploads. |
| Globals: `fetch`, `Buffer`, `URL`, `console` (captured in `logs`) | |

**Rule of thumb:**
- Markdown read/write of pages → `notion.page.*`
- Surgical edits on an existing page → `notion.blocks.*` (or the `blocks` CLI)
- Database queries → `notion.datasources.query()` or `notion.api('POST', 'v1/data_sources/<id>/query', body)`
- Anything else → `notion.api(method, path, body)`
- Don't know the endpoint shape → `notion.api.help/spec/docs(path)` first
- Need search as the user (ranked, beyond PAT visibility) / the user's sidebar → `notion-mcp.mjs` (fallback)

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

## Surgical block edits (add / edit / remove parts of an existing page)

`page update` clobbers the whole page (see warning above). To change **part** of a page without touching the rest, work at the block level. The `blocks` subcommands (and `notion.blocks.*` exec bindings) wrap the raw calls below — prefer them:

1. **List children to get block ids:**
   ```bash
   node scripts/notion.js blocks list <url-or-id>       # type\tid\ttext preview
   ```

2. **Insert new blocks at a position** (only adds; existing blocks untouched) — `--after` sets the block id to follow and auto-adds the required API version:
   ```bash
   echo '[ /* block objects */ ]' | node scripts/notion.js blocks append <url-or-id> --after <block-id>
   ```
   > **`after` gotcha:** the default API version rejects `after` (`400 … body.after should be not present`). `blocks append` passes `{ notionVersion: '2022-06-28' }` for you. Omit `--after` to append at the end of the page instead.

3. **Edit one block's text:** `blocks update <block-id>` with just that block-type payload (e.g. `{ "paragraph": { "rich_text": [...] } }` via `--content`/stdin). Changes only that block.

4. **Delete one block:** `blocks delete <block-id>` (archives it).

Raw-API equivalents if you need them: `GET|PATCH|DELETE v1/blocks/...` via `notion.api(...)`.

Block object shape for `children`: `{ object:'block', type:'paragraph', paragraph:{ rich_text:[ { type:'text', text:{ content:'…', link:{url:'…'}? }, annotations:{ bold:true }? } ] } }`. Headings use `heading_2`/`heading_3`; a horizontal rule is `{ object:'block', type:'divider', divider:{} }`. A `\n` inside a rich_text `content` renders as a soft line break within the same block (matches the `**Bold**<br>text` lead-in pattern common in these docs).

## Markdown in comments

Add/read comments with the `comment` subcommands (`comment add <page> --markdown '...'`, `comment list <page>`) or, in `exec`, `notion.comments.add/list`. Both use the `markdown` field on `POST /v1/comments`:

```js
await notion.api('POST', 'v1/comments', {
  parent: { page_id: 'abc...' },
  markdown: 'See the [spec](https://example.com) and **acknowledge**.',
});
```

Fall back to `rich_text` only for features markdown can't express (mentions, custom emoji, colors).

## Agent guidance

1. "Read/summarize this page" → `page get` (CLI) or `notion.page.get()` (exec).
2. "Create a new page from markdown" → `page create`. "Add/change a section on an **existing** page" → **Surgical block edits** (`blocks` subcommands / `notion.blocks.*`), NOT `page update` — `page update` overwrites the whole body. Only use `page update` to intentionally replace an entire page's content.
3. For any other API endpoint inside `exec`, call `notion.api.help('v1/<path>')` or `notion.api.spec('v1/<path>')` **before** writing the call — the spec is authoritative; memorized shapes drift.
4. Databases: use `db query <data-source-id>` / `notion.datasources.query(...)`. If the user gave you a database id, resolve it first with `db resolve <database-id>` / `notion.datasources.resolve(databaseId)`.
5. Use `Promise.all` for independent requests.
6. If `notion.whoAmI()` errors with "No auth token", instruct the user to run `ntn login`.
7. On `object_not_found`: either the active workspace is wrong (`ntn doctor` / `NOTION_WORKSPACE_ID=<uuid>`), or the page isn't shared with the PAT integration. If it's a sharing/visibility gap, the MCP fallback (`notion-mcp.mjs`, runs as the user's OAuth identity) can usually reach it.
8. "Search for X" / "what do we have on Y": REST `search` is keyword + PAT-scoped. Prefer `notion-mcp.mjs search` — it runs as the user (finds pages the PAT can't see) and ranks results; it also spans connected sources (Slack/Drive/GitHub/Jira/Linear) **iff** the workspace has Notion AI, otherwise it returns Notion-only `workspace_search`. `--user` does people search. For the user's sidebar (private/shared/favorite/recent), use `notion-mcp.mjs list`.
9. Install/auth/workspace or error recovery (`No auth token`, `object_not_found`, PAT limits) → [references/setup-and-troubleshooting.md](references/setup-and-troubleshooting.md).
