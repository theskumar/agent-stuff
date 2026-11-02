---
disable-model-invocation: true
name: linear
description: "Drive Linear from the linear-pp-cli binary: read/search issues, create/edit with labels+states+parents, comments, project updates, plus offline-synced analytics (today, bottleneck, stale, velocity, slipped, burndown, cycles compare, initiatives health, milestones at-risk)."
allowed-tools: "Read Bash"
---

# Linear (linear-pp-cli)

Drives the `linear-pp-cli` binary (Go, offline SQLite store + FTS5 search, agent-native). Use for Linear reads, writes, dedup search, and cross-entity analytics.

Binary: `~/.local/bin/linear-pp-cli` (version `2026.9.2`). Auth is already saved to `~/.config/linear-pp-cli/config.toml`, so commands work with no env var.

## Agent contract (read first)

- **Always add `--agent`** unless a human wants a table. It expands to `--json --compact --no-input --no-color --yes`.
- **`--select` narrows output** with dotted, array-traversing paths. Keep payloads small: `--select identifier,title,state.name,labels.nodes.name,url`. Omitted fields are not absent from the issue, just unrequested.
- **Read several issues in one call**: `issues CSL-385,CSL-386 --agent`. Order preserved, dupes removed; a missing member fails the whole read.
- **`--data-source live|local|auto`** controls where reads come from. Use `live` for closeout/state/description checks where current truth matters; `local` in tight loops to save API budget (~1500 complexity points/hour on personal keys).
- **Errors are JSON too** under `--agent`: `{"error":"...","code":3,"type":"not_found"}`. Piping stdout to a parser is always safe. Exit codes below.
- **Never put Markdown/newlines/backticks/`$()`/media on the shell line.** Write the body to a file and use `--*-file` / `--*-stdin` / `--media`.
- **Name resolution**: `--label`/`--project`/`--state` are UUID-only; use `--label-name`/`--project-name`/`--state-name`/`--state-type` to pass human names (resolved live at write time, even under `--dry-run`).
- **Preview writes** with `--dry-run`.

## Reads

```bash
linear-pp-cli me --agent                                   # authed user
linear-pp-cli teams list --agent --select id,key,name      # team keys
linear-pp-cli issues CSL-385 --agent --data-source live \
  --select identifier,title,description,state.name,labels.nodes.name,url
linear-pp-cli issues list --assignee me --state started --agent --select identifier,title,state.name
linear-pp-cli issues search "login redirect bug" --team CSL --limit 5 --agent   # dedup check (FTS5, freshness-gated)
linear-pp-cli comments list CSL-385 --agent
linear-pp-cli labels list --team CSL --agent --select id,name,global,team.key
linear-pp-cli workflow-states list --team CSL --agent --select id,name,type     # alias: states list
linear-pp-cli projects search "Backend Platform" --team CSL --agent --select id,name,url
linear-pp-cli documents my-runbook-f7f48ab36080 --agent --select title,updatedAt,content
```

Use `issues search` (not `similar`) for "does this ticket already exist" checks: it refreshes stale local data behind a lock or fails visibly, instead of serving stale results.

## Writes

```bash
# create (records ticket in local pp_created ledger)
linear-pp-cli issues create --team CSL --title "Title" \
  --description-file /tmp/body.md --agent
linear-pp-cli issues create --team CSL --title "Child" --parent CSL-385 \
  --state-name "In Progress" --label-name "kind:bug" --agent

# edit
linear-pp-cli issues edit CSL-385 --state-name "In Progress" --agent
linear-pp-cli issues edit CSL-385 --parent CSL-380 --agent      # or --no-parent to clear
linear-pp-cli issues edit CSL-385 --project-name "Backend Platform" --agent
linear-pp-cli issues edit CSL-385 --description-file /tmp/body.md --media /tmp/shot.png --agent

# comments (body via file/stdin; --media appends embeds)
linear-pp-cli comments add --issue CSL-385 --body-file /tmp/comment.md --agent
linear-pp-cli comments add --issue CSL-385 --body-stdin --agent < notes.md

# project updates (status posts)
linear-pp-cli project-updates create --project-name "Backend Platform" \
  --body-file /tmp/update.md --health onTrack --agent
```

Priority: `--priority 0..4` (0 none, 1 urgent, 2 high, 3 medium, 4 low).

State transitions: use `--state-name "In Progress"` / `--state-type started`, or look up the UUID via `workflow-states list --team CSL` and pass `--state <uuid>`. `--state-type started` errors if the team has several `started` states.

Labels: `--label` is UUID-only; `--label-name "kind:bug"` resolves an exact team-owned or workspace-global name. The CLI preflights ownership and refuses cross-team labels before mutating.

### Safe agent writes

Every `issues create` is tagged with a session (default: timestamp, override `--pp-session <tag>` or `PP_SESSION`). Clean up only what this CLI made:

```bash
linear-pp-cli pp-test list --session current --agent
linear-pp-cli pp-cleanup --session current
```

`--trust-mode strict` refuses mutating any issue not in the local `pp_created` ledger — a hard floor against polluting a real workspace.

## Analytics (need `sync` first)

These compute joins/aggregations over the local SQLite store — no single API call returns them, so `--data-source` is ignored. Run `linear-pp-cli sync` once (batched pull) before using, and re-sync every ~30 min in long sessions.

```bash
linear-pp-cli sync
linear-pp-cli today --agent --select identifier,title,state.name,cycle.endsAt,priority   # ranked queue across all teams
linear-pp-cli blocking --agent                              # issues you're blocking, by downstream impact
linear-pp-cli bottleneck --team CSL --json                  # per-assignee load + blocked issues
linear-pp-cli stale --days 30 --team CSL --agent --select identifier,title,assignee.name,updatedAt
linear-pp-cli velocity --weeks 8 --json                     # completion trend
linear-pp-cli slipped --team CSL --json                     # carryover from last cycle
linear-pp-cli cycles compare current previous --json \
  --select completionPct,scopeAdded,scopeCut,carryover,meanCycleTimeHours
linear-pp-cli projects burndown <project-uuid> --weeks 8 --json   # projected landing date
linear-pp-cli initiatives health --json                     # portfolio rollup
linear-pp-cli milestones at-risk --json                     # milestones past target, by slip
```

Cold store prints `(no <resource> ... run 'sync')` to stderr; stale store prints an age hint to stderr (JSON stdout stays clean).

## Finding a command

```bash
linear-pp-cli which "set issue parent" --agent      # NL -> best command; exit 2 = no confident match
linear-pp-cli <group> --help                         # drill into flags
linear-pp-cli doctor                                 # verify auth, API, store health
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 2 | Usage error |
| 3 | Not found |
| 4 | Auth required |
| 5 | API error (upstream) |
| 7 | Rate limited (wait, retry) |
| 10 | Config error |

## Error playbook

```bash
# auth broken -> re-save key (source of truth: ~/.config/linear/api-key)
linear-pp-cli auth set-token "$(cat ~/.config/linear/api-key)"
linear-pp-cli auth status          # or: linear-pp-cli doctor

# binary missing / rebuild from source (Go auto-fetches the 1.26 toolchain)
go install github.com/mvanhorn/printing-press-library/library/project-management/linear/cmd/linear-pp-cli@latest

# analytics returns empty -> run: linear-pp-cli sync
```

Upstream: `github.com/mvanhorn/printing-press-library` under `library/project-management/linear` (Apache-2.0, Matt Van Horn). Full reference lives in that repo's `SKILL.md` / `README.md`.
