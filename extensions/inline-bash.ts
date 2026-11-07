/**
 * Inline Bash Extension
 *
 * What it is:
 *   Expands `!{command}` patterns inside user prompts (and inside expanded
 *   prompt templates) by running the command in a subshell and substituting
 *   its stdout/stderr in place before the message is sent to the model.
 *
 *   Distinct from pi's built-in whole-line `!command` bash escape: that runs
 *   bash interactively. `!{cmd}` is a literal in-string substitution, so it
 *   can be sprinkled inside a sentence or a prompt template.
 *
 * Use cases:
 *   - Embedding live shell context into a prompt without copy/pasting (`git
 *     status`, `pwd`, version strings, etc.).
 *   - Prompt templates (`/commit`, custom slash commands) that need to inline
 *     command output at expansion time.
 *   - Avoiding a separate tool round-trip when the value is small, known, and
 *     deterministic.
 *
 * Common usage patterns:
 *   - `What's in !{pwd}?`
 *   - `The current branch is !{git branch --show-current} and status:
 *     !{git status --short}`
 *   - `My node version is !{node --version}`
 *   - Inside a prompt template body: `Diff to review: !{git diff --staged}`
 *
 * Trust rules:
 *   Expands only text you typed or a prompt template you invoked; never
 *   extension-sent messages, skill bodies, tool output or pasted history.
 *   Text from `pi.sendUserMessage()` can embed untrusted data (`/review pr`
 *   puts a PR's title and diff in one), so a `!{...}` in it must stay
 *   literal. Command output is never re-scanned, and any `!{` in it is
 *   stored as `!\{`, so re-submitting a stored message from /tree or /fork
 *   cannot run it either. RPC input counts as typed: pi-web sends both its
 *   web chat and subagent tasks (written by the model) over RPC, so a
 *   `!{...}` in a subagent task runs too.
 *
 * Hook points:
 *   - `input`              : expands `!{...}` in text typed interactively or
 *                            sent over RPC (`event.source`); skips
 *                            `source === "extension"`. Runs before the
 *                            message is persisted, so session jsonl stores
 *                            the expanded text. Preserves whole-line
 *                            `!command` (pi's built-in bash escape)
 *                            untouched. If the text invokes a prompt
 *                            template (`/name args`, a `source: "prompt"`
 *                            entry of `pi.getCommands()`), it remembers the
 *                            `!{...}` patterns found in that template's file.
 *   - `before_agent_start` : pi expands templates after `input` fires;
 *                            `event.prompt` is the expanded body. If the
 *                            pending invocation expanded to it, mark that
 *                            body for expansion.
 *   - `message_end`        : the run's starting user message carries that
 *                            body. Expand it in place (`{ message }` result),
 *                            running only patterns that appear literally in
 *                            the template file. The model and session jsonl
 *                            both get the expanded text, as for typed input.
 *
 *   There is no `context` hook: it saw every user-role message in the
 *   transcript (extension-sent, skill bodies, history from a reloaded
 *   session) with no way to tell them apart.
 *
 * Trade-offs:
 *   - A template queued while the agent is streaming (steer / follow-up)
 *     never reaches `before_agent_start`, so its body keeps the literal
 *     `!{...}` (fails safe). `!{...}` typed in its arguments still expands.
 *   - Template arguments expand at `input` like any typed text. A pattern
 *     that reaches the body any other way (command output, another
 *     extension's `input` transform) is not in the template file and stays
 *     literal.
 *   - Invoking a template trusts its file, including project-local
 *     (`.pi/prompts/`) and package templates.
 *   - Each invocation runs its commands once, then persists the result, so a
 *     reload or later turn does not re-run them.
 *
 * Original (input-only) source: vendored from earendil-works/pi
 *   packages/coding-agent/examples/extensions/inline-bash.ts
 *   https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/inline-bash.ts
 *   MIT License, Copyright (c) 2025 Mario Zechner.
 */
