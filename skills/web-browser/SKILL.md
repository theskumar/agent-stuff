---
name: web-browser
description: Interactive browser automation via Chrome DevTools Protocol, plus an Obscura headless backend for fast anonymous no-login scraping. Use when you need to interact with web pages, test frontends, scrape public pages, or when user interaction with a visible browser is required.
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
