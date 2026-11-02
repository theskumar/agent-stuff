/**
 * Session Title Extension
 *
 * What it is:
 *   Generates a session name from the conversation with one cheap model call,
 *   the same way pi-web's "Generate title" button does, and can do it
 *   automatically once a session has settled into a task.
 *
 *   The name is set with `pi.setSessionName()`, so everything downstream of
 *   pi's session name follows: `session-name.ts` mirrors it to the tmux window
 *   or herdr tab, `titlebar-spinner.ts` shows it in the terminal title, and
 *   pi-web shows it in its sidebar (it is a `session_info` entry in the
 *   session file).
 *
 * Algorithm (ported from pi-web `lib/session-title.ts`, MIT):
 *   1. Flatten the active branch into a plain-text transcript: every user turn
 *      (800 chars each), the opening of each assistant reply (300 chars), the
 *      last assistant reply (600 chars), compaction and branch summaries
 *      (600 chars). Tool calls, tool results, and thinking are dropped.
 *   2. Bound it to 6000 chars: keep the opening turns (40% of the budget,
 *      because the goal is usually stated first) and the newest turns, and
 *      elide the middle. Cost stays flat however long the session gets.
 *   3. Send it as one user message with a short system prompt, no tools,
 *      `cacheRetention: "none"`, a fresh session id, 256 max tokens, and the
 *      cheapest thinking level the model supports.
 *   4. Clean up the reply: first line only, strip fences, JSON, "Title:"
 *      labels, quotes, and trailing periods, cap at 80 chars.
 *
 * Auto mode:
 *   After each `agent_settled` (the run is done and pi will not continue on
 *   its own), count the user prompts on the active branch. When that count
 *   reaches the next threshold in `autoAtTurns`, generate a title in the
 *   background. The default `[2, 6]` names the session after the second
 *   prompt and refines it once at the sixth, so a session costs at most two
 *   title calls. Auto mode only touches a session that has no name or still
 *   carries the last auto-generated title. A rename from `/name`,
 *   `Ctrl+Shift+N`, or pi-web stops it for that session.
 *
 * Config: `~/.pi/agent/extensions/session-title.config.json`, merged with
 * the project file `.pi/session-title.config.json`. All keys are optional:
 *
 *   {
 *     "auto": true,             // auto-title on agent_settled
 *     "autoAtTurns": [2, 6],    // user-prompt counts that trigger auto mode
 *     "model": "fast",          // "fast" (modes.json), "current", or "provider/modelId"
 *     "shortcut": "ctrl+alt+n" // global file only; read once at startup
 *   }
 *
 * Common usage patterns:
 *   - `/title`: generate a title now and apply it (replaces any name).
 *   - `Ctrl+Alt+N`: same as `/title`.
 *   - `/title status`: show the config, model, and auto state.
 *   - `Ctrl+Shift+N` (session-name.ts): amend a generated title by hand.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Api, AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { buildSessionContext } from "@earendil-works/pi-coding-agent";

// =============================================================================
// Constants
// =============================================================================

const ENTRY_TYPE = "session-title";
const STATUS_KEY = "session-title";

const TITLE_TIMEOUT_MS = 90_000;
const TITLE_MAX_TOKENS = 256;
const MAX_TITLE_LENGTH = 80;

// Per-message caps. User turns carry intent (including mid-session pivots),
// the last reply carries the outcome, and earlier replies only need their
// opening line. Tool calls and results say nothing about intent.
const USER_CHARS = 800;
const ASSISTANT_CHARS = 300;
const LAST_ASSISTANT_CHARS = 600;
const SUMMARY_CHARS = 600;
const TRANSCRIPT_CHARS = 6000;
// Budget share reserved for the opening turns, so a session that drifts into
// routine follow-ups is not titled after its last chore.
const TRANSCRIPT_HEAD_CHARS = Math.round(TRANSCRIPT_CHARS * 0.4);

const ELISION = "[…]";
const IMAGE_PLACEHOLDER = "[image]";

const TITLE_SYSTEM_PROMPT = "You name chat sessions from a transcript. Reply with the title only.";

const TITLE_PROMPT = `Create a concise title for this session based on the conversation above.

Requirements:
- Match the primary language used by the user.
- Describe the user's concrete goal or the outcome, not the act of chatting.
- Use 4-12 words for space-separated languages, or 8-24 characters for CJK text when practical.
- Do not call any tools.
- Return only the title as plain text, with no quotes, label, markdown, or explanation.`;

const DEFAULT_SHORTCUT = "ctrl+alt+n";

// =============================================================================
// Config
// =============================================================================

type TitleConfig = {
  auto: boolean;
  autoAtTurns: number[];
  model: string;
  shortcut: string;
};

const DEFAULT_CONFIG: TitleConfig = {
  auto: true,
  autoAtTurns: [2, 6],
  model: "fast",
  shortcut: DEFAULT_SHORTCUT,
};

function agentDir(): string {
  const env = process.env.PI_CODING_AGENT_DIR;
  if (env) return env.startsWith("~/") ? path.join(os.homedir(), env.slice(2)) : env;
  return path.join(os.homedir(), ".pi", "agent");
}

function readJson(filePath: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeConfig(raw: Record<string, unknown>, base: TitleConfig): TitleConfig {
  const turns = Array.isArray(raw.autoAtTurns)
    ? raw.autoAtTurns
        .filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0)
        .sort((a, b) => a - b)
    : base.autoAtTurns;
  return {
    auto: typeof raw.auto === "boolean" ? raw.auto : base.auto,
    autoAtTurns: turns,
    model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : base.model,
    shortcut:
      typeof raw.shortcut === "string" && raw.shortcut.trim() ? raw.shortcut.trim() : base.shortcut,
  };
}

function globalConfigPath(): string {
  return path.join(agentDir(), "extensions", "session-title.config.json");
}

function loadConfig(cwd?: string): TitleConfig {
  const global = normalizeConfig(readJson(globalConfigPath()), DEFAULT_CONFIG);
  if (!cwd) return global;
  const project = readJson(path.join(cwd, ".pi", "session-title.config.json"));
  // The shortcut is registered once at startup, so only the global file sets it.
  return { ...normalizeConfig(project, global), shortcut: global.shortcut };
}

// =============================================================================
// Model resolution
// =============================================================================

function readFastMode(cwd: string): { provider: string; modelId: string } | undefined {
  for (const file of [path.join(cwd, ".pi", "modes.json"), path.join(agentDir(), "modes.json")]) {
    const modes = readJson(file).modes as Record<string, unknown> | undefined;
    const fast = modes?.fast as { provider?: unknown; modelId?: unknown } | undefined;
    if (typeof fast?.provider === "string" && typeof fast.modelId === "string") {
      return { provider: fast.provider, modelId: fast.modelId };
    }
  }
  return undefined;
}

/** Resolve the configured title model, falling back to the session's current model. */
function resolveTitleModel(ctx: ExtensionContext, spec: string): Model<Api> | undefined {
  let wanted: { provider: string; modelId: string } | undefined;
  if (spec === "fast") wanted = readFastMode(ctx.cwd);
  else if (spec !== "current") {
    const slash = spec.indexOf("/");
    if (slash > 0) wanted = { provider: spec.slice(0, slash), modelId: spec.slice(slash + 1) };
  }
  if (wanted) {
    const model = ctx.modelRegistry.find(wanted.provider, wanted.modelId);
    if (model) return model;
  }
  return ctx.model;
}

