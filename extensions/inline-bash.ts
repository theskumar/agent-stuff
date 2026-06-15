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
 * Two hook points:
 *   - `input`   : catches `!{...}` typed directly by the user. Expands before
 *                 the message is persisted, so session jsonl stores the
 *                 expanded text. Preserves whole-line `!command` (pi's
 *                 built-in bash escape) untouched.
 *   - `context` : catches `!{...}` inlined by prompt-template expansion
 *                 (e.g. /commit's body), which is invisible at `input` time
 *                 because pi expands templates AFTER firing `input`. Rewrites
 *                 the deep-copied messages going to the provider; the
 *                 persisted session message keeps the literal `!{...}`.
 *
 * Results are memoised by raw text so a multi-LLM-call turn does not
 * re-execute the same commands. Memo is cleared on session_start.
 *
 * Original (input-only) source: vendored from earendil-works/pi
 *   packages/coding-agent/examples/extensions/inline-bash.ts
 *   https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/inline-bash.ts
 *   MIT License, Copyright (c) 2025 Mario Zechner.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const PATTERN = /!\{([^}]+)\}/g;
  const TIMEOUT_MS = 30000;
  const memo = new Map<string, string>();

  pi.on("session_start", () => {
    memo.clear();
  });

  async function expand(text: string, ctx?: ExtensionContext): Promise<string> {
    if (!text.includes("!{")) return text;
    const cached = memo.get(text);
    if (cached !== undefined) return cached;

    PATTERN.lastIndex = 0;
    const matches: Array<{ full: string; command: string }> = [];
    let m: RegExpExecArray | null = PATTERN.exec(text);
    while (m !== null) {
      matches.push({ full: m[0], command: m[1] });
      m = PATTERN.exec(text);
    }

    let result = text;
    const expansions: Array<{ command: string; output: string; error?: string }> = [];
    for (const { full, command } of matches) {
      try {
        const r = await pi.exec("bash", ["-c", command], { timeout: TIMEOUT_MS });
        const out = (r.stdout || r.stderr || "").trim();
        if (r.code !== 0 && r.stderr) {
          expansions.push({ command, output: out, error: `exit code ${r.code}` });
        } else {
          expansions.push({ command, output: out });
        }
        result = result.replace(full, out);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        expansions.push({ command, output: "", error: msg });
        result = result.replace(full, `[error: ${msg}]`);
      }
    }

    if (ctx?.hasUI && expansions.length > 0) {
      const summary = expansions
        .map((e) => {
          const status = e.error ? ` (${e.error})` : "";
          const preview = e.output.length > 50 ? `${e.output.slice(0, 50)}...` : e.output;
          return `!{${e.command}}${status} -> "${preview}"`;
        })
        .join("\n");
      ctx.ui.notify(`Expanded ${expansions.length} inline command(s):\n${summary}`, "info");
    }

    memo.set(text, result);
    return result;
  }

  // Path 1: user typed !{...} directly. Persists expanded text into session.
  pi.on("input", async (event, ctx) => {
    const text = event.text;
    // Preserve whole-line `!command` (pi's built-in bash escape).
    if (text.trimStart().startsWith("!") && !text.trimStart().startsWith("!{")) {
      return { action: "continue" };
    }
    if (!text.includes("!{")) return { action: "continue" };
    const expanded = await expand(text, ctx);
    return expanded === text
      ? { action: "continue" }
      : { action: "transform", text: expanded, images: event.images };
  });

  // Path 2: template-expanded bodies (e.g. /commit) become visible at `context`.
  pi.on("context", async (event, ctx) => {
    const messages = event.messages;
    let touched = false;
    for (const msg of messages) {
      if (msg.role !== "user") continue;
      const content = msg.content;
      if (typeof content === "string") {
        if (!content.includes("!{")) continue;
        const expanded = await expand(content, ctx);
        if (expanded !== content) {
          msg.content = expanded;
          touched = true;
        }
      } else if (Array.isArray(content)) {
        for (const c of content) {
          if (
            c &&
            typeof c === "object" &&
            "type" in c &&
            c.type === "text" &&
            typeof (c as { text: unknown }).text === "string" &&
            (c as { text: string }).text.includes("!{")
          ) {
            const block = c as { type: "text"; text: string };
            const expanded = await expand(block.text, ctx);
            if (expanded !== block.text) {
              block.text = expanded;
              touched = true;
            }
          }
        }
      }
    }
    return touched ? { messages } : undefined;
  });
}
