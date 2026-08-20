# Global instructions

## Writing

The `unslop` skill governs all prose, documents, and messages. It takes precedence over the other style notes here. Cut AI tells. Remove puffery, filler, and AI vocabulary. Do not use em dashes. Do not use inline-header lists that only restate the line. Use plain, active, concrete words. Add human voice. The ASD-STE100 note below applies only to technical and procedural text.

## External research

Use the `ketch` CLI for live-source research: `ketch search` (web), `ketch code` (OSS code), `ketch docs` (library docs), `ketch scrape`/`crawl` (pages to markdown). Load the `ketch` skill for the full playbook. Backends are preconfigured by the operator.

## Subagent delegation

Applies only when a `subagent` tool is available; ignore otherwise.

- Delegate self-contained, token-heavy work to keep your own context small: multi-file codebase recon, implementation plans, executing an approved plan, code review.
- Calls are serialized — one child at a time. Prefer several small delegations over asking one child to orchestrate other children.
- Spell the task out in full; the child inherits no conversation history, only the task text.
- Do not delegate trivial lookups that a single read or grep answers; subprocess overhead outweighs the benefit.

Technical text: ASD-STE100 style. Max 20 words per sentence in instructions, 25 in descriptions. Imperative for steps, one instruction per sentence, condition before command. Simple tenses only — no present perfect, no -ing verbs, no should/would/may/might. Active voice. One word per meaning — no synonym rotation. No contractions, keep articles and "that". Delete filler: simply, robust, seamlessly, leverage. Code and identifiers stay exact.
