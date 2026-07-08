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

echo "==> Themes → ~/.pi/agent/themes/"
for theme in "$REPO_DIR"/themes/*.json; do
  name="$(basename "$theme")"
  link "$theme" "$HOME/.pi/agent/themes/$name"
done

echo "==> Extensions → ~/.pi/agent/extensions/"
for ext in "$REPO_DIR"/extensions/*.ts; do
  name="$(basename "$ext")"
  link "$ext" "$HOME/.pi/agent/extensions/$name"
done
# Directory extensions (folder with index.ts)
for ext in "$REPO_DIR"/extensions/*/; do
  [ -f "$ext/index.ts" ] || continue
  name="$(basename "$ext")"
  link "${ext%/}" "$HOME/.pi/agent/extensions/$name"
done

echo "==> Agents → ~/.pi/agent/agents/"
for agent in "$REPO_DIR"/agents/*.md; do
  name="$(basename "$agent")"
  link "$agent" "$HOME/.pi/agent/agents/$name"
done

echo "==> Prompts → ~/.pi/agent/prompts/"
for prompt in "$REPO_DIR"/prompts/*.md; do
  name="$(basename "$prompt")"
  link "$prompt" "$HOME/.pi/agent/prompts/$name"
done

echo "==> Global AGENTS.md → ~/.pi/agent/AGENTS.md"
link "$REPO_DIR/agent/AGENTS.md" "$HOME/.pi/agent/AGENTS.md"

echo "==> Skills → ~/.claude/skills/ (Claude Code)"
# Skills that should be available in both pi and Claude Code
CC_SKILLS=(commit github granola librarian uv summarize mermaid sentry notion pr-summary codemagic)
for name in "${CC_SKILLS[@]}"; do
  link "$HOME/.agents/skills/$name" "$HOME/.claude/skills/$name"
done

echo "==> Skills → ~/.pi/agent/skills/ (pi agent)"
PI_SKILLS=(google-workspace librarian mermaid notion sentry codemagic)
for name in "${PI_SKILLS[@]}"; do
  link "$HOME/.agents/skills/$name" "$HOME/.pi/agent/skills/$name"
done

echo "==> Claude commands"
# security/audit → reuse prompts/security-audit.md
link "$REPO_DIR/prompts/security-audit.md" "$HOME/.claude/commands/security/audit.md"
# Prompts portable to Claude Code (filename becomes the slash command).
# Excluded: commit.md (uses pi-specific !{cmd} inline-bash syntax),
# implement.md (needs the pi-only subagent tool).
CC_PROMPTS=(
  amazon-search
  summarize-url
  go
  create_a_skill
  create_idea_compass
  create_micro_summary
  create_user_story
  edit-article
  extract_wisdom
  handoff
  humanize
)
for name in "${CC_PROMPTS[@]}"; do
  link "$REPO_DIR/prompts/$name.md" "$HOME/.claude/commands/$name.md"
done

echo "==> Pruning dead symlinks"
find "$HOME/.pi/agent" "$HOME/.agents" "$HOME/.claude" \
     -xtype l -print -delete 2>/dev/null || true

echo "Done."
