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
| [`subscription-limits/`](extensions/subscription-limits/) | Claude and Codex quota badges on the footer path row; `/limits` shows account matching, all buckets, resets, and paid usage |
| [`multi-edit.ts`](extensions/multi-edit.ts) | Overrides built-in `edit` with multi-file `edits[]` and Codex `patch` support |
| [`review.ts`](extensions/review.ts) | `/review` workflow (uncommitted, branch, commit, PR, folder) |
| [`prompt-editor.ts`](extensions/prompt-editor.ts) | Named model+thinking presets, cross-session prompt history, low-battery indicator (`.pi/battery.json` / `PI_BATTERY_THRESHOLD` / `PI_BATTERY_DISABLE`) |
| [`session-name.ts`](extensions/session-name.ts) | `Ctrl+Shift+N` prefilled session rename dialog; mirrors the session name into the tmux window name (restores the prior name on quit) |
| [`tree-fast-summary.ts`](extensions/tree-fast-summary.ts) | Route `/tree` branch summarization through the `fast` mode in `modes.json` (project then global) instead of the main model, with a hard-coded fallback |
| [`titlebar-spinner.ts`](extensions/titlebar-spinner.ts) | Braille spinner in terminal title while agent works |
| [`notify.ts`](extensions/notify.ts) | Desktop notification on turn end, titled with the tmux target; clicking jumps back to the firing `session:window.pane` when `terminal-notifier` is installed, else plain OSC 777 |
| [`moshi-notify.ts`](extensions/moshi-notify.ts) | Push notification to [Moshi](https://getmoshi.app) iOS app on turn end via webhook, only when away from the desk — idle or screen locked (`MOSHI_API_TOKEN`, optional `MOSHI_UNIFIED=true`, `MOSHI_IDLE_SECONDS=300`, `MOSHI_NOTIFY=always\|never`) |
| [`snake.ts`](extensions/snake.ts) | `/snake` game |
| [`soul.ts`](extensions/soul.ts) | Durable agent identity (inspired by Nous Research's Hermes Agent): injects `~/.pi/agent/SOUL.md` (or a trusted project `.pi/SOUL.md`, which replaces it) at the top of the system prompt, ahead of pi's own identity. `/personality [name]` applies a session overlay on top of SOUL — 14 built-ins ship embedded, `~/.pi/agent/personalities/*.md` (and trusted project `.pi/personalities/*.md`) add/override by filename, selection persists in `soul-state.json`. `/soul [reload\|path]` inspects the active file. Auto-seeds SOUL.md + the built-in personality files on first run (never clobbers), reads once per session for prompt-cache stability, and skips subagent children (`PI_TMUX_SUBAGENT_CHILD`). Does not reach claude-bridge models (they use the `claude_code` preset) |
| [`uv.ts`](extensions/uv.ts) | Force Python tooling through `uv` |
| [`files.ts`](extensions/files.ts) | File tool tweaks |
| [`goal.ts`](extensions/goal.ts) | `/goal` long-running thread goal with token budget tracking |
| [`answer.ts`](extensions/answer.ts) | `/answer` and `ctrl+.` extract questions from assistant messages into interactive Q&A TUI |
| [`btw.ts`](extensions/btw.ts) | `/btw` side-chat popover that reuses the main conversation context; optional summary injection back into main chat on close (source: [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff)) |
| [`loop.ts`](extensions/loop.ts) | `/loop` runs follow-up prompts on `turn_end` until a breakout condition (tests pass / custom condition / agent-decides via `signal_loop_success` tool) (source: [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff)) |
| [`trust-github-repos.ts`](extensions/trust-github-repos.ts) | Auto-trust checkouts whose git origin is under `fueled`, `theskumar`, or `earendil-works` so `project_trust` never prompts for them (source: [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff), owner allowlist customized) |
| [`todos.ts`](extensions/todos.ts) | `/todos` visual todo manager backed by markdown files in `.pi/todos/` |
| [`no-sleep.ts`](extensions/no-sleep.ts) | Prevent macOS sleep via `caffeinate` while agent runs; `/no-sleep` toggle (source: [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff)) |
| [`inline-bash.ts`](extensions/inline-bash.ts) | Expand `!{cmd}` patterns in user prompts before they reach the agent (source: [earendil-works/pi examples](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/inline-bash.ts)) |
| [`split-fork.ts`](extensions/split-fork.ts) | `/split-fork [-d] [prompt]` forks the current session into a new pi process in a new tmux window or herdr tab (backend auto-detected; `-d` keeps focus here) (adapted from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff), Ghostty → tmux/herdr) |
| [`handoff.ts`](extensions/handoff.ts) | `/handoff <goal>` distills the session into a compact hot-state-first prompt and starts a fresh session seeded with it (`PI_HANDOFF_MODEL`, `PI_HANDOFF_MAX_TOKENS`; adapted from [hjanuschka/shitty-extensions](https://github.com/hjanuschka/shitty-extensions), tuned for mid-task continuation) |
| `npm:pi-subagent-manager` | Arnav Gupta’s hierarchical, steerable agent manager. Installed globally for trial; replaces the archived custom `subagent.ts`. See [trial notes](archive/subagents-2026-10-08/README.md). |
| `npm:pi-web-access` | Nico Bailon's web tools: `web_search`, `fetch_content`, `get_search_content`, `source_check`. Installed globally, pinned. Search runs through the ChatGPT login with Exa as fallback. Config: `~/.pi/agent/web-search.json`. Replaces the removed `codex-web-search.ts` and `ketch` skill. See [nicobailon/pi-web-access](https://github.com/nicobailon/pi-web-access). |
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
| [`mermaid`](skills/mermaid/) | Validate Mermaid diagrams via official CLI |
| [`notion`](skills/notion/) | Notion read/write pages as markdown via the official `ntn` CLI, plus a JS exec sandbox |
| [`pr-summary`](skills/pr-summary/) | Generate PR descriptions following project conventions from code diffs |
| [`sentry`](skills/sentry/) | Fetch and analyze Sentry issues, events, and logs |
| [`slack`](skills/slack/) | Read and search Slack (catchup, threads, users) and create editable drafts through the Claude.ai Slack connector, no bot token |
| [`summarize`](skills/summarize/) | Local files (PDF/DOCX/PPTX) to Markdown plus optional summary; use `fetch_content` for URLs |
| [`tmux`](skills/tmux/) | Remote control tmux sessions for interactive CLIs |
| [`uv`](skills/uv/) | uv project setup, build/publish, PEP-723 |
| [`diagnosing-bugs`](skills/diagnosing-bugs/) | Structured diagnosis loop for hard bugs and performance regressions |
| [`web-browser`](skills/web-browser/) | Browser automation via CDP: accessibility-tree actions (`ax.js`), Obscura scraping, and `agent.mjs` to delegate a web task to a cheap inner agent |
| [`unslop`](skills/unslop/) | Cut AI tells from prose and add human voice; takes precedence over other style guidance |
| [`technical-writing`](skills/technical-writing/) | Formal doc standard (Diátaxis, Google style, STE, Global English) for docs/RFCs/PRs/commits; composes with `unslop` (source: [cursor/plugins](https://github.com/cursor/plugins/blob/main/pstack/skills/technical-writing/SKILL.md)) |
| [`youtube-transcript`](skills/youtube-transcript/) | Fetch timestamped YouTube video transcripts via `youtube-transcript-plus` (source: [badlogic/pi-skills](https://github.com/badlogic/pi-skills/tree/main/youtube-transcript)) |

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
