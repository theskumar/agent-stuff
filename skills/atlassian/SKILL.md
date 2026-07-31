---
name: atlassian
description: "Access Jira (and other Atlassian Cloud products) via Atlassian's official `acli` CLI — auth, projects, boards, work items, JQL search. No custom API wrapper; wraps the first-party binary."
---

# Atlassian (acli)

Use this skill for Jira Cloud tasks: view/search/create/update work items, boards, projects, sprints. Wraps Atlassian's official `acli` binary — no custom scripts, no API tokens to manage in code.

## Architecture

Official Atlassian CLI (`acli`), Go binary, installed via Homebrew tap. Talks to Jira Cloud REST/Agile APIs under the hood; auth is handled by `acli` itself (oauth or API token), not by this skill.

## Prerequisites

1. Install:
   ```bash
   brew tap atlassian/homebrew-acli
   brew install acli
   ```
   (First install: `brew trust atlassian/acli` if the tap is flagged untrusted.)

2. Authenticate (per Atlassian site — one login covers all projects on that site):
   ```bash
   # OAuth (browser) — simplest for interactive use
   acli jira auth login --web

   # API token — better for CI/scripted use
   echo "<token>" | acli jira auth login --site "yoursite.atlassian.net" --email "you@company.com" --token
   ```
   Token generation: https://id.atlassian.com/manage-profile/security/api-tokens

3. Check auth status:
   ```bash
   acli jira auth status
   ```

## CLI

```bash
acli jira auth status                                                # check auth
acli jira project list --recent                                       # list recent projects
acli jira board search --project <KEY>                                # find boards for a project
acli jira board view --id <BOARD_ID> --json                           # board details
acli jira workitem view <KEY>                                          # view single issue
acli jira workitem search --jql "project = <KEY>" --paginate           # JQL search
acli jira workitem search --jql "..." --fields "key,summary,status"    # custom fields
acli jira workitem create --project <KEY> --type Task --summary "..."  # create
```

### Commands

| Command | Description |
|---|---|
| `auth login` / `auth status` | Authenticate (oauth or token) / check current auth |
| `project list --recent \| --limit N` | List projects |
| `board search --project <KEY>` | Find boards belonging to a project |
| `board view --id <ID> --json` | Board metadata (name, type, linked project) |
| `workitem view <KEY>` | Full issue details |
| `workitem search --jql "<JQL>"` | JQL search; requires `--limit`, `--paginate`, or `--count` |
| `workitem create` | Create issue. Flags: `--project`, `--type`, `--summary`, `--description` |
| `workitem search --web` | Open search results in browser instead of terminal |

### Output flags (apply broadly)
- `--json` — machine-readable output
- `--csv` — spreadsheet-friendly
- `-f/--fields` — control which columns/fields render
- `--paginate` — fetch all pages (JQL search requires one of `--limit`/`--paginate`/`--count`)

## Agent guidance

1. **Kanban boards have no separate JQL filter** — a board's issues are usually just `project = <KEY>` (verify with `board view --id <ID> --json`, check `location`/linked project). Don't assume `board = <ID>` works in JQL — it often errors with "field does not exist".
2. **Narrow text search** → `workitem search --jql "project = KEY AND text ~ \"term\""`. Note `text ~` does partial/fuzzy matches across summary+description+comments — expect noise, filter results by eyeballing summaries.
3. **Find a project's boards** → `acli jira board search --project KEY` before guessing a board ID.
4. **Status/workflow names are workspace-specific** — check via `workitem view <KEY>` or a search before filtering by status string.
5. **Auth errors** → run `acli jira auth status`; if not authenticated or oauth expired, re-run `acli jira auth login --web`.

## Error playbook

```bash
# Not authenticated / oauth expired
acli jira auth login --web

# "field 'board' does not exist or you do not have permission to view it"
# JQL has no generic `board` field for kanban boards — filter by project instead,
# or check board view --json for its linked project/filter.

# JQL search with no --limit/--paginate/--count
acli jira workitem search --jql "..." --paginate     # or --limit 50, or --count

# Untrusted tap on install
brew trust atlassian/acli
```
