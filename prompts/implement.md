---
description: Plan and implement a bounded task with pi-subagent-manager
---
Implement: $@

Keep approvals and coordination in the main thread. Use agent_types to inspect the available types.

1. Spawn a researcher at /root/research to find the relevant code. Request file paths, constraints, and a short handoff.
2. Use that result to prepare a plan in the main thread. Ask for approval before broad changes.
3. After approval, spawn a worker at /root/implementation. Include the approved plan, file ownership, applicable repository rules, required skill paths, and acceptance checks.
4. After implementation, spawn an independent researcher at /review. Include the task, approved requirements, and changed file paths. Request read-only review.
5. Inspect the diff and test results in the main thread. Report remaining risks.

Wait for each phase before starting the next. Use agent_spawn and agent_wait according to their schemas. Do not use the retired chain parameter or {previous} placeholder. Do not commit, push, publish, or deploy unless asked.
