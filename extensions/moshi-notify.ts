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
 * Notes:
 *   - Silently no-ops if no token is found, so it's safe to leave installed
 *     on machines without Moshi configured.
 *   - Fire-and-forget: network errors are swallowed so a flaky connection
 *     never breaks turn_end.
 *   - Moshi's legacy /api/v1/agent-events endpoint was retired 2026-06-15;
 *     this only ever uses /api/webhook.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";

const WEBHOOK_URL = "https://api.getmoshi.app/api/webhook";
const TOKEN_FILE = join(homedir(), ".config", "moshi", "device-token");

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
    const lastText = extractLastAssistantText(event.messages ?? []);
    const { title, message } = formatNotification(lastText);
    await sendMoshiPush(title, message);
  });
}
