---
name: github
description: "Interact with GitHub using the `gh` CLI. Use `gh issue`, `gh pr`, `gh run`, and `gh api` for issues, PRs, CI runs, and advanced queries. Includes pr-review.mjs, a wrapper for CodeRabbit/Copilot review-thread triage (list unresolved, reply, resolve, dashboard, wait)."
---

# GitHub Skill

Use the `gh` CLI to interact with GitHub. Always specify `--repo owner/repo` when not in a git directory, or use URLs directly.

## Review-thread triage: `scripts/pr-review.mjs`

Use this for the bot-review loop (CodeRabbit, Copilot). Plain `gh` cannot show thread
resolution state, so this wrapper drives the GraphQL `reviewThreads` API for you. It shells
out to `gh api`, so it reuses gh's auth and needs no token of its own. Repo and PR are
auto-detected from the current branch; override with `--repo owner/repo --pr N`.

```bash
S=~/.agents/skills/github/scripts/pr-review.mjs

# See only unresolved bot threads, numbered.
node "$S" threads --unresolved --bots

# Reply to thread #1 by its number and resolve it in one step.
node "$S" reply 1 "Fixed in abc1234 — clamped to >= 0." --resolve

# Long reply from a file (avoids shell-escaping the body).
node "$S" reply 2 --body-file /tmp/reply.md --resolve

# Resolve several threads, or every unresolved bot thread at once (retries transient failures).
node "$S" resolve 3 4
node "$S" resolve --bots

# One-shot dashboard: summary comments, formal reviews, inline count, checks.
node "$S" surfaces

# Block until CI settles, optionally until a fresh bot review lands.
node "$S" wait --for-bots --timeout 600
```

Thread numbers come from the last `threads` run (cached per repo+PR in the temp dir). Reply
and resolve also accept a raw `PRRT_...` thread id. `reply --comment <id>` posts through the
REST replies endpoint when you only have a comment id.

Run `node "$S" help` for the full flag list.

## Pull Requests

Check CI status on a PR:

```bash
gh pr checks 55 --repo owner/repo
```

List recent workflow runs:

```bash
gh run list --repo owner/repo --limit 10
```

View a run and see which steps failed:

```bash
gh run view <run-id> --repo owner/repo
```

View logs for failed steps only:

```bash
gh run view <run-id> --repo owner/repo --log-failed
```

## API for Advanced Queries

The `gh api` command is useful for accessing data not available through other subcommands.

Get PR with specific fields:

```bash
gh api repos/owner/repo/pulls/55 --jq '.title, .state, .user.login'
```

## JSON Output

Most commands support `--json` for structured output. You can use `--jq` to filter:

```bash
gh issue list --repo owner/repo --json number,title --jq '.[] | "\(.number): \(.title)"'
```
