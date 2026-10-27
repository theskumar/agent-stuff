---
disable-model-invocation: true
name: adr
description: Write, supersede, or review Architecture Decision Records (ADRs).
---

# ADR

## Find the repo's setup

Before you write, find the repo's existing ADRs.
If it has some, follow their folder, template, numbering, file names, and index.
If it has none, create `docs/adr/0001-title-with-dashes.md` and a `docs/adr/README.md` index.

## Write an ADR

Use these sections: Status, Date, Context, Considered Options (pros and cons for each), Decision, Consequences (Positive, Negative, Risks), Implementation Notes.
If the repo has a template, keep its section names and order, and add any of these sections it lacks.
Use only facts from the request, the repo, and any notes you were given.
Mark anything else as an assumption.
Keep it under two pages.
Name the real costs under Negative.
Link related ADRs by number.
Set Status to Proposed, Accepted, Rejected, Deprecated, or `Superseded by ADR-NNNN`.
If the team has not agreed yet, set Status to Proposed.

## Change a decision

Treat an Accepted ADR as fixed history.
To change or reverse an accepted decision, write a new ADR.
In the new ADR, name and link the ADR it supersedes.
In the old ADR, change only the Status line to `Superseded by ADR-NNNN`.
If the decision is dropped with no replacement, set the old Status to Deprecated instead.
If an ADR is still Proposed, edit it in place.

## Keep the index current

After you add an ADR or change a Status, update the index row for every ADR you touched: link, title, status, date.
Make each index status match the Status line in its file.
