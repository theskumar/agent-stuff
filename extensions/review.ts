/**
 * Code Review Extension (inspired by Codex's review feature)
 *
 * What it is:
 *   A `/review` command that turns pi into a structured code reviewer. It
 *   gathers diff context (PR, branch, commit, uncommitted changes, or a
 *   folder snapshot), injects language-aware review rubrics, an optional
 *   project `REVIEW_GUIDELINES.md`, and any persisted custom instructions,
 *   then asks the model to review and emit a machine-readable `review-meta`
 *   JSON trailer so loop-fixing flows can act on the verdict.
 *
 * Use cases:
 *   - Self-review of your own uncommitted work before opening a PR.
 *   - Review a teammate's PR locally without leaving the terminal.
 *   - Review a specific commit / range when bisecting a regression.
 *   - Snapshot review of a folder (no diff) to audit existing code quality.
 *   - Feeding the review verdict into `/loop` to drive automated fix cycles.
 *
 * Common usage patterns:
 *
 * Supports multiple review modes:
 * - Review a GitHub pull request (checks out the PR locally)
 * - Review against a base branch (PR style)
 * - Review uncommitted changes
 * - Review a specific commit
 * - Shared custom review instructions (applied to all review modes when configured)
 *
 * Usage:
 * - `/review` - show interactive selector
 * - `/review pr 123` - review PR #123 (checks out locally)
 * - `/review pr https://github.com/owner/repo/pull/123` - review PR from URL
 * - `/review uncommitted` - review uncommitted changes directly
 * - `/review branch main` - review against main branch
 * - `/review commit abc123` - review specific commit
 * - `/review folder src docs` - review specific folders/files (snapshot, not diff)
 * - `/review` selector includes Add/Remove custom review instructions (applies to all modes)
 * - `/review --extra "focus on performance regressions"` - add extra review instruction (works with any mode)
 *
 * Project-specific review guidelines:
 * - If a REVIEW_GUIDELINES.md file exists in the same directory as .pi,
 *   its contents are appended to the review prompt.
 *
 * Automatic review context (invisible, no command/flag/selector changes):
 * - Targeted checklists for the changed file types are appended to the rubric
 *   (e.g. null/thread-safety for Java, XSS/React for TS/JS). See REVIEW_RULES.
 * - A changed-file manifest, and (when the change is small enough) the full diff,
 *   are pre-embedded so the model spends fewer turns re-deriving them with git.
 * - Large changes get a short "enumerate and risk-rank files first" planning nudge.
 * - The review ends with a fenced `review-meta` JSON trailer that loop-fixing reads
 *   for a deterministic blocking signal (falling back to prose heuristics if absent).
 *
 * Note: PR review requires a clean working tree (no uncommitted changes to tracked files).
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { DynamicBorder, BorderedLoader } from "@earendil-works/pi-coding-agent";
import {
  Container,
  fuzzyFilter,
  Input,
  type SelectItem,
  SelectList,
  Spacer,
  Text,
} from "@earendil-works/pi-tui";
import path from "node:path";
import { promises as fs } from "node:fs";
import { Buffer } from "node:buffer";

// State to track fresh session review (where we branched from).
// Module-level state means only one review can be active at a time.
// This is intentional - the UI and /end-review command assume a single active review.
let reviewOriginId: string | undefined = undefined;
let endReviewInProgress = false;
let reviewLoopFixingEnabled = false;
let reviewCustomInstructions: string | undefined = undefined;
let reviewLoopInProgress = false;

const REVIEW_STATE_TYPE = "review-session";
const REVIEW_ANCHOR_TYPE = "review-anchor";
const REVIEW_SETTINGS_TYPE = "review-settings";
const REVIEW_LOOP_MAX_ITERATIONS = 10;
const REVIEW_LOOP_START_TIMEOUT_MS = 15000;
const REVIEW_LOOP_START_POLL_MS = 50;

// Bounded diff pre-embedding (WI-3): only embed the full diff when the change is
// small enough that it will not crowd the context window. Above these thresholds
// we fall back to the manifest plus the model running git itself, exactly as before.
const DIFF_EMBED_MAX_LINES = 1500;
const DIFF_EMBED_MAX_BYTES = 100 * 1024;
// Plan gate (WI-4): above this many changed lines, nudge the model to enumerate and
// risk-rank the changed files before listing findings. Matches OCR's plan threshold.
const REVIEW_PLAN_GATE_LINE_THRESHOLD = 50;

type ReviewSessionState = {
  active: boolean;
  originId?: string;
};

type ReviewSettingsState = {
  loopFixingEnabled?: boolean;
  customInstructions?: string;
};

function setReviewWidget(ctx: ExtensionContext, active: boolean) {
  if (!ctx.hasUI) return;
  if (!active) {
    ctx.ui.setWidget("review", undefined);
    return;
  }

  ctx.ui.setWidget("review", (_tui, theme) => {
    const message = reviewLoopInProgress
      ? "Review session active (loop fixing running)"
      : reviewLoopFixingEnabled
        ? "Review session active (loop fixing enabled), return with /end-review"
        : "Review session active, return with /end-review";
    const text = new Text(theme.fg("warning", message), 0, 0);
    return {
      render(width: number) {
        return text.render(width);
      },
      invalidate() {
        text.invalidate();
      },
    };
  });
}

function getReviewState(ctx: ExtensionContext): ReviewSessionState | undefined {
  let state: ReviewSessionState | undefined;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && entry.customType === REVIEW_STATE_TYPE) {
      state = entry.data as ReviewSessionState | undefined;
    }
  }

  return state;
}

function applyReviewState(ctx: ExtensionContext) {
  const state = getReviewState(ctx);

  if (state?.active && state.originId) {
    reviewOriginId = state.originId;
    setReviewWidget(ctx, true);
    return;
  }

  reviewOriginId = undefined;
  setReviewWidget(ctx, false);
}

function getReviewSettings(ctx: ExtensionContext): ReviewSettingsState {
  let state: ReviewSettingsState | undefined;
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "custom" && entry.customType === REVIEW_SETTINGS_TYPE) {
      state = entry.data as ReviewSettingsState | undefined;
    }
  }

  return {
    loopFixingEnabled: state?.loopFixingEnabled === true,
    customInstructions: state?.customInstructions?.trim() || undefined,
  };
}

function applyReviewSettings(ctx: ExtensionContext) {
  const state = getReviewSettings(ctx);
  reviewLoopFixingEnabled = state.loopFixingEnabled === true;
  reviewCustomInstructions = state.customInstructions?.trim() || undefined;
}

function parseMarkdownHeading(
  line: string,
): { level: number; title: string } | null {
  const headingMatch = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
  if (!headingMatch) {
    return null;
  }

  const rawTitle = headingMatch[2].replace(/\s+#+\s*$/, "").trim();
  return {
    level: headingMatch[1].length,
    title: rawTitle,
  };
}

function getFindingsSectionBounds(
  lines: string[],
): { start: number; end: number } | null {
  let start = -1;
  let findingsHeadingLevel: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = parseMarkdownHeading(line);
    if (heading && /^findings\b/i.test(heading.title)) {
      start = i + 1;
      findingsHeadingLevel = heading.level;
      break;
    }
    if (/^\s*findings\s*:?\s*$/i.test(line)) {
      start = i + 1;
      break;
    }
  }

  if (start < 0) {
    return null;
  }

  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const heading = parseMarkdownHeading(line);
    if (heading) {
      const normalizedTitle = heading.title.replace(/[*_`]/g, "").trim();
      if (
        /^(review scope|verdict|overall verdict|fix queue|constraints(?:\s*&\s*preferences)?)\b:?/i.test(
          normalizedTitle,
        )
      ) {
        end = i;
        break;
      }

      if (/\[P[0-3]\]/i.test(heading.title)) {
        continue;
      }

      if (
        findingsHeadingLevel !== null &&
        heading.level <= findingsHeadingLevel
      ) {
        end = i;
        break;
      }
    }

    if (
      /^\s*(review scope|verdict|overall verdict|fix queue|constraints(?:\s*&\s*preferences)?)\b:?/i.test(
        line,
      )
    ) {
      end = i;
      break;
    }
  }

  return { start, end };
}

function isLikelyFindingLine(line: string): boolean {
  if (!/\[P[0-3]\]/i.test(line)) {
    return false;
  }

  if (/^\s*(?:[-*+]|(?:\d+)[.)]|#{1,6})\s+priority\s+tag\b/i.test(line)) {
    return false;
  }

  if (
    /^\s*(?:[-*+]|(?:\d+)[.)]|#{1,6})\s+\[P[0-3]\]\s*-\s*(?:drop everything|urgent|normal|low|nice to have)\b/i.test(
      line,
    )
  ) {
    return false;
  }

  const allPriorityTags = line.match(/\[P[0-3]\]/gi) ?? [];
  if (allPriorityTags.length > 1) {
    return false;
  }

  if (/^\s*(?:[-*+]|(?:\d+)[.)])\s+/.test(line)) {
    return true;
  }

  if (/^\s*#{1,6}\s+/.test(line)) {
    return true;
  }

  if (/^\s*(?:\*\*|__)?\[P[0-3]\](?:\*\*|__)?(?=\s|:|-)/i.test(line)) {
    return true;
  }

  return false;
}

function normalizeVerdictValue(value: string): string {
  return value
    .trim()
    .replace(/^[-*+]\s*/, "")
    .replace(/^['"`]+|['"`]+$/g, "")
    .toLowerCase();
}

function isNeedsAttentionVerdictValue(value: string): boolean {
  const normalized = normalizeVerdictValue(value);
  if (!normalized.includes("needs attention")) {
    return false;
  }

  if (/\bnot\s+needs\s+attention\b/.test(normalized)) {
    return false;
  }

  // Reject rubric/choice phrasing like "correct or needs attention", but
  // keep legitimate verdict text that may contain unrelated "or".
  if (/\bcorrect\b/.test(normalized) && /\bor\b/.test(normalized)) {
    return false;
  }

  return true;
}

function hasNeedsAttentionVerdict(messageText: string): boolean {
  const lines = messageText.split(/\r?\n/);

  for (const line of lines) {
    const inlineMatch = line.match(
      /^\s*(?:[*-+]\s*)?(?:overall\s+)?verdict\s*:\s*(.+)$/i,
    );
    if (inlineMatch && isNeedsAttentionVerdictValue(inlineMatch[1])) {
      return true;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = parseMarkdownHeading(line);

    let verdictLevel: number | null = null;
    if (heading) {
      const normalizedHeading = heading.title.replace(/[*_`]/g, "").trim();
      if (!/^(?:overall\s+)?verdict\b/i.test(normalizedHeading)) {
        continue;
      }
      verdictLevel = heading.level;
    } else if (!/^\s*(?:overall\s+)?verdict\s*:?\s*$/i.test(line)) {
      continue;
    }

    for (let j = i + 1; j < lines.length; j++) {
      const verdictLine = lines[j];
      const nextHeading = parseMarkdownHeading(verdictLine);
      if (nextHeading) {
        const normalizedNextHeading = nextHeading.title
          .replace(/[*_`]/g, "")
          .trim();
        if (verdictLevel === null || nextHeading.level <= verdictLevel) {
          break;
        }
        if (
          /^(review scope|findings|fix queue|constraints(?:\s*&\s*preferences)?)\b:?/i.test(
            normalizedNextHeading,
          )
        ) {
          break;
        }
      }

      const trimmed = verdictLine.trim();
      if (!trimmed) {
        continue;
      }

      if (isNeedsAttentionVerdictValue(trimmed)) {
        return true;
      }

      if (/\bcorrect\b/i.test(normalizeVerdictValue(trimmed))) {
        break;
      }
    }
  }

  return false;
}

type ReviewMeta = {
  verdict?: unknown;
  blocking?: unknown;
  findings?: unknown;
};

/**
 * Extract the machine-readable `review-meta` trailer the rubric asks the model to
 * emit (WI-2). Returns the parsed object, or null when the block is absent or
 * malformed.
 *
 * This is an optional convenience signal, not a contract: older sessions and other
 * models won't emit it, and a model can still produce slightly malformed JSON. We
 * deliberately swallow parse failures and return null so callers fall back to the
 * legacy prose-scraping heuristics rather than failing the review. (This is a
 * boundary-level "best effort" by design, the one place the strict fail-fast rule
 * does not apply, because a clean fallback path exists.)
 */
function parseReviewMeta(messageText: string): ReviewMeta | null {
  const fenceRe = /```review-meta\s*\r?\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  let lastBody: string | null = null;
  while ((match = fenceRe.exec(messageText)) !== null) {
    lastBody = match[1];
  }
  if (lastBody === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(lastBody.trim());
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ReviewMeta;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Decide whether the parsed meta indicates blocking findings.
 * Returns null when the meta carries no usable verdict/blocking signal, so the
 * caller can fall back to the legacy heuristics.
 */
function metaIndicatesBlocking(meta: ReviewMeta): boolean | null {
  let known = false;
  let blocking = false;

  if (typeof meta.blocking === "number" && Number.isFinite(meta.blocking)) {
    known = true;
    if (meta.blocking > 0) {
      blocking = true;
    }
  }

  if (typeof meta.verdict === "string" && meta.verdict.trim()) {
    // Only accept the two verdict values the rubric defines. Anything else
    // (e.g. "looks good") is not a usable signal: treating it as known would
    // suppress the legacy prose heuristics even when the prose has [P0-P2]
    // findings.
    if (isNeedsAttentionVerdictValue(meta.verdict)) {
      known = true;
      blocking = true;
    } else if (/^correct$/i.test(normalizeVerdictValue(meta.verdict))) {
      known = true;
    }
  }

  return known ? blocking : null;
}

/**
 * Whether the review reported blocking findings.
 *
 * Prefers the structured `review-meta` trailer (WI-2); falls back to the legacy
 * markdown-scraping heuristics when the trailer is absent or carries no usable
 * signal, so older sessions and non-conforming models keep working.
 */
function hasBlockingReviewFindings(messageText: string): boolean {
  const meta = parseReviewMeta(messageText);
  if (meta) {
    const fromMeta = metaIndicatesBlocking(meta);
    if (fromMeta !== null) {
      return fromMeta;
    }
  }
  return hasBlockingReviewFindingsLegacy(messageText);
}

function hasBlockingReviewFindingsLegacy(messageText: string): boolean {
  const lines = messageText.split(/\r?\n/);
  const bounds = getFindingsSectionBounds(lines);
  const candidateLines = bounds ? lines.slice(bounds.start, bounds.end) : lines;

  let inCodeFence = false;
  let foundTaggedFinding = false;
  for (const line of candidateLines) {
    if (/^\s*```/.test(line)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) {
      continue;
    }

    if (!isLikelyFindingLine(line)) {
      continue;
    }

    foundTaggedFinding = true;
    if (/\[(P0|P1|P2)\]/i.test(line)) {
      return true;
    }
  }

  if (foundTaggedFinding) {
    return false;
  }

  return hasNeedsAttentionVerdict(messageText);
}

