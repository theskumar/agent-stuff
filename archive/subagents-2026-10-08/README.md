# Subagent manager trial

Archived on 2026-10-08 before switching to [Arnav Gupta's manager](https://github.com/championswimmer/pi-subagent-manager).

## Preserved setup

- `extensions/subagent.ts` preserves the serial, attachable tmux and herdr implementation.
- `agents/` preserves the six legacy presets.
- `prompts/implement.md` preserves the old chain workflow.
- `agent/AGENTS.md` preserves the old delegation instructions.
- `install.sh` preserves the symlink installer before the switch.

Local settings backup: `~/.pi/agent/backups/subagents-2026-10-08/settings.json`. The backup is outside this repository.

## Trial configuration

The global package source is `npm:pi-subagent-manager`. The installed version is `0.2.0`. The registry advertises `0.19.0`, but npm's configured release-date cutoff rejects that release. The trial does not bypass the cutoff.

`~/.pi/agent/subagent-manager/settings.json` sets three total levels, two concurrent threads, and sixteen retained threads. These are thread limits, not a dollar budget.

The old extension is no longer in the active `extensions/` directory. Its global symlink is removed. Legacy preset sources remain in the repository, but their global symlinks are removed and the installer no longer activates them.

The global delegation instructions now distinguish inherited children, fresh-context review, and separate project sessions. `/implement` uses staged research, main-thread planning, implementation, and independent review instead of the retired chain API.

## Compatibility findings

- The old tool accepts one task at a time. It does not implement the archived chain API referenced by the old `/implement` prompt.
- The new manager rejects symlinked agent definitions. Its schema uses `thinkingLevel`, ordered `models`, and `tools.allow` or `tools.block`. Legacy files are not drop-in replacements.
- Children in the installed version do not automatically load extensions, skills, or context files. Task prompts must carry applicable instructions and required skill paths.
- The installed manager saves separate child JSONL transcripts and tracks them from the parent. It does not put every transcript in one JSONL file.
- Child agents share the working directory and OS permissions. Tool policies are not a sandbox.
- Existing project handoff notes remain useful. Same-directory child agents do not replace long-lived sessions in other repositories.

## Validation

The package loads through the installed Pi extension loader without errors or warnings. It registers `/agents` and nine `agent_*` tools. The configuration loader reports no diagnostics and exposes three bundled types: `architect`, `researcher`, and `worker`. `bash -n install.sh` and `git diff --check` pass.

No model-backed child task has been run. Provider compatibility, steering, and resume still need a live trial. No Pi-Pocket history is part of this audit.

## Try the manager

1. Start a fresh Pi CLI session.
2. Open `/agents` to inspect limits and available types.
3. Ask for one bounded, read-only task with a `researcher` child.
4. Inspect the child and try steering before testing parallel work.

## Restore the old tool

1. Run `pi remove npm:pi-subagent-manager`.
2. Copy `extensions/subagent.ts` from this archive to the repository's active `extensions/` directory.
3. Restore the legacy agent-link loop in `install.sh` from this archive.
4. Restore the delegation section and `/implement` only if the old behavior is wanted. The old `/implement` chain prompt was already incompatible with the serial tool.
5. Run `./install.sh`.
6. Start a fresh Pi CLI session.

Do not restore the entire settings backup over later configuration changes. Remove only the trial package when rolling back. No commits or pushes were made for this trial.
