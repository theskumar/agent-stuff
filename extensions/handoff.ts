/**
 * Handoff Extension
 *
 * What it is:
 *   `/handoff <goal>` distills the current session into a focused continuation
 *   prompt and starts a fresh session seeded with it. Unlike compaction (which
 *   rewrites in place and is lossy across the whole window) or split-fork
 *   (which clones the verbatim transcript), handoff throws away the bloated
 *   context and hands the next session a compact, hot-state-first brief plus a
 *   `parentSession` lineage pointer.
 *
 *   Adapted from hjanuschka/shitty-extensions. Divergences from the original:
 *     - Tuned for MID-TASK continuation, not a portable handoff doc. The
 *       system prompt forces hot working state first (next action, ruled-out
 *       hypotheses, verbatim errors, locked decisions).
 *     - Hand-rolled conversation trimmer instead of serializeConversation:
 *       recent turns kept verbatim, older tool-result bodies elided (errors
 *       preserved), injected reminders/older thinking stripped, hard token
 *       ceiling.
 *     - Distills on a cheap/fast model by default (there is no KV-cache to
 *       preserve — the side call shares no prefix with the live session).
 *
 * Use cases:
 *   - Context window bloated mid-task and the useful state is scattered
 *     (a finding early, a decision late, dead-ends in between) so a clean
 *     time-axis rewind can't isolate it — reset without thinking about where
 *     to cut.
 *
 * Config (env):
 *   - PI_HANDOFF_MODEL       provider/id for the distiller (default
 *                            anthropic/claude-sonnet-5; falls back to the
 *                            current model if not found).
 *   - PI_HANDOFF_MAX_TOKENS  ceiling on the serialized conversation sent to
 *                            the distiller. When unset, the default (60000) is
 *                            scaled by the continuation task inferred from the
 *                            goal: exploration reads more, debugging less. When
 *                            set, it overrides the task scaling. Oldest middle
 *                            turns are dropped first; head and recent tail are
 *                            never dropped.
 *
 * Task-relative handover:
 *   The distiller (the "writer") already knows the task via the goal, so both
 *   the record's size (input budget) and its shape (extraction schema) adapt
 *   to it: a debug goal keeps recent hot state + verbatim errors; an explore
 *   goal keeps the scattered findings map so the fresh agent does not
 *   re-survey. Grounded in arxiv 2608.14528 (predictive sufficiency).
 *
 * Not this extension's job (use the right tool):
 *   - Parking / resuming later, or picking the next distinct task → todos.
 *   - Tail-shaped bloat where a clean cut point exists → split-fork + rewind.
 */

