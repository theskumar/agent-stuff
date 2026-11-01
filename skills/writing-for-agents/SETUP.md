# Setup: where agent documents live

The machine-specific half of [`writing-for-agents`](SKILL.md). Edit the source copy; the other paths are symlinks.

| Document | Source to edit | Loaded from |
|---|---|---|
| Global skill | `~/code/agent-stuff/skills/<name>/` | `~/.agents/skills/<name>` (pi). Claude Code only gets skills listed in `CC_SKILLS` in `install.sh` |
| Project skill | `<repo>/.claude/skills/<name>/` | pi and Claude Code, in that repo only |
| Global `AGENTS.md` | `~/code/agent-stuff/agent/AGENTS.md` | `~/.pi/agent/AGENTS.md` |
| Project `AGENTS.md` | repo root | that repo; KB repos also keep memory in `.context/` |
| Prompt template | `~/code/agent-stuff/prompts/<name>.md` | `~/.pi/agent/prompts/` as `/name`; `CC_PROMPTS` in `install.sh` for Claude Code |
| Extension (deterministic check) | `~/code/agent-stuff/extensions/<name>.ts` | `~/.pi/agent/extensions/` |

- Run `~/code/agent-stuff/install.sh` after you add a global skill, prompt or extension. It creates the links and prunes dead ones.
- Add a row to the matching table in `~/code/agent-stuff/README.md` for each new global skill or extension.
- Scope by use: a skill that only one repo needs lives in that repo's `.claude/skills/`.
- `~/.claude/skills/synced/` belongs to Claude Desktop, which rewrites it. Leave it alone.
- Prose for humans (posts, messages, READMEs read by people) follows `~/.agents/skills/unslop/SKILL.md`. This skill covers text an agent reads.

## Verify a change

A no-op or a weak pointer only shows up when the document runs. From a scratch directory, run a fresh session that hits the branch you changed:

```bash
cd /tmp && pi -p --no-session '<a prompt that should reach the material>'
```

The change is done when the reply shows the agent reached the material (it quotes the rule, uses the path, or runs the step).
