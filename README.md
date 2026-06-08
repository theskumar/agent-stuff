# Agent Stuff

Personal extensions, skills, and prompts for [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) and [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

## Install

```bash
./install.sh
```

Creates symlinks from `~/.agents/skills/`, `~/.pi/agent/extensions/`, `~/.pi/agent/prompts/`, and `~/.claude/commands/` into this repo. Re-run after adding new items. Existing non-symlink files are skipped.

## Extensions

pi TypeScript extensions. Source: [`extensions/`](extensions/).

| Extension | Purpose |
|---|---|
| [`multi-edit.ts`](extensions/multi-edit.ts) | Overrides built-in `edit` with multi-file `edits[]` and Codex `patch` support |
| [`review.ts`](extensions/review.ts) | `/review` workflow (uncommitted, branch, commit, PR, folder) |
| [`prompt-editor.ts`](extensions/prompt-editor.ts) | Named model+thinking presets, cross-session prompt history |
| [`titlebar-spinner.ts`](extensions/titlebar-spinner.ts) | Braille spinner in terminal title while agent works |
| [`notify.ts`](extensions/notify.ts) | OSC 777 desktop notification on turn end |
| [`snake.ts`](extensions/snake.ts) | `/snake` game |
| [`uv.ts`](extensions/uv.ts) | Force Python tooling through `uv` |
| [`files.ts`](extensions/files.ts) | File tool tweaks |
| [`goal.ts`](extensions/goal.ts) | `/goal` long-running thread goal with token budget tracking |
| [`answer.ts`](extensions/answer.ts) | `/answer` and `ctrl+.` extract questions from assistant messages into interactive Q&A TUI |
| [`todos.ts`](extensions/todos.ts) | `/todos` visual todo manager backed by markdown files in `.pi/todos/` |

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
| [`browser-tools`](skills/browser-tools/) | Chrome DevTools automation via CDP |
| [`commit`](skills/commit/) | Conventional Commit messages |
| [`github`](skills/github/) | `gh` CLI (PRs, issues, runs, API) |
| [`grill-me`](skills/grill-me/) | Stress-test a plan via relentless questioning |
| [`mermaid`](skills/mermaid/) | Validate Mermaid diagrams via official CLI |
| [`librarian`](skills/librarian/) | Cache and reuse remote git checkouts |
| [`native-web-search`](skills/native-web-search/) | Trigger native web search |
| [`notion`](skills/notion/) | Notion read/write pages as markdown via the official `ntn` CLI, plus a JS exec sandbox |
| [`sentry`](skills/sentry/) | Fetch and analyze Sentry issues, events, and logs |
| [`summarize`](skills/summarize/) | URL/PDF/DOCX to Markdown plus optional summary |
| [`tmux`](skills/tmux/) | Remote control tmux sessions for interactive CLIs |
| [`uv`](skills/uv/) | uv project setup, build/publish, PEP-723 |

## Prompts

Prompt templates (pi: `/name`, claude: `/name`). Source: [`prompts/`](prompts/).

| Prompt | Purpose |
|---|---|
| [`security-audit.md`](prompts/security-audit.md) | Comprehensive security audit (OWASP, deps, secrets) |

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
