# Agent Stuff

Personal extensions, skills, and prompts for [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) and [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

## Install

```bash
./install.sh
```

Creates symlinks from `~/.agents/skills/`, `~/.pi/agent/extensions/`, `~/.pi/agent/prompts/`, and `~/.claude/commands/` into this repo. Re-run after adding new items. Existing non-symlink files are skipped.

## Layout

```
extensions/                  pi TypeScript extensions
  notify.ts                  OSC 777 desktop notification on turn end
  review.ts                  /review workflow (uncommitted | branch | commit | pr | folder)
  uv.ts                      Force Python tooling through uv

intercepted-commands/        PATH shims activated by uv.ts
  pip, pip3                  → uv add / uv run --with
  poetry                    → uv init / uv add / uv sync / uv run
  python, python3            → uv run --python

skills/                      Markdown instruction sets (SKILL.md per folder)
  architecture-decision-records/  ADR authoring
  browser-tools/             Chrome DevTools automation via CDP
  commit/                    Conventional Commit messages
  github/                    gh CLI (PRs, issues, runs, API)
  grill-me/                  Stress-test a plan via relentless questioning
  librarian/                 Cache + reuse remote git checkouts
  native-web-search/         Trigger native web search
  skill-creator/             Create / edit / eval skills
  summarize/                 URL/PDF/DOCX → Markdown + optional haiku summary
  uv/                        uv project setup, build/publish, PEP-723

prompts/                     Prompt templates (pi: /name, claude: /name)
  security-audit.md          Comprehensive security audit (OWASP, deps, secrets)
```

## Symlink Targets

| Source | Target |
|--------|--------|
| `skills/*` | `~/.agents/skills/*` |
| `extensions/*.ts` | `~/.pi/agent/extensions/*.ts` |
| `prompts/*.md` | `~/.pi/agent/prompts/*.md` |
| `prompts/security-audit.md` | `~/.claude/commands/security/audit.md` |
