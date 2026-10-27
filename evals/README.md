# Skill evals

Before/after eval kits from the [skill-diet](https://www.npmjs.com/package/skill-diet) runs on 2026-10-27. Reuse them for the next diet of the same skill. Run outputs are not kept.

| Folder | Skill | Contents |
| --- | --- | --- |
| `adr/` | `skills/adr` | `tasks.json`, fixture repos, blind-judge scripts, cut-content cases |
| `notion/` | `skills/notion` | `tasks.json`, logging `ntn` stub, session-log counter, coverage check |
| `web-browser/` | `skills/web-browser` | `tasks.json`, script stubs, `sandbox.sb`, session-log counter, cut-content cases |

Each folder has the `report.md` and score table from its run.

## Rerun an eval

The kits ran from `/tmp/skill-diet-work/<skill>/`, and some scripts still use that path.

1. Copy a kit to `/tmp/skill-diet-work/<skill>/`.
2. Put the old and new skill folders at `sk/before/<skill>/` and `sk/after/<skill>/`. Use `git show` or `git worktree` to get the old version.
3. Run `node <skill-diet>/scripts/eval.mjs run <dir> --versions before,after,none --model openai/gpt-6-luna`.
4. Run `node <skill-diet>/scripts/eval.mjs score <dir>`.

The adapters run `pi` under `sandbox-exec`, so eval sessions cannot read the installed skills in `~/.agents/skills`.
