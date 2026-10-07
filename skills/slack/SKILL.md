---
name: slack
description: "Read and search Slack channels, messages, threads, users, files, and reactions; create editable message drafts and perform other Slack actions after confirmation. Use whenever the user mentions Slack, channels, DMs, Slack messages, drafts, or asks to search/read/write Slack data."
---

# Slack

Use bundled CLI. It calls Slack through Anthropic's MCP proxy without model inference or a Claude CLI subprocess.

```bash
SLACK_CLI="$HOME/.agents/skills/slack/scripts/slack.mjs"
node "$SLACK_CLI" auth
```

## Read workflows

```bash
# Discover channel ID, then read recent messages
node "$SLACK_CLI" channels 'ai-hub'
node "$SLACK_CLI" messages C0123456789 --limit 20

# Search public + private channels and DMs
node "$SLACK_CLI" search 'release after:2026-07-01' --limit 20
node "$SLACK_CLI" search 'from:<@U123> in:engineering incident'

# Public channels only
node "$SLACK_CLI" search 'release notes' --public

# Thread, users, profile
node "$SLACK_CLI" thread C0123456789 1784801848.744239
node "$SLACK_CLI" catchup ai-hub --since 3d
node "$SLACK_CLI" users 'Jane Doe'
node "$SLACK_CLI" profile U123456
```

Resolve human channel names with `channels` before `messages`. For DMs, `messages` accepts a user ID.

## Catch up since a time

`catchup` is the command for "what did I miss". It returns new top-level messages **and** new replies to older threads, grouped by channel and thread, oldest first. Use it instead of `messages`, which only sees top-level messages and silently drops thread replies.

```bash
# A channel, by name or ID
node "$SLACK_CLI" catchup ai-hub --since 3d
node "$SLACK_CLI" catchup C0123456789 --since 2026-09-20

# DMs, @-mentions, or every channel you are in
node "$SLACK_CLI" catchup --dms --since 8h
node "$SLACK_CLI" catchup --mentions --since 2d
node "$SLACK_CLI" catchup --all --since 4h --brief

# One thread, from a copied Slack link
node "$SLACK_CLI" catchup 'https://acme.slack.com/archives/C123/p1784801848744239?thread_ts=1784801848.744239'

# Resume from where the last run stopped
node "$SLACK_CLI" catchup ai-hub --since last
```

`--since` accepts a duration (`45m`, `2h`, `3d`, `1w`), a date or datetime (`2026-09-20`), a Slack ts, a message permalink, or `last`. Default is 24h.

Permalinks split two ways: a link carrying `thread_ts` catches up **that thread**; a link without it means **that channel since that message**.

Every run saves a watermark to `~/.cache/slack-catchup/` so `--since last` works next time. Pass `--no-save` for read-only probing, such as exploring a range you do not want to consume.

Other flags: `--until <time>` to close the window, `--max N` to cap results (default 200, paged 20 at a time), `--brief` to truncate each message to 200 characters, `--bots` to include bot posts, `--no-context` to skip the extra lookups that fetch parent text for threads whose parent is older than the window, and `--json`.

Slack MCP does **not** expose unread markers/counts. Never claim results are unread. Offer `catchup --since` or browser automation instead.

## Message drafts

Drafts are a first-class workflow. `draft` creates an editable Slack draft and does **not** send it. Resolve the destination ID, show exact draft text, get confirmation, then create it:

```bash
# Channel draft
node "$SLACK_CLI" draft C123 'Exact approved draft text' --confirm-write

# Thread draft; stdin preserves multiline text without JSON escaping
printf '%s' 'Exact approved multiline draft' | \
  node "$SLACK_CLI" draft C123 - --thread 1784801848.744239 --confirm-write
```

If user asks only to compose wording, return proposed text without creating anything in Slack. Use `draft` only when they ask to create/save the draft in Slack.

## Custom JS (exec)

Run arbitrary JavaScript with `call(toolName, args, opts)` and `tools` (array of tool schemas) available:

```bash
# Inline script
node "$SLACK_CLI" exec 'const ch = await call("slack_search_channels", {query:"general",limit:1}); return ch;'

# Multiline from stdin
cat <<'JS' | node "$SLACK_CLI" exec -
const channels = await call("slack_search_channels", {query: "engineering", limit: 5});
const msgs = await call("slack_read_channel", {channel_id: channels.results[0].id, limit: 3});
return { channel: channels.results[0].name, recent: msgs.messages?.length };
JS
```

Write tools require `{ confirmWrite: true }` as the third arg to `call`. `options` object from CLI flags is also available.

## Generic tools

Discover current tools and schemas before unfamiliar operations:

```bash
node "$SLACK_CLI" tools
node "$SLACK_CLI" tools --json
node "$SLACK_CLI" call slack_search_channels '{"query":"general","limit":5}'
printf '%s' '{"query":"general"}' | node "$SLACK_CLI" call slack_search_channels - --json
```

Default output is readable text. `--json` returns normalized JSON. Use `--timeout <ms>` for slow calls. Search/channel/user endpoints cap `--limit` at 20; message history caps it at 100. Follow returned cursors for more.

## Writes: confirmation required

Before any send, schedule, reaction, draft, canvas create/update, or unknown non-read tool:

1. Show exact proposed action, destination, and content.
2. Obtain explicit user confirmation.
3. Call tool with `--confirm-write`.

```bash
node "$SLACK_CLI" call slack_send_message \
  '{"channel_id":"C123","message":"Exact approved text"}' \
  --confirm-write
```

CLI has an explicit allowlist of known read tools. New or unknown tools are treated as writes and blocked without `--confirm-write`.

## Auth and failures

Auth lookup order: `CLAUDE_CODE_OAUTH_TOKEN`, macOS Keychain, `~/.claude/.credentials.json`. Script never prints tokens. Claude credential must contain `user:mcp_servers`; Slack connector must be connected on claude.ai.

On auth/connector failures, read [auth and protocol notes](references/auth-and-protocol.md). Do not scrape browser cookies or print credential files.
