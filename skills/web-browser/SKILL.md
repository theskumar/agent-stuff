---
name: web-browser
description: Interactive browser automation via Chrome DevTools Protocol. Use when you need to interact with web pages, test frontends, or when user interaction with a visible browser is required.
---

# Browser Tools

Minimal CDP tools for collaborative site exploration. Raw WebSocket, no Puppeteer.

## Start Chrome

```bash
./scripts/start.js                          # Isolated reusable profile (default)
./scripts/start.js --profile                # Copy your profile into isolated cache
./scripts/start.js --profile --stealth      # Profile + stealth (avoids bot detection)
./scripts/start.js --reset-profile          # Clear selected cached profile before launch
```

Starts Chrome with remote debugging (default port `:9222`).

Profile behavior:
- Default mode uses: `~/.cache/agent-web/browser/fresh-profile`
- `--profile` mode uses: `~/.cache/agent-web/browser/profile-copy`
- `--stealth` disables `--enable-automation`, patches `navigator.webdriver`, and spoofs plugins/permissions to avoid bot detection on sites like Google
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
