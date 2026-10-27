---
disable-model-invocation: true
name: web-browser
description: Browse with a Chrome that carries your logins, scrape public pages with Obscura, or hand a whole web task to a cheap inner agent.
---

# Web Browser

Run the scripts from this skill's folder as `./scripts/<name>`. If `scripts/node_modules` is missing, run `npm install` in `scripts/` first. Only `start.js`, `obscura.js`, `logs-tail.js` and `net-summary.js` run without it.

## Pick the engine

- If the page needs the user's login, use Chrome with `./scripts/start.js --profile`.
- If the user needs to see the window, use Chrome.
- If the site runs a hard anti-bot (DataDome, Cloudflare Turnstile, for example Klook), use Chrome with `--profile`.
- If the page is public, use Obscura: `./scripts/obscura.js content <url>`.
- If you need many public pages, run them in parallel with `./scripts/obscura.js scrape <url>...`.
- If you are unsure whether Obscura gets through, run `./scripts/obscura.js check <url>` first. If it prints `"blocked": true`, switch to Chrome with `--profile`.
- If the task spans several pages of a site you don't know, delegate it to `./scripts/agent.mjs "<task>"`.

## Chrome

```text
start.js [--profile [--chrome-profile <dir>=Default]] [--reset-profile] [--no-stealth]   # Chrome on :9222
start.js --list-profiles                # profile dir → name; pass the dir, not the name
nav.js <url> [--new]                    # --new goes after the URL
eval.js '<js>'                          # expression or statements; awaits promises
screenshot.js [--full-page] [--device <preset> [--landscape]]   # prints a temp PNG path
emulate.js <preset> [--landscape] | --reset | --list
ax.js state [--all]                     # [id] role "name" = value (states); * marks new ids
ax.js click <id> [--state]
ax.js type <id> <text> [--enter] [--state]          # replaces the field's text
ax.js select <id> <option text or value> [--state]  # native <select>
ax.js settle
```

- **Never the live Chrome**: The scripts cannot drive the user's everyday Chrome, because Chrome 136 and later refuse remote debugging on the default profile. For the user's logins, use `start.js --profile`.
- **Profile failure**: If `start.js --profile` fails, stop and tell the user what it printed. Relaunch without `--profile` only when the user agrees, because a fresh profile has no logins. On macOS, `Operation not permitted` means the app hosting the agent lacks Full Disk Access.
- **DOM over pixels**: Read page state with `eval.js` or `ax.js state`. Take a screenshot only when the user wants to see the page or the layout matters.
- **eval.js**: Wrap the code in single quotes. Return `JSON.stringify(...)` for nested data, because eval.js prints an object as `key: value` lines.
- **Forms**: On forms and unfamiliar pages, act by `ax.js` id instead of CSS selectors. An id stays valid until the page reloads. Every action waits for the page to settle, so skip `sleep`. Add `--state` to get the new tree in the same call. A native date picker reports `no change`; run `ax.js state` to see it.
- **Target tab**: The scripts act on the last page in Chrome's target list. Keep one tab open per task, so that page is the one you mean.
- **Mobile**: Run `emulate.js <preset>`, then `nav.js <url>` again so the server sees the mobile user agent, then take the screenshot. The preset stays active for later commands until `emulate.js --reset`.
- **Errors**: If a script prints `fetch failed` or `Chrome not reachable`, run `start.js` with the same `BROWSER_DEBUG_PORT`. If it prints `No active tab found`, run `nav.js <url> --new`.
- **Batches**: In a loop or a codemode script, stop at the first output line that starts with `✗`.

## Obscura (public pages, no login)

```text
obscura.js content|html|links|cookies <url> [obscura flags]
obscura.js eval <url> '<js>'
obscura.js check <url>          # {"url","title","bodyLen","blocked"}
obscura.js scrape <url>...      # parallel, one JSON object per URL
obscura.js shot <url> [out.png]
```

- Fetch commands add `--wait-until networkidle0 --timeout 30`. Append your own flags to override them.
- For `localhost` or a LAN address, append `--allow-private-network`.
- `check` and the fetch commands warn when an anti-bot answers. `scrape` and `shot` don't, so run `check` on one URL before you scrape a protected site in bulk.
- Obscura cannot pass DataDome, Cloudflare or PerimeterX challenges. After a warning, switch to Chrome with `--profile`.

## Inner agent

```text
agent.mjs "<task>" [--domains a.com,*.a.com] [--hard] [--attach] [--profile-dir <dir> --headed] [--model <provider/id>] [--free]
```

- The answer and a short status block come back, so page content stays out of your context.
- Skip it when a known flow fits one `ax.js` script, or when you only need to read a public page.
- Exit 0 means `status=completed`. On any other status, treat the answer as partial: verify it, or rerun with `--hard`.
- **Safety**: The inner agent runs generated JavaScript with file and network access on this machine, and page text is untrusted. On a site you don't know, pass `--domains`. Never put a password, token or other secret in the task text.
- **Logins**: For a logged-in site, run `start.js --profile` and pass `--attach`, or have the user sign in once with `--profile-dir <dir> --headed`. Either way, the pages can reach those logins.

## Look up the rest

- Usage of one script → `--help` for start.js, screenshot.js, obscura.js and agent.mjs; no arguments for nav.js, eval.js, ax.js, pick.js, content.js and emulate.js
- Console errors, failed requests → `logs-tail.js [--follow]` prints the latest log, `net-summary.js` counts statuses and failures; `start.js` starts `watch.js`, which writes them to `~/.cache/agent-web/logs/<date>/<targetId>.jsonl`
- Let the user click elements → `pick.js "<prompt>"`
- Cookie banner → `dismiss-cookies.js [--reject]`
- Page as markdown through Chrome → `content.js <url>`
- Session copy, profiles, ports, Chrome path, stealth → [references/chrome.md](references/chrome.md)
- Several steps in one codemode script → [references/codemode.md](references/codemode.md)
- Inner agent models, limits, credentials → [references/agent.md](references/agent.md)
- Raw Obscura CLI, CDP server → `obscura.js -- <args>`, `obscura.js serve [--port N]` (persistent puppeteer-core or playwright-core clients only; the one-shot scripts don't work against it)
