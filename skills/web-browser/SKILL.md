---
name: web-browser
description: Interactive browser automation via Chrome DevTools Protocol, plus an Obscura headless backend for fast anonymous no-login scraping, plus `agent.mjs` to delegate a whole web task to a cheap inner agent. Use when you need to interact with web pages, test frontends, scrape public pages, delegate a multi-step web task without burning your own context, or when user interaction with a visible browser is required.
---

# Browser Tools

Minimal CDP tools for collaborative site exploration. Raw WebSocket, no Puppeteer.

## Choose an engine

Two backends. Pick by whether the page needs YOUR login.

| Situation | Use | Why |
|---|---|---|
| Page needs your logged-in session | **Chrome** `./scripts/start.js --profile` | Copies your profile, so your cookies/logins ride along |
| You need a visible window for the user | **Chrome** | Obscura is headless-only |
| Hard anti-bot (DataDome, Cloudflare Turnstile) — e.g. Klook | **Chrome** `--profile` | A warmed real profile carries the clearance cookie; Obscura hits the challenge |
| Public page, no login, want speed/low-memory/stealth | **Obscura** `./scripts/obscura.js ...` | 30 MB RAM, instant start, built-in anti-detect |
| Bulk / parallel scraping of public pages | **Obscura** `obscura.js scrape ...` | Parallel workers, one JSON per URL |
| Multi-step task on an unfamiliar site, keep your context small | **Inner agent** `agent.mjs "<task>"` | Cheap model does the browsing, you get the answer only |

Rule of thumb: **no login needed → Obscura. Login needed → Chrome with session copy.**

Unsure if a site will block Obscura? Probe first: `./scripts/obscura.js check <url>`.
It reports `{"blocked": true}` and tells you to switch to Chrome when an anti-bot answers.

## Start Chrome

```bash
./scripts/start.js                                 # Isolated reusable profile (default)
./scripts/start.js --profile                       # Copy your logged-in session into isolated cache
./scripts/start.js --no-stealth                    # Opt out of stealth (shows automation banner)
./scripts/start.js --list-profiles                 # List your Chrome profiles (dir → name)
./scripts/start.js --profile --chrome-profile 'Profile 1'  # Copy a specific source profile
./scripts/start.js --reset-profile                 # Clear the cached copy (forces fresh copy)
```

Starts Chrome with remote debugging (default port `:9222`).

Session copy (`--profile`):
- Copies only **login/session** data — cookies (top-level `Cookies` and modern `Network/Cookies`), `Login Data`, `Web Data`, `Local Storage`, `Session Storage`, `IndexedDB`. Your Keychain-encrypted cookies decrypt in the isolated instance, so logged-in sites work.
- Deliberately **not** copied: `Preferences` / `Secure Preferences` / `Local State`. Chrome HMAC-validates `Preferences` against a profile-path-bound seed; copying it into a different profile path triggers the *"Something went wrong when opening your profile"* dialog. Logins do not need it, and on macOS cookies decrypt via the Keychain key (not `Local State`). Your Chrome **settings** are therefore not carried over — only your sessions.
- **Incremental**: `rsync` without `--delete` of the whole tree, so re-launches sync only changed files (~2s, ~tens of MB — not the multi-GB full Chrome dir).
- **Profile-aware**: defaults to the `Default` source profile. Pick another with `--chrome-profile <dir>`; run `--list-profiles` to see dir → display-name.
- If your real Chrome is **running**, it warns that recently added logins may not be flushed to disk; quit Chrome for the freshest session.
- Cached copy: `~/.cache/agent-web/browser/profile-copy` (default mode: `~/.cache/agent-web/browser/fresh-profile`).

Why copy instead of driving your live Chrome? CDP automation needs Chrome launched with `--remote-debugging-port`, and **Chrome ≥ 136 refuses to open that port on the default profile** (an anti-cookie-theft mitigation). So the port can only attach to a *non-default* `--user-data-dir`. The copy is that non-default profile, carrying your logins. It is also safer: the agent never touches your real browser tabs, history, or session. Trade-off: the copy is a snapshot — quit Chrome first for the freshest cookies.

