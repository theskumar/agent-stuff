#!/bin/sh
# Eval task setup: a stub ntn outside the work dir, first on PATH (the adapter prepends its bin/), plus input files.
set -e
F=/tmp/skill-diet-work/notion/fixtures
STUB="${TMPDIR:-/tmp}/ntnstub-$(basename "$PWD")"
mkdir -p "$STUB/bin"
cp "$F/ntn" "$STUB/bin/ntn"
chmod +x "$STUB/bin/ntn"
: > "$STUB/ntn-log.jsonl"
cp "$F/notes.md" notes.md
cp "$F/diagram.png" diagram.png
