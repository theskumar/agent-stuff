---
description: Create a Conventional Commits-style commit using the commit skill, with the git digest preloaded
argument-hint: "[files or instructions]"
allowedTools: Bash, Read
---

Create a git commit for the current changes. Follow the rules in `~/.agents/skills/commit/SKILL.md` (Conventional Commits subject, optional body, no sign-off, no push). Treat `$ARGUMENTS` as additional guidance: file paths/globs narrow what to stage, freeform text shapes scope/summary/body. If `$ARGUMENTS` is empty, commit all current changes.

User arguments: $ARGUMENTS

## Preloaded digest

The following sections were captured at prompt time via `inline-bash`. Prefer this digest over re-running `git status`/`git diff`/`git log` unless it looks empty, truncated (60KB cap on the diff), or contradicts the user's request.

### Branch + status (`git status --porcelain=v1 -uall -b`)

```
!{git status --porcelain=v1 -uall -b 2>&1}
```

### Change summary (`git diff --stat HEAD`)

```
!{git diff --stat HEAD 2>&1 || true}
```

### Full diff vs HEAD, capped at 60KB (`git diff HEAD | head -c 60000`)

```diff
!{git diff HEAD 2>/dev/null | head -c 60000}
```

### Recent commit subjects (`git log -n 30 --pretty=format:%s`)

```
!{git log -n 30 --pretty=format:%s 2>/dev/null || echo '(no commits yet)'}
```

## Procedure

1. If the status section shows no changes, stop and tell the user there is nothing to commit.
2. If the diff section looks truncated (ends mid-hunk near the 60KB mark) and a precise message requires the rest, re-run `git diff HEAD -- <path>` for the specific files involved instead of dumping the whole diff again.
3. If `$ARGUMENTS` specifies files, stage only those (`git add -- <paths>`). Otherwise stage all changes (`git add -A`).
4. Compose the subject `<type>(<scope>): <summary>` (<= 72 chars, imperative, no trailing period). Add a short body only if the change is non-obvious from the diff.
5. Run `git commit -m "<subject>"` (and `-m "<body>"` if a body is warranted). Do not push. Do not add sign-offs or breaking-change footers.
6. If any files in the status section are ambiguous (e.g. unrelated untracked artifacts), ask the user before staging instead of guessing.
