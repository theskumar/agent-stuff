# Agent-stuff

Personal add-ons for the [pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent):

- Custom **extensions** (TypeScript)
- Reusable **skills** (markdown instructions)

## Repository Structure

```text
.
├── extensions/
│   ├── notify.ts
│   └── review.ts
└── skills/
    ├── commit/
    │   └── SKILL.md
    └── github/
        └── SKILL.md
```

## Included Extensions

### `extensions/notify.ts`

Desktop notification extension that sends a native terminal notification when the agent finishes a turn and is waiting for input.

- Uses OSC 777 escape sequence
- No external runtime dependencies
- Best effort markdown-to-plain-text formatting for notification body

### `extensions/review.ts`

A full `/review` workflow extension for reviewing code changes from inside pi.

Features:

- `/review` interactive mode
- Direct commands:
  - `/review uncommitted`
  - `/review branch <base-branch>`
  - `/review commit <sha>`
  - `/review pr <number-or-url>`
  - `/review folder <paths...>`
- Optional shared custom review instructions
- Optional “loop fixing” mode (iterate review → fix until no blocking findings)
- `/end-review` command to return to origin and optionally summarize/apply fixes
- Auto-loads `REVIEW_GUIDELINES.md` from project root (where `.pi` exists)

## Included Skills

### `skills/commit/SKILL.md`

Guidance for creating concise Conventional Commit messages and making safe commits.

### `skills/github/SKILL.md`

Guidance for using `gh` CLI for PR checks, workflow runs, and GitHub API queries.

## Using This Repo

This repo is intended as a source of reusable files. Typical usage:

1. Copy extension files into your pi extensions location.
2. Copy skill folders into your pi skills location.
3. Enable/load them in your pi configuration.

> Exact paths/config can vary by setup. If needed, see pi docs for extension and skill loading.

## Development Notes

- Extensions are written in TypeScript and target pi extension APIs.
- Skills are plain markdown files with frontmatter.
- Keep each skill in its own folder with `SKILL.md`.

## License

No license file is currently included.
