---
name: pr
description: Write a pull request title and body from the diff (context, summary visual, before/after evidence, merge danger) and open or update it with gh.
disable-model-invocation: true
---

# PR

Write facts from the diff and keep the body inside its scope. When you don't know why a change was needed, ask the user before drafting. Use the repo's domain language (`GLOSSARY.md` when present). Skip preambles; keep prose brief.

When the repo has a `PULL_REQUEST_TEMPLATE`, fill in its headings and fit the sections below into them.

## Title

Conventional commit. Lowercase scope. Under 70 chars. No period.

```
feat(subscriptions): revoke access on account deletion
fix(cabinet): make autocomplete case-insensitive
```

## Body

```markdown
<context>

## Summary

<diagram, diff-sketch, or tree>

## Evidence

- **Before:** <screenshot/output/failing test run>
  **After:** <screenshot/output/passing test run>

## Merge Danger

**Door:** <one-way or two-way>

<optional: description>

**Blast Radius:** <one-word description>

<optional: potential ramifications of merge>

Closes <ticket>
```

### Context

One to three sentences, no heading: the problem, ticket or constraint behind the change. Name any drive-by changes and behavior assumptions, so a reviewer can check the diff against the stated intent. End the body with `Closes <ticket>` when there is one.

### Summary

Pick the smallest view that makes the key point clear, and place it next to the one or two lines of text it supports:

- logic or an algorithm: pseudocode
- runtime control flow: a call tree
- UI structure: a component tree, with the state and module boundaries that matter
- file responsibility or a broad refactor: a shallow file tree with one comment per entry
- component interaction or data flow: Mermaid (check it with `~/.agents/skills/mermaid/SKILL.md`)
- a change to an existing shape: a `diff` of that shape, matched to the topic (call tree, file tree, component tree, state flow), not of the source code

```diff
 submitForm
   createSession
     persistPrompt
+    expandSkillMention
     launchAgent
-  navigateToSession
+  navigateToSession
+    subscribeToEvents
```

Show a whole code block only when most of it is new or the reader needs a copyable target shape. Keep only the calls, files, props and states the reviewer needs. One visual is usual; several is rare.

### Evidence

Show that the change works, before and after:

- Screenshots or recordings are best when the change is visual. `gh` cannot upload images, so leave `<!-- screenshot: what to capture -->` and tell the user.
- Execution is next best: test results or console output. Name the exact test that fails before and passes after.
- When a reviewer can exercise the change against a running app, add numbered steps to reproduce.

Paste only output you ran in this session. When something is unverified, list it here.

### Merge Danger

A **two-way door** can be walked back after merge; a **one-way door** cannot (destructive actions, data migrations, published contracts, hard-to-reverse decisions). Cheap rollback means lower risk.

The **blast radius** is everything the merge can affect: consumers of a changed API, layout shift, mobile responsiveness, and so on. Name any sensitive area touched (auth, permissions, payments, PII, secrets, migrations, dependency bumps, infra or config) and how a break would surface (alert, log, failing check).

## Opening the PR

Write the body to a temp file and pass `--body-file`. A heredoc or inline `--body` breaks on the parentheses, backticks and quotes that markdown bodies contain.

```bash
gh pr create --base <base-branch> --head <branch> --title "<title>" --body-file /tmp/pr_body.md
gh pr edit <number> --body-file /tmp/pr_body.md   # update an existing PR
```

## Example

````markdown
All-uppercase cabinet search queries returned no results, even though the SQL
layer matches case-insensitively (ILIKE).

## Summary

The rapidfuzz re-ranking step compared case-sensitively and discarded valid ILIKE matches.

```diff
 autocomplete(q)
   rows = ilike_search(q)
-  return rank(q, rows)
+  return rank(q, rows, processor=default_process)
```

## Evidence

- **Before:** `GET /api/cabinet/autocomplete/?q=TYLENOL` returns `[]`
  **After:** it returns the Tylenol variants, same as `?q=tylenol`
- `test_autocomplete_uppercase_query` fails on main and passes here.

## Merge Danger

**Door:** two-way

**Blast Radius:** search

Ranking only; no schema or API shape change.

Closes CPA-329
````

## Provenance

Adapted from Matt Pocock's [`pr`](https://github.com/mattpocock/skills/blob/main/skills/engineering/pr/SKILL.md) skill at `e484a80` (MIT). Its Summary menu comes from Dex Horthy's [`show-me`](https://github.com/humanlayer/skills/blob/main/plugins/show-me/skills/show-me/SKILL.md) skill (HumanLayer), and the sensitive-area list from Warp's [`merge-risk`](https://github.com/warpdotdev/common-skills/blob/main/.agents/skills/merge-risk/SKILL.md) skill (MIT). Local additions: Context, the conventional-commit title, `--body-file` and the evidence honesty rule. License notices: [`LICENSE`](LICENSE).
