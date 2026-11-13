---
disable-model-invocation: true
name: atlassian
description: "Jira Cloud through Atlassian's acli CLI: search, view, create, edit, transition and comment on work items, plus boards, sprints and projects."
---

Run Jira tasks with `acli jira`.
To find a command or its flags, run `acli jira <group> --help` (groups: workitem, board, sprint, project, filter, field, auth).
For output you parse, add `--json`.

## Before a write

Before you create, edit, transition, comment on, assign, link or delete a work item, show the user the exact change and wait for a yes.

## Search

- Add `--limit N`, `--paginate` or `--count` to every `workitem search`. Search fails without one.
- To get a board's items, filter by its project: `project = KEY`. JQL has no `board` field. To find the project, run `acli jira board view --id <ID> --json` and read its location.
- To find a project's boards, run `acli jira board search --project KEY`.
- Read status names from `workitem view <KEY>` or a search before you filter by status. Each workspace names its own.
- `text ~ "term"` matches loosely across summary, description and comments. Check each hit's summary before you report it.

## If acli fails

If `acli` is missing, run `brew tap atlassian/homebrew-acli && brew install acli`.
If auth fails, run `acli jira auth status`, then ask the user to run `acli jira auth login --web`.
