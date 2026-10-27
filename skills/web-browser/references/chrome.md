# Chrome details

## Session copy (`start.js --profile`)

- `--profile` copies only login data from the source profile: cookies (`Cookies` and `Network/`), `Login Data`, `Web Data`, `Local Storage`, `Session Storage` and `IndexedDB`. Settings stay behind, because a copied `Preferences` file triggers Chrome's "Something went wrong when opening your profile" dialog.
- The source is `~/Library/Application Support/Google/Chrome/Default` (macOS only). To pick another profile, run `start.js --list-profiles`, then pass `--chrome-profile <dir>`.
- Each launch syncs the copy with `rsync` and deletes every other file in the cached `Default/`.
- If the user's own Chrome is running, start.js warns that recent logins can be missing. For the freshest session, ask the user to quit Chrome, then run start.js again.
- The copy lives in `~/.cache/agent-web/browser/profile-copy`. Without `--profile`, Chrome uses `~/.cache/agent-web/browser/fresh-profile`, and logins made there persist. `--reset-profile` deletes the copy before launch.

## One Chrome per port

- start.js reuses a Chrome it started in the same mode. If its Chrome runs in the other mode, start.js refuses. `start.js --stop` quits it.
- If an unknown process holds `:9222`, start.js refuses to attach. Then set `BROWSER_DEBUG_PORT=<port>` for start.js and for every later script.
- If Chrome lives outside `/Applications`, set `BROWSER_BIN=/path/to/chrome`.

## Stealth

Stealth is on by default: Chrome starts without `--enable-automation`, and `nav.js` and `content.js` patch `navigator.webdriver`, plugins and languages. `start.js --no-stealth` brings back the automation banner.
