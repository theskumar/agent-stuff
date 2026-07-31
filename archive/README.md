# Archive

Retired code kept for reference. Nothing here is symlinked by `install.sh`.

| Path | Retired | Why |
|---|---|---|
| [`extensions/subagents/`](extensions/subagents/) | 2026-07-27 | Replaced by [`extensions/subagent.ts`](../extensions/subagent.ts) (mitsuhiko's serial tmux-backed version) for attachability. This one did parallel/chain fan-out over headless `pi --mode json` subprocesses with agent personas from [`agents/`](../agents/), claude-bridge model pinning, and token/cost accounting — but children were unobservable black boxes until exit. |
