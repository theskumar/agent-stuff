---
name: librarian
description: "Get a stable, up-to-date local checkout of a remote git repository (GitHub/GitLab/Bitbucket URLs, git@... SSH, or owner/repo shorthand) so it can be read, grepped, and analyzed without repeated clones. Use this skill whenever the user points to a remote git repo as reference, pastes a repo URL, mentions a repo by owner/repo, or whenever you would otherwise run a one-off `git clone` into a temp directory. Reuses a shared cache at ~/.cache/checkouts/<host>/<org>/<repo> across turns and sessions."
---

Resolve a remote git repository to a local path, cloning on first use and refreshing on later use.

## Usage

Call the bundled script by its absolute path inside this skill. Substitute the skill's real location for `<SKILL_DIR>` (the directory containing this SKILL.md):

```bash
bash <SKILL_DIR>/checkout.sh <repo> --path-only
```

`<repo>` accepts any of: `owner/repo` (defaults to github.com), `host/org/repo`, full HTTPS/SSH URLs, and deep links like `https://github.com/<org>/<repo>/tree/main/...` (the script trims to `org/repo`).

The script clones with `--filter=blob:none` on first use, reuses the existing checkout otherwise, fetches when the cache is older than 5 minutes, and fast-forwards when the working tree is clean and tracking an upstream. Output is the absolute path of the checkout.

## Cache layout

`~/.cache/checkouts/<host>/<org>/<repo>` — e.g. `theskumar/python-dotenv` → `~/.cache/checkouts/github.com/theskumar/python-dotenv`.

## Flags worth knowing

- `--force-update` — fetch and try to fast-forward even within the 5-minute throttle window.
- `--update-interval <secs>` — override the throttle.

## Workflow

1. Call `checkout.sh <repo> --path-only` and capture the path.
2. Read, grep, and analyze inside that path.
3. On later references to the same repo, call it again — it will reuse and refresh the same checkout.

Avoid editing inside the shared cache. If changes are needed, copy the checkout or create a git worktree elsewhere first.