// Review target types (matching Codex's approach)
type ReviewTarget =
  | { type: "uncommitted" }
  | { type: "baseBranch"; branch: string }
  | { type: "commit"; sha: string; title?: string }
  | { type: "pullRequest"; prNumber: number; baseBranch: string; title: string }
  | { type: "folder"; paths: string[] };

// Prompts (adapted from Codex)
const UNCOMMITTED_PROMPT =
  "Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.";

const LOCAL_CHANGES_REVIEW_INSTRUCTIONS =
  "Also include local working-tree changes (staged, unstaged, and untracked files) from this branch. Use `git status --porcelain`, `git diff`, `git diff --staged`, and `git ls-files --others --exclude-standard` so local fixes are part of this review cycle.";

const BASE_BRANCH_PROMPT_WITH_MERGE_BASE =
  "Review the code changes against the base branch '{baseBranch}'. The merge base commit for this comparison is {mergeBaseSha}. Run `git diff {mergeBaseSha}` to inspect the changes relative to {baseBranch}. Provide prioritized, actionable findings.";

const BASE_BRANCH_PROMPT_FALLBACK =
  'Review the code changes against the base branch \'{branch}\'. Start by finding the merge diff between the current branch and {branch}\'s upstream e.g. (`git merge-base HEAD "$(git rev-parse --abbrev-ref "{branch}@{upstream}")"`), then run `git diff` against that SHA to see what changes we would merge into the {branch} branch. Provide prioritized, actionable findings.';

const COMMIT_PROMPT_WITH_TITLE =
  'Review the code changes introduced by commit {sha} ("{title}"). Provide prioritized, actionable findings.';

const COMMIT_PROMPT =
  "Review the code changes introduced by commit {sha}. Provide prioritized, actionable findings.";

const PULL_REQUEST_PROMPT =
  "Review pull request #{prNumber} (\"{title}\") against the base branch '{baseBranch}'. The merge base commit for this comparison is {mergeBaseSha}. Run `git diff {mergeBaseSha}` to inspect the changes that would be merged. Provide prioritized, actionable findings.";

const PULL_REQUEST_PROMPT_FALLBACK =
  "Review pull request #{prNumber} (\"{title}\") against the base branch '{baseBranch}'. Start by finding the merge base between the current branch and {baseBranch} (e.g., `git merge-base HEAD {baseBranch}`), then run `git diff` against that SHA to see the changes that would be merged. Provide prioritized, actionable findings.";

const FOLDER_REVIEW_PROMPT =
  "Review the code in the following paths: {paths}. This is a snapshot review (not a diff). Read the files directly in these paths and provide prioritized, actionable findings.";

// The detailed review rubric (adapted from Codex's review_prompt.md)
const REVIEW_RUBRIC = `# Review Guidelines

You are acting as a code reviewer for a proposed code change made by another engineer.

Below are default guidelines for determining what to flag. These are not the final word — if you encounter more specific guidelines elsewhere (in a developer message, user message, file, or project review guidelines appended below), those override these general instructions.

## Determining what to flag

Flag issues that:
1. Meaningfully impact the accuracy, performance, security, or maintainability of the code.
2. Are discrete and actionable (not general issues or multiple combined issues).
3. Don't demand rigor inconsistent with the rest of the codebase.
4. Were introduced in the changes being reviewed (not pre-existing bugs).
5. The author would likely fix if aware of them.
6. Don't rely on unstated assumptions about the codebase or author's intent.
7. Have provable impact on other parts of the code — it is not enough to speculate that a change may disrupt another part, you must identify the parts that are provably affected.
8. Are clearly not intentional changes by the author.
9. Be particularly careful with untrusted user input and follow the specific guidelines to review.
10. Treat silent local error recovery (especially parsing/IO/network fallbacks) as high-signal review candidates unless there is explicit boundary-level justification.

## Untrusted User Input

1. Be careful with open redirects, they must always be checked to only go to trusted domains (?next_page=...)
2. Always flag SQL that is not parametrized
3. In systems with user supplied URL input, http fetches always need to be protected against access to local resources (intercept DNS resolver!)
4. Escape, don't sanitize if you have the option (eg: HTML escaping)

## Comment guidelines

1. Be clear about why the issue is a problem.
2. Communicate severity appropriately - don't exaggerate.
3. Be brief - at most 1 paragraph.
4. Keep code snippets under 3 lines, wrapped in inline code or code blocks.
5. Use \`\`\`suggestion blocks ONLY for concrete replacement code (minimal lines; no commentary inside the block). Preserve the exact leading whitespace of the replaced lines.
6. Explicitly state scenarios/environments where the issue arises.
7. Use a matter-of-fact tone - helpful AI assistant, not accusatory.
8. Write for quick comprehension without close reading.
9. Avoid excessive flattery or unhelpful phrases like "Great job...".

## Review priorities

1. Surface critical non-blocking human callouts (migrations, dependency churn, auth/permissions, compatibility, destructive operations) at the end.
2. Prefer simple, direct solutions over wrappers or abstractions without clear value.
3. Treat back pressure handling as critical to system stability.
4. Apply system-level thinking; flag changes that increase operational risk or on-call wakeups.
5. Ensure that errors are always checked against codes or stable identifiers, never error messages.

## Fail-fast error handling (strict)

When reviewing added or modified error handling, default to fail-fast behavior.

1. Evaluate every new or changed \`try/catch\`: identify what can fail and why local handling is correct at that exact layer.
2. Prefer propagation over local recovery. If the current scope cannot fully recover while preserving correctness, rethrow (optionally with context) instead of returning fallbacks.
3. Flag catch blocks that hide failure signals (e.g. returning \`null\`/\`[]\`/\`false\`, swallowing JSON parse failures, logging-and-continue, or “best effort” silent recovery).
4. JSON parsing/decoding should fail loudly by default. Quiet fallback parsing is only acceptable with an explicit compatibility requirement and clear tested behavior.
5. Boundary handlers (HTTP routes, CLI entrypoints, supervisors) may translate errors, but must not pretend success or silently degrade.
6. If a catch exists only to satisfy lint/style without real handling, treat it as a bug.
7. When uncertain, prefer crashing fast over silent degradation.

## Required human callouts (non-blocking, at the very end)

After findings/verdict, you MUST append this final section:

## Human Reviewer Callouts (Non-Blocking)

Include only applicable callouts (no yes/no lines):

- **This change adds a database migration:** <files/details>
- **This change introduces a new dependency:** <package(s)/details>
- **This change changes a dependency (or the lockfile):** <files/package(s)/details>
- **This change modifies auth/permission behavior:** <what changed and where>
- **This change introduces backwards-incompatible public schema/API/contract changes:** <what changed and where>
- **This change includes irreversible or destructive operations:** <operation and scope>

Rules for this section:
1. These are informational callouts for the human reviewer, not fix items.
2. Do not include them in Findings unless there is an independent defect.
3. These callouts alone must not change the verdict.
4. Only include callouts that apply to the reviewed change.
5. Keep each emitted callout bold exactly as written.
6. If none apply, write "- (none)".

## Priority levels

Tag each finding with a priority level in the title:
- [P0] - Drop everything to fix. Blocking release/operations. Only for universal issues that do not depend on assumptions about inputs.
- [P1] - Urgent. Should be addressed in the next cycle.
- [P2] - Normal. To be fixed eventually.
- [P3] - Low. Nice to have.

## Output format

Provide your findings in a clear, structured format:
1. List each finding with its priority tag, file location, and explanation.
2. Findings must reference locations that overlap with the actual diff — don't flag pre-existing code.
3. Keep line references as short as possible (avoid ranges over 5-10 lines; pick the most suitable subrange).
4. Provide an overall verdict: "correct" (no blocking issues) or "needs attention" (has blocking issues).
5. Ignore trivial style issues unless they obscure meaning or violate documented standards.
6. Do not generate a full PR fix — only flag issues and optionally provide short suggestion blocks.
7. End with the required "Human Reviewer Callouts (Non-Blocking)" section and all applicable bold callouts (no yes/no).

Output all findings the author would fix if they knew about them. If there are no qualifying findings, explicitly state the code looks good. Don't stop at the first finding - list every qualifying issue. Then append the required non-blocking callouts section.

## Machine-readable trailer (required, very last)

After the Human Reviewer Callouts section, append exactly one fenced code block labeled \`review-meta\` as the very last thing in your response. It must contain a single JSON object:

\`\`\`review-meta
{"verdict":"correct","blocking":0,"findings":[{"priority":"P3","file":"path/to/file.ext","line":42,"title":"short finding title"}]}
\`\`\`

Rules for this trailer:
1. \`verdict\` is exactly "correct" or "needs attention" and must match the overall verdict you reported above.
2. \`blocking\` is the integer count of blocking findings (P0, P1, or P2). Use 0 when the verdict is "correct".
3. \`findings\` lists every finding you reported, including P3. Use \`[]\` when there are none. Use \`null\` for \`line\` when a single line does not apply.
4. This block is metadata for tooling. Keep it accurate and consistent with the human-readable review above it; do not add commentary inside the block.`;

