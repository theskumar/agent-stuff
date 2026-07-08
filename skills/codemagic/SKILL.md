---
name: codemagic
description: "Trigger, monitor, cancel Codemagic CI builds and download artifacts — gh-cli-style. Wraps Codemagic's REST API via a Node.js script, no external deps."
---

# Codemagic

Use this skill for Codemagic CI tasks: list apps/builds, trigger builds, watch build status, cancel builds, fetch artifacts.

## Architecture

Pure Node.js (stdlib only) wrapper over Codemagic's REST API (`https://api.codemagic.io`). Zero npm deps. Requires `node` on PATH.

## Prerequisites

1. Get an API token in Codemagic UI:
   **Teams → Personal Account (or team) → Integrations → Codemagic API → Show**

2. Store the token (pick one):
   ```bash
   # Option A: env var (add to shell profile)
   export CODEMAGIC_API_TOKEN="..."

   # Option B: file
   mkdir -p ~/.config/codemagic
   echo "..." > ~/.config/codemagic/api-token
   chmod 600 ~/.config/codemagic/api-token
   ```

## CLI

```bash
node scripts/codemagic.cjs apps                                    # list apps
node scripts/codemagic.cjs app <appId>                             # app details, workflow ids
node scripts/codemagic.cjs builds --app <appId> --limit 5          # recent builds
node scripts/codemagic.cjs build <buildId>                         # build summary (--full for raw)
node scripts/codemagic.cjs trigger --app <appId> --workflow rosey-fix \
  --branch develop --input linear_ticket_id=ABC-123               # start build
node scripts/codemagic.cjs watch <buildId> --interval 30           # poll until done
node scripts/codemagic.cjs cancel <buildId>                        # cancel build
node scripts/codemagic.cjs artifacts <buildId>                     # list artifacts
node scripts/codemagic.cjs download <buildId> --name .apk --dir /tmp  # download artifacts
node scripts/codemagic.cjs api GET /apps                           # raw API escape hatch
```

### Commands

| Command | Description |
|---|---|
| `apps` | List apps: id, name, repo, workflow names |
| `app <appId>` | Full app object — use to find workflow ids and branches |
| `builds` | Recent builds. Flags: `--app`, `--workflow`, `--branch`, `--tag`, `--limit` (default 10) |
| `build <buildId>` | Build summary; `--full` for raw API object |
| `status <buildId>` | Alias for `build` |
| `trigger` | Start build. Required: `--app`, `--workflow`. Optional: `--branch`, `--tag`, repeatable `--var K=V` (env vars), `--input K=V` (workflow inputs), `--label L` |
| `watch <buildId>` | Poll until terminal status. Flags: `--interval` secs (default 30), `--timeout` secs (default 3600). Exit 0 iff status `finished` |
| `cancel <buildId>` | Cancel running build |
| `artifacts <buildId>` | List artifact names, sizes, URLs |
| `download <buildId>` | Download artifacts. Flags: `--name` substring filter, `--dir` target dir |
| `api <METHOD> <path>` | Raw authenticated call, e.g. `api POST /builds --data '{...}'` |

### Build statuses

In progress: `queued`, `preparing`, `fetching`, `building`, `testing`, `publishing`, `finishing`.
Terminal: `finished` (success), `failed`, `canceled`, `timeout`, `warning`, `skipped`.

## Agent guidance

1. **Find app/workflow ids** → `apps` first, then `app <appId>`; for `codemagic.yaml` repos, workflow id = the key in the yaml (e.g. `rosey-fix`)
2. **Trigger + follow** → `trigger …` prints `buildId`, then `watch <buildId>`; watch exit code tells success/failure
3. **Parametrized workflows** → `--input` for `codemagic.yaml` `inputs:`, `--var` for environment variables
4. **Logs are not exposed cleanly** via API — point user to the build URL printed by `trigger` for full logs
5. **Anything uncovered** → `api` command hits any endpoint with auth header set
6. **Auth errors** → tell user to create/check token (see Prerequisites)

## Error playbook

```bash
# No API token
export CODEMAGIC_API_TOKEN="..."
# or
echo "..." > ~/.config/codemagic/api-token

# HTTP 401/403
# Token wrong or from wrong team — regenerate in Codemagic UI → Integrations → Codemagic API

# Trigger returns error about workflow
# Workflow id mismatch: for yaml apps use the workflow key from codemagic.yaml,
# for UI-configured apps use the workflow _id from `app <appId>`
```
