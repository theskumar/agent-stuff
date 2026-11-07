# Agent Stuff

Personal extensions, skills, and prompts for [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) and [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

## Install

```bash
./install.sh
```

Creates symlinks from `~/.agents/skills/`, `~/.pi/agent/extensions/`, `~/.pi/agent/prompts/`, `~/.pi/agent/themes/`, and `~/.claude/commands/` into this repo. Re-run after adding new items. Existing non-symlink files are skipped.

## Extensions

pi TypeScript extensions. Source: [`extensions/`](extensions/).

| Extension | Purpose |
|---|---|
| [`multi-edit.ts`](extensions/multi-edit.ts) | Overrides built-in `edit` with multi-file `edits[]` and Codex `patch` support |
| [`review.ts`](extensions/review.ts) | `/review` workflow (uncommitted, branch, commit, PR, folder). PR and branch reviews open with a Merge Risk section (alignment, impact, verification, rollback cost, error detection) using the PR body, linked issues and CI checks; the extension computes low/medium/high from the `review-meta` trailer and never lets it affect blocking (rubric adapted from [warpdotdev/common-skills merge-risk](https://github.com/warpdotdev/common-skills/blob/main/.agents/skills/merge-risk/SKILL.md), MIT) |
| [`prompt-editor.ts`](extensions/prompt-editor.ts) | Named model+thinking presets, cross-session prompt history, low-battery indicator (`.pi/battery.json` / `PI_BATTERY_THRESHOLD` / `PI_BATTERY_DISABLE`) |
| [`session-name.ts`](extensions/session-name.ts) | `Ctrl+Shift+N` prefilled session rename dialog; mirrors the session name into the tmux window name (restores the prior name on quit) |
| [`session-title.ts`](extensions/session-title.ts) | `/title` and `Ctrl+Alt+N` generate a session name from the conversation with one cheap model call (pi-web's "Generate title" algorithm); auto-titles on `agent_settled` at user-turn thresholds (default 2 and 6) and stops once you rename by hand. Config: `~/.pi/agent/extensions/session-title.config.json` (`auto`, `autoAtTurns`, `model`: `fast` / `current` / `provider/id`, `shortcut`); `/title status` shows state |
| [`tree-fast-summary.ts`](extensions/tree-fast-summary.ts) | `/tree` branch summaries run on the `fast` mode from `modes.json` (project file first, then global; Haiku 4.5 if neither has one), not the main model. Adds a "Suggested Skills" section to each summary. `/compact` is not touched |
| [`titlebar-spinner.ts`](extensions/titlebar-spinner.ts) | Braille spinner in terminal title while agent works |
| [`notify.ts`](extensions/notify.ts) | Desktop notification on turn end, titled with the tmux target; clicking jumps back to the firing `session:window.pane` when `terminal-notifier` is installed, else plain OSC 777 |
| [`moshi-notify.ts`](extensions/moshi-notify.ts) | Push notification to [Moshi](https://getmoshi.app) iOS app on turn end via webhook, only when away from the desk — idle or screen locked (`MOSHI_API_TOKEN`, optional `MOSHI_UNIFIED=true`, `MOSHI_IDLE_SECONDS=300`, `MOSHI_NOTIFY=always\|never`) |
| [`snake.ts`](extensions/snake.ts) | `/snake` game |
| [`uv.ts`](extensions/uv.ts) | Force Python tooling through `uv` |
| [`files.ts`](extensions/files.ts) | File tool tweaks |
| [`goal.ts`](extensions/goal.ts) | `/goal` long-running thread goal with token budget tracking |
| [`answer.ts`](extensions/answer.ts) | `/answer` and `ctrl+.` extract questions from assistant messages into interactive Q&A TUI |
| [`btw.ts`](extensions/btw.ts) | `/btw` side-chat popover that reuses the main conversation context; optional summary injection back into main chat on close (source: [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff)) |
| [`loop.ts`](extensions/loop.ts) | `/loop` runs follow-up prompts on `turn_end` until a breakout condition (tests pass / custom condition / agent-decides via `signal_loop_success` tool) (source: [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff)) |
| [`trust-github-repos.ts`](extensions/trust-github-repos.ts) | Auto-trust checkouts whose git origin is under `fueled`, `theskumar`, or `earendil-works` so `project_trust` never prompts for them (source: [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff), owner allowlist customized) |
| [`todos.ts`](extensions/todos.ts) | `/todos` visual todo manager backed by markdown files in `.pi/todos/` |
| [`no-sleep.ts`](extensions/no-sleep.ts) | Prevent macOS sleep via `caffeinate` while agent runs; `/no-sleep` toggle (source: [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff)) |
| [`edit-guard.ts`](extensions/edit-guard.ts) | Warns (never blocks) when bash edits a file through Python/`sed -i` or reads one with `cat`/`head`/`sed -n`; points to `edit`/`read`. Max 3 warnings per kind per session. `PI_EDIT_GUARD=0` disables |
| [`inline-bash.ts`](extensions/inline-bash.ts) | Expand `!{cmd}` patterns before they reach the agent, only in text you type and in the `!{...}` lines of a prompt template file you invoke; never in extension-sent messages (e.g. `/review` diffs), skill bodies or history (source: [earendil-works/pi examples](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/inline-bash.ts)) |
| [`split-fork.ts`](extensions/split-fork.ts) | `/split-fork [-d] [prompt]` forks the current session into a new pi process in a new tmux window or herdr tab (backend auto-detected; `-d` keeps focus here) (adapted from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff), Ghostty → tmux/herdr) |
| [`handoff.ts`](extensions/handoff.ts) | `/handoff <goal>` distills the session into a compact hot-state-first prompt and starts a fresh session seeded with it (`PI_HANDOFF_MODEL`, `PI_HANDOFF_MAX_TOKENS`; adapted from [hjanuschka/shitty-extensions](https://github.com/hjanuschka/shitty-extensions), tuned for mid-task continuation) |
| `pi-claude-bridge` (local) | Claude Code as a pi model provider through the Agent SDK, plus an `AskClaude` tool. Loaded from the checkout at `~/code/pi-claude-bridge` (fork of [elidickinson/pi-claude-bridge](https://github.com/elidickinson/pi-claude-bridge)). |
| `npm:pi-wait` | `/wait <duration> <prompt>` queues a prompt and sends it after the timer; `/wait now`, `pause`, `resume`, `cancel`, `status`. Pairs with `/loop` for polling. See [brettinternet/pi-extensions](https://github.com/brettinternet/pi-extensions). |
| `npm:skill-diet` | Nico Bailon's skill that keeps other skills lean and correct; use it before editing a skill. See [nicobailon/skill-diet](https://github.com/nicobailon/skill-diet). |
| `@agegr/pi-web` (global npm) | Web UI for pi. Also provides the subagent tools used here: `Agent` (types `explore`, `general-purpose`, `plan`; foreground or background, optional git worktree), `get_subagent_result` and `steer_subagent`. Each child runs as its own Pi session you can open in the UI. Replaced `pi-subagent-manager` and the archived custom `subagent.ts` ([notes](archive/subagents-2026-10-08/README.md)). See [agegr/pi-web](https://github.com/agegr/pi-web). |
| `npm:pi-web-access` | Nico Bailon's web tools: `web_search`, `fetch_content`, `get_search_content`, `source_check`. Installed globally, pinned. Search runs through the ChatGPT login with Exa as fallback. Config: `~/.pi/agent/web-search.json`. Replaces the removed `codex-web-search.ts` and `ketch` skill. See [nicobailon/pi-web-access](https://github.com/nicobailon/pi-web-access). |
| `npm:pi-blackhole` | k0valik's compaction plus memory package. Replaces the LLM summary behind `/compact` with a deterministic one, and adds `/blackhole` and the `recall` tool for searching the full session file. Installed globally. Global config `~/.pi/agent/pi-blackhole/pi-blackhole-config.json`: auto compaction at 140K tokens, summaries appended, memory workers off. This repo's [`.pi/pi-blackhole-config.json`](.pi/pi-blackhole-config.json) also keeps memory off. See [k0valik/pi-blackhole](https://github.com/k0valik/pi-blackhole). |
| [`view-image.ts`](extensions/view-image.ts) | `view_image` tool reads an image file and returns it as an image attachment for visual inspection; reuses the built-in read tool's result renderer so pi's inline image viewer handles display (source: [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff)) |

## Global AGENTS.md

[`agent/AGENTS.md`](agent/AGENTS.md) is symlinked to `~/.pi/agent/AGENTS.md` — global instructions loaded into every pi session. It carries the subagent-delegation nudge, and it is the only prompt channel claude-bridge forwards to Claude subprocesses (sanitized, as `# CLAUDE.md`); extension prompt sections are dropped at the bridge. A project-local `AGENTS.md` shadows it on the bridge side, and the sanitizer rewrites the bare word "pi" to "environment" — avoid it in this file.

## Themes

pi color themes. Source: [`themes/`](themes/). Loaded via `"themes": ["~/.pi/agent/themes"]` in `~/.pi/agent/settings.json`; activate with `/theme <name>`.

| Theme | Description |
|---|---|
| [`modern-dark.json`](themes/modern-dark.json) | Orange-accented dark theme (source: [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff)) |
| [`nightowl.json`](themes/nightowl.json) | Night Owl color scheme (source: [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff)) |
| [`dayowl.json`](themes/dayowl.json) | Day Owl light variant (source: [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff)) |

### PATH shims (activated by `uv.ts`)

Source: [`intercepted-commands/`](intercepted-commands/).

| Shim | Redirects to |
|---|---|
| [`pip`](intercepted-commands/pip), [`pip3`](intercepted-commands/pip3) | `uv add` / `uv run --with` |
| [`poetry`](intercepted-commands/poetry) | `uv init` / `uv add` / `uv sync` / `uv run` |
| [`python`](intercepted-commands/python), [`python3`](intercepted-commands/python3) | `uv run --python` |

## Output styles

Claude Code output styles. Source: [`output-styles/`](output-styles/), symlinked to `~/.claude/output-styles/`. Select with `/output-style <name>` or set `"outputStyle": "<name>"` in `~/.claude/settings.json`. See [`output-styles/SOURCES.md`](output-styles/SOURCES.md) for sources and acknowledgements.

| Style | Description |
|---|---|
| [`caveman.md`](output-styles/caveman.md) | Terse "smart caveman" prose; substance stays, fluff dies (source: [carlosduplar/caveman-output-style-claude-code](https://github.com/carlosduplar/caveman-output-style-claude-code)) |

## Skills

Markdown instruction sets (one `SKILL.md` per folder). Source: [`skills/`](skills/).

| Skill | Purpose |
|---|---|
| [`adr`](skills/adr/) | Architecture Decision Records |
| [`commit`](skills/commit/) | Conventional Commit messages |
| [`figma`](skills/figma/) | Read Figma designs via `figma-pp-cli`: `scripts/figma-node.sh <url>` gives a compact tree, raw nodes, text styles, and a 2x PNG. Personal access token in keychain `figma-pat` |
| [`github`](skills/github/) | `gh` CLI (PRs, issues, runs, API) |
| [`google-workspace`](skills/google-workspace/) | Access Google Workspace APIs (Drive, Docs, Sheets, Calendar, Gmail, Chat, People) via OAuth |
| [`grill-me`](skills/grill-me/) | Stress-test a plan via relentless questioning |
| [`librarian`](skills/librarian/) | Cache and reuse remote git checkouts (GitHub, GitLab, Codeberg, Bitbucket, sourcehut, self-hosted) |
| [`explainer-video`](skills/explainer-video/) | Narrated explainer videos from docs: TTS, animated HTML scenes, Chrome render, ffmpeg |
| [`mermaid`](skills/mermaid/) | Validate and preview Mermaid diagrams with Pele (no browser) |
| [`message-voice`](skills/message-voice/) | Rewrite drafted Slack messages and emails into Saurabh's voice before sending |
| [`notion`](skills/notion/) | Notion read/write pages as markdown via the official `ntn` CLI, plus a JS exec sandbox |
| [`pr-summary`](skills/pr-summary/) | Generate PR descriptions following project conventions from code diffs |
| [`sentry`](skills/sentry/) | Fetch and analyze Sentry issues, events, and logs |
| [`slack`](skills/slack/) | Read and search Slack (catchup, threads, users) and create editable drafts through the Claude.ai Slack connector, no bot token |
| [`summarize`](skills/summarize/) | Local files (PDF/DOCX/PPTX) to Markdown plus optional summary; use `fetch_content` for URLs |
| [`uv`](skills/uv/) | uv project setup, build/publish, PEP-723 |
| [`diagnosing-bugs`](skills/diagnosing-bugs/) | Structured diagnosis loop for hard bugs and performance regressions |
| [`writing-for-agents`](skills/writing-for-agents/) | Writing skills, prompts and AGENTS.md for agents: context pointers, information hierarchy, pruning. `SETUP.md` maps where each document lives here (adapted from [mattpocock/skills](https://github.com/mattpocock/skills/tree/main/skills/productivity/writing-for-agents)) |
| [`web-browser`](skills/web-browser/) | Browser automation via CDP: accessibility-tree actions (`ax.js`), Obscura scraping, and `agent.mjs` to delegate a web task to a cheap inner agent |
| [`unslop`](skills/unslop/) | Cut AI tells from prose and add human voice; takes precedence over other style guidance |
| [`technical-writing`](skills/technical-writing/) | Formal doc standard (Diátaxis, Google style, STE, Global English) for docs/RFCs/PRs/commits; composes with `unslop` (source: [cursor/plugins](https://github.com/cursor/plugins/blob/main/pstack/skills/technical-writing/SKILL.md)) |
| [`statechart`](skills/statechart/) | `/statechart`: model a stateful system (flow, protocol, service) in TLA+, check it with TLC, draw a Mermaid statechart with the shortest path to each broken rule. Needs Node 22.18+/Bun/Deno; first run installs TLC and Java via mise. Vendored without upstream `scripts/test/` (source: [cursor/plugins](https://github.com/cursor/plugins/tree/main/pstack/skills/statechart), MIT) |
| [`youtube-transcript`](skills/youtube-transcript/) | Fetch timestamped YouTube video transcripts via `youtube-transcript-plus` (source: [badlogic/pi-skills](https://github.com/badlogic/pi-skills/tree/main/youtube-transcript)) |

See [`CREDITS.md`](CREDITS.md) for every third-party source and its license.

## Commands

Short commands linked into `~/.local/bin` by `install.sh`: every executable in [`bin/`](bin/), plus the skill scripts listed in `SKILL_CMDS`.

| Command | Purpose |
|---|---|
| [`amazon`](bin/amazon) | `amazon search <query> [--min --max --limit]` and `amazon product <asin-or-url>`: Amazon.in listings, specs and top reviews as JSON via Obscura (`AMAZON_DOMAIN` to switch market) |
| [`ci-wait`](bin/ci-wait) | Wait for a PR's checks, then print the failing job logs; exit 1 on failure |
| [`kite`](bin/kite) | Read-only Zerodha portfolio via the hosted Kite MCP server: `kite login`, `status`, `holdings`/`mf`/`positions`/`margins`, `ltp`/`quote`/`hist`/`search`, `snapshot`; order and GTT tools are refused (`--account NAME`, one login per day) |
| `slack` | [`skills/slack/scripts/slack.mjs`](skills/slack/scripts/slack.mjs) |
| `notion` | [`skills/notion/scripts/notion.js`](skills/notion/scripts/notion.js) |

## Prompts

Prompt templates (pi: `/name`, claude: `/name`). Source: [`prompts/`](prompts/).

| Prompt | Purpose |
|---|---|
| [`amazon-search.md`](prompts/amazon-search.md) | Search Amazon products, extract listings/reviews via DOM, recommend by requirements |
| [`create_a_skill.md`](prompts/create_a_skill.md) | Create new agent skills with proper structure and bundled resources |
| [`create_idea_compass.md`](prompts/create_idea_compass.md) | Organize and structure ideas by exploring definition, evidence, and related themes |
| [`create_micro_summary.md`](prompts/create_micro_summary.md) | Generate concise micro summaries of content |
| [`create_user_story.md`](prompts/create_user_story.md) | Write clear technical user stories formatted for all stakeholders |
| [`edit-article.md`](prompts/edit-article.md) | Edit/revise article drafts: restructure sections by dependency, tighten prose (source: [mattpocock/skills](https://github.com/mattpocock/skills/blob/main/skills/personal/edit-article/SKILL.md)) |
| [`extract_wisdom.md`](prompts/extract_wisdom.md) | Extract surprising and insightful information from text |
| [`security-audit.md`](prompts/security-audit.md) | Comprehensive security audit (OWASP, deps, secrets) |
| [`to-questionnaire.md`](prompts/to-questionnaire.md) | `/to-questionnaire` interviews you about recipient and needed answers, then writes a Markdown questionnaire for them to fill in (source: [mattpocock/skills](https://github.com/mattpocock/skills/blob/main/skills/productivity/to-questionnaire/SKILL.md)) |
| [`summarize-url.md`](prompts/summarize-url.md) | Fetch and summarize URLs (including HN posts + comments) |
| [`commit.md`](prompts/commit.md) | `/commit` slash command. Preloads `git status`/`diff`/`log` via `inline-bash` and delegates formatting to the `commit` skill |
| [`go.md`](prompts/go.md) | `/go` execute prompt that nudges the agent to follow Explore → Plan → Clarify → Execute |
| [`implement.md`](prompts/implement.md) | `/implement <task>` staged research, main-thread planning, implementation, and fresh-context review through `pi-subagent-manager` |

## Evals

Before/after skill-diet eval kits for `adr`, `notion` and `web-browser`. Source: [`evals/`](evals/).

## Symlink targets

| Source | Target |
|---|---|
| [`skills/*`](skills/) | `~/.agents/skills/*` |
| [`extensions/*.ts`](extensions/) | `~/.pi/agent/extensions/*.ts` |
| [`prompts/*.md`](prompts/) | `~/.pi/agent/prompts/*.md` |
| [`prompts/security-audit.md`](prompts/security-audit.md) | `~/.claude/commands/security/audit.md` |
| [`output-styles/*.md`](output-styles/) (except `SOURCES.md`) | `~/.claude/output-styles/*.md` |
| Selected skills (CC_SKILLS) | `~/.claude/skills/*` |
| Selected skills (PI_SKILLS) | `~/.pi/agent/skills/*` |

See [`AGENTS.md`](AGENTS.md) for conventions when adding new items.
