# notion skill diet

Before: `skills/notion/` working tree (with the uncommitted `disable-model-invocation: true`). After: `sk/after/notion/`. Scripts unchanged (`diff -r` clean). Markdown diff: `diff.patch`.

## Tokens (≈ bytes/4)

| level | before | after |
|---|---|---|
| description (0 per session: user-invoked both times) | 389 chars ≈ 97 | 78 chars ≈ 20 |
| `SKILL.md` | 13,994 B ≈ 3,500 | 9,558 B ≈ 2,390 (−32%) |
| `references/mcp-proxy.md` | 4,895 B ≈ 1,225 | merged into troubleshooting.md |
| `references/setup-and-troubleshooting.md` | 2,054 B ≈ 515 | merged |
| `references/troubleshooting.md` | – | 2,290 B ≈ 570 |
| typical task load | ≈ 3,500 (SKILL.md only) | ≈ 2,390 (SKILL.md only) |

Typical load: in 60 days of logs (Pi: 515 notion calls in 49 sessions; Claude Code: 0), no reference was ever opened; agents read script source 14 times. In the eval no run opened a reference. `check` passes; `tools/coverage.mjs` passes on after.

## Eval (pi, openai/gpt-6-luna, 11 tasks × 3 runs, stub `ntn`, sandboxed)

| version | success | tokens/run | turns/run | wall s/run |
|---|---|---|---|---|
| before | 32/33 | 23,913 | 3.8 | 20 |
| after | 33/33 | 10,861 | 2.6 | 12 |
| none (ntn help only) | 18/33 | 19,828 | 5.7 | 28 |

Per task (before/after/none): read-page 3/3/3, add-section 3/3/0, edit-line 3/3/0, create-private 3/3/3, create-from-file 3/3/0, db-query 3/3/3, comment 3/3/3, set-status 3/3/2, search 3/3/3, sidebar 3/3/0, upload-image 2/3/1. `none` failed partial edits by running `pages update` (whole-page replace) and then reporting success.

**Verdict: ship.** No MISS, no WORSE, 0 WARN on after. `score` still exits 1, because of 10 WARNs on **before** runs. 9 are scorer false positives: the eval dir `/tmp/skill-diet-work/notion/` contains `/notion/`, so a bare `cd …/sk/before/notion` counts as "outside". 1 is a before run that typed the wrong path `…/notion/scripts/notion.js`, which doesn't exist. `tools/eval-patched.mjs` (trailing-slash fix at eval.mjs:277) leaves only that one WARN. Output: `score-official.txt`, `score-patched.txt`.

Spot cases for moved or cut pieces (`spot/`, 3 runs each): insert-after 3/3, MCP people search 3/3, other workspace 2/3 (before also 2/3). These ran on the text one revision before final (that revision lacked `completions` in the Index and had a different link label). `NOTION_WORKSPACE_ID` went back into SKILL.md after the reference-only version scored 1/3.

Eval harness (`adapter`, `fixtures/`, `checks/check.mjs`): per-run stub `ntn` in `$TMPDIR/ntnstub-*` first on PATH (logs args and stdin, canned replies; help/docs pass through to the real ntn). Fake `NOTION_API_TOKEN`/`CLAUDE_CODE_OAUTH_TOKEN` and a dead host for both APIs. Throwaway HOME, plus a `sandbox-exec` profile that hides installed skills and other eval versions. Without it, `none` calibration runs found `~/.agents/skills/notion`. `none` gets one hint line saying `ntn` is installed. No real Notion call ran.

## Drift (proof)

