---
disable-model-invocation: true
name: figma
description: "Read Figma designs from the figma-pp-cli binary: turn a figma.com URL into a compact frame tree, exact text styles (font family, weight, size, line height), colors, and a PNG render. Use whenever the user shares a Figma link or asks to match, implement, or compare against a Figma design."
allowed-tools: "Read Bash"
---

# Figma (figma-pp-cli)

Drives the `figma-pp-cli` binary (Go, REST API, local SQLite cache). Use it to read designs, not to edit them.

Binary: `~/.local/bin/figma-pp-cli` (version `2026.9.1`). Auth is saved in `~/.config/figma-pp-cli/config.toml`, so commands work with no env var.

## Start here: one command per Figma link

```bash
~/.agents/skills/figma/scripts/figma-node.sh '<figma url with node-id>' [depth]
```

It writes four files to `~/.cache/figma-node/<file_key>/<node_id>/` and prints their paths:

| File | What it holds | Use it for |
|---|---|---|
| `frame.json` | Compact tree from `frame extract`, styles deduped into `styleRegistry` | Layout, structure, names |
| `nodes.json` | Raw REST node JSON | Exact values when `frame.json` is not enough |
| `typography.json` | Every distinct text style, with sample text | Font family, weight, size, line height, letter spacing |
| `render.png` | 2x PNG of the node | Look at it before and after you build |

Always look at `render.png`. Use whatever image viewer the harness has: `read` in the pi CLI, `view_image`, or the `browser` tool on the file path in Pi Pocket. Tall frames render tall: crop or downscale before viewing. The JSON says what the values are. The PNG shows what the designer meant.

Design-system frames often spell out their tokens as text ("16px / 400 / 1.5", "#6652ff"). List every text node in reading order to get the spec without any images:

```bash
jq -r '.. | objects | select(.type?=="TEXT") | .characters' ~/.cache/figma-node/KEY/NODE/nodes.json
```

The script reuses cached files. Pass `FIGMA_REFRESH=1` to fetch again after the designer changes the frame.

The CLI may print `typed-table upsert failed` or `not cached locally`. Those are about its own SQLite cache. The files are complete.

Depth cuts off nested content. If a card or tile looks empty in `nodes.json`, find its id in the parent and run the script on that subnode instead of raising depth for the whole frame.

## Agent contract

- **Add `--agent`** to every direct command. It expands to `--json --compact --no-input --no-color --yes`.
- **Node ids:** a URL has `node-id=139-2`. The CLI accepts `139-2` or `139:2`.
- **File key:** the segment after `/design/` or `/file/` in the URL.
- **Reads are rate limited by seat.** A View or Collab seat gets very few file reads a month. Fetch a node once, save it, and read the saved file. Never loop over `files` calls.
- **`--depth`** keeps payloads small. Start at 4 and raise it only for the subtree you need.
- **Variables API is Enterprise-only** (`files variables`, `tokens diff`). Without the `file_variables:read` scope it returns 403 `Invalid scope(s)`. Read colors and type from `nodes.json` and `typography.json` instead.
- **Budget about 3 to 5 frames per task.** Fetch the design-system frame and the one or two screens you are building, not the whole file.
- **Errors are JSON under `--agent`.** Exit codes: 2 usage, 3 not found, 4 auth, 5 API, 7 rate limited (wait, then retry once), 10 config.

## Direct commands

```bash
figma-pp-cli doctor                                              # auth + reachability
figma-pp-cli files KEY --depth 2 --json > /tmp/pages.json        # pages and top frames (one read; cache it)
figma-pp-cli me --agent                                          # who the token belongs to
figma-pp-cli frame extract KEY --ids 139-2 --depth 4 --agent     # compact tree
figma-pp-cli files nodes get-file KEY --ids 139:2 --depth 3 --agent  # raw node JSON
figma-pp-cli images KEY --ids 139:2 --scale 2 --format png --agent  # returns render URLs
figma-pp-cli dev-mode dump KEY --node 139-2                      # Markdown hand-off bundle
figma-pp-cli files comments KEY --agent                          # design comments
figma-pp-cli which "<capability in plain words>"                 # find a command
```

`images` returns URLs, not files. Download with `curl -sL "$url" -o out.png`. The URLs expire after about 30 days.

## Implementing a design

1. Run `figma-node.sh` on the frame link. Read `render.png` and `typography.json` first.
2. Map Figma values to the project's existing tokens. Do not paste raw hex or px values when a token exists. If a value has no token, say so and propose one.
3. Check font weights against the font files the project ships. A weight the project does not load renders as a faux or fallback weight. A variable font file covers every weight in one download.
4. Map type per element, not per page. `typography.json` lists each style with a sample and a node id. Look up that node to see where the style is used.
5. Check WCAG contrast for every text and background pair before you adopt a palette: 4.5:1 for text, 3:1 for input borders and focus rings. Design files often fail in dark mode (a brand purple on near-black) and for the faintest grey. Keep the designer's values as tokens, and record each deviation with its ratio so the designer can review it.
6. Render your build at the same width and compare it with `render.png` side by side.

## Auth

The token is a Figma personal access token (`figd_…`). It lives in the macOS keychain as `figma-pat` and is copied into the CLI config:

```bash
figma-pp-cli auth set-token "$(security find-generic-password -a "$USER" -s figma-pat -w)"
figma-pp-cli doctor
```

Never print the token or put it on the command line by value.

Figma caps tokens at 90 days. When `doctor` reports `Auth` failing or a command exits 4, ask the user for a new token:

1. figma.com → account menu → **Settings** → **Security** → **Personal access tokens** → **Generate new token**.
2. Expiration: 90 days. Scopes, all read-only: `file_content:read`, `file_metadata:read`, `file_comments:read`, `file_dev_resources:read`, `file_versions:read`, `library_content:read`, `library_assets:read`, `current_user:read`.
3. On the Mac: `security add-generic-password -U -a "$USER" -s figma-pat -w` and paste the token at the prompt.
4. Run the two commands above.

## Install or update

```bash
GOBIN=$HOME/.local/bin mise exec go@1.26.6 -- \
  go install github.com/mvanhorn/printing-press-library/library/productivity/figma/cmd/figma-pp-cli@latest
figma-pp-cli --version
```

The npx installer needs Go on `PATH`, so it fails here. `mise exec` uses Go once without changing global tools.
