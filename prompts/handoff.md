---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS - not the current workspace.

Judge the document by whether the fresh agent can reproduce the next action or decision, not by how faithfully it retells the conversation. Keep the information the unfinished task still depends on; drop the rest.

What a handoff must retain depends on the continuation task, so first classify it from the passed arguments (default to "general" if none), then use the matching schema and depth:

- Debugging / fixing a failure ("bug", "fix", "debug", "failing", "crash", "regression"). Keep it tight and recent. Sections: Next action (exact edit/command in flight - file, line, change); Errors verbatim (stack traces / failing tests copied exactly, never paraphrased); Hypothesis & ruled out (theory plus dead ends already tried); Locked decisions; Files in play.
- Exploration / research / design ("explore", "research", "investigate", "design", "compare", "evaluate"). Keep the scattered findings, including early ones. Sections: Goal & open question; Findings map (every load-bearing discovery with its source path/URL); Surveyed & ruled out (options already examined, so the fresh agent does not re-survey); Locked decisions; Next action; Sources in play.
- General (anything else). Sections: Next action; Hypothesis & ruled out; Errors verbatim; Locked decisions; Files in play.

Store decisions and constraints exactly - never compress them into prose that could drop them. Summarise repeated evidence only when the summary clearly preserves its effect on the task; otherwise keep the original observation.

Include a "suggested skills" section in the document, which suggests skills that the agent should invoke.

Name the detected task type near the top of the document so the reader can see how it was scoped.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
