# Global instructions

When reporting information to me, be extremely concise and sacrifice grammer for the sake of concision.

## Where things live

- Global skills: `~/.agents/skills/<name>/SKILL.md` (symlinks into `~/code/agent-stuff/skills`). Most are user-only, so they are not in your skill list. When a rule here names a skill, read its SKILL.md by that path.
- Pi extensions: `~/code/agent-stuff/extensions`, linked from `~/.pi/agent/extensions`. Pi settings: `~/.pi/agent/settings.json`.
- Session logs: `~/.pi/agent/sessions/<cwd-slug>/*.jsonl`.
- Household books: `~/Documents/paisa/`. Read its AGENTS.md first.
- Short commands on PATH (`~/code/agent-stuff/bin` and skill scripts, linked by `install.sh`; `<cmd> --help` for usage):
  - `slack`: Slack CLI (`slack draft` for drafts).
  - `notion`: Notion pages and databases.
  - `amazon search <query> [--min N --max N]` and `amazon product <asin-or-url>`: Amazon.in listings as JSON.
  - `ci-wait [pr]`: wait for PR checks, then print failing job logs. Use it instead of `sleep` polling.

## External research

- Web search: use `web_search`. Put related queries in one call with `queries`.
- Library or framework source: use `~/.agents/skills/librarian/SKILL.md` to get a cached checkout, then read and grep it. Use `fetch_content` for GitHub pull requests and issues.
- Amazon: use `amazon`.
- Other retail, social and maps sites (Flipkart, Croma, Myntra, X, LinkedIn, Instagram, Google Maps): use Obscura, `~/.agents/skills/web-browser/scripts/obscura.js` (usage in `~/.agents/skills/web-browser/SKILL.md`).
- Any other URL: use `fetch_content` first. Re-fetch with Obscura when the result is an error, only nav or boilerplate, or lacks the fact you came for.

## Slack

Read `~/.agents/skills/slack/SKILL.md` before any Slack work. When I ask for a Slack message, reply or DM draft, create it in Slack with `slack draft`, then show me the text.

## Codemode

- Show an image with `image(await tools.read({path}))`. A returned image block arrives as base64 text.
- Write long or markdown text to files with `tools.write`, built from `String.raw` or a plain string. Backticks and `${` inside a JS template literal break the script.
- End a `grep` that may match nothing with `|| true`.
- Call `Agent`, `get_subagent_result` and `steer_subagent` as top-level tools; codemode does not expose them.

## Subagent delegation

- Tools: `Agent` (types: explore, general-purpose, plan), `get_subagent_result`, `steer_subagent`.
- Keep planning, approvals and user conversation in the main thread. Delegate bounded research, implementation and review.
- Children do not load global instructions or skills. Put the rules, skill paths, file ownership and acceptance checks in each prompt.
- Run tasks in parallel only when they cannot touch the same files or ports.
- For work in another repository, write a handoff note and start a separate session there.
- Do a lookup that one read or grep answers yourself.
