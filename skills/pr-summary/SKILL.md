---
name: pr-summary
description: Use when drafting a pull request description or filling in the repo's PULL_REQUEST_TEMPLATE for copa-backend. Produces a Summary + Test plan body that matches the project's established PR conventions.
---

# PR Summary

State facts from what you changed. Don't expand scope beyond the diff. If you don't know why something was needed, ask the user. Never fabricate motivation.

If you can't write a confident summary for any section, ask the user before drafting. A question is better than a guess.

## Title

Conventional commit. Lowercase scope. Under 70 chars. No period.

```
feat(subscriptions): revoke access on account deletion
fix(cabinet): make autocomplete case-insensitive
chore(docker): make app port configurable
```

## Body structure

Three sections, in this order:

1. **Context**: why this change is needed (the problem, ticket, or constraint that motivated it)
2. **Summary**: what was done (behavioral changes, not file names)
3. **How to test** *(optional)*: numbered steps a reviewer follows against a running app to verify the change. Use your judgment — include it when the change has observable runtime behavior a reviewer can exercise (API endpoints, commands, UI flows). Omit it when there's nothing meaningful to manually verify (e.g. pure refactors, docs, dependency bumps, changes fully covered by automated tests).

## Creating the PR

Do **not** pass the body via a heredoc or inline `--body "..."` — markdown bodies contain parentheses, backticks, and quotes that break shell quoting. Write the body to a temp file and use `--body-file`:

```bash
# write the body with your editor/Write tool to a temp file, e.g. /tmp/pr_body.md
gh pr create --base main --head <branch> \
  --title "<conventional-commit title>" \
  --body-file /tmp/pr_body.md
```

## Examples

**fix with Linear ID:**

```markdown
All-uppercase cabinet search queries returned no results, even though the
SQL layer used ILIKE (case-insensitive). Reported in CPA-329.

## Summary

- The rapidfuzz re-ranking step was case-sensitive, discarding valid ILIKE
  matches when the query was uppercase.
- Fix: pass `processor=fuzz_utils.default_process` to `process.extract`.

## How to test

1. `GET /api/cabinet/autocomplete/?q=TYLENOL`
2. Verify results include "Tylenol" variants (previously returned empty)
3. Compare with `GET /api/cabinet/autocomplete/?q=tylenol`, confirm same results

Closes CPA-329
```

**chore/infra:**

```markdown
Running multiple worktrees with `docker compose up` caused port collisions
because the app port was hardcoded to 8000.

## Summary

- App host port now configurable via `APP_PORT` (defaults to 8000).
- db and valkey switched from `ports` to `expose`, avoiding host collisions.

## How to test

1. `APP_PORT=9001 docker compose up`
2. `curl localhost:9001/-/alive/` returns ok
3. Start a second worktree with `APP_PORT=9002`, confirm both run without conflicts
```
