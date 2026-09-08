---
name: html-report
description: >-
  Produce a self-contained, on-brand HTML report for anything meant to be read,
  reviewed, or shared: PR reviews, plan and spec reviews, post-mortems and
  incident writeups, code explainers, status updates, and research summaries.
  Use whenever the user asks for an "HTML report" or "HTML artifact", asks to
  review a PR or plan, write a post-mortem, explain a piece of code, or
  summarize work for a reviewer or stakeholder, even if they do not say "HTML".
  Picks a focus (lens) and an output shape (projection), gathers real context,
  and renders one shareable HTML file.
---

<!-- Ported from https://github.com/darylldoyle/html-report (html-report skill), fetched 2026-08-20.
     Local changes:
     - Brand tokens, logo, theme script, and the full component kit moved to assets/template.html
       (SKILL.md no longer inlines them).
     - scripts/build.py assembles a body fragment into the template, drops unused CSS component
       blocks, and validates the output.
     - Default color theme is Auto (was Light). The verdict card follows light/dark (was always dark).
     - Lens/projection is chosen by asking in plain text, not the AskUserQuestion tool.
     - Prose defers to the existing `unslop` and `technical-writing` skills, not a bundled writing-style skill. -->

# HTML Report

Render one self-contained HTML file, focused by a **lens** and shaped by a
**projection**, grounded in real context, styled with the Fueled brand.

- **Lens** is the single objective for this run. It varies every time.
- **Projection** is the report's shape. Always one self-contained HTML file.
- **Evidence** is constant: cite sources, separate confirmed findings from hypotheses.

The brand tokens, logo, theme toggle, and component CSS live in
`assets/template.html`. You compose only the body; `scripts/build.py` assembles
and validates the file. Do not re-derive CSS in this skill.

## Workflow

### 1. Identify the subject
Infer from what the user gave you: a PR/diff/branch is `pr`; a plan/spec/design
doc is `plan`; an incident/outage/logs is `incident`; a code area or "explain
this" is `explainer`; data/tickets/config to edit is `editing`.

### 2. Choose lens and projection
Ask the user in one plain-text message. List the 2-3 lens options and 2-3
projection options for the detected subject (see catalogues below), ordered by
how often each fits, and invite a written-in custom answer for each. Wait for
the reply. If the user already named both, skip the question. In a
non-interactive run, take the first option of each and state the assumption.

### 3. Gather context
Use the sources the chosen lens names. Do not ask for context you can gather.
Pull from the repo, git history, and connected tools (Slack, Linear, Sentry).
Ground every claim in something you actually read.

### 4. Render
1. Write the body fragment to a file: the `<section>...</section>` blocks that go
   between the header and footer. Use the component classes below.
2. Run the build script:
   ```bash
   python3 scripts/build.py \
     --title "…" --eyebrow "SUBJECT · LENS · DATE" --thesis "one-line verdict" \
     --subject "…" --lens "…" --projection "…" \
     --body body.html --out report.html
   ```
   It fills the header, injects the body, drops unused CSS component blocks, and
   validates (doctype, balanced tags, no `<img src>`, Auto default, theme script,
   no leftover placeholders). It exits non-zero and lists problems on failure.

### 5. Prose style
Do not add a writing-style skill. Follow the repo's existing writing skills:
apply `unslop` to all prose (it owns the slop-pattern catalog and always
applies), and `technical-writing` for structure. Lead with the conclusion,
descriptive headings, short scannable sentences, no em dashes. Tables and specs
are reference material; keep them complete over scannable.

### 6. Evidence discipline
Cite sources per claim. Mark anything inferred but not verified as a hypothesis,
visually distinct from confirmed findings (`.finding` vs `.finding.hypothesis`).
Never invent data to fill a section.

## Lens catalogue

A lens is the single objective for one report. Offer these per subject, most
common first, with the sources that lens should read. Always allow a custom lens.

