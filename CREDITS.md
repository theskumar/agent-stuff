# Credits

Third-party work in this repo, copied or adapted from other projects. Thank you to every author below. Upstream licenses apply to their files.

When you vendor or adapt something, add a row here and keep the `(source: ...)` note in [README.md](README.md).

## Skills

| Item | Upstream | Author | License | Notes |
|---|---|---|---|---|
| [pr](skills/pr/) | [mattpocock/skills: engineering/pr](https://github.com/mattpocock/skills/blob/main/skills/engineering/pr/SKILL.md) | Matt Pocock | MIT ([LICENSE](skills/pr/LICENSE)) | Adapted at upstream commit e484a80 and merged with the old local `pr-summary`. The Summary visual menu comes from Dex Horthy's [show-me](https://github.com/humanlayer/skills/blob/main/plugins/show-me/skills/show-me/SKILL.md) (HumanLayer, MIT) by way of Matt's skill; the sensitive-area list from Warp's [merge-risk](https://github.com/warpdotdev/common-skills/blob/main/.agents/skills/merge-risk/SKILL.md) (MIT). |
| [statechart](skills/statechart/) | [cursor/plugins: pstack/skills/statechart](https://github.com/cursor/plugins/tree/main/pstack/skills/statechart) | Lauren Tan | MIT ([LICENSE](skills/statechart/LICENSE)) | Copied at upstream commit 2776ddd (2026-11-05), pstack 0.15.36. Upstream `scripts/test/` left out (2.7 MB corpus, not needed at runtime). |
| [technical-writing](skills/technical-writing/) | [cursor/plugins: pstack/skills/technical-writing](https://github.com/cursor/plugins/blob/main/pstack/skills/technical-writing/SKILL.md) | Lauren Tan | MIT | |
| [writing-for-agents](skills/writing-for-agents/) | [mattpocock/skills](https://github.com/mattpocock/skills/tree/main/skills/productivity/writing-for-agents) | Matt Pocock | See upstream | Adapted. |
| [youtube-transcript](skills/youtube-transcript/) | [badlogic/pi-skills](https://github.com/badlogic/pi-skills/tree/main/youtube-transcript) | Mario Zechner | See upstream | |

## Extensions

| Item | Upstream | Notes |
|---|---|---|
| [btw.ts](extensions/btw.ts) | [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) | |
| [loop.ts](extensions/loop.ts) | [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) | |
| [no-sleep.ts](extensions/no-sleep.ts) | [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) | |
| [view-image.ts](extensions/view-image.ts) | [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) | |
| [trust-github-repos.ts](extensions/trust-github-repos.ts) | [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) | Owner allowlist customized. |
| [split-fork.ts](extensions/split-fork.ts) | [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) | Adapted: Ghostty to tmux/herdr. |
| [handoff.ts](extensions/handoff.ts) | [hjanuschka/shitty-extensions](https://github.com/hjanuschka/shitty-extensions) | Adapted for mid-task continuation. |
| [review.ts](extensions/review.ts) | [warpdotdev/common-skills: merge-risk](https://github.com/warpdotdev/common-skills/blob/main/.agents/skills/merge-risk/SKILL.md) | Merge-risk rubric (MIT, Copyright (c) 2026 Denver Technologies, Inc.; itself derived from Matt Pocock's `pr` skill) adapted for PR and branch reviews; the risk level is computed in code, with floors added. Notice kept in the file's merge-risk comment. |
| [inline-bash.ts](extensions/inline-bash.ts) | [earendil-works/pi examples](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/inline-bash.ts) | |

## Prompts

| Item | Upstream |
|---|---|
| [edit-article.md](prompts/edit-article.md) | [mattpocock/skills](https://github.com/mattpocock/skills/blob/main/skills/personal/edit-article/SKILL.md) |
| [to-questionnaire.md](prompts/to-questionnaire.md) | [mattpocock/skills](https://github.com/mattpocock/skills/blob/main/skills/productivity/to-questionnaire/SKILL.md) |

## Themes

| Item | Upstream |
|---|---|
| [modern-dark.json](themes/modern-dark.json) | [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) |
| [nightowl.json](themes/nightowl.json) | [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) |
| [dayowl.json](themes/dayowl.json) | [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) |

## Output styles

| Item | Upstream |
|---|---|
| [caveman.md](output-styles/caveman.md) | [carlosduplar/caveman-output-style-claude-code](https://github.com/carlosduplar/caveman-output-style-claude-code) (details in [SOURCES.md](output-styles/SOURCES.md)) |

## Installed packages (not vendored)

Used as-is from their own repos, listed in [README.md](README.md): [nicobailon/skill-diet](https://github.com/nicobailon/skill-diet), [nicobailon/pi-web-access](https://github.com/nicobailon/pi-web-access), [brettinternet/pi-extensions](https://github.com/brettinternet/pi-extensions) (pi-wait), [k0valik/pi-blackhole](https://github.com/k0valik/pi-blackhole), [agegr/pi-web](https://github.com/agegr/pi-web), [elidickinson/pi-claude-bridge](https://github.com/elidickinson/pi-claude-bridge) (local fork).