/**
 * Naming is a short classification task, so thinking only adds latency and
 * tokens. Use the cheapest level the model supports. Gemini rejects "minimal",
 * so it skips to the next level.
 */
function resolveTitleThinkingLevel(model: Model<Api>): string {
  if (!model.reasoning) return "off";
  const supported = getSupportedThinkingLevels(model) as string[];
  const rejectsMinimal = model.api === "google-generative-ai" || /gemini/i.test(model.id);
  const usable = rejectsMinimal
    ? supported.filter((level) => level !== "off" && level !== "minimal")
    : supported;
  return usable[0] ?? supported[0] ?? "off";
}

// =============================================================================
// Transcript
// =============================================================================

type LooseMessage = {
  role: string;
  content?: unknown;
  summary?: string;
  command?: string;
};

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  let images = 0;
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const type = (block as { type?: string }).type;
    const text = (block as { text?: unknown }).text;
    if (type === "text" && typeof text === "string") parts.push(text);
    else if (type === "image") images += 1;
  }
  const text = parts.join("\n").trim();
  if (images === 0) return text;
  const marker = images === 1 ? IMAGE_PLACEHOLDER : `${IMAGE_PLACEHOLDER} ×${images}`;
  return text ? `${text}\n${marker}` : marker;
}

function clip(text: string, max: number): string {
  const characters = Array.from(text);
  return characters.length <= max ? text : `${characters.slice(0, max).join("")}…`;
}

