---
disable-model-invocation: true
name: codemagic
description: "Codemagic CI from a Node script: list apps and builds, trigger, watch, cancel, read step logs, download artifacts."
---

Run every command as `node ~/.agents/skills/codemagic/scripts/codemagic.cjs <command>`. Run it with no arguments for the full flag list.

| Command | Use |
|---|---|
| `apps` | App ids, names, repos, workflow names |
| `app <appId>` | Full app object: workflow ids, branches |
| `builds` | Recent builds. Filter with `--app`, `--workflow`, `--branch`, `--tag`, `--limit` (default 10) |
| `build <buildId>` | Build summary. `--full` prints the raw object |
| `logs <buildId>` | Step list, then the last 200 lines of each failed step. `--step <name>`, `--all`, `--tail N` (0 for all) |
| `trigger --app A --workflow W` | Start a build. `--branch`, `--tag`, `--input K=V`, `--var K=V`, `--label L` (repeatable). Prints buildId and URL |
| `watch <buildId>` | Poll until done. Exit 0 only when status is `finished`. `--interval` (30 s), `--timeout` (3600 s) |
| `cancel <buildId>` | Cancel a running build |
| `artifacts <buildId>` / `download <buildId>` | List or download artifacts. `--name` substring, `--dir` |
| `api <METHOD> <path>` | Any other endpoint, with `--data '{...}'` for a body |

Terminal statuses: `finished` (success), `failed`, `canceled`, `timeout`, `warning`, `skipped`. Every other status is still running.

## Rules

- Find ids with `apps`, then `app <appId>`. For a repo with `codemagic.yaml`, the workflow id is the workflow's key in that file (for example `rosey-fix`). For an app set up in the Codemagic UI, use the workflow `_id` from `app <appId>`.
- Pass `codemagic.yaml` `inputs:` with `--input` and environment variables with `--var`.
- To find why a build failed, run `logs <buildId>` and quote the failing lines.
- `trigger`, `cancel` and non-GET `api` calls change real builds and app settings. Run them when the user asked for that action. Ask first when the action is your own idea, or when it changes app settings or variables.
- `watch` can run for an hour. Set the bash timeout above `--timeout`, or run it in the background.

## If a command fails

If it reports no token or HTTP 401/403, ask the user to set `CODEMAGIC_API_TOKEN` or write the token to `~/.config/codemagic/api-token` (Codemagic → Teams → Integrations → Codemagic API).