// ---------------------------------------------------------------------------
// WI-1: Language- and path-aware rule injection
//
// Targeted checklists appended to the generic rubric, scoped to the file types
// actually changed. Embedded inline (rather than a sidecar JSON) because this
// repo installs extensions as standalone symlinked `.ts` files (see install.sh),
// so a `.json` data file would not be deployed alongside the extension.
//
// Checklists are seeded from and inspired by alibaba/open-code-review
// (internal/config/rules/system_rules.json), which is licensed Apache-2.0.
// ---------------------------------------------------------------------------
type ReviewRule = {
  id: string;
  globs: string[];
  checklist: string;
};

const REVIEW_RULES: ReviewRule[] = [
  {
    id: "java",
    globs: ["**/*.java"],
    checklist:
      "### Java\n" +
      "- Null-safety: guard against NullPointerException; check Optional usage, unboxing of nullable wrappers, and map/collection lookups.\n" +
      "- Thread-safety: flag shared mutable state without synchronization, non-thread-safe types (SimpleDateFormat, HashMap) used concurrently, and double-checked locking without volatile.\n" +
      "- Resource handling: ensure streams/connections use try-with-resources; flag resources that may leak on exception.\n" +
      "- Exceptions: flag swallowed exceptions and overly broad catch (Exception/Throwable) without rethrow or context.",
  },
  {
    id: "web-ts-js",
    globs: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"],
    checklist:
      "### TypeScript / JavaScript\n" +
      "- XSS: flag `dangerouslySetInnerHTML`, `innerHTML`/`outerHTML` assignment, and `eval`/`new Function` on untrusted input; prefer escaping over sanitizing.\n" +
      "- Async: flag unhandled promise rejections and missing `await` on promises whose result/errors matter.\n" +
      "- Equality/types: prefer `===`/`!==`; be wary of implicit `any` and unchecked non-null assertions (`!`).",
  },
  {
    id: "react",
    globs: ["**/*.tsx", "**/*.jsx"],
    checklist:
      "### React\n" +
      "- Verify hook dependency arrays, stable `key` props in lists, and effects that need cleanup; avoid state updates after unmount.",
  },
  {
    id: "python",
    globs: ["**/*.py"],
    checklist:
      "### Python\n" +
      "- Mutable default arguments (`def f(x=[])`) and shared module-level mutable state.\n" +
      "- Broad `except:`/`except Exception:` that swallows errors; prefer specific exceptions and re-raise where recovery isn't possible.\n" +
      "- SQL built via f-strings/`%`/`.format`; require parameterized queries.\n" +
      "- `subprocess(..., shell=True)` or `os.system` with interpolated input.",
  },
  {
    id: "c-cpp",
    globs: ["**/*.c", "**/*.h", "**/*.cc", "**/*.cpp", "**/*.cxx", "**/*.hpp"],
    checklist:
      "### C / C++\n" +
      "- malloc/calloc/realloc paired with exactly one free; flag leaks and double-free on every path (including error paths).\n" +
      "- Check allocation results for NULL before use.\n" +
      "- Buffer bounds: flag unbounded copies (strcpy/strcat/sprintf/gets) and off-by-one indexing.\n" +
      "- Integer overflow in size/length arithmetic used for allocation or indexing.",
  },
  {
    id: "go",
    globs: ["**/*.go"],
    checklist:
      "### Go\n" +
      "- Unchecked errors: every returned `error` should be handled or explicitly ignored with rationale.\n" +
      "- Goroutine leaks: ensure goroutines can exit (context/cancellation, closed channels).\n" +
      "- `defer` inside loops accumulating until function return.\n" +
      "- Nil dereference of maps/pointers/interfaces before initialization.",
  },
  {
    id: "sql-mapper-xml",
    globs: ["**/*mapper*.xml", "**/*Mapper*.xml"],
    checklist:
      "### SQL mapper XML (MyBatis/iBatis)\n" +
      "- SQL injection: flag `${...}` string substitution on user-controlled values; require `#{...}` parameter binding instead.\n" +
      "- Dynamic SQL (`<if>`/`<foreach>`) that concatenates untrusted fragments.\n" +
      "- Unparameterized `LIKE`, `ORDER BY`, or `IN` clauses built from input.",
  },
  {
    id: "maven-pom",
    globs: ["**/pom.xml"],
    checklist:
      "### Maven pom.xml\n" +
      "- Dependency pinning: flag `-SNAPSHOT` dependencies and unbounded/open version ranges in release builds.\n" +
      "- Unpinned plugin versions (rely on a fixed version, not the build's default).\n" +
      "- New or changed dependencies that warrant a human callout.",
  },
  {
    id: "npm-package-json",
    globs: ["**/package.json"],
    checklist:
      "### package.json\n" +
      "- Wildcard/loose version specifiers (`*`, `latest`, or broad `^`/`~` on security-sensitive deps).\n" +
      "- New dependencies and dependency/lockfile churn (call out for human review).\n" +
      "- `scripts` (especially `preinstall`/`postinstall`) that run network or arbitrary shell commands.",
  },
];

const GLOB_REGEX_CACHE = new Map<string, RegExp>();

function escapeRegExpLiteral(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compile a small subset of glob syntax (`**`, `*`, `?`) to a RegExp anchored to
 * the whole path. `**​/` matches zero or more leading path segments so that, e.g.,
 * `**​/pom.xml` matches both `pom.xml` and `a/b/pom.xml`.
 */
function globToRegExp(glob: string): RegExp {
  const cached = GLOB_REGEX_CACHE.get(glob);
  if (cached) {
    return cached;
  }

  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += escapeRegExpLiteral(c);
    }
  }

  const compiled = new RegExp(`^${re}$`);
  GLOB_REGEX_CACHE.set(glob, compiled);
  return compiled;
}