/** Keep the opening and the newest lines, and drop the middle, to stay in budget. */
export function boundTranscript(lines: string[]): string {
  const joined = lines.join("\n\n");
  if (joined.length <= TRANSCRIPT_CHARS || lines.length < 2) return joined;

  const head: string[] = [];
  let used = ELISION.length + 4;
  let next = 0;
  // The first line always survives.
  for (; next < lines.length; next++) {
    const size = used + lines[next].length + 2;
    if (head.length > 0 && size > TRANSCRIPT_HEAD_CHARS) break;
    head.push(lines[next]);
    used = size;
  }

  const tail: string[] = [];
  for (let i = lines.length - 1; i >= next; i--) {
    const size = used + lines[i].length + 2;
    if (size > TRANSCRIPT_CHARS) break;
    tail.unshift(lines[i]);
    used = size;
  }

  if (next + tail.length >= lines.length) return joined;
  return [...head, ELISION, ...tail].join("\n\n");
}

function lineForMessage(message: LooseMessage, isLastAssistant: boolean): string | undefined {
  if (message.role === "compactionSummary" || message.role === "branchSummary") {
    const summary = message.summary?.trim();
    return summary ? `[Earlier summary] ${clip(summary, SUMMARY_CHARS)}` : undefined;
  }
  if (message.role === "custom") {
    const text = textOf(message.content).trim();
    return text ? `User: ${clip(text, USER_CHARS)}` : undefined;
  }
  if (message.role === "bashExecution") {
    const command = message.command?.trim();
    return command ? `User: ${clip(`Ran \`${command}\``, USER_CHARS)}` : undefined;
  }
  if (message.role !== "user" && message.role !== "assistant") return undefined;
  const text = textOf(message.content).trim();
  if (!text) return undefined;
  if (message.role === "user") return `User: ${clip(text, USER_CHARS)}`;
  return `Assistant: ${clip(text, isLastAssistant ? LAST_ASSISTANT_CHARS : ASSISTANT_CHARS)}`;
}

/** Flatten messages into the plain-text transcript the title model reads. */
export function buildTitleTranscript(messages: readonly LooseMessage[]): string {
  let lastAssistant: LooseMessage | undefined;
  for (const message of messages) {
    if (message.role === "assistant" && textOf(message.content).trim()) lastAssistant = message;
  }
  const lines: string[] = [];
  for (const message of messages) {
    const line = lineForMessage(message, message === lastAssistant);
    if (line) lines.push(line);
  }
  return boundTranscript(lines);
}

// =============================================================================
// Reply parsing
// =============================================================================

function stripWrappingQuotes(value: string): string {
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
    ["\u201c", "\u201d"],
    ["\u300c", "\u300d"],
    ["\u300e", "\u300f"],
  ];
  for (const [start, end] of pairs) {
    if (
      value.startsWith(start) &&
      value.endsWith(end) &&
      value.length > start.length + end.length
    ) {
      return value.slice(start.length, -end.length).trim();
    }
  }
  return value;
}

export function parseGeneratedTitle(raw: string): string {
  let value = raw.trim();
  const fenced = value.match(/^```(?:json|text)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) value = fenced[1].trim();

  if (value.startsWith("{")) {
    try {
      const parsed = JSON.parse(value) as { title?: unknown };
      if (typeof parsed.title === "string") value = parsed.title.trim();
    } catch {
      // Fall back to plain-text cleanup below.
    }
  }

  value = value.split(/\r?\n/, 1)[0] ?? "";
  value = value.replace(/^(?:session\s+title|title|标题)\s*[:：-]\s*/i, "");
  value = stripWrappingQuotes(value).replace(/\s+/g, " ").trim();
  value = value.replace(/[。.!]+$/u, "").trim();

  if (!/[\p{L}\p{N}]/u.test(value)) {
    throw new Error("The model did not return a usable session title");
  }
  const characters = Array.from(value);
  if (characters.length > MAX_TITLE_LENGTH) {
    value = characters.slice(0, MAX_TITLE_LENGTH).join("").trim();
  }
  return value;
}

