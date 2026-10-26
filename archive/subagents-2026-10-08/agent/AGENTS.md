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

Applies only when a `subagent` tool is available; ignore otherwise.

- Delegate self-contained, token-heavy work to keep your own context small: multi-file codebase recon, implementation plans, executing an approved plan, code review.
- Calls are serialized — one child at a time. Prefer several small delegations over asking one child to orchestrate other children.
- Spell the task out in full; the child inherits no conversation history, only the task text.
- Do not delegate trivial lookups that a single read or grep answers; subprocess overhead outweighs the benefit.

The `technical-writing` skill above carries the full technical-text standard. When you cannot load it, hold the baseline in the Writing section, plus: imperative for steps, simple tenses, no should/would/may/might, one word per meaning, keep articles and "that", and keep code and identifiers exact.


When reporting information to me, be extremely concise and sacrifice grammer for the sake of concision. 