function normalizeReviewPath(p: string): string {
  return p.trim().replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * Concatenate the checklists of every rule whose glob matches at least one of the
 * changed files. De-duplicated by rule id and stable in rule order. Returns an
 * empty string when nothing matches (so the prompt is unchanged from today).
 */
function selectRulesForChangedFiles(changedFiles: string[]): string {
  if (changedFiles.length === 0) {
    return "";
  }

  const paths = changedFiles
    .map(normalizeReviewPath)
    .filter((p) => p.length > 0);
  if (paths.length === 0) {
    return "";
  }

  const blocks: string[] = [];
  for (const rule of REVIEW_RULES) {
    const matched = rule.globs.some((glob) => {
      const re = globToRegExp(glob);
      return paths.some((p) => re.test(p));
    });
    if (matched) {
      blocks.push(rule.checklist);
    }
  }

  return blocks.join("\n\n");
}

// ---------------------------------------------------------------------------
// WI-3: Bounded diff pre-embedding + shared changed-file resolution (also feeds WI-1)
// ---------------------------------------------------------------------------
type DiffContext = {
  changedFiles: string[];
  // name-status listing plus a shortstat summary. Always set when resolvable.
  manifest?: string;
  // Full unified diff, only when the change is under the embed thresholds.
  diff?: string;
  // Changed line count (insertions + deletions) when known, else 0.
  lineCount: number;
};

function splitGitLines(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Parse `git status --porcelain` output into the set of affected paths, including
 * untracked files and the destination side of renames.
 */
function parsePorcelainPaths(stdout: string): string[] {
  const files: string[] = [];
  for (const rawLine of stdout.split("\n")) {
    if (!rawLine.trim()) {
      continue;
    }
    // Porcelain v1: 2 status chars, a space, then the path (or "old -> new").
    let p = rawLine.slice(3);
    const arrow = p.indexOf(" -> ");
    if (arrow >= 0) {
      p = p.slice(arrow + 4);
    }
    p = p.trim();
    if (p.startsWith('"') && p.endsWith('"')) {
      p = p.slice(1, -1);
    }
    if (p) {
      files.push(p);
    }
  }
  return files;
}

function parseShortstatLineCount(shortstat: string): number {
  const insertions = shortstat.match(/(\d+)\s+insertion/);
  const deletions = shortstat.match(/(\d+)\s+deletion/);
  const ins = insertions ? parseInt(insertions[1], 10) : 0;
  const del = deletions ? parseInt(deletions[1], 10) : 0;
  return (Number.isFinite(ins) ? ins : 0) + (Number.isFinite(del) ? del : 0);
}

async function getChangedFilesForTarget(
  pi: ExtensionAPI,
  target: ReviewTarget,
  mergeBase: string | null,
): Promise<string[]> {
  switch (target.type) {
    case "folder":
      return [...target.paths];
    case "uncommitted": {
      const { stdout, code } = await pi.exec("git", ["status", "--porcelain"]);
      if (code !== 0) return [];
      return parsePorcelainPaths(stdout);
    }
    case "commit": {
      const { stdout, code } = await pi.exec("git", [
        "show",
        "--name-only",
        "--format=",
        target.sha,
      ]);
      if (code !== 0) return [];
      return splitGitLines(stdout);
    }
    case "baseBranch":
    case "pullRequest": {
      if (!mergeBase) return [];
      const { stdout, code } = await pi.exec("git", [
        "diff",
        "--name-only",
        mergeBase,
      ]);
      if (code !== 0) return [];
      return splitGitLines(stdout);
    }
  }
}

/**
 * Resolve the changed-file list and, when the change is small enough, the full
 * diff for the given target. Best-effort: on any git failure (or for folder
 * snapshot reviews) the relevant fields are simply omitted so the review degrades
 * to today's behavior. `mergeBase` is the value already computed by the caller for
 * branch/PR targets, avoiding a duplicate `git merge-base`.
 */
async function collectDiffContext(
  pi: ExtensionAPI,
  target: ReviewTarget,
  mergeBase: string | null,
): Promise<DiffContext> {
  const changedFiles = await getChangedFilesForTarget(pi, target, mergeBase);

  // Folder review is a snapshot, not a diff: no manifest/diff to embed.
  if (target.type === "folder") {
    return { changedFiles, lineCount: 0 };
  }

  let nameStatusArgs: string[];
  let shortstatArgs: string[];
  let diffArgs: string[];

  switch (target.type) {
    case "uncommitted":
      nameStatusArgs = ["diff", "HEAD", "--name-status"];
      shortstatArgs = ["diff", "HEAD", "--shortstat"];
      diffArgs = ["diff", "HEAD"];
      break;
    case "commit":
      nameStatusArgs = ["show", "--name-status", "--format=", target.sha];
      shortstatArgs = ["show", "--shortstat", "--format=", target.sha];
      diffArgs = ["show", "--format=", target.sha];
      break;
    case "baseBranch":
    case "pullRequest":
      if (!mergeBase) {
        return { changedFiles, lineCount: 0 };
      }
      nameStatusArgs = ["diff", "--name-status", mergeBase];
      shortstatArgs = ["diff", "--shortstat", mergeBase];
      diffArgs = ["diff", mergeBase];
      break;
  }

  const [nameStatus, shortstat, untracked] = await Promise.all([
    pi.exec("git", nameStatusArgs),
    pi.exec("git", shortstatArgs),
    target.type === "uncommitted"
      ? pi.exec("git", ["ls-files", "--others", "--exclude-standard"])
      : Promise.resolve(null),
  ]);
  const lineCount =
    shortstat.code === 0 ? parseShortstatLineCount(shortstat.stdout) : 0;

  let nsBody = nameStatus.code === 0 ? nameStatus.stdout.trim() : "";

  // `git diff HEAD` does not cover untracked files, so list them explicitly:
  // otherwise the embedded diff (presented as "the full diff") would steer the
  // model away from ever reading newly added files.
  if (untracked && untracked.code === 0) {
    const untrackedFiles = splitGitLines(untracked.stdout);
    if (untrackedFiles.length > 0) {
      const block =
        "Untracked (new) files — not included in any embedded diff; read them with the file tools:\n" +
        untrackedFiles.map((f) => `A\t${f}`).join("\n");
      nsBody = nsBody ? `${nsBody}\n\n${block}` : block;
    }
  }

  let manifest: string | undefined;
  if (nsBody) {
    const summary = shortstat.code === 0 ? shortstat.stdout.trim() : "";
    manifest = summary ? `${nsBody}\n\n${summary}` : nsBody;
  }

  let diff: string | undefined;
  if (lineCount > 0 && lineCount <= DIFF_EMBED_MAX_LINES) {
    const full = await pi.exec("git", diffArgs);
    if (
      full.code === 0 &&
      full.stdout.trim() &&
      Buffer.byteLength(full.stdout, "utf8") <= DIFF_EMBED_MAX_BYTES
    ) {
      diff = full.stdout;
    }
  }

  return { changedFiles, manifest, diff, lineCount };
}

async function loadProjectReviewGuidelines(
  cwd: string,
): Promise<string | null> {
  let currentDir = path.resolve(cwd);

  while (true) {
    const piDir = path.join(currentDir, ".pi");
    const guidelinesPath = path.join(currentDir, "REVIEW_GUIDELINES.md");

    const piStats = await fs.stat(piDir).catch(() => null);
    if (piStats?.isDirectory()) {
      const guidelineStats = await fs.stat(guidelinesPath).catch(() => null);
      if (guidelineStats?.isFile()) {
        try {
          const content = await fs.readFile(guidelinesPath, "utf8");
          const trimmed = content.trim();
          return trimmed ? trimmed : null;
        } catch {
          return null;
        }
      }
      return null;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

/**
 * Get the merge base between HEAD and a branch
 */
async function getMergeBase(
  pi: ExtensionAPI,
  branch: string,
): Promise<string | null> {
  try {
    // First try to get the upstream tracking branch
    const { stdout: upstream, code: upstreamCode } = await pi.exec("git", [
      "rev-parse",
      "--abbrev-ref",
      `${branch}@{upstream}`,
    ]);

    if (upstreamCode === 0 && upstream.trim()) {
      const { stdout: mergeBase, code } = await pi.exec("git", [
        "merge-base",
        "HEAD",
        upstream.trim(),
      ]);
      if (code === 0 && mergeBase.trim()) {
        return mergeBase.trim();
      }
    }

    // Fall back to using the branch directly
    const { stdout: mergeBase, code } = await pi.exec("git", [
      "merge-base",
      "HEAD",
      branch,
    ]);
    if (code === 0 && mergeBase.trim()) {
      return mergeBase.trim();
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Get list of local branches
 */
async function getLocalBranches(pi: ExtensionAPI): Promise<string[]> {
  const { stdout, code } = await pi.exec("git", [
    "branch",
    "--format=%(refname:short)",
  ]);
  if (code !== 0) return [];
  return stdout
    .trim()
    .split("\n")
    .filter((b) => b.trim());
}

/**
 * Get list of recent commits
 */
async function getRecentCommits(
  pi: ExtensionAPI,
  limit: number = 10,
): Promise<Array<{ sha: string; title: string }>> {
  const { stdout, code } = await pi.exec("git", [
    "log",
    `--oneline`,
    `-n`,
    `${limit}`,
  ]);
  if (code !== 0) return [];

  return stdout
    .trim()
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const [sha, ...rest] = line.trim().split(" ");
      return { sha, title: rest.join(" ") };
    });
}

/**
 * Check if there are uncommitted changes (staged, unstaged, or untracked)
 */
async function hasUncommittedChanges(pi: ExtensionAPI): Promise<boolean> {
  const { stdout, code } = await pi.exec("git", ["status", "--porcelain"]);
  return code === 0 && stdout.trim().length > 0;
}

/**
 * Check if there are changes that would prevent switching branches
 * (staged or unstaged changes to tracked files - untracked files are fine)
 */
async function hasPendingChanges(pi: ExtensionAPI): Promise<boolean> {
  // Check for staged or unstaged changes to tracked files
  const { stdout, code } = await pi.exec("git", ["status", "--porcelain"]);
  if (code !== 0) return false;

  // Filter out untracked files (lines starting with ??)
  const lines = stdout
    .trim()
    .split("\n")
    .filter((line) => line.trim());
  const trackedChanges = lines.filter((line) => !line.startsWith("??"));
  return trackedChanges.length > 0;
}

/**
 * Parse a PR reference (URL or number) and return the PR number
 */
function parsePrReference(ref: string): number | null {
  const trimmed = ref.trim();

  // Try as a number first
  const num = parseInt(trimmed, 10);
  if (!isNaN(num) && num > 0) {
    return num;
  }

  // Try to extract from GitHub URL
  // Formats: https://github.com/owner/repo/pull/123
  //          github.com/owner/repo/pull/123
  const urlMatch = trimmed.match(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
  if (urlMatch) {
    return parseInt(urlMatch[1], 10);
  }

  return null;
}

/**
 * Get PR information from GitHub CLI
 */
async function getPrInfo(
  pi: ExtensionAPI,
  prNumber: number,
): Promise<{ baseBranch: string; title: string; headBranch: string } | null> {
  const { stdout, code } = await pi.exec("gh", [
    "pr",
    "view",
    String(prNumber),
    "--json",
    "baseRefName,title,headRefName",
  ]);

  if (code !== 0) return null;

  try {
    const data = JSON.parse(stdout);
    return {
      baseBranch: data.baseRefName,
      title: data.title,
      headBranch: data.headRefName,
    };
  } catch {
    return null;
  }
}

/**
 * Checkout a PR using GitHub CLI
 */
async function checkoutPr(
  pi: ExtensionAPI,
  prNumber: number,
): Promise<{ success: boolean; error?: string }> {
  const { stdout, stderr, code } = await pi.exec("gh", [
    "pr",
    "checkout",
    String(prNumber),
  ]);

  if (code !== 0) {
    return {
      success: false,
      error: stderr || stdout || "Failed to checkout PR",
    };
  }

  return { success: true };
}

/**
 * Get the current branch name
 */
async function getCurrentBranch(pi: ExtensionAPI): Promise<string | null> {
  const { stdout, code } = await pi.exec("git", ["branch", "--show-current"]);
  if (code === 0 && stdout.trim()) {
    return stdout.trim();
  }
  return null;
}

/**
 * Get the default branch (main or master)
 */
async function getDefaultBranch(pi: ExtensionAPI): Promise<string> {
  // Try to get from remote HEAD
  const { stdout, code } = await pi.exec("git", [
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "--short",
  ]);
  if (code === 0 && stdout.trim()) {
    return stdout.trim().replace("origin/", "");
  }

  // Fall back to checking if main or master exists
  const branches = await getLocalBranches(pi);
  if (branches.includes("main")) return "main";
  if (branches.includes("master")) return "master";

  return "main"; // Default fallback
}

/**
 * Append the changed-file manifest and (when available) the pre-embedded diff to a
 * base focus prompt (WI-3). When no diff context is available the base prompt is
 * returned unchanged, matching today's behavior.
 */
function appendDiffContext(base: string, diffContext?: DiffContext): string {
  if (!diffContext) {
    return base;
  }

  let out = base;
  if (diffContext.manifest) {
    out += `\n\nChanged files in scope:\n\n${diffContext.manifest}`;
  }
  if (diffContext.diff) {
    // Diffs can themselves contain fence lines (markdown changes, or template
    // literals with backticks); use a fence longer than any backtick run in the
    // diff so it cannot be closed early.
    const fence = makeFenceFor(diffContext.diff);
    out +=
      "\n\nThe full diff for this review is included below. You may rely on it" +
      " directly instead of re-running git to fetch the diff (still read" +
      ` surrounding code with the file tools as needed):\n\n${fence}diff\n` +
      diffContext.diff +
      `\n${fence}`;
  }
  return out;
}

/**
 * Return a backtick fence at least one longer than the longest backtick run in
 * `content` (minimum the standard three), so the fenced block cannot be closed
 * early by fence-like lines inside the content.
 */
function makeFenceFor(content: string): string {
  let longestRun = 0;
  const runRe = /`+/g;
  let match: RegExpExecArray | null;
  while ((match = runRe.exec(content)) !== null) {
    if (match[0].length > longestRun) {
      longestRun = match[0].length;
    }
  }
  return "`".repeat(Math.max(3, longestRun + 1));
}

/**
 * Build the review prompt based on target.
 *
 * `options.mergeBase` lets the caller pass a merge base it already computed for
 * branch/PR targets (avoiding a duplicate `git merge-base`). When omitted
 * (`undefined`) it is computed here as before; a passed `null` means "computed and
 * none found" and selects the fallback prompt.
 */
async function buildReviewPrompt(
  pi: ExtensionAPI,
  target: ReviewTarget,
  options?: {
    includeLocalChanges?: boolean;
    mergeBase?: string | null;
    diffContext?: DiffContext;
  },
): Promise<string> {
  const includeLocalChanges = options?.includeLocalChanges === true;
  const diffContext = options?.diffContext;

  switch (target.type) {
    case "uncommitted":
      return appendDiffContext(UNCOMMITTED_PROMPT, diffContext);

    case "baseBranch": {
      const mergeBase =
        options?.mergeBase !== undefined
          ? options.mergeBase
          : await getMergeBase(pi, target.branch);
      const basePrompt = mergeBase
        ? BASE_BRANCH_PROMPT_WITH_MERGE_BASE.replace(
            /{baseBranch}/g,
            target.branch,
          ).replace(/{mergeBaseSha}/g, mergeBase)
        : BASE_BRANCH_PROMPT_FALLBACK.replace(/{branch}/g, target.branch);
      const withLocal = includeLocalChanges
        ? `${basePrompt} ${LOCAL_CHANGES_REVIEW_INSTRUCTIONS}`
        : basePrompt;
      return appendDiffContext(withLocal, diffContext);
    }

    case "commit": {
      const basePrompt = target.title
        ? COMMIT_PROMPT_WITH_TITLE.replace("{sha}", target.sha).replace(
            "{title}",
            target.title,
          )
        : COMMIT_PROMPT.replace("{sha}", target.sha);
      return appendDiffContext(basePrompt, diffContext);
    }

    case "pullRequest": {
      const mergeBase =
        options?.mergeBase !== undefined
          ? options.mergeBase
          : await getMergeBase(pi, target.baseBranch);
      const basePrompt = mergeBase
        ? PULL_REQUEST_PROMPT.replace(/{prNumber}/g, String(target.prNumber))
            .replace(/{title}/g, target.title)
            .replace(/{baseBranch}/g, target.baseBranch)
            .replace(/{mergeBaseSha}/g, mergeBase)
        : PULL_REQUEST_PROMPT_FALLBACK.replace(
            /{prNumber}/g,
            String(target.prNumber),
          )
            .replace(/{title}/g, target.title)
            .replace(/{baseBranch}/g, target.baseBranch);
      const withLocal = includeLocalChanges
        ? `${basePrompt} ${LOCAL_CHANGES_REVIEW_INSTRUCTIONS}`
        : basePrompt;
      return appendDiffContext(withLocal, diffContext);
    }

    case "folder":
      // Snapshot review: no diff context is gathered for folders.
      return FOLDER_REVIEW_PROMPT.replace("{paths}", target.paths.join(", "));
  }
}

/**
 * Get user-facing hint for the review target
 */
function getUserFacingHint(target: ReviewTarget): string {
  switch (target.type) {
    case "uncommitted":
      return "current changes";
    case "baseBranch":
      return `changes against '${target.branch}'`;
    case "commit": {
      const shortSha = target.sha.slice(0, 7);
      return target.title
        ? `commit ${shortSha}: ${target.title}`
        : `commit ${shortSha}`;
    }

    case "pullRequest": {
      const shortTitle =
        target.title.length > 30
          ? target.title.slice(0, 27) + "..."
          : target.title;
      return `PR #${target.prNumber}: ${shortTitle}`;
    }

    case "folder": {
      const joined = target.paths.join(", ");
      return joined.length > 40
        ? `folders: ${joined.slice(0, 37)}...`
        : `folders: ${joined}`;
    }
  }
}

type AssistantSnapshot = {
  id: string;
  text: string;
  stopReason?: string;
};

function extractAssistantTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const textParts = content
    .filter((part): part is { type: "text"; text: string } =>
      Boolean(
        part &&
        typeof part === "object" &&
        "type" in part &&
        part.type === "text" &&
        "text" in part,
      ),
    )
    .map((part) => part.text);
  return textParts.join("\n").trim();
}

function getLastAssistantSnapshot(
  ctx: ExtensionContext,
): AssistantSnapshot | null {
  const entries = ctx.sessionManager.getBranch();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "message" || entry.message.role !== "assistant") {
      continue;
    }

    const assistantMessage = entry.message as {
      content?: unknown;
      stopReason?: string;
    };
    return {
      id: entry.id,
      text: extractAssistantTextContent(assistantMessage.content),
      stopReason: assistantMessage.stopReason,
    };
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForLoopTurnToStart(
  ctx: ExtensionContext,
  previousAssistantId?: string,
): Promise<boolean> {
  const deadline = Date.now() + REVIEW_LOOP_START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const lastAssistantId = getLastAssistantSnapshot(ctx)?.id;
    if (
      !ctx.isIdle() ||
      ctx.hasPendingMessages() ||
      (lastAssistantId && lastAssistantId !== previousAssistantId)
    ) {
      return true;
    }
    await sleep(REVIEW_LOOP_START_POLL_MS);
  }

  return false;
}

// Review preset options for the selector (keep this order stable)
const REVIEW_PRESETS = [
  {
    value: "uncommitted",
    label: "Review uncommitted changes",
    description: "",
  },
  {
    value: "baseBranch",
    label: "Review against a base branch",
    description: "(local)",
  },
  { value: "commit", label: "Review a commit", description: "" },
  {
    value: "pullRequest",
    label: "Review a pull request",
    description: "(GitHub PR)",
  },
  {
    value: "folder",
    label: "Review a folder (or more)",
    description: "(snapshot, not diff)",
  },
] as const;

const TOGGLE_LOOP_FIXING_VALUE = "toggleLoopFixing" as const;
const TOGGLE_CUSTOM_INSTRUCTIONS_VALUE = "toggleCustomInstructions" as const;
type ReviewPresetValue =
  | (typeof REVIEW_PRESETS)[number]["value"]
  | typeof TOGGLE_LOOP_FIXING_VALUE
  | typeof TOGGLE_CUSTOM_INSTRUCTIONS_VALUE;

export default function reviewExtension(pi: ExtensionAPI) {
  function persistReviewSettings() {
    pi.appendEntry(REVIEW_SETTINGS_TYPE, {
      loopFixingEnabled: reviewLoopFixingEnabled,
      customInstructions: reviewCustomInstructions,
    });
  }

  function setReviewLoopFixingEnabled(enabled: boolean) {
    reviewLoopFixingEnabled = enabled;
    persistReviewSettings();
  }

  function setReviewCustomInstructions(instructions: string | undefined) {
    reviewCustomInstructions = instructions?.trim() || undefined;
    persistReviewSettings();
  }

  function applyAllReviewState(ctx: ExtensionContext) {
    applyReviewSettings(ctx);
    applyReviewState(ctx);
  }

  pi.on("session_start", (_event, ctx) => {
    applyAllReviewState(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    applyAllReviewState(ctx);
  });

  /**
   * Determine the smart default review type based on git state
   */
  async function getSmartDefault(): Promise<
    "uncommitted" | "baseBranch" | "commit"
  > {
    // Priority 1: If there are uncommitted changes, default to reviewing them
    if (await hasUncommittedChanges(pi)) {
      return "uncommitted";
    }

    // Priority 2: If on a feature branch (not the default branch), default to PR-style review
    const currentBranch = await getCurrentBranch(pi);
    const defaultBranch = await getDefaultBranch(pi);
    if (currentBranch && currentBranch !== defaultBranch) {
      return "baseBranch";
    }

    // Priority 3: Default to reviewing a specific commit
    return "commit";
  }

  /**
   * Show the review preset selector
   */
  async function showReviewSelector(
    ctx: ExtensionContext,
  ): Promise<ReviewTarget | null> {
    // Determine smart default (but keep the list order stable)
    const smartDefault = await getSmartDefault();
    const presetItems: SelectItem[] = REVIEW_PRESETS.map((preset) => ({
      value: preset.value,
      label: preset.label,
      description: preset.description,
    }));
    const smartDefaultIndex = presetItems.findIndex(
      (item) => item.value === smartDefault,
    );

    while (true) {
      const customInstructionsLabel = reviewCustomInstructions
        ? "Remove custom review instructions"
        : "Add custom review instructions";
      const customInstructionsDescription = reviewCustomInstructions
        ? "(currently set)"
        : "(applies to all review modes)";
      const loopToggleLabel = reviewLoopFixingEnabled
        ? "Disable Loop Fixing"
        : "Enable Loop Fixing";
      const loopToggleDescription = reviewLoopFixingEnabled
        ? "(currently on)"
        : "(currently off)";
      const items: SelectItem[] = [
        ...presetItems,
        {
          value: TOGGLE_CUSTOM_INSTRUCTIONS_VALUE,
          label: customInstructionsLabel,
          description: customInstructionsDescription,
        },
        {
          value: TOGGLE_LOOP_FIXING_VALUE,
          label: loopToggleLabel,
          description: loopToggleDescription,
        },
      ];

      const result = await ctx.ui.custom<ReviewPresetValue | null>(
        (tui, theme, _kb, done) => {
          const container = new Container();
          container.addChild(
            new DynamicBorder((str) => theme.fg("accent", str)),
          );
          container.addChild(
            new Text(theme.fg("accent", theme.bold("Select a review preset"))),
          );

          const selectList = new SelectList(items, Math.min(items.length, 10), {
            selectedPrefix: (text) => theme.fg("accent", text),
            selectedText: (text) => theme.fg("accent", text),
            description: (text) => theme.fg("muted", text),
            scrollInfo: (text) => theme.fg("dim", text),
            noMatch: (text) => theme.fg("warning", text),
          });

          // Preselect the smart default without reordering the list
          if (smartDefaultIndex >= 0) {
            selectList.setSelectedIndex(smartDefaultIndex);
          }

          selectList.onSelect = (item) => done(item.value as ReviewPresetValue);
          selectList.onCancel = () => done(null);

          container.addChild(selectList);
          container.addChild(
            new Text(
              theme.fg("dim", "Press enter to confirm or esc to go back"),
            ),
          );
          container.addChild(
            new DynamicBorder((str) => theme.fg("accent", str)),
          );

          return {
            render(width: number) {
              return container.render(width);
            },
            invalidate() {
              container.invalidate();
            },
            handleInput(data: string) {
              selectList.handleInput(data);
              tui.requestRender();
            },
          };
        },
      );

      if (!result) return null;

      if (result === TOGGLE_LOOP_FIXING_VALUE) {
        const nextEnabled = !reviewLoopFixingEnabled;
        setReviewLoopFixingEnabled(nextEnabled);
        ctx.ui.notify(
          nextEnabled ? "Loop fixing enabled" : "Loop fixing disabled",
          "info",
        );
        continue;
      }

      if (result === TOGGLE_CUSTOM_INSTRUCTIONS_VALUE) {
        if (reviewCustomInstructions) {
          setReviewCustomInstructions(undefined);
          ctx.ui.notify("Custom review instructions removed", "info");
          continue;
        }

        const customInstructions = await ctx.ui.editor(
          "Enter custom review instructions (applies to all review modes):",
          "",
        );

        if (!customInstructions?.trim()) {
          ctx.ui.notify("Custom review instructions not changed", "info");
          continue;
        }

        setReviewCustomInstructions(customInstructions);
        ctx.ui.notify("Custom review instructions saved", "info");
        continue;
      }

      // Handle each preset type
      switch (result) {
        case "uncommitted":
          return { type: "uncommitted" };

        case "baseBranch": {
          const target = await showBranchSelector(ctx);
          if (target) return target;
          break;
        }

        case "commit": {
          if (reviewLoopFixingEnabled) {
            ctx.ui.notify(
              "Loop mode does not work with commit review.",
              "error",
            );
            break;
          }
          const target = await showCommitSelector(ctx);
          if (target) return target;
          break;
        }

        case "folder": {
          const target = await showFolderInput(ctx);
          if (target) return target;
          break;
        }

        case "pullRequest": {
          const target = await showPrInput(ctx);
          if (target) return target;
          break;
        }

        default:
          return null;
      }
    }
  }

  /**
   * Show branch selector for base branch review
   */
  async function showBranchSelector(
    ctx: ExtensionContext,
  ): Promise<ReviewTarget | null> {
    const branches = await getLocalBranches(pi);
    const currentBranch = await getCurrentBranch(pi);
    const defaultBranch = await getDefaultBranch(pi);

    // Never offer the current branch as a base branch (reviewing against itself is meaningless).
    const candidateBranches = currentBranch
      ? branches.filter((b) => b !== currentBranch)
      : branches;

    if (candidateBranches.length === 0) {
      ctx.ui.notify(
        currentBranch
          ? `No other branches found (current branch: ${currentBranch})`
          : "No branches found",
        "error",
      );
      return null;
    }

    // Sort branches with default branch first
    const sortedBranches = candidateBranches.sort((a, b) => {
      if (a === defaultBranch) return -1;
      if (b === defaultBranch) return 1;
      return a.localeCompare(b);
    });

    const items: SelectItem[] = sortedBranches.map((branch) => ({
      value: branch,
      label: branch,
      description: branch === defaultBranch ? "(default)" : "",
    }));

    const result = await ctx.ui.custom<string | null>(
      (tui, theme, keybindings, done) => {
        const container = new Container();
        container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
        container.addChild(
          new Text(theme.fg("accent", theme.bold("Select base branch"))),
        );

        const searchInput = new Input();
        container.addChild(searchInput);
        container.addChild(new Spacer(1));

        const listContainer = new Container();
        container.addChild(listContainer);
        container.addChild(
          new Text(
            theme.fg("dim", "Type to filter • enter to select • esc to cancel"),
          ),
        );
        container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

        let filteredItems = items;
        let selectList: SelectList | null = null;

        const updateList = () => {
          listContainer.clear();
          if (filteredItems.length === 0) {
            listContainer.addChild(
              new Text(theme.fg("warning", "  No matching branches")),
            );
            selectList = null;
            return;
          }

          selectList = new SelectList(
            filteredItems,
            Math.min(filteredItems.length, 10),
            {
              selectedPrefix: (text) => theme.fg("accent", text),
              selectedText: (text) => theme.fg("accent", text),
              description: (text) => theme.fg("muted", text),
              scrollInfo: (text) => theme.fg("dim", text),
              noMatch: (text) => theme.fg("warning", text),
            },
          );

          selectList.onSelect = (item) => done(item.value);
          selectList.onCancel = () => done(null);
          listContainer.addChild(selectList);
        };

        const applyFilter = () => {
          const query = searchInput.getValue();
          filteredItems = query
            ? fuzzyFilter(
                items,
                query,
                (item) =>
                  `${item.label} ${item.value} ${item.description ?? ""}`,
              )
            : items;
          updateList();
        };

        applyFilter();

        return {
          render(width: number) {
            return container.render(width);
          },
          invalidate() {
            container.invalidate();
          },
          handleInput(data: string) {
            if (
              keybindings.matches(data, "tui.select.up") ||
              keybindings.matches(data, "tui.select.down") ||
              keybindings.matches(data, "tui.select.confirm") ||
              keybindings.matches(data, "tui.select.cancel")
            ) {
              if (selectList) {
                selectList.handleInput(data);
              } else if (keybindings.matches(data, "tui.select.cancel")) {
                done(null);
              }
              tui.requestRender();
              return;
            }

            searchInput.handleInput(data);
            applyFilter();
            tui.requestRender();
          },
        };
      },
    );

    if (!result) return null;
    return { type: "baseBranch", branch: result };
  }

  /**
   * Show commit selector
   */
  async function showCommitSelector(
    ctx: ExtensionContext,
  ): Promise<ReviewTarget | null> {
    const commits = await getRecentCommits(pi, 20);

    if (commits.length === 0) {
      ctx.ui.notify("No commits found", "error");
      return null;
    }

    const items: SelectItem[] = commits.map((commit) => ({
      value: commit.sha,
      label: `${commit.sha.slice(0, 7)} ${commit.title}`,
      description: "",
    }));

    const result = await ctx.ui.custom<{ sha: string; title: string } | null>(
      (tui, theme, keybindings, done) => {
        const container = new Container();
        container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
        container.addChild(
          new Text(theme.fg("accent", theme.bold("Select commit to review"))),
        );

        const searchInput = new Input();
        container.addChild(searchInput);
        container.addChild(new Spacer(1));

        const listContainer = new Container();
        container.addChild(listContainer);
        container.addChild(
          new Text(
            theme.fg("dim", "Type to filter • enter to select • esc to cancel"),
          ),
        );
        container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

        let filteredItems = items;
        let selectList: SelectList | null = null;

        const updateList = () => {
          listContainer.clear();
          if (filteredItems.length === 0) {
            listContainer.addChild(
              new Text(theme.fg("warning", "  No matching commits")),
            );
            selectList = null;
            return;
          }

          selectList = new SelectList(
            filteredItems,
            Math.min(filteredItems.length, 10),
            {
              selectedPrefix: (text) => theme.fg("accent", text),
              selectedText: (text) => theme.fg("accent", text),
              description: (text) => theme.fg("muted", text),
              scrollInfo: (text) => theme.fg("dim", text),
              noMatch: (text) => theme.fg("warning", text),
            },
          );

          selectList.onSelect = (item) => {
            const commit = commits.find((c) => c.sha === item.value);
            if (commit) {
              done(commit);
            } else {
              done(null);
            }
          };
          selectList.onCancel = () => done(null);
          listContainer.addChild(selectList);
        };

        const applyFilter = () => {
          const query = searchInput.getValue();
          filteredItems = query
            ? fuzzyFilter(
                items,
                query,
                (item) =>
                  `${item.label} ${item.value} ${item.description ?? ""}`,
              )
            : items;
          updateList();
        };

        applyFilter();

        return {
          render(width: number) {
            return container.render(width);
          },
          invalidate() {
            container.invalidate();
          },
          handleInput(data: string) {
            if (
              keybindings.matches(data, "tui.select.up") ||
              keybindings.matches(data, "tui.select.down") ||
              keybindings.matches(data, "tui.select.confirm") ||
              keybindings.matches(data, "tui.select.cancel")
            ) {
              if (selectList) {
                selectList.handleInput(data);
              } else if (keybindings.matches(data, "tui.select.cancel")) {
                done(null);
              }
              tui.requestRender();
              return;
            }

            searchInput.handleInput(data);
            applyFilter();
            tui.requestRender();
          },
        };
      },
    );

    if (!result) return null;
    return { type: "commit", sha: result.sha, title: result.title };
  }

  function parseReviewPaths(value: string): string[] {
    return value
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  /**
   * Show folder input
   */
  async function showFolderInput(
    ctx: ExtensionContext,
  ): Promise<ReviewTarget | null> {
    const result = await ctx.ui.editor(
      "Enter folders/files to review (space-separated or one per line):",
      ".",
    );

    if (!result?.trim()) return null;
    const paths = parseReviewPaths(result);
    if (paths.length === 0) return null;

    return { type: "folder", paths };
  }

  /**
   * Show PR input and handle checkout
   */
  async function showPrInput(
    ctx: ExtensionContext,
  ): Promise<ReviewTarget | null> {
    // First check for pending changes that would prevent branch switching
    if (await hasPendingChanges(pi)) {
      ctx.ui.notify(
        "Cannot checkout PR: you have uncommitted changes. Please commit or stash them first.",
        "error",
      );
      return null;
    }

    // Get PR reference from user
    const prRef = await ctx.ui.editor(
      "Enter PR number or URL (e.g. 123 or https://github.com/owner/repo/pull/123):",
      "",
    );

    if (!prRef?.trim()) return null;

    const prNumber = parsePrReference(prRef);
    if (!prNumber) {
      ctx.ui.notify(
        "Invalid PR reference. Enter a number or GitHub PR URL.",
        "error",
      );
      return null;
    }

    // Get PR info from GitHub
    ctx.ui.notify(`Fetching PR #${prNumber} info...`, "info");
    const prInfo = await getPrInfo(pi, prNumber);

    if (!prInfo) {
      ctx.ui.notify(
        `Could not find PR #${prNumber}. Make sure gh is authenticated and the PR exists.`,
        "error",
      );
      return null;
    }

    // Check again for pending changes (in case something changed)
    if (await hasPendingChanges(pi)) {
      ctx.ui.notify(
        "Cannot checkout PR: you have uncommitted changes. Please commit or stash them first.",
        "error",
      );
      return null;
    }

    // Checkout the PR
    ctx.ui.notify(`Checking out PR #${prNumber}...`, "info");
    const checkoutResult = await checkoutPr(pi, prNumber);

    if (!checkoutResult.success) {
      ctx.ui.notify(`Failed to checkout PR: ${checkoutResult.error}`, "error");
      return null;
    }

    ctx.ui.notify(`Checked out PR #${prNumber} (${prInfo.headBranch})`, "info");

    return {
      type: "pullRequest",
      prNumber,
      baseBranch: prInfo.baseBranch,
      title: prInfo.title,
    };
  }

  /**
   * Execute the review
   */
  async function executeReview(
    ctx: ExtensionCommandContext,
    target: ReviewTarget,
    useFreshSession: boolean,
    options?: { includeLocalChanges?: boolean; extraInstruction?: string },
  ): Promise<boolean> {
    // Check if we're already in a review
    if (reviewOriginId) {
      ctx.ui.notify(
        "Already in a review. Use /end-review to finish first.",
        "warning",
      );
      return false;
    }

    // Handle fresh session mode
    if (useFreshSession) {
      // Store current position (where we'll return to).
      // In an empty session there is no leaf yet, so create a lightweight anchor first.
      let originId = ctx.sessionManager.getLeafId() ?? undefined;
      if (!originId) {
        pi.appendEntry(REVIEW_ANCHOR_TYPE, {
          createdAt: new Date().toISOString(),
        });
        originId = ctx.sessionManager.getLeafId() ?? undefined;
      }
      if (!originId) {
        ctx.ui.notify("Failed to determine review origin.", "error");
        return false;
      }
      reviewOriginId = originId;

      // Keep a local copy so session_tree events during navigation don't wipe it
      const lockedOriginId = originId;

      // Find the first user message in the session.
      // If none exists (e.g. brand-new session), we'll stay on the current leaf.
      const entries = ctx.sessionManager.getEntries();
      const firstUserMessage = entries.find(
        (e) => e.type === "message" && e.message.role === "user",
      );

      if (firstUserMessage) {
        // Navigate to first user message to create a new branch from that point
        // Label it as "code-review" so it's visible in the tree
        try {
          const result = await ctx.navigateTree(firstUserMessage.id, {
            summarize: false,
            label: "code-review",
          });
          if (result.cancelled) {
            reviewOriginId = undefined;
            return false;
          }
        } catch (error) {
          // Clean up state if navigation fails
          reviewOriginId = undefined;
          ctx.ui.notify(
            `Failed to start review: ${error instanceof Error ? error.message : String(error)}`,
            "error",
          );
          return false;
        }

        // Clear the editor (navigating to user message fills it with the message text)
        ctx.ui.setEditorText("");
      }

      // Restore origin after navigation events (session_tree can reset it)
      reviewOriginId = lockedOriginId;

      // Show widget indicating review is active
      setReviewWidget(ctx, true);

      // Persist review state so tree navigation can restore/reset it
      pi.appendEntry(REVIEW_STATE_TYPE, {
        active: true,
        originId: lockedOriginId,
      });
    }

    // Gather diff/rule context once (best-effort; degrades to prior behavior on
    // any git failure). The merge base is computed here for branch/PR targets and
    // reused by both the diff context and the prompt builder (no duplicate work).
    let mergeBase: string | null | undefined;
    if (target.type === "baseBranch") {
      mergeBase = await getMergeBase(pi, target.branch);
    } else if (target.type === "pullRequest") {
      mergeBase = await getMergeBase(pi, target.baseBranch);
    }

    const diffContext = await collectDiffContext(pi, target, mergeBase ?? null);
    const rulesBlock = selectRulesForChangedFiles(diffContext.changedFiles);

    const prompt = await buildReviewPrompt(pi, target, {
      includeLocalChanges: options?.includeLocalChanges === true,
      mergeBase,
      diffContext,
    });
    const hint = getUserFacingHint(target);
    const projectGuidelines = await loadProjectReviewGuidelines(ctx.cwd);

    // Combine the review rubric with the specific prompt.
    let fullPrompt = REVIEW_RUBRIC;

    // WI-1: targeted checklists for the changed file types, after the rubric and
    // before the focus/guidelines. Inserted only when something matched.
    if (rulesBlock) {
      fullPrompt += `\n\n---\n\nThe changed files match these targeted checklists. Apply them in addition to the general guidelines above:\n\n${rulesBlock}`;
    }

    fullPrompt += `\n\n---\n\nPlease perform a code review with the following focus:\n\n${prompt}`;

    // WI-4: plan gate for large changes. A short planning nudge, still within the
    // single Pi turn. Small diffs (and reviews where the line count is unknown)
    // are unaffected.
    if (diffContext.lineCount > REVIEW_PLAN_GATE_LINE_THRESHOLD) {
      fullPrompt += `\n\nThis is a large change (~${diffContext.lineCount} changed lines). Before listing findings, briefly enumerate the changed files and rank them by risk (highest first), then review them in that order. Keep this plan to a few lines.`;
    }

    if (reviewCustomInstructions) {
      fullPrompt += `\n\nShared custom review instructions (applies to all reviews):\n\n${reviewCustomInstructions}`;
    }

    if (options?.extraInstruction?.trim()) {
      fullPrompt += `\n\nAdditional user-provided review instruction:\n\n${options.extraInstruction.trim()}`;
    }

    if (projectGuidelines) {
      fullPrompt += `\n\nThis project has additional instructions for code reviews:\n\n${projectGuidelines}`;
    }

    const modeHint = useFreshSession ? " (fresh session)" : "";
    ctx.ui.notify(`Starting review: ${hint}${modeHint}`, "info");

    // Send as a user message that triggers a turn
    pi.sendUserMessage(fullPrompt);
    return true;
  }

  /**
   * Parse command arguments for direct invocation
   * Returns the target or a special marker for PR that needs async handling
   */
  type ParsedReviewArgs = {
    target: ReviewTarget | { type: "pr"; ref: string } | null;
    extraInstruction?: string;
    error?: string;
  };

  function tokenizeArgs(value: string): string[] {
    const tokens: string[] = [];
    let current = "";
    let quote: '"' | "'" | null = null;

    for (let i = 0; i < value.length; i++) {
      const char = value[i];

      if (quote) {
        if (char === "\\" && i + 1 < value.length) {
          current += value[i + 1];
          i += 1;
          continue;
        }
        if (char === quote) {
          quote = null;
          continue;
        }
        current += char;
        continue;
      }

      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }

      if (/\s/.test(char)) {
        if (current.length > 0) {
          tokens.push(current);
          current = "";
        }
        continue;
      }

      current += char;
    }

    if (current.length > 0) {
      tokens.push(current);
    }

    return tokens;
  }

  function parseArgs(args: string | undefined): ParsedReviewArgs {
    if (!args?.trim()) return { target: null };

    const rawParts = tokenizeArgs(args.trim());
    const parts: string[] = [];
    let extraInstruction: string | undefined;

    for (let i = 0; i < rawParts.length; i++) {
      const part = rawParts[i];
      if (part === "--extra") {
        const next = rawParts[i + 1];
        if (!next) {
          return { target: null, error: "Missing value for --extra" };
        }
        extraInstruction = next;
        i += 1;
        continue;
      }

      if (part.startsWith("--extra=")) {
        extraInstruction = part.slice("--extra=".length);
        continue;
      }

      parts.push(part);
    }

    if (parts.length === 0) {
      return { target: null, extraInstruction };
    }

    const subcommand = parts[0]?.toLowerCase();

    switch (subcommand) {
      case "uncommitted":
        return { target: { type: "uncommitted" }, extraInstruction };

      case "branch": {
        const branch = parts[1];
        if (!branch) return { target: null, extraInstruction };
        return { target: { type: "baseBranch", branch }, extraInstruction };
      }

      case "commit": {
        const sha = parts[1];
        if (!sha) return { target: null, extraInstruction };
        const title = parts.slice(2).join(" ") || undefined;
        return { target: { type: "commit", sha, title }, extraInstruction };
      }

      case "folder": {
        const paths = parseReviewPaths(parts.slice(1).join(" "));
        if (paths.length === 0) return { target: null, extraInstruction };
        return { target: { type: "folder", paths }, extraInstruction };
      }

      case "pr": {
        const ref = parts[1];
        if (!ref) return { target: null, extraInstruction };
        return { target: { type: "pr", ref }, extraInstruction };
      }

      default:
        return { target: null, extraInstruction };
    }
  }

  /**
   * Handle PR checkout and return a ReviewTarget (or null on failure)
   */
  async function handlePrCheckout(
    ctx: ExtensionContext,
    ref: string,
  ): Promise<ReviewTarget | null> {
    // First check for pending changes
    if (await hasPendingChanges(pi)) {
      ctx.ui.notify(
        "Cannot checkout PR: you have uncommitted changes. Please commit or stash them first.",
        "error",
      );
      return null;
    }

    const prNumber = parsePrReference(ref);
    if (!prNumber) {
      ctx.ui.notify(
        "Invalid PR reference. Enter a number or GitHub PR URL.",
        "error",
      );
      return null;
    }

    // Get PR info
    ctx.ui.notify(`Fetching PR #${prNumber} info...`, "info");
    const prInfo = await getPrInfo(pi, prNumber);

    if (!prInfo) {
      ctx.ui.notify(
        `Could not find PR #${prNumber}. Make sure gh is authenticated and the PR exists.`,
        "error",
      );
      return null;
    }

    // Checkout the PR
    ctx.ui.notify(`Checking out PR #${prNumber}...`, "info");
    const checkoutResult = await checkoutPr(pi, prNumber);

    if (!checkoutResult.success) {
      ctx.ui.notify(`Failed to checkout PR: ${checkoutResult.error}`, "error");
      return null;
    }

    ctx.ui.notify(`Checked out PR #${prNumber} (${prInfo.headBranch})`, "info");

    return {
      type: "pullRequest",
      prNumber,
      baseBranch: prInfo.baseBranch,
      title: prInfo.title,
    };
  }

  function isLoopCompatibleTarget(target: ReviewTarget): boolean {
    if (target.type !== "commit") {
      return true;
    }

    return false;
  }

  async function runLoopFixingReview(
    ctx: ExtensionCommandContext,
    target: ReviewTarget,
    extraInstruction?: string,
  ): Promise<void> {
    if (reviewLoopInProgress) {
      ctx.ui.notify("Loop fixing review is already running.", "warning");
      return;
    }

    reviewLoopInProgress = true;
    setReviewWidget(ctx, Boolean(reviewOriginId));
    try {
      ctx.ui.notify(
        "Loop fixing enabled: using Empty branch mode and cycling until no blocking findings remain.",
        "info",
      );

      for (let pass = 1; pass <= REVIEW_LOOP_MAX_ITERATIONS; pass++) {
        const reviewBaselineAssistantId = getLastAssistantSnapshot(ctx)?.id;
        const started = await executeReview(ctx, target, true, {
          includeLocalChanges: true,
          extraInstruction,
        });
        if (!started) {
          ctx.ui.notify(
            "Loop fixing stopped before starting the review pass.",
            "warning",
          );
          return;
        }

        const reviewTurnStarted = await waitForLoopTurnToStart(
          ctx,
          reviewBaselineAssistantId,
        );
        if (!reviewTurnStarted) {
          ctx.ui.notify(
            "Loop fixing stopped: review pass did not start in time.",
            "error",
          );
          return;
        }

        await ctx.waitForIdle();

        const reviewSnapshot = getLastAssistantSnapshot(ctx);
        if (
          !reviewSnapshot ||
          reviewSnapshot.id === reviewBaselineAssistantId
        ) {
          ctx.ui.notify(
            "Loop fixing stopped: could not read the review result.",
            "warning",
          );
          return;
        }

        if (reviewSnapshot.stopReason === "aborted") {
          ctx.ui.notify("Loop fixing stopped: review was aborted.", "warning");
          return;
        }

        if (reviewSnapshot.stopReason === "error") {
          ctx.ui.notify(
            "Loop fixing stopped: review failed with an error.",
            "error",
          );
          return;
        }

        if (reviewSnapshot.stopReason === "length") {
          ctx.ui.notify(
            "Loop fixing stopped: review output was truncated (stopReason=length).",
            "warning",
          );
          return;
        }

        if (!hasBlockingReviewFindings(reviewSnapshot.text)) {
          const finalized = await executeEndReviewAction(
            ctx,
            "returnAndSummarize",
            {
              showSummaryLoader: true,
              notifySuccess: false,
            },
          );
          if (finalized !== "ok") {
            return;
          }

          ctx.ui.notify(
            "Loop fixing complete: no blocking findings remain.",
            "info",
          );
          return;
        }

        ctx.ui.notify(
          `Loop fixing pass ${pass}: found blocking findings, returning to fix them...`,
          "info",
        );

        const fixBaselineAssistantId = getLastAssistantSnapshot(ctx)?.id;
        const sentFixPrompt = await executeEndReviewAction(
          ctx,
          "returnAndFix",
          {
            showSummaryLoader: true,
            notifySuccess: false,
          },
        );
        if (sentFixPrompt !== "ok") {
          return;
        }

        const fixTurnStarted = await waitForLoopTurnToStart(
          ctx,
          fixBaselineAssistantId,
        );
        if (!fixTurnStarted) {
          ctx.ui.notify(
            "Loop fixing stopped: fix pass did not start in time.",
            "error",
          );
          return;
        }

        await ctx.waitForIdle();

        const fixSnapshot = getLastAssistantSnapshot(ctx);
        if (!fixSnapshot || fixSnapshot.id === fixBaselineAssistantId) {
          ctx.ui.notify(
            "Loop fixing stopped: could not read the fix pass result.",
            "warning",
          );
          return;
        }
        if (fixSnapshot.stopReason === "aborted") {
          ctx.ui.notify(
            "Loop fixing stopped: fix pass was aborted.",
            "warning",
          );
          return;
        }
        if (fixSnapshot.stopReason === "error") {
          ctx.ui.notify(
            "Loop fixing stopped: fix pass failed with an error.",
            "error",
          );
          return;
        }
        if (fixSnapshot.stopReason === "length") {
          ctx.ui.notify(
            "Loop fixing stopped: fix pass output was truncated (stopReason=length).",
            "warning",
          );
          return;
        }
      }

      ctx.ui.notify(
        `Loop fixing stopped after ${REVIEW_LOOP_MAX_ITERATIONS} passes (safety limit reached).`,
        "warning",
      );
    } finally {
      reviewLoopInProgress = false;
      setReviewWidget(ctx, Boolean(reviewOriginId));
    }
  }

  // Register the /review command
  pi.registerCommand("review", {
    description:
      "Review code changes (PR, uncommitted, branch, commit, or folder)",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("Review requires interactive mode", "error");
        return;
      }

      if (reviewLoopInProgress) {
        ctx.ui.notify("Loop fixing review is already running.", "warning");
        return;
      }

      // Check if we're already in a review
      if (reviewOriginId) {
        ctx.ui.notify(
          "Already in a review. Use /end-review to finish first.",
          "warning",
        );
        return;
      }

      // Check if we're in a git repository
      const { code } = await pi.exec("git", ["rev-parse", "--git-dir"]);
      if (code !== 0) {
        ctx.ui.notify("Not a git repository", "error");
        return;
      }

      // Try to parse direct arguments
      let target: ReviewTarget | null = null;
      let fromSelector = false;
      let extraInstruction: string | undefined;
      const parsed = parseArgs(args);
      if (parsed.error) {
        ctx.ui.notify(parsed.error, "error");
        return;
      }
      extraInstruction = parsed.extraInstruction?.trim() || undefined;

      if (parsed.target) {
        if (parsed.target.type === "pr") {
          // Handle PR checkout (async operation)
          target = await handlePrCheckout(ctx, parsed.target.ref);
          if (!target) {
            ctx.ui.notify(
              "PR review failed. Returning to review menu.",
              "warning",
            );
          }
        } else {
          target = parsed.target;
        }
      }

      // If no args or invalid args, show selector
      if (!target) {
        fromSelector = true;
      }

      while (true) {
        if (!target && fromSelector) {
          target = await showReviewSelector(ctx);
        }

        if (!target) {
          ctx.ui.notify("Review cancelled", "info");
          return;
        }

        if (reviewLoopFixingEnabled && !isLoopCompatibleTarget(target)) {
          ctx.ui.notify("Loop mode does not work with commit review.", "error");
          if (fromSelector) {
            target = null;
            continue;
          }
          return;
        }

        if (reviewLoopFixingEnabled) {
          await runLoopFixingReview(ctx, target, extraInstruction);
          return;
        }

        // Determine if we should use fresh session mode
        // Check if this is a new session (no messages yet)
        const entries = ctx.sessionManager.getEntries();
        const messageCount = entries.filter((e) => e.type === "message").length;

        // In an empty session, default to fresh review mode so /end-review works consistently.
        let useFreshSession = messageCount === 0;

        if (messageCount > 0) {
          // Existing session - ask user which mode they want
          const choice = await ctx.ui.select("Start review in:", [
            "Empty branch",
            "Current session",
          ]);

          if (choice === undefined) {
            if (fromSelector) {
              target = null;
              continue;
            }
            ctx.ui.notify("Review cancelled", "info");
            return;
          }

          useFreshSession = choice === "Empty branch";
        }

        await executeReview(ctx, target, useFreshSession, { extraInstruction });
        return;
      }
    },
  });

  // Custom prompt for review summaries - focuses on preserving actionable findings
  const REVIEW_SUMMARY_PROMPT = `We are leaving a code-review branch and returning to the main coding branch.
Create a structured handoff that can be used immediately to implement fixes.

You MUST summarize the review that happened in this branch so findings can be acted on.
Do not omit findings: include every actionable issue that was identified.

Required sections (in order):

## Review Scope
- What was reviewed (files/paths, changes, and scope)

## Verdict
- "correct" or "needs attention"

## Findings
For EACH finding, include:
- Priority tag ([P0]..[P3]) and short title
- File location (\`path/to/file.ext:line\`)
- Why it matters (brief)
- What should change (brief, actionable)

## Fix Queue
1. Ordered implementation checklist (highest priority first)

## Constraints & Preferences
- Any constraints or preferences mentioned during review
- Or "(none)"

## Human Reviewer Callouts (Non-Blocking)
Include only applicable callouts (no yes/no lines):
- **This change adds a database migration:** <files/details>
- **This change introduces a new dependency:** <package(s)/details>
- **This change changes a dependency (or the lockfile):** <files/package(s)/details>
- **This change modifies auth/permission behavior:** <what changed and where>
- **This change introduces backwards-incompatible public schema/API/contract changes:** <what changed and where>
- **This change includes irreversible or destructive operations:** <operation and scope>

If none apply, write "- (none)".

These are informational callouts for humans and are not fix items by themselves.

Preserve exact file paths, function names, and error messages where available.`;

  const REVIEW_FIX_FINDINGS_PROMPT = `Use the latest review summary in this session and implement the review findings now.

Instructions:
1. Treat the summary's Findings/Fix Queue as a checklist.
2. Fix in priority order: P0, P1, then P2 (include P3 if quick and safe).
3. If a finding is invalid/already fixed/not possible right now, briefly explain why and continue.
4. Treat "Human Reviewer Callouts (Non-Blocking)" as informational only; do not convert them into fix tasks unless there is a separate explicit finding.
5. Follow fail-fast error handling: do not add local catch/fallback recovery unless this scope is an explicit boundary that can safely translate the failure.
6. If you add or keep a \`try/catch\`, explain the expected failure mode and either rethrow with context or return a boundary-safe error response.
7. JSON parsing/decoding should fail loudly by default; avoid silent fallback parsing.
8. Run relevant tests/checks for touched code where practical.
9. End with: fixed items, deferred/skipped items (with reasons), and verification results.`;

  type EndReviewAction = "returnOnly" | "returnAndFix" | "returnAndSummarize";
  type EndReviewActionResult = "ok" | "cancelled" | "error";
  type EndReviewActionOptions = {
    showSummaryLoader?: boolean;
    notifySuccess?: boolean;
  };

  function getActiveReviewOrigin(ctx: ExtensionContext): string | undefined {
    if (reviewOriginId) {
      return reviewOriginId;
    }

    const state = getReviewState(ctx);
    if (state?.active && state.originId) {
      reviewOriginId = state.originId;
      return reviewOriginId;
    }

    if (state?.active) {
      setReviewWidget(ctx, false);
      pi.appendEntry(REVIEW_STATE_TYPE, { active: false });
      ctx.ui.notify(
        "Review state was missing origin info; cleared review status.",
        "warning",
      );
    }

    return undefined;
  }

  function clearReviewState(ctx: ExtensionContext) {
    setReviewWidget(ctx, false);
    reviewOriginId = undefined;
    pi.appendEntry(REVIEW_STATE_TYPE, { active: false });
  }

  async function navigateWithSummary(
    ctx: ExtensionCommandContext,
    originId: string,
    showLoader: boolean,
  ): Promise<{ cancelled: boolean; error?: string } | null> {
    if (showLoader && ctx.hasUI) {
      return ctx.ui.custom<{ cancelled: boolean; error?: string } | null>(
        (tui, theme, _kb, done) => {
          const loader = new BorderedLoader(
            tui,
            theme,
            "Returning and summarizing review branch...",
          );
          loader.onAbort = () => done(null);

          ctx
            .navigateTree(originId, {
              summarize: true,
              customInstructions: REVIEW_SUMMARY_PROMPT,
              replaceInstructions: true,
            })
            .then(done)
            .catch((err) =>
              done({
                cancelled: false,
                error: err instanceof Error ? err.message : String(err),
              }),
            );

          return loader;
        },
      );
    }

    try {
      return await ctx.navigateTree(originId, {
        summarize: true,
        customInstructions: REVIEW_SUMMARY_PROMPT,
        replaceInstructions: true,
      });
    } catch (error) {
      return {
        cancelled: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function executeEndReviewAction(
    ctx: ExtensionCommandContext,
    action: EndReviewAction,
    options: EndReviewActionOptions = {},
  ): Promise<EndReviewActionResult> {
    const originId = getActiveReviewOrigin(ctx);
    if (!originId) {
      if (!getReviewState(ctx)?.active) {
        ctx.ui.notify(
          "Not in a review branch (use /review first, or review was started in current session mode)",
          "info",
        );
      }
      return "error";
    }

    const notifySuccess = options.notifySuccess ?? true;

    if (action === "returnOnly") {
      try {
        const result = await ctx.navigateTree(originId, { summarize: false });
        if (result.cancelled) {
          ctx.ui.notify(
            "Navigation cancelled. Use /end-review to try again.",
            "info",
          );
          return "cancelled";
        }
      } catch (error) {
        ctx.ui.notify(
          `Failed to return: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
        return "error";
      }

      clearReviewState(ctx);
      if (notifySuccess) {
        ctx.ui.notify(
          "Review complete! Returned to original position.",
          "info",
        );
      }
      return "ok";
    }

    const summaryResult = await navigateWithSummary(
      ctx,
      originId,
      options.showSummaryLoader ?? false,
    );
    if (summaryResult === null) {
      ctx.ui.notify(
        "Summarization cancelled. Use /end-review to try again.",
        "info",
      );
      return "cancelled";
    }

    if (summaryResult.error) {
      ctx.ui.notify(`Summarization failed: ${summaryResult.error}`, "error");
      return "error";
    }

    if (summaryResult.cancelled) {
      ctx.ui.notify(
        "Navigation cancelled. Use /end-review to try again.",
        "info",
      );
      return "cancelled";
    }

    clearReviewState(ctx);

    if (action === "returnAndSummarize") {
      if (!ctx.ui.getEditorText().trim()) {
        ctx.ui.setEditorText("Act on the review findings");
      }
      if (notifySuccess) {
        ctx.ui.notify("Review complete! Returned and summarized.", "info");
      }
      return "ok";
    }

    pi.sendUserMessage(REVIEW_FIX_FINDINGS_PROMPT, { deliverAs: "followUp" });
    if (notifySuccess) {
      ctx.ui.notify(
        "Review complete! Returned and queued a follow-up to fix findings.",
        "info",
      );
    }
    return "ok";
  }

  async function runEndReview(ctx: ExtensionCommandContext): Promise<void> {
    if (!ctx.hasUI) {
      ctx.ui.notify("End-review requires interactive mode", "error");
      return;
    }

    if (reviewLoopInProgress) {
      ctx.ui.notify(
        "Loop fixing review is running. Wait for it to finish.",
        "info",
      );
      return;
    }

    if (endReviewInProgress) {
      ctx.ui.notify("/end-review is already running", "info");
      return;
    }

    endReviewInProgress = true;
    try {
      const choice = await ctx.ui.select("Finish review:", [
        "Return only",
        "Return and fix findings",
        "Return and summarize",
      ]);

      if (choice === undefined) {
        ctx.ui.notify("Cancelled. Use /end-review to try again.", "info");
        return;
      }

      const action: EndReviewAction =
        choice === "Return and fix findings"
          ? "returnAndFix"
          : choice === "Return and summarize"
            ? "returnAndSummarize"
            : "returnOnly";

      await executeEndReviewAction(ctx, action, {
        showSummaryLoader: true,
        notifySuccess: true,
      });
    } finally {
      endReviewInProgress = false;
    }
  }

  // Register the /end-review command
  pi.registerCommand("end-review", {
    description: "Complete review and return to original position",
    handler: async (_args, ctx) => {
      await runEndReview(ctx);
    },
  });
}
