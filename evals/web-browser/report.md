# web-browser diet report

**Verdict: ship.** `eval.mjs score eval/` exits 0 (no MISS, no WORSE, no WARN). After matches before within noise (31/33 vs 32/33). It uses 41% fewer tokens per run and fixes drift. Model: `openai/gpt-6-luna`, 3 runs per task, `--parallel 4`.

## Tokens per level (bytes/4)

| level | before | after |
|---|---|---|
| description (every session) | 0 (user-invoked; pi drops `disable-model-invocation` skills from the prompt) · 410 chars ≈ 102 | 0 · 129 chars ≈ 32 |
| SKILL.md | 16,008 B ≈ 4,000 | 6,425 B ≈ 1,600 |
| references/chrome.md | – | 1,688 B ≈ 420 |
| references/codemode.md | – | 1,001 B ≈ 250 |
| references/agent.md | – | 652 B ≈ 160 |
| typical task load | SKILL.md ≈ 4,000 | SKILL.md ≈ 1,600 (0 of 33 eval runs opened a reference) |
| eval tokens/run | 10,866 | 6,443 |

No file is near Pi's 50 KB read limit. `check sk/after/web-browser` passes (links ok).

## Usage (last 60 days, `log-count.mjs --no-dev`)

889 calls in 29 sessions (Pi 27, Claude Code 2). 23 of those sessions loaded the skill. By share of calls: eval.js 52%, nav.js 20%, screenshot.js 9%, start.js 7%, ax.js 6%, obscura.js 5%, agent.mjs under 1% (32 calls if skill-dev sessions are included). The most-used flags were `start.js --profile` (20) and `nav.js --new` (10). Recurring errors: `✗ fetch failed` (124), `Chrome not reachable` (56) and `No active tab found` (26). Most of them came from one codemode loop (personal-kb, 2026-10-10) that kept going after every failure on `BROWSER_DEBUG_PORT=9333`.

## Eval

There were 11 tasks taken from real sessions (Slack thread, Gmail, Amazon, Klook, httpbin form, mobile screenshot, fframes docs delegation, partial agent result, secret in the task text, bulk docs scrape, console logs).

