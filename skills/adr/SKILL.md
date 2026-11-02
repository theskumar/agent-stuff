---
disable-model-invocation: true
name: adr
description: Write, supersede, or review Architecture Decision Records (ADRs).
---

## Find the repo's setup

Before you write, find the repo's existing ADRs.
If it has some, follow their folder, template, numbering, file names, and index.
If it has none, create `docs/adr/0001-title-with-dashes.md` and a `docs/adr/README.md` index.

## Write an ADR

If the repo has an ADR template, use its sections and order as-is.
If it has none, use these sections: Status, Date, Context, Considered Options, Decision, Consequences (Positive, Negative, Risks), Implementation Notes.
List at least two real options, each with pros and cons.
Include keeping the current approach when that is a real choice.
Use only facts from the request, the repo, and any notes you were given.
Mark anything else as an assumption.
Keep it under two pages.
Name the real costs in the consequences.
Link related ADRs by number.
Set Status to Proposed, Accepted, Rejected, Deprecated, or `Superseded by ADR-NNNN`.
If the team has not agreed yet, set Status to Proposed.
To review an ADR, check it against the rules in this section, list each gap, and leave the file unchanged.

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
