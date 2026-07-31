/**
 * Moshi Push Notification Extension
 *
 * What it is:
 *   Sends a push notification to the Moshi iOS app (https://getmoshi.app)
 *   whenever the agent finishes a turn and is waiting for the user. Moshi is
 *   a mosh-based terminal client for iPhone with lock screen / Dynamic
 *   Island / Apple Watch push support.
 *
 *   pi is not one of Moshi's natively supported agents (moshi-hook only
 *   wires Claude Code, Codex, OpenCode, Gemini, Cursor, Kimi, Qwen), so this
 *   uses Moshi's plain webhook endpoint instead of the moshi-hook daemon.
 *   See https://getmoshi.app/docs/notifications.
 *
 * Setup:
 *   1. In Moshi: Settings -> Push Notifications -> enable, copy the API
 *      (device) token shown after registration.
 *   2. Store it via MOSHI_API_TOKEN env var, or ~/.config/moshi/device-token
 *      (chmod 600; env var takes priority).
 *   3. Optionally export MOSHI_UNIFIED=true to fan the push out to every
 *      device on the same Moshi license (default: only the token's device).
 *
 * Away-from-desk gating (macOS):
 *   Moshi usually mosh-es back into this same Mac, so a push while you are
 *   sitting at the machine just duplicates the desktop notification (and
 *   Continuity mirrors the iPhone banner onto the Mac anyway). So the push
 *   only fires when you look away:
 *     - HID idle time >= MOSHI_IDLE_SECONDS (default 300), or
 *     - the screen is locked.
 *   Overrides: MOSHI_NOTIFY=always (never gate) / never (disable).
 *   On non-macOS, or if the idle probe fails, it falls back to sending.
 *
 * Notes:
 *   - Silently no-ops if no token is found, so it's safe to leave installed
 *     on machines without Moshi configured.
 *   - Fire-and-forget: network errors are swallowed so a flaky connection
 *     never breaks turn_end.
 *   - Moshi's legacy /api/v1/agent-events endpoint was retired 2026-06-15;
 *     this only ever uses /api/webhook.
 */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";

const WEBHOOK_URL = "https://api.getmoshi.app/api/webhook";
const TOKEN_FILE = join(homedir(), ".config", "moshi", "device-token");
const DEFAULT_IDLE_SECONDS = 300;

const execFileAsync = promisify(execFile);

const run = async (file: string, args: string[]): Promise<string | null> => {
  try {
    const { stdout } = await execFileAsync(file, args, { timeout: 2000 });
    return stdout;
  } catch {
    return null;
  }
};

/** Seconds since the last keyboard/mouse/trackpad event, or null if unknown. */
const hidIdleSeconds = async (): Promise<number | null> => {
  const out = await run("ioreg", ["-c", "IOHIDSystem", "-d", "4"]);
  const match = out?.match(/"HIDIdleTime"\s*=\s*(\d+)/);
  if (!match) {
    return null;
  }
  return Number(match[1]) / 1e9;
};

const isScreenLocked = async (): Promise<boolean> => {
  const out = await run("ioreg", ["-n", "Root", "-d1", "-r", "-k", "IOConsoleUsers"]);
  return /CGSSessionScreenIsLocked"?\s*=\s*Yes/.test(out ?? "");
};

/**
 * True when the user is not at the Mac this agent runs on, i.e. when a phone
 * push is actually useful. Unknown states resolve to true so a broken probe
 * degrades to the old always-notify behaviour.
 */
const isAwayFromDesk = async (): Promise<boolean> => {
  if (process.platform !== "darwin") {
    return true;
  }

  if (await isScreenLocked()) {
    return true;
  }

  const idle = await hidIdleSeconds();
  if (idle === null) {
    return true;
  }

  const threshold = Number(process.env.MOSHI_IDLE_SECONDS ?? DEFAULT_IDLE_SECONDS);
  return idle >= (Number.isFinite(threshold) ? threshold : DEFAULT_IDLE_SECONDS);
};

const shouldPush = async (): Promise<boolean> => {
  const mode = process.env.MOSHI_NOTIFY;
  if (mode === "never") {
    return false;
  }
  if (mode === "always") {
    return true;
  }
  return isAwayFromDesk();
};

const getApiToken = (): string | undefined => {
  if (process.env.MOSHI_API_TOKEN) {
    return process.env.MOSHI_API_TOKEN;
  }
  try {
    const token = readFileSync(TOKEN_FILE, "utf8").trim();
    return token || undefined;
  } catch {
    return undefined;
  }
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

const formatNotification = (text: string | null): { title: string; message: string } => {
  const simplified = text ? simpleMarkdown(text) : "";
  const normalized = simplified.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return { title: "π ready for input", message: "" };
  }

  const maxBody = 180;
  const message = normalized.length > maxBody ? `${normalized.slice(0, maxBody - 1)}…` : normalized;
  return { title: "π", message };
};

const sendMoshiPush = async (title: string, message: string): Promise<void> => {
  const token = getApiToken();
  if (!token) {
    return;
  }

  const payload: Record<string, unknown> = { token, title, message };
  if (process.env.MOSHI_UNIFIED === "true") {
    payload.unified = true;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch {
    // Best-effort notification; never break turn_end on network failure.
  }
};

export default function (pi: ExtensionAPI) {
  pi.on("agent_end", async (event) => {
    if (!(await shouldPush())) {
      return;
    }

    const lastText = extractLastAssistantText(event.messages ?? []);
    const { title, message } = formatNotification(lastText);
    await sendMoshiPush(title, message);
  });
}