| version | success | tokens/run | turns/run | wall s/run |
|---|---|---|---|---|
| before | 32/33 | 10,866 | 1.5 | 38 |
| after | 31/33 | 6,443 | 1.4 | 34 |
| none (scripts' own `--help` only) | 18/33 | 22,018 | 4.9 | 81 |

| task | before | after | none |
|---|---|---|---|
| slack-thread | 3/3 | 3/3 | 0/3 |
| profile-eperm | 3/3 | 3/3 | 0/3 |
| amazon-price | 3/3 | 3/3 | 2/3 |
| klook-ticket | 3/3 | 3/3 | 1/3 |
| form-fill | 3/3 | 3/3 | 3/3 |
| mobile-shot | 3/3 | 3/3 | 3/3 |
| delegate-domains | 3/3 | 3/3 | 3/3 |
| agent-partial | 3/3 | 2/3 | 3/3 |
| secret-task | 3/3 | 2/3 | 0/3 |
| bulk-scrape | 2/3 | 3/3 | 0/3 |
| console-logs | 3/3 | 3/3 | 3/3 |

The two after failures are one-offs. In one, the agent used `curl` on a public page instead of rerunning the inner agent. In the other, it refused the secret task with no commands, which is a safe outcome. Where none passes (form-fill, mobile-shot, delegate-domains, agent-partial, console-logs), the scripts' own usage text is enough. That is why after keeps those parts as one-line cheat-sheet entries.

**Cut-content cases** (`eval-cases/`, 3 runs each): eval-multi, cookies-reject, obscura-proxy and custom-port passed 3/3 with after. Two cases failed on the first draft: chrome-profile (1/3) and live-chrome (0/3). Both pieces moved back into SKILL.md (the `--list-profiles` line and the "Never the live Chrome" rule). After the fix, both pass 3/3 with after, and before also scores 3/3. The main eval was then rerun against the final text.

**Scorer fixes.** I loosened three tasks after a fresh Luna judge (pi, no skill) said YES on both of its runs:
- amazon-price: the URL was in a shell variable.
- bulk-scrape: parallel `obscura.js eval` via `xargs -P` or `&`/`wait`.
- secret-task: credentials went through env vars instead of `--profile-dir`.

slack-thread accepts `agent.mjs --attach` after `start.js --profile` (judge YES twice). `content.js` for Slack got a split verdict, so that run stays failed. I also fixed live-chrome's `must`, which demanded `--profile` even though the prompt said to skip the copy, and rescored it in both versions.

**Eval safety.** The task prompts ask for commands only. The skill's scripts were replaced by stubs (`eval/stubgen/build-stubs.mjs`) that print the real usage and refuse to do anything else. My copy of the adapter runs pi under `sandbox-exec` (`eval/sandbox.sb`). The sandbox hides the installed copies, the session logs, the repo and the Chrome profile. It also blocks Chrome from running and blocks the `:9222`/`:9333` ports. A "none" calibration agent had found `~/.agents/skills/web-browser` (a symlink to the repo) and `~/.cache/checkouts/github.com/mitsuhiko/agent-stuff/skills/web-browser`, both of which contain a real `start.js`.

## Drift (with proof)

1. **content.js deps**: the skill says Readability and Turndown are "loaded from CDN, no local deps". In fact, `content.js:6-9` imports `@mozilla/readability`, `jsdom` and `turndown` from `node_modules`. Without them, `node content.js` fails with `ERR_MODULE_NOT_FOUND`.
2. **npm install**: the skill only asks for it for agent.mjs. But every CDP script imports `ws` (`cdp.js:5`), so `nav.js` with no `node_modules` also fails with `ERR_MODULE_NOT_FOUND`.
3. **Obscura "built-in stealth"**: obscura.js never passes `--stealth` (`FETCH_DEFAULTS`, `obscura.js:138`). `obscura --help` describes `--stealth` as enabling "TLS impersonation plus tracker blocking". On example.com, `navigator.userAgent` read Chrome/143 without the flag and Chrome/145 with it.
4. **"Every fetch scans for challenges"**: not true. `shot` and `scrape` use `runInherit` with no scan (`obscura.js:174, 200`).
5. **Obscura and localhost**: Obscura refuses localhost by default (`Access to localhost domain 'localhost' is not allowed`), and the error doesn't name the fix (`--allow-private-network`). It also accepts `--wait-until bogus` silently.
6. **"Current tab"**: every script takes `pages.at(-1)`, the last page target (`nav.js:42`, `eval.js:35`, `screenshot.js:97`, `ax.js`). `explainer-video/references/capture.md:7` says "first", which contradicts the source.
7. **agent.mjs unknown flags**: `agent.mjs:49` sets `opt[key] = true` for any unknown flag, and the value after it joins the task (`agent.mjs:44`). So `--domain example.com` sets no allow-list and appends "example.com" to the task. This is a safety issue.
8. **nav.js `--new`**: it is only read as `argv[3]` (`nav.js:10-11`), so `nav.js --new <url>` navigates to "--new".
9. **Help gaps**:
   - `start.js --help` prints `✗ Unknown option(s): --help` and exits 1.
   - `dismiss-cookies.js`, `watch.js`, `logs-tail.js` and `net-summary.js` have no help, so `--help` runs the action.
   - Public options the skill never mentioned: `screenshot.js --landscape`, `logs-tail.js`/`net-summary.js --file`, agent.mjs `--reasoning`, `--max-steps`, `--timeout`, `--max-cost`, `--workspace`, `--verbose` and `--json`, `obscura.js install`, and `BROWSER_DEBUG_HOST`.
10. **Emulation and ax.js**: `ax.js` does not import `applyActiveEmulation`, so ax actions don't re-apply the mobile preset. I could not verify the effect, because Chrome was not run.
11. **Consumers**:
    - `skills/explainer-video/references/capture.md:5` still says start.js "exits with a stack trace" on EPERM. That has been stale since 97651eb.
    - `prompts/amazon-search.md:28` and `prompts/summarize-url.md:28` pass `--stealth`, which start.js accepts as a no-op.
    - `agent/AGENTS.md:18` names `obscura.js check`, which still resolves.

## What moved where

- Engine table, rule of thumb and the Obscura "when to use" text → one "Pick the engine" list (SKILL.md). It now includes `obscura.js scrape` for bulk work.
- Start/Navigate/Eval/Screenshot/Emulate/ax sections → one cheat sheet of usage lines, plus short named rules: Never the live Chrome, Profile failure, DOM over pixels, eval.js, Forms, Target tab, Mobile, Errors, Batches.
- Session-copy details, cache paths, `BROWSER_BIN`, port conflicts and stealth → `references/chrome.md`.
- Codemode batch example → `references/codemode.md`. The example now stops at the first `✗` line.
- Inner agent:
  - When to use it, the partial status, the safety lines and logins stay in SKILL.md.
  - Defaults, the browser lifecycle, credentials and the SDK → `references/agent.md`.
  - Models and options are already in `agent.mjs --help`.
- pick.js, dismiss-cookies.js, content.js, logs and `obscura.js serve` → the "Look up the rest" index.

## What was cut

- **Motivation and history**: "Raw WebSocket, no Puppeteer", the browser-use-pi credits, 30 MB RAM, rsync timings, the Luna benchmark (41 vs 58), "5 to 40 s, under $0.01", and the Chrome 136 essay (only one clause remains).
- **Behavior the tool already handles**: settle timings (150 ms, 1.5 s, 3 s) and the hidden-window DOM-click fallback.
- **Things the model already knows**: the IIFE advice (eval.js already falls back to REPL mode for statements), repeated examples, and the `BROWSER_BIN`/`BROWSER_DEBUG_PORT` code blocks.
- **False claims**: content.js "CDN, no local deps", Obscura "built-in stealth beats fingerprint detectors", and "every fetch scans".
- **New lines from source and logs**:
  - npm install covers all CDP scripts.
  - The target is the last page target.
  - What to do on `fetch failed` and `No active tab found`.
  - Stop a batch on the first `✗`.
  - Obscura needs `--allow-private-network` for localhost.

## Proposed tool changes (not applied)

1. `cdp.js connect()`: map `fetch failed`/ECONNREFUSED to `✗ Chrome not reachable on :<port>. Run ./scripts/start.js (same BROWSER_DEBUG_PORT)`. Today only ax.js maps it. Also make `No active tab found` add `Open one with nav.js <url> --new`. The skill's Errors line can go once both land.
2. `agent.mjs`: reject unknown flags and suggest the closest valid one (`--domain` → `--domains`).
3. `obscura.js`:
   - Add `--stealth` to `FETCH_DEFAULTS` and to `scrape`.
   - Scan `scrape`/`shot` output for challenges.
   - On the localhost error, print the `--allow-private-network` hint.
4. `start.js`: make `--help` exit 0, and add `--stop` (kill the pid in `~/.cache/agent-web/browser/state.json`).
5. `nav.js`: accept `--new` in any position.
6. Help text for `dismiss-cookies.js`, `watch.js`, `logs-tail.js` and `net-summary.js` (`--help` must not run the action).
7. Tab targeting: `--tab <url-substring>` for eval/nav/screenshot/ax. explainer-video already ships its own `tab.mjs` for this.
8. `ax.js`: apply the active emulation like the other scripts do.
9. Consumer docs: fix `explainer-video/references/capture.md:5,7`, and drop `--stealth` from the two prompts.
10. skill-diet `eval.mjs calibrate`: the "none" check is a substring match on command text. A `find -path '*/web-browser/SKILL.md'` that read nothing fails it about half the time with Luna, so I had to retry (`eval/run-retry.sh`). It should check read calls instead.

## Files

- `sk/before/web-browser/`, `sk/after/web-browser/`: the scripts are byte-identical to the repo's, without node_modules.
- `diff.patch`: markdown only.
- `eval/`: tasks, runs, `score.txt`, the sandboxed adapter and the stubs.
- `eval-cases/`: the cut-content cases.
- `review/review.md`: the fresh reviewer's pass.
- `log-count.mjs`: the session-log counter, kept for the next diet.
