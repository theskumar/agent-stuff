# Global instructions

## External research

Use the `ketch` CLI for live-source research: `ketch search` (web), `ketch code` (OSS code), `ketch docs` (library docs), `ketch scrape`/`crawl` (pages to markdown). Load the `ketch` skill for the full playbook. Backends are preconfigured by the operator.

## Subagent delegation

Applies only when a `subagent` tool is available; ignore otherwise.

- Delegate self-contained, token-heavy work to keep your own context small: multi-file codebase recon, implementation plans, executing an approved plan, code review.
- Calls are serialized — one child at a time. Prefer several small delegations over asking one child to orchestrate other children.
- Spell the task out in full; the child inherits no conversation history, only the task text.
- Do not delegate trivial lookups that a single read or grep answers; subprocess overhead outweighs the benefit.
