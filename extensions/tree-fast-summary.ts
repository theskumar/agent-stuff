/**
 * Tree Fast Summary Extension
 *
 * What it is:
 *   pi's `/tree` branch summarization normally runs on the currently active
 *   session model. This extension reroutes that summary call to a cheap,
 *   fast model configured via the `fast` mode in `modes.json` (resolved
 *   project-first, then global), so navigating the tree doesn't burn your
 *   expensive main model. `/compact` is NOT touched by this extension and
 *   continues to use the active session model.
 *
 *   Reuses pi's exported `generateBranchSummary`, so the structured output
 *   format, file tracking, and preamble are identical to the built-in — only
 *   the model swaps out, and we append a couple of extra guideline lines to
 *   the summarization instructions (see EXTRA_TREE_GUIDELINES). Falls back
 *   to `FALLBACK_FAST_MODEL` if no usable `fast` mode is found.
 *
 * Use cases:
 *   - Heavy `/tree` navigators who don't want to pay GPT-5 / Opus rates for
 *     branch summaries.
 *   - Consistent fast-path `/tree` summarization across projects via a
 *     single `~/.pi/agent/modes.json` `fast` entry.
 *
 * Common usage patterns:
 *   - Add a `fast` mode via `/mode` (Configure modes…) or directly in
 *     modes.json — see below.
 *   - Use `/tree` as normal; branch summaries automatically use the fast
 *     model.
 *   - Override per-project by adding `fast` to `.pi/modes.json`.
 *
 * The model is NOT hard-coded here. It is read from the `fast` mode in
 * `modes.json` (the same file the modes/prompt-editor extension manages),
 * resolving the project `.pi/modes.json` first and then the global
 * `~/.pi/agent/modes.json`. If no usable `fast` mode is found we fall back to
 * FALLBACK_FAST_MODEL below.
 *
 * Add a `fast` mode via `/mode` (Configure modes…) or directly in modes.json:
 *
 *   "fast": {
 *     "provider": "amazon-bedrock",
 *     "modelId": "global.anthropic.claude-haiku-4-5-20251001-v1:0"
 *   }
 *
 * We reuse pi's exported `generateBranchSummary`, so the prompt, structured
 * format, file tracking, and preamble are identical to the built-in summarizer
 * — only the model changes and a couple of extra guideline lines are appended
 * via `customInstructions` (see EXTRA_TREE_GUIDELINES).
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { generateBranchSummary } from "@earendil-works/pi-coding-agent";

// Name of the mode in modes.json to use for summarization.
const FAST_MODE_NAME = "fast";

// Extra guideline lines appended to pi's built-in BRANCH_SUMMARY_PROMPT via
// `customInstructions` (i.e. under the "Additional focus:" line). Keep these
// short — they are not a replacement for the default prompt, just additions.
const EXTRA_TREE_GUIDELINES = [
  'Include a "Suggested Skills" section listing skills the agent should invoke when resuming this branch (skill name + one-line reason). Use "(none)" if no skills apply.',
  "Do not duplicate content already captured in other artifacts (PRDs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.",
].join("\n");

// Used only when modes.json has no usable `fast` mode (missing file, missing
// mode, or missing provider/modelId).
const FALLBACK_FAST_MODEL = {
  provider: "amazon-bedrock",
  modelId: "global.anthropic.claude-haiku-4-5-20251001-v1:0",
};

type FastModelSpec = { provider: string; modelId: string };

function expandUserPath(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function getGlobalAgentDir(): string {
  const env = process.env.PI_CODING_AGENT_DIR;
  if (env) return expandUserPath(env);
  return path.join(os.homedir(), ".pi", "agent");
}

function getGlobalModesPath(): string {
  return path.join(getGlobalAgentDir(), "modes.json");
}

function getProjectModesPath(cwd: string): string {
  return path.join(cwd, ".pi", "modes.json");
}

async function readFastSpecFrom(filePath: string): Promise<FastModelSpec | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { modes?: Record<string, unknown> };
    const spec = parsed?.modes?.[FAST_MODE_NAME] as
      | { provider?: unknown; modelId?: unknown }
      | undefined;
    if (spec && typeof spec.provider === "string" && typeof spec.modelId === "string") {
      return { provider: spec.provider, modelId: spec.modelId };
    }
  } catch {
    // Missing/invalid file → caller falls through.
  }
  return null;
}

/**
 * Resolve the `fast` mode spec, preferring the project modes.json and falling
 * back to the global one, then to FALLBACK_FAST_MODEL.
 */
async function resolveFastModel(cwd: string): Promise<FastModelSpec> {
  const fromProject = await readFastSpecFrom(getProjectModesPath(cwd));
  if (fromProject) return fromProject;

  const fromGlobal = await readFastSpecFrom(getGlobalModesPath());
  if (fromGlobal) return fromGlobal;

  return FALLBACK_FAST_MODEL;
}

export default function (pi: ExtensionAPI) {
  pi.on("session_before_tree", async (event, ctx: ExtensionContext) => {
    const { preparation, signal } = event;

    // Only generate a summary if the user opted in and there's something to summarize.
    // Returning nothing lets pi's default summarizer (or no summary) take over.
    if (!preparation.userWantsSummary) return;
    if (!preparation.entriesToSummarize?.length) return;

    const fast = await resolveFastModel(ctx.cwd);
    const model = ctx.modelRegistry.find(fast.provider, fast.modelId);
    if (!model) {
      if (ctx.hasUI) {
        ctx.ui.notify(
          `tree-fast-summary: model ${fast.provider}/${fast.modelId} not found; using default summarizer`,
          "warning",
        );
      }
      return;
    }

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) {
      if (ctx.hasUI) {
        const why = auth.ok ? "no API key" : auth.error;
        ctx.ui.notify(
          `tree-fast-summary: ${why} for ${model.provider}; using default summarizer`,
          "warning",
        );
      }
      return;
    }

    try {
      if (ctx.hasUI) {
        ctx.ui.notify(`tree-fast-summary: summarizing branch with ${model.id}…`, "info");
      }

      // Merge our extra guidelines with any user-supplied custom instructions.
      // When `replaceInstructions` is true the user's text fully replaces pi's
      // BRANCH_SUMMARY_PROMPT, so we append our guidelines to it. Otherwise
      // pi's code appends `customInstructions` after "Additional focus:", so
      // we just concatenate ours with the user's (if any).
      const userInstructions = preparation.customInstructions?.trim();
      const customInstructions = userInstructions
        ? `${userInstructions}\n\n${EXTRA_TREE_GUIDELINES}`
        : EXTRA_TREE_GUIDELINES;

      const result = await generateBranchSummary(preparation.entriesToSummarize, {
        model,
        apiKey: auth.apiKey,
        headers: auth.headers,
        signal,
        customInstructions,
        replaceInstructions: preparation.replaceInstructions,
      });

      if (result.aborted || result.error || !result.summary) {
        if (result.error && ctx.hasUI) {
          ctx.ui.notify(`tree-fast-summary: ${result.error}; using default summarizer`, "warning");
        }
        return;
      }

      return {
        summary: {
          summary: result.summary,
          details: {
            readFiles: result.readFiles ?? [],
            modifiedFiles: result.modifiedFiles ?? [],
          },
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (ctx.hasUI) {
        ctx.ui.notify(`tree-fast-summary: ${message}; using default summarizer`, "warning");
      }
      return;
    }
  });
}
