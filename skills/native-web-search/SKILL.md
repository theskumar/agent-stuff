---
name: native-web-search
description: "Trigger native web search. Use when you need quick internet research with concise summaries and full source URLs."
---

# Native Web Search

Use this skill to run a **fast model (Haiku) with native web search enabled** and get a concise research summary with explicit full URLs. It shells out to the `claude` CLI in print mode with only `WebSearch`/`WebFetch` tools allowed.

## Script

- `search.mjs`

## Usage

Run from this skill directory:

```bash
node search.mjs "<what to search>" --purpose "<why you need this>"
```

Examples:

```bash
node search.mjs "latest python release" --purpose "update dependency notes"
node search.mjs "vite 7 breaking changes" --purpose "prepare migration checklist"
```

Optional flags:

- `--model <id>` (default: `haiku`)
- `--timeout <ms>` (default: 120000)
- `--json`

## Output expectations

The script instructs the model to:
- search the internet for the requested topic
- provide a concise summary for the given purpose
- include full canonical URLs (`https://...`) for each key finding
- highlight disagreements between sources

## Notes

- Requires the `claude` CLI on PATH (Claude Code). No npm install needed.
- Auth/model come from the local Claude Code config — no API keys handled here.