Other behavior:
- Stealth is **on by default**: no `--enable-automation`, plus `navigator.webdriver` patched and plugins/permissions spoofed to avoid bot detection on sites like Google. Opt out with `--no-stealth` (alias `--automation`) to get the automation banner back.
- The skill does not attach to your live Chrome profile directly
- If `:9222` is already used by an unknown instance, start will fail instead of reusing it

If Chrome is installed in a non-standard location, set:

```bash
BROWSER_BIN=/path/to/chrome ./scripts/start.js
```

Optional debug endpoint override:

```bash
BROWSER_DEBUG_PORT=9333 ./scripts/start.js
```

## Navigate

```bash
./scripts/nav.js https://example.com
./scripts/nav.js https://example.com --new
```

Navigate current tab or open new tab.

## Device Emulation (Mobile)

```bash
./scripts/emulate.js --list
./scripts/emulate.js iphone-14
./scripts/emulate.js pixel-7 --landscape
./scripts/emulate.js --reset
```

Set an active device emulation preference (viewport, DPR, touch, UA) for browser skill commands. Use `--reset` to clear.

Commands like `nav.js`, `eval.js`, `pick.js`, `dismiss-cookies.js`, and `screenshot.js` automatically apply the active preference.

## Evaluate JavaScript

```bash
./scripts/eval.js 'document.title'
./scripts/eval.js 'document.querySelectorAll("a").length'
./scripts/eval.js 'document.querySelector("button")?.click(); "clicked"'
./scripts/eval.js 'await Promise.resolve(document.title)'
```

Execute JavaScript in the active tab. Input can be an expression or statement list; the console-style completion value is printed and promises/top-level `await` are awaited. Use single quotes for the outer string.

## Accessibility Tree (id-based actions)

```bash
./scripts/ax.js state              # [id] role "name" = value (states), ## headings, in page order; "*" marks ids new since the last state
./scripts/ax.js state --all        # also non-control named nodes
./scripts/ax.js click <id> [--state]
./scripts/ax.js type <id> "text" [--enter] [--state]   # replaces existing text
./scripts/ax.js select <id> "Option text" [--state]    # native <select>
./scripts/ax.js settle             # wait until the page is quiet
```

