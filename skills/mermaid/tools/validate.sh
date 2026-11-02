#!/bin/bash
# Validate Mermaid diagrams with Pele (https://pele.run). Optionally render SVG or PNG.
# Usage: validate.sh [options] <file.mmd|file.md>...

set -euo pipefail

# pele-cli 0.1.1 pins pele 1.6.0. Both were published inside the 7-day npm
# cooldown (~/.npmrc min-release-age=7), so this call alone skips the cooldown.
# Drop --min-release-age=0 after 2026-10-30.
PELE_VERSION="0.1.1"
if [ -n "${PELE_CMD:-}" ]; then
    read -r -a PELE <<<"$PELE_CMD"
elif command -v pele >/dev/null 2>&1; then
    PELE=(pele)
else
    PELE=(npx -y --loglevel=error --min-release-age=0 "@ahmedelgabri/pele-cli@$PELE_VERSION")
fi

usage() {
    cat <<'EOF'
Usage: validate.sh [options] <file.mmd|file.md>...

Validates every Mermaid diagram in .mmd/.mermaid files and in mermaid code
blocks in .md files. Errors print as file:line:col.

Options:
  --svg <dir>     Write one SVG per diagram to <dir>
  --png <dir>     Write SVG and PNG per diagram to <dir> (needs Chrome/Chromium)
  --theme <name>  Theme for --svg/--png: light (default), dark, auto
  --json          Print the check result as JSON
  --ascii         Print an ASCII preview of .mmd files (beautiful-mermaid, best-effort)
  --strict        Also validate with the official mermaid-cli (slow, needs Chromium)
  -h, --help      Show this help

Exit codes: 0 valid, 1 invalid diagrams, 2 usage or file error.
Env: PELE_CMD overrides the pele command. CHROME sets the browser binary.
EOF
}

SVG_DIR=""
PNG_DIR=""
THEME="light"
FORMAT="text"
ASCII=0
STRICT=0
FILES=()

while [ $# -gt 0 ]; do
    case "$1" in
    --svg) SVG_DIR="${2:?--svg needs a directory}"; shift 2 ;;
    --png) PNG_DIR="${2:?--png needs a directory}"; shift 2 ;;
    --theme) THEME="${2:?--theme needs light, dark, or auto}"; shift 2 ;;
    --json) FORMAT="json"; shift ;;
    --ascii) ASCII=1; shift ;;
    --strict) STRICT=1; shift ;;
    -h | --help) usage; exit 0 ;;
    --) shift; FILES+=("$@"); break ;;
    -*) echo "Error: unknown option: $1" >&2; usage >&2; exit 2 ;;
    *) FILES+=("$1"); shift ;;
    esac
done

