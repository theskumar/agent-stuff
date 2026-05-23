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

## Adding a new prompt

1. Place the `.md` file in `prompts/`.
2. Run `./install.sh` to symlink it to `~/.pi/agent/prompts/`.
3. Add a one-line entry in `README.md` under the `prompts/` section of the Layout block (if one exists).

## Conventions

- `install.sh` globs each directory, so new files are picked up automatically. Just re-run it.
- Never place files directly in the symlink targets (`~/.pi/agent/extensions/`, etc.). Always work in this repo.
- Match existing code style and README formatting when adding entries.
