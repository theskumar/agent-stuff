/**
 * Desktop Notification Extension
 *
 * What it is:
 *   Sends a native desktop notification whenever the agent finishes a turn
 *   and is waiting for the user. Implemented as a pure OSC 777 escape
 *   sequence (with tmux DCS-passthrough wrapping when running inside tmux),
 *   so it has no external dependencies — the terminal emulator surfaces the
 *   notification.
 *
 *   Supported terminals: Ghostty, iTerm2, WezTerm, rxvt-unicode.
 *   Not supported: Kitty (uses OSC 99), Terminal.app, Windows Terminal,
 *   Alacritty.
 *
 * Clicking the notification:
 *   OSC 777 banners only bring the terminal app forward — with several tmux
 *   sessions sharing one client you still land wherever the client happens
 *   to be. So on macOS, if `terminal-notifier` is on PATH (brew install
 *   terminal-notifier), it is used instead and the click runs
 *   `tmux switch-client` back to the exact session:window.pane that fired,
 *   then activates the terminal app. Without it, the OSC 777 path is used
 *   and the title carries the tmux target so you know where to go.
 *
 * Use cases:
 *   - Long-running turns where you want to switch to another window and only
 *     come back when pi is ready for input.
 *   - Background `/loop` or `/goal` runs to get pinged when the agent stops
 *     making progress (e.g. blocks on a question).
 *   - Pair-programming flow where you only check pi when it has output.
 *
 * Common usage patterns:
 *   - Install and forget; notifications fire automatically on `turn_end`.
 *   - Notification title shows pi + cwd; body shows the first line of the
 *     last assistant message.
 *   - On unsupported terminals the OSC sequence is silently ignored, so it's
 *     safe to leave installed everywhere.
 */

import { execFile } from "node:child_process";
import { constants, accessSync } from "node:fs";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";

const execFileAsync = promisify(execFile);

const run = async (file: string, args: string[]): Promise<string | null> => {
  try {
    const { stdout } = await execFileAsync(file, args, { timeout: 2000 });
    return stdout;
  } catch {
    return null;
  }
};

const resolveBinary = (binary: string): string | null => {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = join(dir, binary);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep looking.
    }
  }
  return null;
};

/** Single-quote a string for safe use inside a /bin/sh command line. */
const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

type TmuxTarget = { clientTty: string; target: string; clientPid: string; socketPath: string };

const tmuxTarget = async (): Promise<TmuxTarget | null> => {
  if (!process.env.TMUX) {
    return null;
  }

  const pane = process.env.TMUX_PANE;
  const out = await run("tmux", [
    "display",
    "-p",
    ...(pane ? ["-t", pane] : []),
    "#{client_tty}\t#{session_name}:#{window_index}.#{pane_index}\t#{client_pid}\t#{socket_path}",
  ]);

  const [clientTty, target, clientPid, socketPath] = (out ?? "").trim().split("\t");
  return target
    ? {
        clientTty: clientTty ?? "",
        target,
        clientPid: clientPid ?? "",
        socketPath: socketPath ?? "",
      }
    : null;
};

/**
 * Walk up the process tree from the tmux client (or this process) looking for
 * the .app bundle that owns the terminal, so a notification click can activate
 * that specific app rather than guessing.
 */
