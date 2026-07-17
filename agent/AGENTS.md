# Global instructions

## External research

Use the `ketch` CLI for live-source research: `ketch search` (web), `ketch code` (OSS code), `ketch docs` (library docs), `ketch scrape`/`crawl` (pages to markdown). Load the `ketch` skill for the full playbook. Backends are preconfigured by the operator.

## Subagent delegation

Applies only when a `subagent` tool is available; ignore otherwise.

- Delegate self-contained, token-heavy work to keep your own context small: scout for multi-file codebase recon, planner for implementation plans, worker for executing an approved plan, reviewer for code review.
- Run independent tasks in parallel via `tasks[]`; use chain mode with the `{previous}` placeholder for scout -> planner -> worker handoffs.
- Reserve oracle for long-horizon, complex problems that cheaper agents cannot handle; it is slow and costly.
- Do not delegate trivial lookups that a single read or grep answers; subprocess overhead outweighs the benefit.