1. **`after` is deprecated.** Append-children docs say: "The `after` parameter is deprecated. Use the `position` parameter" (`drift/docs-append.txt:44`). The current schema has `position` and no `after` (`drift/spec-append-patch.txt`). The script pins `2022-06-28` to keep `after` working (`ntn.js:277-278`).
2. **`notion.api.spec/help/docs(path)` fail on multi-method paths.** Real reply: "error: Multiple methods are available for `/v1/blocks/{block_id}/children` … Pass `-X <METHOD>`" (`drift/spec-append.txt`; also a logged user session and eval run `before-set-status-2`). `apiMeta` never passes `-X` (`ntn.js:362`). Before told agents to call `spec` "before writing the call". Spec/docs output is 36–180 KB, which is over Pi's 50 KB read limit.
3. **`db query` and `notion.datasources.query()` return TSV, not JSON.** `--json` is parsed but `cmdDb` ignores it (`notion.js:354`), and `ntn.js:213` never passes `--json`. Logged session: `res.results.map` → "Cannot read properties of undefined", and `Object.keys(res)` = `"2295","2296",…` (string indices).
4. **`files create <path>` drops the file name.** `ntn.js:253` pipes bytes without `--filename`. A logged upload of a named .zip came back named `upload.zip`.
5. **Unknown flags are silently ignored.** `parseArgs` pushes them to positionals (`notion.js:51`). Eval: `notion.js files create --filename x` → "ENOENT … open '--filename'". `--content -` becomes a literal "-" body: eval run `runs-after-v5/after-create-from-file-1` created a page whose body was "-". ntn itself rejects unknown flags and suggests close names (`drift/t4-ntn-errors.txt`).
6. **Never mentioned in before:** the recommended surgical edit `PATCH v1/pages/{id}/markdown` `update_content` (`drift/docs-md-patch.txt:9`), `ntn logout|completions|workers`, and the endpoints `pages/{id}/move`, `views`, `meeting_notes`, `data_sources/{id}/templates`, `custom_emojis` (`drift/api-ls.txt`).
7. **Recurring log errors with no rule in before:** `notion-mcp.mjs fetch` ("Unknown command: fetch"), exec `require is not defined` (×2), `403 restricted_resource` on `v1/users`, and a wrong image/file block shape.

## What moved where

- **Into SKILL.md:** `NOTION_WORKSPACE_ID` (was in the reference), and the MCP decision (was in three places: CLI notes, guidance #8, the mcp-proxy table), now one section.
- **New in SKILL.md, from logs and drift:** `update_content` edits, property-update shape (8 logged calls), upload-and-attach shape, the TSV warnings, exec limits, `-X`, the 403 on users, and absolute script paths. Agents ran `node scripts/notion.js` from the user's cwd: 2/33 failures on the first draft.
- **Into a separate block:** the ntn-direct calls (`datasources`, `files create --filename`). On the first draft, agents ran them through notion.js.
- **Errors:** guidance #6, #7, #9 and the setup playbook are now one Errors list.
- **Into `references/troubleshooting.md`:** install/login, MCP auth, connector URL, overrides, write guard and plan limits (from both old references).

## What was cut

- Architecture and Files sections, and "zero npm deps": human info.
- The exec bindings table, now one index line.
- The surgical-edit walkthrough, and the API-version explanation (the script handles it).
- The Anthropic endpoint URLs and beta header: one line now says the API is private.
- The "Observed on a Business workspace" measurements (`notion-fetch self` replaces them).
- `page trash --no-yes`, comment stdin, `notion-get-comments`, and `object:"block"`/`type:"text"` in examples (both optional per spec). `--external-url` and `exec --script` moved to the Index.

## Proposed changes (not applied)

Scripts (`skills/notion/scripts/`):

1. `notion.js` `parseArgs`: reject unknown flags with the valid list, and treat `--content -` as stdin.
2. `ntn.js` `filesCreate`: pass `--filename <basename>` and `--content-type`.
3. `ntn.js`: pass `--json` in `datasourcesQuery`/`Resolve`/`files*`, and honor `db query --json`. The SKILL.md TSV lines go once this lands.
4. `ntn.js` `blocksAppend`: send `position: {type:"after_block", …}` with no version pin, and add `position: start`.
5. `apiMeta`: take a method and pass `-X`. Otherwise drop `api.spec/help/docs` from exec.
6. `notion-mcp.mjs`: add a `fetch <id>` alias.
7. Optionally add `page edit <id> --old --new`, wrapping `update_content`.
8. Add `tools/coverage.mjs` to the repo, and run it when ntn changes version.

Not verified live (writes were forbidden): `update_content` through the user's integration, and the exact `ntn datasources query --json` shape. Both come from ntn's own docs and help, and the stub mirrors them. "Drops comment anchors" is carried over from before.

skill-diet itself: the `score` "outside" check misfires when the eval dir name contains the skill name (eval.mjs:277). The calibration `none` check fails on a `find -path '*/notion/SKILL.md'` command that read nothing, so calibration needed retries.
