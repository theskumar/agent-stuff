# Agents

This repo stores pi extensions, skills, and prompts. Everything is symlinked into place by `install.sh`.

## Adding a new extension

1. Place the `.ts` file in `extensions/`.
2. Run `./install.sh` to symlink it to `~/.pi/agent/extensions/`.
3. Add a one-line entry in `README.md` under the `extensions/` section of the Layout block.

## Adding a new skill

1. Create a folder under `skills/` with a `SKILL.md` inside it.
2. Run `./install.sh` to symlink it to `~/.agents/skills/`.
3. Add a one-line entry in `README.md` under the `skills/` section of the Layout block.
4. If the skill should also be available in Claude Code, add its name to the `CC_SKILLS` array in `install.sh`.

## Adding a new agent

1. Place the `.md` file in `agents/` (frontmatter: `name`, `description`, optional `tools`, `model`, `provider`, `thinking`).
2. Run `./install.sh` to symlink it to `~/.pi/agent/agents/`.
3. Add a row in `README.md` under the Agents section.

## Adding a new prompt

1. Place the `.md` file in `prompts/`.
2. Run `./install.sh` to symlink it to `~/.pi/agent/prompts/`.
3. Add a one-line entry in `README.md` under the `prompts/` section of the Layout block (if one exists).

## Conventions

- `install.sh` globs each directory, so new files are picked up automatically. Just re-run it.
- Never place files directly in the symlink targets (`~/.pi/agent/extensions/`, etc.). Always work in this repo.
- Match existing code style and README formatting when adding entries.
- After modifying any files under `extensions/`, run `npm run fix` to apply Biome lint and formatting fixes before considering the task done.

## Extension authoring lessons

- Built-in tool factories (`createEditToolDefinition`, `withFileMutationQueue`, etc.) are public exports of `@earendil-works/pi-coding-agent`. Compose with them instead of vendoring BOM/line-ending/diff helpers, which are not exported.
- An extension that calls `registerTool({ name: "edit" })` overrides the built-in.
- `renderShell: "self"` plus `renderCall` / `renderResult` are available to extensions. Delegating to the built-in's renderers (after normalizing args back to the built-in shape) preserves the live TUI diff preview.
- Pi loads extensions through jiti with package aliases set up in `core/extensions/loader.js`. A standalone smoke test will fail with `Cannot find module '@earendil-works/pi-coding-agent'` unless it runs from `~/.pi/agent/npm/` and replicates those aliases.
- Bare model ids like `claude-sonnet-5` are ambiguous across providers (bedrock, anthropic, and claude-bridge all register them). Pass `provider/id` (e.g. `claude-bridge/claude-sonnet-5`) when spawning `pi` subprocesses. Child `pi` processes load global `settings.json` packages, so claude-bridge is available in them automatically.
- claude-bridge replaces pi's system prompt with the `claude_code` preset, so extension prompt customizations (`promptGuidelines`, `before_agent_start` appends) never reach bridge models. It forwards only tool descriptions plus one AGENTS.md — nearest in cwd ancestors, falling back to `~/.pi/agent/AGENTS.md` — sanitized (bare `pi` → "environment") under `# CLAUDE.md`. Cross-provider prompt nudges therefore live in [`agent/AGENTS.md`](agent/AGENTS.md); keep the bare word "pi" out of it, and remember a project-local AGENTS.md shadows the global one.