import type {
  Api,
  ImageContent,
  Message,
  Model,
  TextContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { BorderedLoader, convertToLlm } from "@earendil-works/pi-coding-agent";

const SYSTEM_PROMPT_BASE = `You produce a continuation prompt so a fresh agent resumes the SAME in-progress task with no memory of the prior session. Optimize for resuming work, not for a readable report. Output the prompt only, no preamble like "Here's the prompt".`;

const SYSTEM_PROMPT_RULES = `Rules:
- Redact secrets (API keys, tokens, passwords, PII).
- Reference existing artifacts (specs, ADRs, diffs, commits) by path/URL; do not restate their contents.
- Omit sections that genuinely don't apply. Never pad.`;

// --- Task-relative handover ---------------------------------------------
// The writer already knows the task (the /handoff goal). The record's size
// and shape should depend on it: a bug fix needs recent hot state and exact
// errors; an exploration needs the scattered findings map so the fresh agent
// does not re-survey. See arxiv 2608.14528 (predictive sufficiency: what a
// handover must retain depends on the continuation task).

type TaskKind = "debug" | "explore" | "default";

interface TaskProfile {
  kind: TaskKind;
  /** Multiplier on the writer's input budget (how much old context it reads). */
  budgetScale: number;
  /** Task-specific extraction schema appended to the base system prompt. */
  schema: string;
}

const DEBUG_SCHEMA = `Extract, in this priority (debugging continuation):
1. NEXT ACTION — the exact edit/command in flight. Be specific: file, line, what change. If mid-edit, state the intended change verbatim.
2. ERRORS VERBATIM — failing tests / stack traces / error lines copied exactly, not paraphrased.
3. HYPOTHESIS & RULED OUT — current theory plus approaches already tried and rejected, so the fresh agent does not re-explore dead ends.
4. LOCKED DECISIONS — settled choices the fresh agent must not relitigate.
5. FILES IN PLAY — path + why each matters.`;

const EXPLORE_SCHEMA = `Extract, in this priority (exploration/research/design continuation):
1. GOAL & OPEN QUESTION — what is still being decided and the current leading direction.
2. FINDINGS MAP — every load-bearing discovery so far, each with where it came from (file/URL/tool). These are scattered across the session; do not drop old ones just because they are early.
3. SURVEYED & RULED OUT — options/paths already examined and rejected, so the fresh agent does not re-survey them.
4. LOCKED DECISIONS — settled choices the fresh agent must not relitigate.
5. NEXT ACTION — the concrete next step, if one is chosen.
6. FILES / SOURCES IN PLAY — path or URL + why each matters.`;

const DEFAULT_SCHEMA = `Extract, in this priority:
1. NEXT ACTION — the exact edit/command in flight. Be specific: file, line, what change. If mid-edit, state the intended change verbatim.
2. HYPOTHESIS & RULED OUT — current theory plus approaches already tried and rejected, so the fresh agent does not re-explore dead ends.
3. ERRORS VERBATIM — failing tests / stack traces / error lines copied exactly, not paraphrased.
4. LOCKED DECISIONS — settled choices the fresh agent must not relitigate.
5. FILES IN PLAY — path + why each matters.`;

const DEBUG_RE =
  /\b(bug|fix|debug|failing|crash|error|regression|broken|repro|stack ?trace|traceback|test(s)? fail)\b/i;
const EXPLORE_RE =
  /\b(explore|research|investigate|design|compare|evaluate|options?|survey|understand|figure out|spike|prototype|architect)\b/i;

/** Classify the continuation task from the goal to set record size + shape. */
function taskProfile(goal: string): TaskProfile {
  if (EXPLORE_RE.test(goal)) {
    return { kind: "explore", budgetScale: 1.75, schema: EXPLORE_SCHEMA };
  }
  if (DEBUG_RE.test(goal)) {
    return { kind: "debug", budgetScale: 0.6, schema: DEBUG_SCHEMA };
  }
  return { kind: "default", budgetScale: 1, schema: DEFAULT_SCHEMA };
}

function systemPromptFor(profile: TaskProfile): string {
  return `${SYSTEM_PROMPT_BASE}\n\n${profile.schema}\n\n${SYSTEM_PROMPT_RULES}`;
}

// --- Trimming knobs ------------------------------------------------------

/** First N messages kept (original goal + earliest decisions). */
const HEAD_MSGS = 4;
/** Last N messages kept verbatim (the hot working state). */
const TAIL_MSGS = 24;
/** Rough chars-per-token for the ceiling estimate. */
const CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_TOKENS = 60000;

/** Non-error tool results in head/middle are cut to head+tail chars. */
const RESULT_HEAD = 400;
const RESULT_TAIL = 150;
/** Error results are kept generously (still capped for pathological dumps). */
const ERROR_HEAD = 2000;
const ERROR_TAIL = 1000;
/** Tool-call argument JSON cap outside the verbatim tail. */
const ARGS_MAX = 500;

/**
 * Writer input budget. An explicit PI_HANDOFF_MAX_TOKENS always wins; otherwise
 * the base default is scaled by the continuation task (bigger for exploration,
 * smaller for debugging) so the record's size tracks the task.
 */
function maxTokensFor(budgetScale: number): number {
  const v = Number(process.env.PI_HANDOFF_MAX_TOKENS);
  if (Number.isFinite(v) && v > 0) return v;
  return Math.round(DEFAULT_MAX_TOKENS * budgetScale);
}

function parseModelSpec(v: string | undefined): { provider: string; modelId: string } | null {
  if (!v) return null;
  const i = v.indexOf("/");
  if (i <= 0) return null;
  return { provider: v.slice(0, i), modelId: v.slice(i + 1) };
}

const DEFAULT_HANDOFF_MODEL = { provider: "anthropic", modelId: "claude-sonnet-5" };

/**
 * Resolve the distiller model: PI_HANDOFF_MODEL, else the Sonnet default, else
 * the current session model. Returns null only if nothing is usable.
 */
async function resolveHandoffModel(
  ctx: ExtensionCommandContext,
): Promise<{ model: Model<Api>; apiKey?: string; headers?: Record<string, string> } | null> {
  const spec = parseModelSpec(process.env.PI_HANDOFF_MODEL) ?? DEFAULT_HANDOFF_MODEL;
  const found = ctx.modelRegistry.find(spec.provider, spec.modelId);
  if (found) {
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(found);
    if (auth.ok && auth.apiKey) {
      return { model: found, apiKey: auth.apiKey, headers: auth.headers };
    }
  }
  if (ctx.model) {
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
    if (auth.ok) return { model: ctx.model, apiKey: auth.apiKey, headers: auth.headers };
  }
  return null;
}

// --- Conversation trimming ----------------------------------------------

/** Drop harness-injected noise that carries no distill value. */
function stripInjected(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
}

function elide(text: string, headChars: number, tailChars: number): string {
  if (text.length <= headChars + tailChars + 40) return text;
  const cut = text.length - headChars - tailChars;
  return `${text.slice(0, headChars)}\n… [${cut} chars elided] …\n${text.slice(-tailChars)}`;
}

function textOf(content: (TextContent | ImageContent)[]): string {
  return content.map((c) => (c.type === "text" ? c.text : "[image]")).join("");
}

const ERROR_RE = /\b(error|traceback|exception|failed|fail|panic|fatal)\b/i;

function isErrorResult(m: ToolResultMessage, body: string): boolean {
  return m.isError || ERROR_RE.test(body);
}

function renderToolCall(b: ToolCall, verbatim: boolean): string {
  const p = typeof b.arguments?.path === "string" ? b.arguments.path : "";
  let args = JSON.stringify(b.arguments ?? {});
  if (!verbatim && args.length > ARGS_MAX) args = `${args.slice(0, ARGS_MAX)}… [truncated]`;
  return `→ ${b.name}(${p}) ${args}`;
}

/** Render one message. `verbatim` (tail zone) keeps thinking + full bodies. */
function renderMessage(m: Message, verbatim: boolean): string {
  switch (m.role) {
    case "user": {
      const raw = typeof m.content === "string" ? m.content : textOf(m.content);
      const clean = stripInjected(raw);
      return clean ? `## user\n${clean}` : "";
    }
    case "assistant": {
      const parts: string[] = [];
      for (const b of m.content) {
        if (b.type === "text") {
          const t = stripInjected(b.text);
          if (t) parts.push(t);
        } else if (b.type === "thinking") {
          if (verbatim && b.thinking.trim()) parts.push(`[thinking] ${b.thinking.trim()}`);
        } else if (b.type === "toolCall") {
          parts.push(renderToolCall(b, verbatim));
        }
      }
      return parts.length ? `## assistant\n${parts.join("\n")}` : "";
    }
    case "toolResult": {
      const body = stripInjected(textOf(m.content));
      if (!body) return "";
      const err = isErrorResult(m, body);
      const shown = verbatim
        ? body
        : err
          ? elide(body, ERROR_HEAD, ERROR_TAIL)
          : elide(body, RESULT_HEAD, RESULT_TAIL);
      return `## tool_result ${m.toolName}${err ? " (error)" : ""}\n${shown}`;
    }
  }
}

type Rendered = { idx: number; zone: "head" | "middle" | "tail"; text: string };

/**
 * Serialize the conversation for the distiller: head + recent tail kept
 * (tail verbatim), middle compressed, oldest middle dropped first under a
 * token ceiling. Discontinuities get an omission marker.
 */
function buildConversationText(
  messages: Message[],
  maxTokens: number,
): { text: string; approxTokens: number } {
  const n = messages.length;
  const headEnd = Math.min(HEAD_MSGS, n);
  // Snap the tail start back to a user-message boundary so we don't begin
  // mid tool-call sequence.
  let tailStart = Math.max(headEnd, n - TAIL_MSGS);
  while (tailStart > headEnd && messages[tailStart]?.role !== "user") tailStart--;

  const rendered: Rendered[] = [];
  for (let i = 0; i < n; i++) {
    const zone: Rendered["zone"] = i < headEnd ? "head" : i >= tailStart ? "tail" : "middle";
    const text = renderMessage(messages[i], zone === "tail");
    if (text) rendered.push({ idx: i, zone, text });
  }

  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const total = () => rendered.reduce((s, r) => s + r.text.length + 2, 0);
  // Drop oldest middle turns first; head and tail are sacred.
  for (let i = 0; i < rendered.length && total() > maxChars; ) {
    if (rendered[i].zone === "middle") rendered.splice(i, 1);
    else i++;
  }

  const out: string[] = [];
  let prev = -1;
  for (const r of rendered) {
    if (prev >= 0 && r.idx > prev + 1) out.push("… [earlier turns omitted] …");
    out.push(r.text);
    prev = r.idx;
  }
  const text = out.join("\n\n");
  return { text, approxTokens: Math.round(text.length / CHARS_PER_TOKEN) };
}

// --- Command -------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  pi.registerCommand("handoff", {
    description: "Distill this session into a fresh continuation session. Usage: /handoff <goal>",
    handler: async (args, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("handoff requires interactive mode", "error");
        return;
      }

      const goal = args.trim();
      if (!goal) {
        ctx.ui.notify("Usage: /handoff <goal for new session>", "error");
        return;
      }

      const branch = ctx.sessionManager.getBranch();
      const agentMessages = branch
        .filter((entry): entry is SessionEntry & { type: "message" } => entry.type === "message")
        .map((entry) => entry.message);

      if (agentMessages.length === 0) {
        ctx.ui.notify("No conversation to hand off", "error");
        return;
      }

      const selection = await resolveHandoffModel(ctx);
      if (!selection) {
        ctx.ui.notify("No usable model for handoff (check PI_HANDOFF_MODEL / auth)", "error");
        return;
      }

      const profile = taskProfile(goal);
      const systemPrompt = systemPromptFor(profile);
      const llmMessages = convertToLlm(agentMessages);
      const { text: conversationText, approxTokens } = buildConversationText(
        llmMessages,
        maxTokensFor(profile.budgetScale),
      );
      const currentSessionFile = ctx.sessionManager.getSessionFile();

      const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
        const loader = new BorderedLoader(
          tui,
          theme,
          `Distilling handoff on ${selection.model.id} · ${profile.kind} (~${approxTokens.toLocaleString()} tok)…`,
        );
        loader.onAbort = () => done(null);

        const doGenerate = async () => {
          const userMessage: UserMessage = {
            role: "user",
            content: [
              {
                type: "text",
                text: `## Conversation (trimmed)\n\n${conversationText}\n\n## Goal for the new session\n\n${goal}`,
              },
            ],
            timestamp: Date.now(),
          };

          // Route through the coding-agent runtime, not pi-ai's raw complete():
          // custom providers (e.g. claude-bridge) are registered in the runtime,
          // not in pi-ai's api-registry, so raw complete() throws
          // "No API provider registered for api: <provider>".
          const response = await ctx.modelRegistry.complete(
            selection.model,
            { systemPrompt, messages: [userMessage] },
            { apiKey: selection.apiKey, headers: selection.headers, signal: loader.signal },
          );

          if (response.stopReason === "aborted" || response.stopReason === "error") {
            return null;
          }

          return response.content
            .filter((c): c is TextContent => c.type === "text")
            .map((c) => c.text)
            .join("\n");
        };

        doGenerate()
          .then(done)
          .catch((err) => {
            console.error("Handoff generation failed:", err);
            done(null);
          });

        return loader;
      });

      if (!result) {
        ctx.ui.notify("Handoff cancelled", "info");
        return;
      }

      const editedPrompt = await ctx.ui.editor(
        "Edit handoff prompt (enter to submit, shift+enter for newline, esc to cancel)",
        result,
      );

      if (editedPrompt === undefined) {
        ctx.ui.notify("Cancelled", "info");
        return;
      }

      // After newSession() the captured ctx is stale; do post-replacement work
      // via withSession using the fresh ctx it passes.
      const newSessionResult = await ctx.newSession({
        parentSession: currentSessionFile,
        withSession: async (sessionCtx) => {
          sessionCtx.ui.setEditorText(editedPrompt);
          sessionCtx.ui.notify("Handoff ready. Submit when ready.", "info");
        },
      });
      if (newSessionResult.cancelled) {
        // No replacement happened, so the original ctx is still valid here.
        ctx.ui.notify("New session cancelled", "info");
      }
    },
  });
}
