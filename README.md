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
| [`review.ts`](extensions/review.ts) | `/review` workflow (uncommitted, branch, commit, PR, folder) |
| [`prompt-editor.ts`](extensions/prompt-editor.ts) | Named model+thinking presets, cross-session prompt history, low-battery indicator (`.pi/battery.json` / `PI_BATTERY_THRESHOLD` / `PI_BATTERY_DISABLE`) |
| [`tree-fast-summary.ts`](extensions/tree-fast-summary.ts) | Route `/tree` branch summarization through the `fast` mode in `modes.json` (project then global) instead of the main model, with a hard-coded fallback |
| [`titlebar-spinner.ts`](extensions/titlebar-spinner.ts) | Braille spinner in terminal title while agent works |
| [`notify.ts`](extensions/notify.ts) | OSC 777 desktop notification on turn end |
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
| [`inline-bash.ts`](extensions/inline-bash.ts) | Expand `!{cmd}` patterns in user prompts before they reach the agent (source: [earendil-works/pi examples](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/inline-bash.ts)) |
| [`split-fork.ts`](extensions/split-fork.ts) | `/split-fork [prompt]` forks the current session into a new pi process in a right-hand tmux split (adapted from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff), Ghostty → tmux) |
| [`subagents/`](extensions/subagents/) | `subagent` tool: delegate tasks to isolated `pi` subprocesses (single/parallel/chain), pinned to the `claude-bridge` provider by default; agent defs in [`agents/`](agents/) (adapted from [earendil-works/pi examples](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/subagent)) |

## Agents

Subagent definitions for the `subagents` extension. Source: [`agents/`](agents/), symlinked to `~/.pi/agent/agents/`. Frontmatter: `name`, `description`, `tools`, `model` (bare ids pinned to `claude-bridge`; use `provider/id` or `provider:` to override), `thinking`.

| Agent | Model | Purpose |
|---|---|---|
| [`scout.md`](agents/scout.md) | haiku-4-5 | Fast codebase recon, compressed handoff context |
| [`worker.md`](agents/worker.md) | sonnet-5 | General-purpose implementation, full tools |
| [`reviewer.md`](agents/reviewer.md) | sonnet-5 | Read-only code review |
| [`planner.md`](agents/planner.md) | opus-4-8 | Implementation plans (high thinking) |
| [`oracle.md`](agents/oracle.md) | fable-5 | Long-horizon complex work and decisions; costly, use sparingly |

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

## Skills

Markdown instruction sets (one `SKILL.md` per folder). Source: [`skills/`](skills/).

| Skill | Purpose |
|---|---|
| [`adr`](skills/adr/) | Architecture Decision Records |
| [`commit`](skills/commit/) | Conventional Commit messages |
| [`github`](skills/github/) | `gh` CLI (PRs, issues, runs, API) |
| [`google-workspace`](skills/google-workspace/) | Access Google Workspace APIs (Drive, Docs, Sheets, Calendar, Gmail, Chat, People) via OAuth |
| [`grill-me`](skills/grill-me/) | Stress-test a plan via relentless questioning |
| [`librarian`](skills/librarian/) | Cache and reuse remote git checkouts |
| [`mermaid`](skills/mermaid/) | Validate Mermaid diagrams via official CLI |
| [`native-web-search`](skills/native-web-search/) | Trigger native web search |
| [`notion`](skills/notion/) | Notion read/write pages as markdown via the official `ntn` CLI, plus a JS exec sandbox |
| [`pr-summary`](skills/pr-summary/) | Generate PR descriptions following project conventions from code diffs |
| [`sentry`](skills/sentry/) | Fetch and analyze Sentry issues, events, and logs |
| [`summarize`](skills/summarize/) | URL/PDF/DOCX to Markdown plus optional summary |
| [`tmux`](skills/tmux/) | Remote control tmux sessions for interactive CLIs |
| [`uv`](skills/uv/) | uv project setup, build/publish, PEP-723 |
| [`diagnosing-bugs`](skills/diagnosing-bugs/) | Structured diagnosis loop for hard bugs and performance regressions |
| [`web-browser`](skills/web-browser/) | Interactive browser automation via Chrome DevTools Protocol |

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
| [`humanize.md`](prompts/humanize.md) | Rewrite AI-generated text to sound natural and conversational |
| [`security-audit.md`](prompts/security-audit.md) | Comprehensive security audit (OWASP, deps, secrets) |
| [`summarize-url.md`](prompts/summarize-url.md) | Fetch and summarize URLs (including HN posts + comments) |
| [`commit.md`](prompts/commit.md) | `/commit` slash command. Preloads `git status`/`diff`/`log` via `inline-bash` and delegates formatting to the `commit` skill |
| [`go.md`](prompts/go.md) | `/go` execute prompt that nudges the agent to follow Explore → Plan → Clarify → Execute |
| [`implement.md`](prompts/implement.md) | `/implement <task>` subagent chain: scout → planner → worker (pi-only, needs `subagents` extension) |

## Symlink targets

| Source | Target |
|---|---|
| [`skills/*`](skills/) | `~/.agents/skills/*` |
| [`extensions/*.ts`](extensions/) | `~/.pi/agent/extensions/*.ts` |
| [`prompts/*.md`](prompts/) | `~/.pi/agent/prompts/*.md` |
| [`prompts/security-audit.md`](prompts/security-audit.md) | `~/.claude/commands/security/audit.md` |
| Selected skills (CC_SKILLS) | `~/.claude/skills/*` |
| Selected skills (PI_SKILLS) | `~/.pi/agent/skills/*` |

See [`AGENTS.md`](AGENTS.md) for conventions when adding new items.
