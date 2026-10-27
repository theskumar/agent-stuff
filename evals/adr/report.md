# adr skill diet

**Verdict: ship, with caveats.** after passes 30/30, the same as before, and uses 25% fewer tokens per run. A blind judge split 8 after / 7 before. The official `score` exits 1 only on 2 false WARNs (see Eval). A copy of the scorer with that heuristic narrowed exits 0, with no MISS or WORSE.

## Tokens per level (estimated as bytes / 4)

| level | before | after |
| --- | --- | --- |
| description (every session) | 0 (user-invoked); text 246 B ≈ 62 | 0 (user-invoked); text 65 B ≈ 16 |
| SKILL.md | 13,030 B ≈ 3,250 | 1,597 B ≈ 400 (−88%) |
| references | none | none |
| typical task load (SKILL.md via `/skill:adr`) | ≈ 3,250 | ≈ 400 |
| measured tokens/run in the eval | 34,543 | 26,075 (−25%) |

Usage: no `/skill:adr` (or old name `architecture-decision-records`) invocations in the last 60 days of Pi or Claude Code logs. In that time the user asked for about 20 ADR tasks without the skill: "build up an ADR … two options", "draft an ADR here", "update that ADR". The eval tasks are based on those requests.

## Eval (gpt-6-luna via pi, 10 tasks × 3 runs, local fixture repos)

| version | success | tokens/run | output tok/run | turns/run | wall s/run |
|---|---|---|---|---|---|
| before | 30/30 | 34,543 | 1,256 | 5.6 | 45 |
| after | 30/30 | 26,075 | 2,344 | 6.0 | 72 |
| none | 26/30 | 16,232 | 1,106 | 5.9 | 43 |

| task | before | after | none |
|---|---|---|---|
| new-adr | 3/3 | 3/3 | 3/3 |
| supersede | 3/3 | 3/3 | 1/3 |
| edit-accepted (don't rewrite an accepted ADR) | 3/3 | 3/3 | 2/3 |
| skip-trivial | 3/3 | 3/3 | 3/3 |
| rejected | 3/3 | 3/3 | 3/3 |
| y-statement | 3/3 | 3/3 | 3/3 |
| adr-tools | 3/3 | 3/3 | 3/3 |
| fix-index | 3/3 | 3/3 | 2/3 |
| review | 3/3 | 3/3 | 3/3 |
| draft-notes | 3/3 | 3/3 | 3/3 |

- `score` (official): exit 1 with 2 WARNs. Both come from after runs whose `find`/`rg` globs (`*/docs/adr/*`) matched the scorer's "read the skill from outside sk/" test, because the skill is named `adr`. Neither run read a skill file. `scripts/eval-local.mjs` is a copy with one changed line: it counts only paths ending in `/adr/SKILL.md` or under `/sk/`. It exits 0 (`score-local.txt`). Fixture ADRs live in `docs/decisions/` for the same reason.
- Scorer fixes made before the after runs, each confirmed by a fresh no-skill judge (`judge/loosen-*`): negatives regex broadened; "supersedes" wording no longer required in the new ADR; "Proposal" accepted as the decision heading; y-statement no longer requires canonical keywords; "Probably not" accepted; the adr-tools call log moved into `.git/` because agents deleted it. Changed tasks were rerun in every version.
- Blind judge, v3 (shipped): 15 before/after pairs, random order, fresh pi session. after 8, before 7. before won all new-adr and draft-notes pairs: after added unrelated ADR links and too many caveats. after won 8 of 9 supersede, rejected and edit-accepted pairs because it flags assumptions. Details are in `judge/blind-key.json`.
- Step-5 cases for cut or uncovered content (`cases/`, after only, 3 runs each): repo with no ADRs → `docs/adr/0001-*` + index 3/3; deprecate with no replacement 3/3; Implementation Notes present 3/3; review raises security, cost, reversibility or operations 3/3. Implementation Notes failed 0/3 in an earlier draft, so it went back in.
- Rules review by a fresh session: `judge/rules-review.md`.

## What moved where

All of it stays in SKILL.md. There are no references because every remaining line applies to most tasks. The user's uncommitted `disable-model-invocation: true` edit is kept. The description is now one user-facing line.

- Directory structure example → "find the repo's existing ADRs and follow them; else `docs/adr/0001-…` + `README.md` index".
- Template 1 (MADR) → one line listing the sections, plus "repo template wins, add missing sections".
- Lifecycle diagram and status meanings → one Status line.
- Template 4 (deprecation) and "Don't change accepted ADRs" → "Change a decision" section (supersede, Deprecated, edit Proposed in place).
- Index README example → "Keep the index current" (none failed this 1/3).
- New line: "Use only facts from the request, the repo, and any notes; mark anything else as an assumption." The blind judge's top complaint in both versions was invented specifics.

## What was cut

- What ADRs are, the when-to-use list, and the write/skip table. none passes skip-trivial 3/3.
- Templates 2–5 (lightweight, Y-statement, deprecation, RFC). The model knows them, and y-statement passes 3/3 with none.
- adr-tools commands. adr-tools passes 3/3 with none, and the repo's `adr help` covers them.
- Review checklist and do's/don'ts. review passes 3/3 with none. Human process steps (two senior reviewers, notify the team, file tickets) were also cut.
- Resources links.

## Risks

- after writes longer ADRs: 291 vs 221 words, 2,344 vs 1,256 output tokens per run, 72 vs 45 s wall time. Most of the increase comes from Implementation Notes, Risks and assumption labels. Total tokens per run still drop 25%.
- Blind quality is a tie within noise. A v4 that tightened the facts and linking lines regressed: 27/30, judge 6–9. It was discarded (`old-after-v4/`).
- Adapter changes: pi runs under `sandbox-exec`, which blocks reads of `~/**/skills/*` and the other eval versions. Without it, none runs found the real skill in `~/.agents/skills/adr`. The adapter also snapshots the work dir for judging. Calibration still flakes when the none agent types a search for `adr/SKILL.md` (the read is blocked), so `scripts/run.sh` retries.
- The tool skill steps (T1–T4) were skipped because the skill teaches no tool it ships.
