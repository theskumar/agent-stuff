/**
 * Split-Fork Extension
 *
 * What it is:
 *   `/split-fork` branches the current pi session: it copies the session
 *   transcript into a fresh session id and spawns a new pi process attached
 *   to that copy in a right-hand tmux split. The original session keeps
 *   running on the left; the fork can diverge freely without touching it.
 *
 *   Requires pi to be running inside a tmux pane.
 *
 *   Adapted from mitsuhiko/agent-stuff (the original used Ghostty +
 *   AppleScript; this port uses tmux `split-window`).
 *
 * Use cases:
 *   - Explore an alternative direction without losing the current thread —
 *     keep the main session intact, experiment in the fork.
 *   - Compare two prompting / model / mode strategies side-by-side from the
 *     same starting point.
 *   - Branch-then-throw-away for risky tool use (e.g. destructive bash
 *     commands) while the original session waits.
 *
 * Common usage patterns:
 *   - `/split-fork` — fork the current session into a new tmux split.
 *   - Work in the right pane on the alternate plan; the left pane is the
 *     original.
 *   - Close the fork (`exit` in the right pane) to drop the experiment, or
 *     keep both panes if both branches turn out useful.
 */

import { randomUUID } from "node:crypto";
import { promises as fs, existsSync } from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

function shellQuote(value: string): string {
  if (value.length === 0) return "''";
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function getPiInvocationParts(): string[] {
  const currentScript = process.argv[1];
  if (currentScript && existsSync(currentScript)) {
    return [process.execPath, currentScript];
  }

  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return [process.execPath];
  }

  return ["pi"];
}

function buildPiCommand(sessionFile: string | undefined, prompt: string): string {
  const commandParts = [...getPiInvocationParts()];

  if (sessionFile) {
    commandParts.push("--session", sessionFile);
  }

  if (prompt.length > 0) {
    commandParts.push("--", prompt);
  }

  return commandParts.map(shellQuote).join(" ");
}

async function createForkedSession(ctx: ExtensionCommandContext): Promise<string | undefined> {
  const sessionFile = ctx.sessionManager.getSessionFile();
  if (!sessionFile) {
    return undefined;
  }

  const sessionDir = path.dirname(sessionFile);
  const branchEntries = ctx.sessionManager.getBranch();
  const currentHeader = ctx.sessionManager.getHeader();

  const timestamp = new Date().toISOString();
  const fileTimestamp = timestamp.replace(/[:.]/g, "-");
  const newSessionId = randomUUID();
  const newSessionFile = path.join(sessionDir, `${fileTimestamp}_${newSessionId}.jsonl`);

  const newHeader = {
    type: "session",
    version: currentHeader?.version ?? 3,
    id: newSessionId,
    timestamp,
    cwd: currentHeader?.cwd ?? ctx.cwd,
    parentSession: sessionFile,
  };

  const lines = `${[JSON.stringify(newHeader), ...branchEntries.map((entry) => JSON.stringify(entry))].join("\n")}\n`;

  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(newSessionFile, lines, "utf8");

  return newSessionFile;
}

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("split-fork", {
    description:
      "Fork this session into a new pi process in a right-hand tmux split. Usage: /split-fork [optional prompt]",
    handler: async (args, ctx) => {
      const tmuxPane = process.env.TMUX_PANE;
      if (!process.env.TMUX || !tmuxPane) {
        ctx.ui.notify("/split-fork requires running pi inside a tmux pane.", "warning");
        return;
      }

      const wasBusy = !ctx.isIdle();
      const prompt = args.trim();
      const forkedSessionFile = await createForkedSession(ctx);
      const piCommand = buildPiCommand(forkedSessionFile, prompt);

      // Open the split with the user's shell (so the pane survives pi
      // exiting), capture the new pane id, then type the pi command into it.
      // This mirrors Ghostty's "initial input" semantics from the original.
      const splitResult = await pi.exec("tmux", [
        "split-window",
        "-h",
        "-P",
        "-F",
        "#{pane_id}",
        "-t",
        tmuxPane,
        "-c",
        ctx.cwd,
      ]);
      if (splitResult.code !== 0) {
        const reason =
          splitResult.stderr?.trim() || splitResult.stdout?.trim() || "unknown tmux error";
        ctx.ui.notify(`Failed to open tmux split: ${reason}`, "error");
        if (forkedSessionFile) {
          ctx.ui.notify(`Forked session was created: ${forkedSessionFile}`, "info");
        }
        return;
      }

      const newPaneId = splitResult.stdout.trim();
      const sendResult = await pi.exec("tmux", ["send-keys", "-t", newPaneId, piCommand, "Enter"]);
      if (sendResult.code !== 0) {
        const reason =
          sendResult.stderr?.trim() || sendResult.stdout?.trim() || "unknown tmux error";
        ctx.ui.notify(`Opened split but failed to send command: ${reason}`, "error");
        if (forkedSessionFile) {
          ctx.ui.notify(`Forked session was created: ${forkedSessionFile}`, "info");
        }
        return;
      }

      if (forkedSessionFile) {
        const fileName = path.basename(forkedSessionFile);
        const suffix = prompt ? " and sent prompt" : "";
        ctx.ui.notify(`Forked to ${fileName} in a new tmux split${suffix}.`, "info");
        if (wasBusy) {
          ctx.ui.notify(
            "Forked from current committed state (in-flight turn continues in original session).",
            "info",
          );
        }
      } else {
        ctx.ui.notify("Opened a new tmux split (no persisted session to fork).", "warning");
      }
    },
  });
}
