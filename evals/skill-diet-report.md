# skill-diet trial: report

I ran [skill-diet](https://github.com/nicobailon/skill-diet) 0.1.0 on three of my skills on 2026-10-27: `adr`, `notion` and `web-browser`. All three got smaller, and none scored worse. The bigger payoff was the drift check. It found 16 places where a skill or its scripts were wrong, and I fixed most of them in the scripts. Running it took about 4 hours, 1,434 agent sessions and 23.5M tokens.

## Results

| Skill | `SKILL.md` size | Eval passes (before / after / no skill) | Tokens per run |
| --- | --- | --- | --- |
| adr | 13.0 KB → 1.6 KB | 30 / 30 / 26 of 30 | 34.5k → 26.1k (−25%) |
| notion | 14.0 KB + 6.9 KB refs → 9.6 KB + 2.3 KB refs | 32 / 33 / 18 of 33 | 23.9k → 10.9k (−55%) |
| web-browser | 16.0 KB → 6.4 KB + 3.3 KB refs | 32 / 31 / 18 of 33 | 10.9k → 6.4k (−41%) |

Model: `openai/gpt-6-luna` through pi. Each skill had 10 or 11 tasks, run 3 times per version in fresh sessions. The token counts include cache reads at full price, so use them to compare versions, not to estimate cost.

After the diet, I applied the script fixes it proposed. That cut `notion` to 9.1 KB and `web-browser` to 5.8 KB, because lines that warned about tool bugs could go. Commits: `1141998` (diet), `e3bc8b1` (notion fixes), `01d1098` (web-browser fixes), `efe03f9` (eval kits in [`evals/`](.)).

## How skill-diet works

skill-diet is itself a skill: a 2.4 KB `SKILL.md`, five reference files and two Node scripts. The agent does the work. The scripts keep the measurement honest.

### The levels

Every fact goes on the lowest level that still reaches the agent in time:

| Level | Holds | Loaded |
| --- | --- | --- |
| `description` | one trigger per case | every session |
| `SKILL.md` | what every task needs | when the skill is used |
| `references/` | what only some tasks need | when that case comes up |
| the tool's `--help` | flags, values, examples | when the agent picks that command |
| the tool's errors | the fix and the next step | when a guess is wrong |

The last two levels matter most. A skill that copies a CLI's reference goes stale. A clear error message replaces a paragraph of skill prose and is always correct.

### A full diet

1. **Baseline.** Copy the skill aside as `before`, measure each level, and list every consumer (prompts, other skills, tests).
2. **Tool steps**, for a skill that teaches a tool:
   - List the tool's public operations.
   - Prove each mismatch between skill and tool by running it or citing a source line.
   - Count real calls and errors in 60 days of session logs. The calls that cover about 90% of use become the cheat sheet.
   - Check the tool's help and errors. Each gap becomes a proposed tool fix.
3. **Place.** Write the eval tasks first, from real session requests, before anything is cut. Then sort each piece onto a level.
4. **Cut and write.** Cut what the model already knows and what only a human needs. Turn lists of cases into the rule behind them.
5. **Verify.** Run the eval, then a fresh reviewer checks that every rule in `before` has a home or was cut on purpose. Each cut piece that no task covers gets a one-line case, run 3 times. It goes back in unless all 3 pass.

### The eval

- **Three versions:** `before`, `after` and `none` (no skill). A task that `none` passes marks lines the model doesn't need.
- **The adapter** is a small script that your agent writes. It runs one session with exactly one copy of the skill and writes `result.json` with the answer, tokens and tool calls.
- **Calibration** runs before every eval. The agent must quote a line only its copy holds, say it has no skill when given none, and run a shell command. A leaky adapter stops the eval instead of skewing it.
- **The scorer** (`eval.mjs score`) checks each run against the task's `must` patterns and `check` command. It exits non-zero when `after` does worse than chance would explain.
- **Quality tasks** (prose, like an ADR) also get a blind judge: a fresh session compares before/after pairs in random order.

### Upkeep after the diet

`SKILL.md` stays installed, so every later edit follows five steps. Stop at the first one that handles the change:

1. Fix the tool.
2. Add nothing the model does anyway.
3. Edit the line that already covers the idea.
4. Pick the level.
5. Write the rule, not the story.

Each commit records the size before and after. A skill 10% over its last diet is due for another.

## Per-skill notes

### adr

- The model knows ADRs. With no skill it passed 26 of 30, so the five templates, the lifecycle diagram and the review checklist all went.
- One line was added. The blind judge's top complaint, about both versions, was invented details. `after` now says to use only facts from the request, repo and notes, and to mark anything else as an assumption.
- The blind judge split 8 to 7 for `after`. `after` writes longer ADRs: 2.3k output tokens per run against 1.3k.
- One cut piece (Implementation Notes) failed its case 0/3 and went back in.

### notion

- 60 days of logs: 515 calls in 49 sessions. No session ever opened a reference file, so whatever lived there was effectively invisible.
- Without the skill, the agent did one-line edits with `pages update`, which replaces the whole page, and then reported success.
- Drift found: `notion.api.spec` broke on multi-method paths, `db query --json` printed TSV, uploads lost their file name, unknown flags became arguments, and the `after` block parameter is deprecated.

### web-browser

- With no skill, runs used twice the tokens of the old skill (22k against 10.9k), because the agent explored the scripts by hand.
- 0 of 33 eval runs opened a reference, so the diet kept anything most tasks need in `SKILL.md`.
- Two cut pieces failed their cases: the `--list-profiles` line (1/3) and "never attach to the live Chrome" (0/3). Both went back in.
- Drift found: `agent.mjs --domain x.com` set no allow-list and added "x.com" to the task text. `obscura.js` never passed `--stealth`. The skill claimed `content.js` had no local dependencies. "Current tab" meant the last page in Chrome's target list.

## Problems with skill-diet 0.1.0

- **Installed skills leak into runs.** The adapter hid skills from pi's loader, but `none` agents found `~/.agents/skills/<name>` with `find`. I ran pi under a `sandbox-exec` profile to block those paths. Without it, the `none` numbers are wrong.
- **Calibration fails about half the time by mistake.** The "no skill" check matches command text. A `find -path '*/notion/SKILL.md'` that read nothing still fails it, so I wrapped calibration in a retry script.
- **The scorer gives false warnings** when the skill's name appears in a path: `docs/adr/` in a fixture, or `/notion/` in the work folder name (`eval.mjs:277`).
- **Iteration is the cost.** `adr` took 4 drafts and `notion` took 6. Each draft reruns the eval, so most of the 1,434 sessions went to drafts, judges and spot cases, not the final table.
- **Luna only.** The adapter runs pi with `--no-extensions`, which drops claude-bridge. Testing on Opus needs that one extension loaded with `-e`.

## Verdict

Use it on skills that teach a tool, and on skills over about 8 KB. The before/after/none eval is the part I'd keep even without the rest. It shows which lines the model needs, and the `none` column tells you when a skill pays for itself.

Skip it on small skills about things the model already knows. `adr` cost the most tokens to diet (10.3M) and gained the least.

The lesson I'm keeping: when an agent gets a tool wrong, fix the tool's error message before adding a line to the skill.

## Rerun

See [`README.md`](README.md). Each `evals/<skill>/` folder has its `tasks.json`, adapter, fixtures, stubs and full report.
