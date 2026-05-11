# Agent-stuff

Personal extensions and skills for the [pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent).

## Layout

```text
extensions/            TypeScript extensions
  notify.ts            OSC 777 desktop notification on turn end
  review.ts            /review workflow (uncommitted | branch | commit | pr | folder)
  uv.ts                Force Python tooling through uv
intercepted-commands/  PATH shims activated by uv.ts (pip, poetry, python, …)
skills/                Markdown instruction sets
  commit/              Conventional Commit messages
  github/              `gh` CLI usage (PRs, runs, API)
  librarian/           Cache + reuse remote git checkouts
  uv/                  uv project setup, build/publish, PEP-723 scripts
```

## Extensions

- **notify.ts** — Native terminal notification when the agent awaits input. OSC 777, no deps, markdown→plain-text body.
- **review.ts** — `/review` interactive or direct: `uncommitted`, `branch <base>`, `commit <sha>`, `pr <n|url>`, `folder <paths…>`. Optional loop-fix mode, `/end-review` to return/summarize, auto-loads `REVIEW_GUIDELINES.md` from the project root (where `.pi` lives).
- **uv.ts** — Prepends `intercepted-commands/` to `$PATH` and blocks disallowed invocations at bash spawn time (catches bypasses like `.venv/bin/python -m pip …`), returning the uv equivalent. Pairs with `intercepted-commands/` and `skills/uv/`.

## Intercepted Commands

Shims that exit non-zero with a uv-equivalent hint:

- `pip`, `pip3` → `uv add` / `uv run --with PACKAGE`
- `poetry` → `uv init` / `uv add` / `uv sync` / `uv run`
- `python`, `python3` → blocks `-m pip|venv|py_compile`; otherwise transparently `exec uv run --python <real-interp> python "$@"` so `python foo.py` runs in a uv-managed env

`pip3`→`pip` and `python3`→`python` are symlinks. Auto-activated by `uv.ts`; prepend the dir to your shell `$PATH` to use outside pi.

## Usage

Copy extension files and skill folders into your pi locations and enable them in your pi config. See pi docs for exact paths.

## Notes

- Extensions: TypeScript, pi extension APIs.
- Skills: markdown with frontmatter, one folder per skill containing `SKILL.md`.