Ids are Chrome `backendNodeId`s: stable across calls until the page reloads, so a stateless CLI works. Prefer this over guessing CSS selectors for forms and unfamiliar pages; it is far smaller than HTML. Idea from [browser-use-pi](https://github.com/browser-use/browser-use-pi) (`src/ax.ts`).

Settling: every action (and `state`) waits until the document is loaded, the DOM has had no real change for 150 ms, and no request is in flight (requests open longer than 1.5 s count as long-poll and are ignored; hard cap 3 s). No `sleep` needed. Each action then prints one outcome line: `-> navigated to <url>`, `-> page changed` or `-> no change`. `--state` appends the fresh state, so a click and its result take one call. Popups drawn in native shadow UI (date pickers) are not DOM changes and report `no change`; run `state` to see them.

Hidden window caveat: if the Chrome window is occluded, `document.visibilityState` is `hidden`. Chrome then stalls ~5 s and drops real mouse input. `ax.js click` detects this and falls back to a DOM `.click()`. Text input is unaffected.

### Batch with codemode

When pi's `codemode` tool is on, chain calls in one script via `tools.bash`. One model turn, no per-step LLM cost, and the script resolves ids from the `state` output, so the model never reads the tree:

```js
const sh = async (c) => (await tools.bash({ command: `cd <SKILL_DIR>/scripts && ${c}` })).output.trim();
await sh("./nav.js https://httpbin.org/forms/post");
const st = await sh("./ax.js state");
const id = (re) => st.split("\n").find((l) => re.test(l))?.match(/\[(\d+)\]/)[1];
await sh(`./ax.js type ${id(/Customer name/)} Test`);
await sh(`./ax.js click ${id(/Submit order/)}`);
return await sh("./eval.js 'document.body.innerText.slice(0,300)'");
```

To show a screenshot from a script: `base64 < file | tr -d '\n'`, then `image("data:image/png;base64," + b64)`. `tools.read` on an image returns only a text stub.

## Delegate a whole task (inner agent)

```bash
./scripts/agent.mjs "Open https://example.com/pricing and list the plan names and monthly prices as JSON"
./scripts/agent.mjs "<task>" --hard                 # xhigh reasoning, 80 steps, 15 min, $2 cap
./scripts/agent.mjs "<task>" --free                 # openrouter/free router: $0, slow, may log prompts
./scripts/agent.mjs "<task>" --domains example.com,*.example.com
./scripts/agent.mjs "<task>" --attach               # use this skill's Chrome on :9222 (its logins) instead of an isolated one
./scripts/agent.mjs "<task>" --model openrouter/openai/gpt-6-luna   # pin one model, no fallback
```

Runs the [browser-use-pi](https://github.com/browser-use/browser-use-pi) SDK: a small model drives Chrome through a persistent JS REPL, an accessibility-tree view and raw CDP. Only the final answer plus one status line (`status`, model, steps, cost, time, workspace) comes back, so page content never enters your context.

Use it when:
- the task spans several pages or steps on a site you do not know and you would otherwise read pages yourself;
- you want a cheap model, not yours, to burn the tokens.

Do not use it when:
- a known flow fits `ax.js` in one codemode script (faster, no inner model);
- you only need to read a public page (`obscura.js content`, `ketch scrape`);
- the page needs a login you have not copied (`--attach` after `start.js --profile`).

Behavior:
- Models, in order: `openai/gpt-6-luna` (ChatGPT subscription via pi's `auth.json`), `openrouter/openai/gpt-6-luna`, `openrouter/openrouter/free`. A tier is skipped only when it errors before any output. Typical task: 5-40 s, under $0.01.
- Default browser is a fresh isolated headless Chrome (adds ~5 s), closed on exit. `--headed` shows it; `--profile-dir DIR` keeps logins across runs (sign in once with `--headed`).
- Defaults: reasoning `low`, 40 steps, 5 min, $0.25 cap. Hard tasks need `--hard`; the published Browser Use benchmark has Luna scoring 41 (low) vs 58 (xhigh) on hard tasks.
- Exit code 0 only when `status=completed`. Any other status means a partial answer: verify before relying on it. `completed` means a schema-valid answer, not a correct one.
- Safety: the inner agent runs generated JavaScript with file and network access on this machine. Page content is untrusted. Use `--domains` on unknown sites. Navigation allow-lists are not network isolation. Never pass secrets in the task text. `--attach` and `--profile-dir` expose logins to whatever the pages say.
- Credentials are read through pi's own `AuthStorage` (file-locked, same refresh as pi). Without pi, set `OPENAI_API_KEY` or `OPENROUTER_API_KEY`.
- The SDK is `@browser_use/pi` (pinned in `scripts/package.json`; run `npm install` in `scripts/`). Anonymous telemetry is disabled.

## Screenshot

```bash
./scripts/screenshot.js
./scripts/screenshot.js --full-page
./scripts/screenshot.js --device iphone-14
./scripts/screenshot.js --device pixel-7 --full-page
```

Takes a screenshot and returns a temp file path.

- Default: current viewport
- `--full-page`: captures full document height
- `--device <preset>`: temporary mobile emulation for that screenshot only

## Pick Elements

```bash
./scripts/pick.js "Click the submit button"
```

Interactive element picker. Click to select, Cmd/Ctrl+Click for multi-select, Enter to finish.

## Dismiss Cookie Dialogs

```bash
./scripts/dismiss-cookies.js          # Accept cookies
./scripts/dismiss-cookies.js --reject # Reject cookies (where possible)
```

Automatically dismisses EU cookie consent dialogs. Run after navigating to a page.

## Extract Page Content

```bash
./scripts/content.js https://example.com
```

Navigate to a URL and extract readable content as markdown using Readability and Turndown (loaded from CDN, no local deps). Falls back to raw innerText if Readability cannot parse the page.

## Obscura (no-login scraping)

Anonymous, headless scraping via the [Obscura](https://github.com/h4ckf0r0day/obscura) Rust engine. Built-in stealth, ~30 MB RAM, instant start. No Chrome, no session. Use when the page needs **no login**.

The binary auto-installs (stealth build) to `~/.cache/agent-web/obscura/` on first run.

```bash
./scripts/obscura.js content <url>       # readable page text
./scripts/obscura.js html <url>          # rendered HTML
./scripts/obscura.js links <url>         # all links as JSON
./scripts/obscura.js cookies <url>       # cookie jar as JSON (incl. HttpOnly)
./scripts/obscura.js eval <url> '<js>'   # run JS, print result
./scripts/obscura.js shot <url> [out.png]# screenshot to file
./scripts/obscura.js check <url>         # probe: {title, bodyLen, blocked}
./scripts/obscura.js scrape <url...>     # parallel multi-URL scrape (JSON/URL)
./scripts/obscura.js -- <raw obscura args>  # passthrough to the CLI
```

Fetch commands default to `--wait-until networkidle0 --timeout 30`. Append your own flags to override, e.g. `content <url> --timeout 60 --proxy socks5://127.0.0.1:1080`.

Anti-bot detection: every fetch scans the response for challenge signatures (DataDome, Cloudflare, PerimeterX, captcha). On a hit it prints a warning and tells you to switch to Chrome with your session. Obscura cannot pass these.

- **Klook is behind DataDome** — `check` returns `blocked: true`. Scrape it with `./scripts/start.js --profile` instead (stealth is on by default; a warmed real profile carries the `datadome` clearance cookie).
- Obscura stealth **does** beat fingerprint detectors (`navigator.webdriver`, plugins, UA) and normal sites; it does **not** beat network/behavioral anti-bots without residential proxies.

`obscura.js serve [--port N]` starts a CDP server, but only for a **persistent** client (`puppeteer-core` / `playwright-core`). Obscura drops tabs when a connection closes, so the one-shot scripts above (`nav.js`, `eval.js`, ...) do not work against it. For script-driven work use the one-shot commands.

## Background Logging (Console + Errors + Network)

Automatically started by `start.js` and writes JSONL logs to:

```
~/.cache/agent-web/logs/YYYY-MM-DD/<targetId>.jsonl
```

Manually start:
```bash
./scripts/watch.js
```

Tail latest log:
```bash
./scripts/logs-tail.js           # dump current log and exit
./scripts/logs-tail.js --follow  # keep following
```

Summarize network responses:
```bash
./scripts/net-summary.js
```

## Efficiency Guide

### DOM Inspection Over Screenshots

Don't take screenshots to see page state. Parse the DOM directly:

```bash
./scripts/eval.js 'JSON.stringify({title: document.title, forms: document.forms.length, buttons: document.querySelectorAll("button").length})'
```

### Complex Scripts in Single Calls

Wrap multi-statement code in an IIFE:

```bash
./scripts/eval.js '(function(){ const data = document.querySelector("#target").textContent; document.querySelector("button").click(); return JSON.stringify({data}); })()'
```

### Quick Mobile Debug Flow

```bash
./scripts/start.js
./scripts/nav.js https://example.com
./scripts/emulate.js iphone-14
./scripts/nav.js https://example.com      # reload with mobile UA
./scripts/dismiss-cookies.js
./scripts/screenshot.js --full-page
```