// =============================================================================
// Session state
// =============================================================================

type TitleEntryData = { title: string; userTurns: number; model: string };

/** Count user prompts on the active branch. Compaction does not reset this. */
function countUserTurns(branch: SessionEntry[]): number {
  let count = 0;
  for (const entry of branch) {
    if (entry.type === "message" && (entry.message as { role?: string }).role === "user") count++;
  }
  return count;
}

/** Latest auto-title record. The session name is global, so scan the whole file. */
function lastTitleEntry(entries: SessionEntry[]): TitleEntryData | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "custom" && entry.customType === ENTRY_TYPE) {
      return entry.data as TitleEntryData;
    }
  }
  return undefined;
}

// =============================================================================
// Generation
// =============================================================================

type GeneratedTitle = {
  title: string;
  model: Model<Api>;
  userTurns: number;
  usage?: AssistantMessage["usage"];
};

async function generateTitle(ctx: ExtensionContext, config: TitleConfig): Promise<GeneratedTitle> {
  const sm = ctx.sessionManager;
  const { messages } = buildSessionContext(sm.getEntries(), sm.getLeafId());
  const transcript = buildTitleTranscript(messages as LooseMessage[]);
  if (!transcript.trim()) throw new Error("The session has no usable text to name");

  const model = resolveTitleModel(ctx, config.model);
  if (!model) throw new Error("No model available for title generation");

  const context: Context = {
    systemPrompt: TITLE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: `${transcript}\n\n${TITLE_PROMPT}` }],
        timestamp: Date.now(),
      },
    ],
  };
  const thinking = resolveTitleThinkingLevel(model);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TITLE_TIMEOUT_MS);

  try {
    const stream = ctx.modelRegistry.streamSimple(model, context, {
      maxTokens: TITLE_MAX_TOKENS,
      cacheRetention: "none",
      sessionId: randomUUID(),
      signal: controller.signal,
      ...(thinking !== "off" ? { reasoning: thinking as never } : {}),
    });
    const message = await stream.result();
    if (message.stopReason === "aborted" || controller.signal.aborted) {
      throw new Error("Title generation timed out");
    }
    if (message.stopReason === "error") {
      throw new Error(message.errorMessage || "The title model request failed");
    }
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { text: string }).text)
      .join("\n")
      .trim();
    if (!text) throw new Error("The model did not return a session title");
    return {
      title: parseGeneratedTitle(text),
      model,
      userTurns: countUserTurns(sm.getBranch()),
      usage: message.usage,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function formatUsage(usage: AssistantMessage["usage"] | undefined): string {
  // Subscription bridges (claude-bridge) report zero tokens; say nothing then.
  if (!usage || usage.input + usage.output === 0) return "";
  const total = usage.cost?.total ?? 0;
  const cost = total <= 0 ? "" : total < 0.0001 ? ", <$0.0001" : `, $${total.toFixed(4)}`;
  return ` (${usage.input} in / ${usage.output} out${cost})`;
}

// =============================================================================
// Extension
// =============================================================================

export default function (pi: ExtensionAPI): void {
  const startupConfig = loadConfig();
  // Bumped on every session_start, so a generation that outlives its session
  // never renames the session that replaced it.
  let epoch = 0;
  let inFlight = false;
  // Thresholds already attempted this process, so a failing model is not
  // retried after every settled run.
  const attempted = new Set<number>();

  async function run(ctx: ExtensionContext, mode: "manual" | "auto"): Promise<void> {
    if (inFlight) {
      if (mode === "manual" && ctx.hasUI) ctx.ui.notify("Title generation already running", "info");
      return;
    }
    inFlight = true;
    const startEpoch = epoch;
    const nameBefore = pi.getSessionName();
    const config = loadConfig(ctx.cwd);
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", "✎ naming…"));

    try {
      const result = await generateTitle(ctx, config);
      if (epoch !== startEpoch) return;
      // A manual rename that landed mid-generation wins over an auto title.
      if (mode === "auto" && pi.getSessionName() !== nameBefore) return;

      pi.appendEntry<TitleEntryData>(ENTRY_TYPE, {
        title: result.title,
        userTurns: result.userTurns,
        model: `${result.model.provider}/${result.model.id}`,
      });
      // Fires session_info_changed, which session-name.ts mirrors to tmux/herdr.
      pi.setSessionName(result.title);
      if (ctx.hasUI) {
        const detail = mode === "manual" ? formatUsage(result.usage) : "";
        ctx.ui.notify(`Session titled: ${result.title}${detail}`, "info");
      }
    } catch (error) {
      if (epoch !== startEpoch) return;
      const message = error instanceof Error ? error.message : String(error);
      if (ctx.hasUI) ctx.ui.notify(`Title generation failed: ${message}`, "error");
    } finally {
      inFlight = false;
      if (epoch === startEpoch && ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
    }
  }

  function autoState(ctx: ExtensionContext) {
    const config = loadConfig(ctx.cwd);
    const sm = ctx.sessionManager;
    const name = pi.getSessionName();
    const last = lastTitleEntry(sm.getEntries());
    const userTurns = countUserTurns(sm.getBranch());
    // Auto mode owns the name only while it is empty or still the last auto title.
    const managed = !name || name === last?.title;
    const doneTurns = name && last ? last.userTurns : 0;
    const due = config.autoAtTurns.filter((t) => t <= userTurns && t > doneTurns);
    return { config, name, last, userTurns, managed, due };
  }

  pi.registerCommand("title", {
    description: "Generate a session title from the conversation (`/title status` for config)",
    handler: async (args, ctx) => {
      if (args.trim() === "status") {
        const { config, name, last, userTurns, managed } = autoState(ctx);
        const model = resolveTitleModel(ctx, config.model);
        const lines = [
          `name: ${name ?? "(none)"}${name && name === last?.title ? " [auto]" : ""}`,
          `model: ${model ? `${model.provider}/${model.id}` : "(none)"} (config: ${config.model})`,
          `auto: ${config.auto ? `on at turns ${config.autoAtTurns.join(", ")}` : "off"}${
            config.auto && !managed ? " (paused: name set by hand)" : ""
          }`,
          `user turns: ${userTurns}`,
          `config: ${globalConfigPath()}`,
        ];
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }
      await run(ctx, "manual");
    },
  });

  pi.registerShortcut(startupConfig.shortcut as never, {
    description: "Generate session title",
    handler: async (ctx) => {
      await run(ctx, "manual");
    },
  });

  pi.on("session_start", async () => {
    epoch++;
    attempted.clear();
    inFlight = false;
  });

  pi.on("agent_settled", async (_event, ctx) => {
    const { config, managed, due } = autoState(ctx);
    if (!config.auto || !managed || due.length === 0) return;
    const threshold = due[due.length - 1];
    if (attempted.has(threshold)) return;
    attempted.add(threshold);
    // Background: the settled hook stays fast and the user can keep typing.
    void run(ctx, "auto");
  });

  pi.on("session_shutdown", async () => {
    epoch++;
  });
}
