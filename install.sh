#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

link() {
  local src="$1" dst="$2"
  mkdir -p "$(dirname "$dst")"
  if [ -L "$dst" ]; then
    rm "$dst"
  elif [ -e "$dst" ]; then
    echo "SKIP (exists, not symlink): $dst"
    return
  fi
  ln -s "$src" "$dst"
  echo "  $dst -> $src"
}

echo "==> Skills → ~/.agents/skills/"
for skill in "$REPO_DIR"/skills/*/; do
  name="$(basename "$skill")"
  link "$skill" "$HOME/.agents/skills/$name"
done

echo "==> Extensions → ~/.pi/agent/extensions/"
for ext in "$REPO_DIR"/extensions/*.ts; do
  name="$(basename "$ext")"
  link "$ext" "$HOME/.pi/agent/extensions/$name"
done

echo "==> Prompts → ~/.pi/agent/prompts/"
for prompt in "$REPO_DIR"/prompts/*.md; do
  name="$(basename "$prompt")"
  link "$prompt" "$HOME/.pi/agent/prompts/$name"
done

echo "==> Claude commands"
# security/audit → reuse prompts/security-audit.md
link "$REPO_DIR/prompts/security-audit.md" "$HOME/.claude/commands/security/audit.md"

echo "Done."
