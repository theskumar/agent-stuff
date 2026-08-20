# Archive

Retired code kept for reference. Nothing here is symlinked by `install.sh`.

| Path | Retired | Why |
|---|---|---|
| [`extensions/subagents/`](extensions/subagents/) | 2026-07-27 | Replaced by [`extensions/subagent.ts`](../extensions/subagent.ts) (mitsuhiko's serial tmux-backed version) for attachability. This one did parallel/chain fan-out over headless `pi --mode json` subprocesses with agent personas from [`agents/`](../agents/), claude-bridge model pinning, and token/cost accounting — but children were unobservable black boxes until exit. |
| [`prompts/humanize.md`](prompts/humanize.md) | 2026-08-20 | Superseded by the [`unslop`](../skills/unslop/) skill, which covers the same rewrite-to-human goal as a checklist and now applies by default via the global AGENTS.md writing rule. |
