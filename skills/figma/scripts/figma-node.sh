#!/usr/bin/env bash
# Fetch one Figma node as agent-ready files: compact tree, raw JSON, text styles, PNG.
#
# Usage: figma-node.sh <figma-url-with-node-id> [depth]
#        figma-node.sh <file_key> <node_id> [depth]
#
# Writes ~/.cache/figma-node/<file_key>/<node_id>/{frame,nodes,typography}.json and render.png,
# then prints the paths. Cached files are reused. Set FIGMA_REFRESH=1 to fetch again.
set -euo pipefail

die() { echo "figma-node: $*" >&2; exit 1; }
command -v figma-pp-cli >/dev/null || die "figma-pp-cli is not installed. See the figma skill."
command -v jq >/dev/null || die "jq is not installed."

[ $# -ge 1 ] || die "usage: figma-node.sh <figma-url> [depth] | <file_key> <node_id> [depth]"

if [[ "$1" == http* ]]; then
  url="$1"
  depth="${2:-4}"
  key="$(sed -nE 's#.*/(design|file|proto|board)/([A-Za-z0-9]+).*#\2#p' <<<"$url")"
  node="$(sed -nE 's#.*[?&]node-id=([0-9]+[-:][0-9]+).*#\1#p' <<<"$url")"
  [ -n "$key" ] || die "no file key in URL: $url"
  [ -n "$node" ] || die "no node-id in URL. In Figma, right-click the frame > Copy link to selection."
else
  key="$1"
  node="${2:-}"
  depth="${3:-4}"
  [ -n "$node" ] || die "usage: figma-node.sh <file_key> <node_id> [depth]"
fi

node_colon="${node/-/:}"
node_dash="${node/:/-}"
out="$HOME/.cache/figma-node/$key/$node_dash"
mkdir -p "$out"

fresh() { [ -s "$1" ] && [ "${FIGMA_REFRESH:-0}" != 1 ]; }

# Compact tree for structure and layout.
if ! fresh "$out/frame.json"; then
  figma-pp-cli frame extract "$key" --ids "$node_dash" --depth "$depth" --agent >"$out/frame.json.tmp" \
    || die "frame extract failed: $(head -c 400 "$out/frame.json.tmp")"
  mv "$out/frame.json.tmp" "$out/frame.json"
fi

# Raw node JSON, for exact style values.
if ! fresh "$out/nodes.json"; then
  figma-pp-cli files nodes get-file "$key" --ids "$node_colon" --depth "$depth" --json --no-color --no-input >"$out/nodes.json.tmp" \
    || die "files nodes failed: $(head -c 400 "$out/nodes.json.tmp")"
  mv "$out/nodes.json.tmp" "$out/nodes.json"
fi

# Every distinct text style, with the first text that uses it.
jq '[.. | objects | select(.type? == "TEXT" and (.style? | type) == "object")
     | {family: .style.fontFamily, postScript: .style.fontPostScriptName, weight: .style.fontWeight,
        size: .style.fontSize, lineHeightPx: .style.lineHeightPx, letterSpacing: .style.letterSpacing,
        textCase: .style.textCase, sample: ((.characters // "") | .[0:60]), node: .id}]
    | group_by([.family, .weight, .size, .lineHeightPx, .letterSpacing, .textCase])
    | map(.[0] + {count: length}) | sort_by(-.size)' "$out/nodes.json" >"$out/typography.json"

# PNG render at 2x.
if ! fresh "$out/render.png"; then
  render_url="$(figma-pp-cli images "$key" --ids "$node_colon" --scale 2 --format png --json --no-color --no-input \
    | jq -r '[.. | objects | select(has("images")) | .images | to_entries[] | .value | select(. != null)] | first // empty')"
  [ -n "$render_url" ] || die "no render URL returned for $node_colon."
  curl -sSfL "$render_url" -o "$out/render.png" || die "render download failed."
fi

echo "file_key:   $key"
echo "node:       $node_colon"
echo "frame:      $out/frame.json ($(wc -c <"$out/frame.json" | tr -d ' ') bytes)"
echo "nodes:      $out/nodes.json ($(wc -c <"$out/nodes.json" | tr -d ' ') bytes)"
echo "typography: $out/typography.json ($(jq length "$out/typography.json") styles)"
echo "render:     $out/render.png"
