---
name: notion
description: "Read, edit, search and query Notion pages and databases through the ntn CLI."
disable-model-invocation: true
---

# Notion

`scripts/` paths below are relative to this skill's folder. Call each script by its absolute path, and stay in the user's directory so their file paths still resolve. `scripts/notion.js` wraps the official `ntn` CLI, and `ntn` owns login and workspace choice. `scripts/notion-mcp.mjs` reaches Notion as the user through the claude.ai Notion connector.

## Safety

- **Whole-page replace**: `page update` replaces the entire page body and drops comment anchors. Use it only when the user asks to replace the whole page. For any partial change, use [Partial edits](#partial-edits).
- **Removal**: trash a page or delete a block only when the user asked for that removal.
- **MCP writes**: `notion-mcp.mjs` refuses write tools without `--confirm-write`. Pass the flag only after the user confirms that write.

## Cheat sheet

```bash
node scripts/notion.js page get <id-or-url> [--json]          # markdown; properties come first as frontmatter
node scripts/notion.js page create [--parent page:<id>|database:<id>|data-source:<id>] < page.md
node scripts/notion.js page update <id-or-url> [--allow-deleting-content] < page.md   # replaces the body
node scripts/notion.js page trash <id-or-url>
node scripts/notion.js blocks list <id-or-url> [--limit 100] [--start-cursor <c>] [--json]   # type, id, text per line
node scripts/notion.js blocks append <id-or-url> [--after <block-id>] [--content '<children-json>']
node scripts/notion.js blocks update <block-id> [--content '<payload-json>']
node scripts/notion.js blocks delete <block-id>
node scripts/notion.js comment list <id-or-url> [--json]
node scripts/notion.js comment add <id-or-url> --markdown '<text>'   # inline formatting only
node scripts/notion.js api <GET|POST|PATCH|DELETE> v1/<path> [--content '<json>']
node scripts/notion.js exec [--timeout 30000] <<'JS' … JS          # multi-step JS, see Exec
```

Call these through `ntn` itself, not `notion.js`:

```bash
ntn datasources resolve <database-id>                             # prints <data-source-id> <TAB> name
ntn datasources query <data-source-id> --json [--filter '<json>'] [--sort '<property> desc'] [--limit 25] [--start-cursor <c>]
ntn files create --filename <name> [--content-type <mime>] < <path>   # prints <upload-id> <TAB> name <TAB> status …
```

```bash
node scripts/notion-mcp.mjs search '<query>' [--user] [--limit 10]    # ranked search as the user
node scripts/notion-mcp.mjs list private|shared|favorite|recent [--limit 20]
node scripts/notion-mcp.mjs call notion-fetch '{"id":"<url-or-id>"}'
```

- **Workspace**: every command targets the default workspace. When the user names another workspace, prefix each `notion.js` or `ntn` command with `NOTION_WORKSPACE_ID=<workspace-uuid>`.
- **Ids**: `<id-or-url>` takes a Notion URL or id. Every other id slot takes the bare id, the 32 hex characters at the end of the URL.
- **Content input**: `page create`, `page update`, `blocks append`, `blocks update` and `api` take the body on stdin (`< file`, a pipe or a heredoc), or as text in `--content '<text>'`.
- **New pages**: without `--parent`, `page create` makes a private page. A leading `# Title` line becomes the title. The script turns GitHub alerts (`> [!WARNING]`) into callouts and keeps GFM tables.
- **Databases**: a database URL holds a database id. Run `ntn datasources resolve` on it, then query the data source id it prints.
- **JSON output**: `node scripts/notion.js db query` and `notion.datasources.query()` print TSV text. For JSON, call `ntn datasources query --json` or `api POST v1/data_sources/<id>/query`.
- **File names**: `node scripts/notion.js files create <path>` drops the file name. Upload with `ntn files create --filename` instead.

## Partial edits

**Change text in place**: send search-and-replace edits to the markdown endpoint. Copy each `old_str` exactly from `page get`. When no edit matches, or one `old_str` matches in several places, the call returns `validation_error`. Misses next to a match come back in `warnings`.

```bash
node scripts/notion.js api PATCH v1/pages/<page-id>/markdown --content '{"type":"update_content","update_content":{"content_updates":[{"old_str":"Owner: TBD","new_str":"Owner: Priya"}]}}'
```

**Add blocks**: `blocks append` adds children at the end of the page. With `--after <block-id>` from `blocks list`, it inserts them after that block.

```bash
echo '[{"type":"heading_2","heading_2":{"rich_text":[{"text":{"content":"Risks"}}]}},
{"type":"bulleted_list_item","bulleted_list_item":{"rich_text":[{"text":{"content":"Vendor delay","link":{"url":"https://example.com"}},"annotations":{"bold":true}}]}}]' \
  | node scripts/notion.js blocks append <id-or-url>
```

A divider is `{"type":"divider","divider":{}}`. A `\n` inside `content` is a line break within the block.

**Edit or remove one block**: `blocks update <block-id>` takes only that block type's payload, such as `{"paragraph":{"rich_text":[…]}}`. `blocks delete <block-id>` archives the block.

## Hard shapes

- **Page properties**: read the page with `api GET v1/pages/<id>` to learn each property's type. Then send the payload for that type:
  `node scripts/notion.js api PATCH v1/pages/<id> --content '{"properties":{"Status":{"status":{"name":"Done"}},"Due":{"date":{"start":"2026-10-27"}}}}'`
  A select property takes `{"select":{"name":"…"}}`.
- **Attach an upload**: take the first TSV field of `ntn files create` as the upload id. Append a block such as `{"type":"image","image":{"type":"file_upload","file_upload":{"id":"<upload-id>"}}}`, with `file`, `pdf` or `video` for other kinds. A files property takes `{"files":[{"type":"file_upload","file_upload":{"id":"<upload-id>"},"name":"<name>"}]}`.
- **Rich comments**: for mentions, custom emoji or colors, send `rich_text` to `api POST v1/comments` instead of `--markdown`.
- **Database filter**: `--filter '{"property":"Status","status":{"equals":"Blocked"}}'`. Use `select` or `checkbox` in place of `status` to match the property's type.

## Exec

`exec` runs the script as an async function body and prints `{ok, logs, result}` with the returned value. The script sees `notion`, `fetch`, `Buffer`, `URL` and `console`. It has no `require`, `import` or file access, so put the data in the script text.

```bash
node scripts/notion.js exec <<'JS'
const id = notion.parsePageId('https://www.notion.so/acme/Plan-1a2b3c4d5e6f40718293a4b5c6d7e8f9');
const all = []; let cursor;
do {
  const r = await notion.api('GET', `v1/blocks/${id}/children`, null, { query: { page_size: 100, ...(cursor && { start_cursor: cursor }) } });
  all.push(...r.results); cursor = r.has_more ? r.next_cursor : null;
} while (cursor);
return all.map(b => b.type);
JS
```

- `notion.api(method, path, body?, { query?, notionVersion? })` returns parsed JSON. Put query parameters in `query`, not in the path.
- The other bindings mirror the CLI: `notion.page.get|create|update|trash`, `notion.blocks.list|append|update|delete`, `notion.comments.list|add`, `notion.search`, `notion.files.list|get|create`, `notion.datasources.resolve|query`, `notion.whoAmI`.
- Run independent requests with `Promise.all`.

## Endpoint lookup

When an endpoint shape is unknown, run `ntn api <path> --help` first. Then read `ntn api <path> --docs -X <METHOD> | head -120`. Docs and `--spec` output run 35 to 180 KB, so read them through `head` or `grep`. A path with several methods needs `-X <METHOD>`.

## Search and the MCP fallback

- **Which search**: `notion-mcp.mjs search` runs as the user and ranks results, so it finds pages the ntn integration can't see. `node scripts/notion.js search <query>` matches titles in pages shared with the integration only.
- **Connected sources**: MCP search covers Slack, Drive, GitHub, Jira and Linear only when the workspace has Notion AI. Otherwise it searches Notion alone.
- **Other MCP reads**: use `notion-mcp.mjs` for the user's sidebar (`list`), people (`search <name> --user`) and pages that return `object_not_found` through ntn. Read those pages with `call notion-fetch`; there is no `fetch` subcommand. `tools` lists the connector's tools.

## Errors

- `No auth token` → ask the user to run `ntn login`.
- `object_not_found` → run `ntn doctor` to check the workspace, then try `notion-mcp.mjs call notion-fetch`.
- `403 restricted_resource` on `v1/users` → personal tokens can't read users. Use `notion-mcp.mjs search <name> --user`.
- `Multiple methods are available` → add `-X <METHOD>`.

## Index

- ntn: `pages get|create|update|trash`, `datasources resolve|query`, `files create|get|list`, `api ls`, `api <path> [--help|--docs|--spec]`, `whoami`, `doctor`, `login`, `logout`, `update`, `completions`, `workers`.
- API endpoints without a wrapper, called through `api`: `POST v1/pages/<id>/move`, `v1/views`, `POST v1/blocks/meeting_notes/query`, `GET v1/data_sources/<id>/templates`, `GET v1/custom_emojis`. `ntn api ls` lists every endpoint.
- notion.js: `whoami`, `search <query> [--limit N] [--json]`, `db resolve|query`, `files list|get|create [--external-url <url>]`, `exec --script '<js>'`.
- notion-mcp.mjs: `auth`, `search [--created-after|--created-before YYYY-MM-DD]`, `tools`, `call <tool> '<json>' [--confirm-write]`, and `--json` on every command.

## Look up the rest

- Install ntn, log in to another workspace, MCP auth or connector errors, plan limits → [references/troubleshooting.md](references/troubleshooting.md)