if [ ${#FILES[@]} -eq 0 ]; then
    usage >&2
    exit 2
fi

# 1. Validate with Pele.
STATUS=0
"${PELE[@]}" check --format "$FORMAT" "${FILES[@]}" || STATUS=$?
if [ "$STATUS" -eq 2 ]; then
    exit 2
fi

find_chrome() {
    if [ -n "${CHROME:-}" ]; then echo "$CHROME"; return; fi
    local c
    for c in \
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
        "/Applications/Chromium.app/Contents/MacOS/Chromium" \
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"; do
        if [ -x "$c" ]; then echo "$c"; return; fi
    done
    for c in google-chrome chromium chromium-browser chrome; do
        if command -v "$c" >/dev/null 2>&1; then command -v "$c"; return; fi
    done
}

# 2. Optional cross-check with the official renderer.
if [ "$STRICT" -eq 1 ]; then
    # ignore-scripts=true blocks Puppeteer's Chromium download, so reuse the system browser.
    if [ -z "${PUPPETEER_EXECUTABLE_PATH:-}" ]; then
        PUPPETEER_EXECUTABLE_PATH=$(find_chrome)
        export PUPPETEER_EXECUTABLE_PATH
    fi
    TMP_STRICT=$(mktemp -d /tmp/mermaid_strict.XXXXXX)
    for f in "${FILES[@]}"; do
        rm -rf "${TMP_STRICT:?}"/*
        case "$f" in
        *.md | *.markdown) out="$TMP_STRICT/$(basename "$f")" ;;
        *) out="$TMP_STRICT/$(basename "$f").svg" ;;
        esac
        # mermaid-cli can exit 0 and still render an error diagram, so check the SVGs too.
        if npx -y --loglevel=error @mermaid-js/mermaid-cli -i "$f" -o "$out" -q >/dev/null &&
            ! grep -qs 'class="error-text"' "$TMP_STRICT"/*.svg; then
            echo "✓ mermaid-cli: $f"
        else
            echo "✗ mermaid-cli: $f"
            STATUS=1
        fi
    done
    rm -rf "$TMP_STRICT"
fi

# 3. Optional ASCII preview (.mmd/.mermaid only).
if [ "$ASCII" -eq 1 ]; then
    for f in "${FILES[@]}"; do
        case "$f" in *.md | *.markdown) continue ;; esac
        echo ""
        echo "ASCII preview: $f"
        MERMAID_INPUT="$f" npx -y --loglevel=error --package beautiful-mermaid node -e '
const fs = require("node:fs");
const path = require("node:path");
const moduleRoot = path.dirname(process.env.PATH.split(":")[0]);
const { renderMermaidAscii } = require(path.join(moduleRoot, "beautiful-mermaid"));
process.stdout.write(renderMermaidAscii(fs.readFileSync(process.env.MERMAID_INPUT, "utf8")) + "\n");
' || echo "Warning: ASCII preview failed (diagram type may be unsupported)."
    done
fi

# 4. Optional SVG/PNG output. Pele writes the valid diagrams even when others fail.
render_svgs() {
    local dir="$1"
    mkdir -p "$dir"
    "${PELE[@]}" render --theme "$THEME" -o "$dir" --format json "${FILES[@]}" 2>/dev/null |
        node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const f of JSON.parse(s).written??[])console.log(f)})' || true
}


if [ -n "$SVG_DIR" ]; then
    echo ""
    echo "SVG:"
    render_svgs "$SVG_DIR" | sed 's/^/  /'
fi

if [ -n "$PNG_DIR" ]; then
    CHROME_BIN=$(find_chrome)
    if [ -z "$CHROME_BIN" ]; then
        echo "Error: --png needs Chrome or Chromium. Set CHROME to the binary path." >&2
        exit 2
    fi
    PROFILE=$(mktemp -d /tmp/mermaid_chrome.XXXXXX)
    trap 'rm -rf "$PROFILE"' EXIT
    echo ""
    echo "PNG:"
    while IFS= read -r svg; do
        case "$svg" in *.svg) ;; *) continue ;; esac
        [ -f "$svg" ] || continue
        abs=$(cd "$(dirname "$svg")" && pwd)/$(basename "$svg")
        png="${abs%.svg}.png"
        html="$PROFILE/$(basename "${abs%.svg}").html"
        w=$(grep -o ' width="[0-9.]*"' "$abs" | head -1 | tr -dc '0-9.')
        h=$(grep -o ' height="[0-9.]*"' "$abs" | head -1 | tr -dc '0-9.')
        w=$(printf '%.0f' "${w:-800}")
        h=$(printf '%.0f' "${h:-600}")
        { printf '<!doctype html><html><body style="margin:0">'; cat "$abs"; printf '</body></html>'; } >"$html"
        "$CHROME_BIN" --headless=new --disable-gpu --hide-scrollbars --no-first-run \
            --no-default-browser-check --user-data-dir="$PROFILE/profile" \
            --force-device-scale-factor=2 --window-size="$w,$h" \
            --screenshot="$png" "file://$html" >/dev/null 2>&1 || true
        if [ -f "$png" ]; then echo "  $png"; else echo "  failed: $svg" >&2; fi
    done < <(render_svgs "$PNG_DIR")
fi

exit "$STATUS"