import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const PATTERN = /!\{([^}]+)\}/g;
  const TIMEOUT_MS = 30000;

  /** A prompt-template invocation typed by the user, awaiting pi's expansion. */
  type Invocation = { text: string; commands: Set<string> };
  // Set by `input`, consumed by the next `before_agent_start`.
  let pending: Invocation | undefined;
  // Set by `before_agent_start`, consumed by the run's starting user message.
  let awaiting: { body: string; commands: Set<string> } | undefined;

  pi.on("session_start", () => {
    pending = undefined;
    awaiting = undefined;
  });

  /**
   * Run each `!{cmd}` in `text` (only those `allow` accepts) and splice its
   * output in. Single pass: output is never scanned for further patterns.
   */
  async function expand(
    text: string,
    ctx: ExtensionContext,
    allow: (pattern: string) => boolean = () => true,
  ): Promise<string> {
    if (!text.includes("!{")) return text;

    const parts: string[] = [];
    let last = 0;
    const expansions: Array<{ command: string; output: string; error?: string }> = [];
    for (const m of text.matchAll(PATTERN)) {
      const [full, command] = m;
      if (!allow(full)) continue;
      let out: string;
      try {
        const r = await pi.exec("bash", ["-c", command], { timeout: TIMEOUT_MS });
        out = (r.stdout || r.stderr || "").trim();
        if (r.code !== 0 && r.stderr) {
          expansions.push({ command, output: out, error: `exit code ${r.code}` });
        } else {
          expansions.push({ command, output: out });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        expansions.push({ command, output: "", error: msg });
        out = `[error: ${msg}]`;
      }
      // Stored output keeps no live pattern, so re-submitting this message from
      // /tree or /fork (which counts as typed input) cannot run text a command printed.
      parts.push(text.slice(last, m.index), out.replace(/!\{/g, "!\\{"));
      last = m.index + full.length;
    }
    if (expansions.length === 0) return text;
    parts.push(text.slice(last));

    if (ctx.hasUI) {
      const summary = expansions
        .map((e) => {
          const status = e.error ? ` (${e.error})` : "";
          const preview = e.output.length > 50 ? `${e.output.slice(0, 50)}...` : e.output;
          return `!{${e.command}}${status} -> "${preview}"`;
        })
        .join("\n");
      ctx.ui.notify(`Expanded ${expansions.length} inline command(s):\n${summary}`, "info");
    }

    return parts.join("");
  }

  /**
   * If `text` invokes a prompt template, return the `!{...}` patterns in its
   * file. Mirrors pi's `expandPromptTemplate` lookup: first template whose
   * name matches. `/skill:name` expands to a skill body, never a template.
   */
  function templatePatterns(text: string): Set<string> | undefined {
    const name = /^\/(\S+)/.exec(text)?.[1];
    if (!name || name.startsWith("skill:")) return undefined;
    const template = pi.getCommands().find((c) => c.source === "prompt" && c.name === name);
    if (!template) return undefined;
    try {
      const source = readFileSync(template.sourceInfo.path, "utf8");
      return new Set(Array.from(source.matchAll(PATTERN), (m) => m[0]));
    } catch {
      return undefined;
    }
  }

  // Text the user typed (or sent over RPC). Persists expanded text into session.
  pi.on("input", async (event, ctx) => {
    pending = undefined;
    if (event.source === "extension") return { action: "continue" };
    const text = event.text;
    // Preserve whole-line `!command` (pi's built-in bash escape).
    if (text.trimStart().startsWith("!") && !text.trimStart().startsWith("!{")) {
      return { action: "continue" };
    }

    // An idle invocation starts a run; a queued one never reaches before_agent_start.
    let invocation: Invocation | undefined;
    if (event.streamingBehavior === undefined) {
      const commands = templatePatterns(text);
      if (commands && commands.size > 0) {
        invocation = { text, commands };
        pending = invocation;
      }
    }

    const expanded = await expand(text, ctx);
    if (invocation) invocation.text = expanded;
    return expanded === text
      ? { action: "continue" }
      : { action: "transform", text: expanded, images: event.images };
  });

  // pi has expanded the template; `event.prompt` is the body it will send.
  pi.on("before_agent_start", (event) => {
    const invocation = pending;
    pending = undefined;
    awaiting = undefined;
    if (event.messageType !== "user" || !invocation) return;
    if (event.prompt === invocation.text || !event.prompt.includes("!{")) return;
    awaiting = { body: event.prompt, commands: invocation.commands };
  });

  // The run's first user message is the template body (plus any image hints pi appended).
  pi.on("message_end", async (event, ctx) => {
    const message = event.message;
    if (!awaiting || message.role !== "user") return;
    const { body, commands } = awaiting;
    awaiting = undefined;
    const allow = (pattern: string) => commands.has(pattern);

    if (typeof message.content === "string") {
      if (!message.content.startsWith(body)) return;
      const expanded = await expand(body, ctx, allow);
      if (expanded === body) return;
      return { message: { ...message, content: expanded + message.content.slice(body.length) } };
    }

    const index = message.content.findIndex((c) => c.type === "text");
    const block = message.content[index];
    if (block?.type !== "text" || !block.text.startsWith(body)) return;
    const expanded = await expand(body, ctx, allow);
    if (expanded === body) return;
    const content = message.content.slice();
    content[index] = { ...block, text: expanded + block.text.slice(body.length) };
    return { message: { ...message, content } };
  });

  pi.on("agent_end", () => {
    awaiting = undefined;
  });
}
