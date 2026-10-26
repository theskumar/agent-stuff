# Archive

Retired code kept for reference. Nothing here is symlinked by `install.sh`.

| Path | Retired | Why |
|---|---|---|
| [`subagents-2026-10-08/`](subagents-2026-10-08/) | 2026-10-08 | Snapshot of the custom serial subagent extension, presets, instructions, and installer before trialing `npm:pi-subagent-manager`. Includes validation and rollback steps. |
| [`extensions/subagents/`](extensions/subagents/) | 2026-07-27 | Replaced by the serial extension now preserved in [`subagents-2026-10-08/`](subagents-2026-10-08/) (mitsuhiko's serial tmux-backed version) for attachability. This one did parallel/chain fan-out over headless `pi --mode json` subprocesses with agent personas from [`agents/`](../agents/), claude-bridge model pinning, and token/cost accounting — but children were unobservable black boxes until exit. |
| [`prompts/humanize.md`](prompts/humanize.md) | 2026-08-20 | Superseded by the [`unslop`](../skills/unslop/) skill, which covers the same rewrite-to-human goal as a checklist and now applies by default via the global AGENTS.md writing rule. |
| [`output-styles/simple-english.md`](output-styles/simple-english.md) | 2026-08-20 | Superseded by the [`technical-writing`](../skills/technical-writing/) skill, whose STE layer covers ASD-STE100 plus Diátaxis, Google style, and Global English. Kept for reference (vendored from [AminBlg/SimpleEnglish](https://github.com/AminBlg/SimpleEnglish)). |