const terminalAppPath = async (clientPid?: string): Promise<string | null> => {
  let pid = clientPid || String(process.pid);

  for (let hop = 0; hop < 12; hop++) {
    const out = await run("ps", ["-o", "ppid=,comm=", "-p", pid]);
    const match = out?.trim().match(/^(\d+)\s+(.*)$/);
    if (!match) {
      return null;
    }

    const [, parent, comm] = match;
    const app = comm.match(/^(.*\.app)\/Contents\/MacOS\//);
    if (app) {
      return app[1];
    }
    if (parent === "0" || parent === pid) {
      return null;
    }
    pid = parent;
  }

  return null;
};

/**
 * Send a desktop notification via OSC 777 escape sequence.
 */
const notifyViaOsc = (title: string, body: string): void => {
  // OSC 777 format: ESC ] 777 ; notify ; title ; body BEL
  // Inside tmux, wrap with DCS passthrough (ESC chars must be doubled).
  if (process.env.TMUX) {
    process.stdout.write(`\x1bPtmux;\x1b\x1b]777;notify;${title};${body}\x07\x1b\\`);
  } else {
    process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
  }
};

/**
 * Send via terminal-notifier so clicking restores the exact tmux target.
 * Returns false when nothing was sent, so the caller can fall back to OSC 777.
 */
const notifyViaTerminalNotifier = async (
  title: string,
  body: string,
  target: TmuxTarget | null,
): Promise<boolean> => {
  const notifier = process.platform === "darwin" ? resolveBinary("terminal-notifier") : null;
  if (!notifier) {
    return false;
  }

  const app = await terminalAppPath(target?.clientPid);
  // The click runs under launchd with a bare PATH, so absolute paths only,
  // and the socket has to be named since TMUX is not set there either.
  const tmuxBin = resolveBinary("tmux");
  const socket = target?.socketPath ? `-S ${shellQuote(target.socketPath)} ` : "";
  const clickCommand = [
    tmuxBin && target?.clientTty
      ? `${shellQuote(tmuxBin)} ${socket}switch-client -c ${shellQuote(target.clientTty)} -t ${shellQuote(target.target)}`
      : null,
    app ? `/usr/bin/open -a ${shellQuote(app)}` : null,
  ]
    .filter(Boolean)
    .join("; ");

  if (!clickCommand) {
    return false;
  }

  const sent = await run(notifier, [
    "-title",
    title,
    "-message",
    body || "Ready for input",
    // One slot per tmux target, so a new turn replaces its own stale banner.
    "-group",
    `pi-${target?.target ?? "default"}`,
    "-execute",
    clickCommand,
  ]);

  return sent !== null;
};

const isTextPart = (part: unknown): part is { type: "text"; text: string } =>
  Boolean(
    part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part,
  );

const extractLastAssistantText = (
  messages: Array<{ role?: string; content?: unknown }>,
): string | null => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "assistant") {
      continue;
    }

    const content = message.content;
    if (typeof content === "string") {
      return content.trim() || null;
    }

    if (Array.isArray(content)) {
      const text = content
        .filter(isTextPart)
        .map((part) => part.text)
        .join("\n")
        .trim();
      return text || null;
    }

    return null;
  }

  return null;
};

const plainMarkdownTheme: MarkdownTheme = {
  heading: (text) => text,
  link: (text) => text,
  linkUrl: () => "",
  code: (text) => text,
  codeBlock: (text) => text,
  codeBlockBorder: () => "",
  quote: (text) => text,
  quoteBorder: () => "",
  hr: () => "",
  listBullet: () => "",
  bold: (text) => text,
  italic: (text) => text,
  strikethrough: (text) => text,
  underline: (text) => text,
};

const simpleMarkdown = (text: string, width = 80): string => {
  const markdown = new Markdown(text, 0, 0, plainMarkdownTheme);
  return markdown.render(width).join("\n");
};

const formatNotification = (text: string | null): { title: string; body: string } => {
  const simplified = text ? simpleMarkdown(text) : "";
  const normalized = simplified.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return { title: "Ready for input", body: "" };
  }

  const maxBody = 200;
  const body = normalized.length > maxBody ? `${normalized.slice(0, maxBody - 1)}…` : normalized;
  return { title: "π", body };
};

export default function (pi: ExtensionAPI) {
  pi.on("agent_end", async (event) => {
    const lastText = extractLastAssistantText(event.messages ?? []);
    const { title, body } = formatNotification(lastText);
    const target = await tmuxTarget();
    // Without a clickable action the title is the only hint about which
    // session is waiting, so name it there.
    const titled = target ? `${title} · ${target.target}` : title;

    if (!(await notifyViaTerminalNotifier(titled, body, target))) {
      notifyViaOsc(titled, body);
    }
  });
}
