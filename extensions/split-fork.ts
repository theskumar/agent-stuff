/**
 * Split-Fork Extension
 *
 * What it is:
 *   `/split-fork` branches the current pi session: it copies the session
 *   transcript into a fresh session id and spawns a new pi process attached
 *   to that copy in a new tmux window (opened right after the current one).
 *   The original session keeps running in its own window; the fork can
 *   diverge freely without touching it.
 *
 *   Requires pi to be running inside tmux.
 *
 *   Adapted from mitsuhiko/agent-stuff (the original used Ghostty +
 *   AppleScript; this port uses tmux `new-window`).
 *
 * Use cases:
 *   - Explore an alternative direction without losing the current thread —
 *     keep the main session intact, experiment in the fork.
 *   - Compare two prompting / model / mode strategies from the same starting
 *     point, switching between windows.
 *   - Branch-then-throw-away for risky tool use (e.g. destructive bash
 *     commands) while the original session waits.
 *
 * Behavior:
 *   - The fork window opens right after this session's window and takes
 *     focus, unless `-d` was passed or a turn is still running here — a
 *     window hides the original session, so an in-flight turn is never
 *     switched away from. The notify says which window to jump to.
 *   - pi is launched as the window's command with the login shell `exec`ed
 *     after it, so the window survives the fork exiting.
 *
 * Common usage patterns:
 *   - `/split-fork` — fork the current session into a new tmux window.
 *   - `/split-fork -d [prompt]` — fork in the background and keep working
 *     here.
 *   - Work on the alternate plan in the fork window; the previous window is
 *     the original session.
 *   - Close the fork (`exit` twice in the fork window) to drop the
 *     experiment, or keep both windows if both branches turn out useful.
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

/**
 * tmux runs a window's shell-command through `sh -c`, so chain an `exec` of
 * the login shell after pi: the window stays open when the fork exits, the
 * same way a plain shell pane would, without depending on `send-keys` landing
 * after the shell is ready to read it.
 */
function buildWindowCommand(piCommand: string): string {
  return `${piCommand}; exec "\${SHELL:-/bin/sh}"`;
}

type ParsedArgs = {
  background: boolean;
  prompt: string;
};

function parseArgs(args: string): ParsedArgs {
  let background = false;
  const rest: string[] = [];

  for (const token of args.trim().split(/\s+/).filter(Boolean)) {
    // Only leading flags are options; anything after the first prompt word is
    // prompt text, since prompts legitimately contain things like "-d".
    if (rest.length === 0 && (token === "-d" || token === "--bg" || token === "--background")) {
      background = true;
      continue;
    }
    rest.push(token);
  }

  return { background, prompt: rest.join(" ") };
}

function execError(result: { stderr?: string; stdout?: string }): string {
  return result.stderr?.trim() || result.stdout?.trim() || "unknown tmux error";
}

/** The user's prefix, in tmux's own notation, for the "how to get there" hint. */
async function getPrefixKey(pi: ExtensionAPI): Promise<string> {
  const result = await pi.exec("tmux", ["show-options", "-gv", "prefix"]);
  const prefix = result.code === 0 ? result.stdout.trim() : "";
  return prefix || "C-b";
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
      "Fork this session into a new pi process in a new tmux window. Usage: /split-fork [-d] [optional prompt]",
    handler: async (args, ctx) => {
      const tmuxPane = process.env.TMUX_PANE;
      if (!process.env.TMUX || !tmuxPane) {
        ctx.ui.notify("/split-fork requires running pi inside tmux.", "warning");
        return;
      }

      const wasBusy = !ctx.isIdle();
      const { background: backgroundRequested, prompt } = parseArgs(args);
      // A window steals the whole screen, unlike the old right-hand split, so
      // never switch away from a turn that is still running: the fork opens
      // behind it and the notify says where it went.
      const background = backgroundRequested || wasBusy;
      const forkedSessionFile = await createForkedSession(ctx);
      const piCommand = buildPiCommand(forkedSessionFile, prompt);

      // `new-window -t` only accepts a window target, so resolve our pane to
      // its window first; that also pins the fork next to this session's
      // window rather than wherever the attached client currently is.
      const windowLookup = await pi.exec("tmux", [
        "display-message",
        "-p",
        "-t",
        tmuxPane,
        "#{window_id}",
      ]);
      const currentWindowId = windowLookup.code === 0 ? windowLookup.stdout.trim() : "";
      if (!currentWindowId) {
        ctx.ui.notify(
          `Failed to resolve the current tmux window: ${execError(windowLookup)}`,
          "error",
        );
        if (forkedSessionFile) {
          ctx.ui.notify(`Forked session was created: ${forkedSessionFile}`, "info");
        }
        return;
      }

      const windowResult = await pi.exec("tmux", [
        "new-window",
        "-a",
        ...(background ? ["-d"] : []),
        "-P",
        "-F",
        "#{window_index}",
        "-t",
        currentWindowId,
        "-n",
        "pi-fork",
        "-c",
        ctx.cwd,
        buildWindowCommand(piCommand),
      ]);
      if (windowResult.code !== 0) {
        ctx.ui.notify(`Failed to open tmux window: ${execError(windowResult)}`, "error");
        if (forkedSessionFile) {
          ctx.ui.notify(`Forked session was created: ${forkedSessionFile}`, "info");
        }
        return;
      }

      const windowIndex = windowResult.stdout.trim();
      const where = windowIndex
        ? `window ${windowIndex} (${await getPrefixKey(pi)} ${windowIndex})`
        : "a new window";

      if (forkedSessionFile) {
        const fileName = path.basename(forkedSessionFile);
        const suffix = prompt ? " and sent prompt" : "";
        ctx.ui.notify(`Forked to ${fileName} in ${where}${suffix}.`, "info");
        if (wasBusy) {
          ctx.ui.notify(
            "Forked from current committed state; staying here because a turn is still running (in-flight turn continues in this session).",
            "info",
          );
        }
      } else {
        ctx.ui.notify(`Opened ${where} (no persisted session to fork).`, "warning");
      }
    },
  });
}