### pr
1. **Correctness and risk** — bugs, edge cases, regressions, security. Read: the diff, touched files, git blame on changed lines, linked issue.
2. **Explain for a reviewer** — orient someone unfamiliar and walk them through it. Read: the diff, the PR description, surrounding code.
3. **Focus on one subsystem** — deep review of a named area. Read: the diff filtered to that area plus its call sites.

### plan
1. **Feasibility and risk** — will it work, what breaks, what is unknown. Read: the plan files, the code they touch, related past incidents.
2. **Completeness** — gaps, missing cases, unhandled failure modes. Read: the plan files, the interfaces they depend on.
3. **Alternatives and trade-offs** — other approaches and why to prefer one. Read: the plan files, the current implementation.

### incident
1. **Timeline and root cause** — what happened and why, in order. Read: the timeline, deploy history, Sentry, the Slack thread.
2. **Contributing factors and prevention** — systemic causes and action items. Read: the timeline, monitoring config, related incidents.
3. **Blameless stakeholder narrative** — a comms-ready account. Read: the timeline, customer impact data.

### explainer
1. **How it works** — a mental model and the main flow. Read: the core code paths, entry points, key data structures.
2. **Onboarding walkthrough** — for someone new to this area. Read: the code paths, setup and config, common entry tasks.
3. **Gotchas and edge cases** — what bites people. Read: the code, error handling, git history for past fixes.

### editing
1. **Triage and prioritize** — order items by a rule the user gives. Read: the data or ticket source.
2. **Validate and find conflicts** — surface dependencies, contradictions, invalid states. Read: the config or data plus its schema.
3. **Restructure and clean** — reshape messy data into a consistent form. Read: the source data.

## Projection catalogue

A projection is the report's shape, always one self-contained HTML file. Every
projection includes a front-loaded verdict, a sources line, and a visual split
between confirmed findings and hypotheses. Offer these per subject, most common
first. Always allow a custom projection.

- **pr** — *Annotated diff*: verdict, findings by severity, the diff with `.diff` margin notes, open questions, sources. *Review summary*: verdict, findings table, risk callouts, what to test, sources.
- **plan** — *Decision doc*: recommendation, problem, evidence, trade-offs, open questions, sources. *Annotated plan*: summary, the plan with margin annotations, risks inline, sources.
- **incident** — *Timeline report*: summary and impact, timeline with severity bands, root cause, contributing factors, action items with owners, sources. *Exec one-pager*: what happened, impact in numbers, root cause, action items, sources.
- **explainer** — *Single-page explainer*: one-line model, an SVG diagram, 3-4 annotated snippets, gotchas, sources. *Slide deck*: title, one concept per section, a gotchas section, sources.
- **editing** — *Interactive editor*: instructions, an editable UI (cards/form/table), a live preview, and a copy-as-JSON/prompt export button (needs working JS).
- **Cross-cutting** (any subject): *Long-form explainer*, *Slide deck*, *Interactive editor*.

## Components available in the template

Compose the body from these classes. `build.py` keeps only the CSS you use.

- `.verdict` — the front-loaded verdict card (follows light/dark).
- `.pill` `.pill.ok|.warn|.bad` — status chips.
- `table.data` — data tables (`th`, `td`, `td strong`).
- `.finding` / `.finding.hypothesis` — confirmed vs to-verify, with `.kind` and `.cite`.
- `.grid2` + `.card` (+ `h3`, `p`) — side-by-side cards.
- `.weights` + `.weightrow` + `.track` + `.fill` — labelled bar meters.
- `.diff` (`.row`, `.code.add|.del`, `.note`) — annotated diff rows.
- `.sources` — the sources block. `.export` — a copy button for interactive editors.
- Base, always present: `.eyebrow`, `.tag`, `.lede`, `.src-line`, `h2`, `h3`, `ul/li`.

## Branding
`assets/template.html` is the single source of brand truth: palette, type, logo,
and the light/dark/auto tokens. To rebrand every report at once, edit that file.
Never paste the logo as `<img src>`; it is inlined as SVG so it travels with the file.
