# Global instructions

## Writing

The `unslop` skill governs all prose, documents, and messages. It owns the slop-pattern catalog: AI vocabulary, filler, hedging, em dashes, and formatting tells. Cut AI tells. Use plain, active, concrete words. Add human voice.

For docs, RFCs, readmes, PR descriptions, and commit messages, also apply the `technical-writing` skill. It carries the formal standard: Diátaxis mode, Google developer sentence style, STE instruction rules, and Global English syntax. It defers to `unslop` for slop patterns.

Baseline for technical text when neither skill is loaded: one instruction per sentence, condition before command, active voice with a named actor, short sentences (about 20 words for steps, 25 otherwise), one name per thing, real symbol and path names, no em dashes.

## External research

Two tool classes. Route by task, not by habit.

- Discovery (search, code, docs): use the `ketch` CLI. `ketch search` (web), `ketch code` (OSS code), `ketch docs` (library docs). Load the `ketch` skill for the full playbook. Backends are preconfigured by the operator. Obscura has no search index, so it cannot replace these.
- Fetch a known URL. You usually cannot tell static from JS-rendered before fetching, so do not try to classify upfront. Use these two rules instead:
  - Known app-shell or anti-bot domains: go straight to Obscura from the `web-browser` skill. This list includes retail, social, and maps: Amazon, Flipkart, Croma, Reliance Digital, Myntra, X/Twitter, LinkedIn, Instagram, Google Maps. Probe first with `obscura.js check <url>`; if `blocked`, escalate to Chrome with a copied profile.
  - Anything else: try `ketch scrape` first (cheap, token-budgeted, no JS).

Escalation rule: escalate on a detectable failure signal, not a guess. Re-fetch with Obscura when `ketch scrape` shows any of these: frontmatter `words:` near zero, output is only nav or boilerplate or a cookie banner, or the specific fact you came for is absent. Do not fall back to SERP snippets.

## Subagent delegation

Applies when `agent_spawn` or `subagent` is available. Use the tool's actual schema.

- Keep planning, approvals, and user conversation in the main thread. Delegate bounded research, implementation, and review tasks.
- With `agent_spawn`, discover types with `agent_types`. Use `/root/task` for inherited context and `/task` for fresh context. Include all needed instructions in fresh-context tasks.
- Children do not automatically load global instructions or skills. Include the applicable rules, required skill paths, file ownership, and acceptance checks in each task.
- Start with one child. Run independent tasks in parallel only when they cannot modify the same files or compete for ports. Respect configured depth and concurrency limits.
- With the legacy `subagent` tool, use one child at a time and spell out the complete task. Do not assume inherited history.
- For work in another repository, keep a durable handoff note and start a separate session there. Same-directory child agents do not replace project handoffs.
- Do not delegate trivial lookups that one read or grep answers.

The `technical-writing` skill above carries the full technical-text standard. When you cannot load it, hold the baseline in the Writing section, plus: imperative for steps, simple tenses, no should/would/may/might, one word per meaning, keep articles and "that", and keep code and identifiers exact.


When reporting information to me, be extremely concise and sacrifice grammer for the sake of concision. 
