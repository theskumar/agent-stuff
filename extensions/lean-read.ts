/**
 * Lean-Read Extension
 *
 * What it is:
 *   Overrides pi's built-in `read` tool so file reads are routed through
 *   `lean-ctx read`, which auto-compresses larger code files:
 *
 *     - Small files and configs → full content
 *     - Medium code files (8KB-96KB) → `map` mode (imports + API signatures)
 *     - Large code files (≥96KB) → `signatures` mode (AST signatures only)
 *     - Explicit `mode` param overrides auto-selection
 *     - `offset`/`limit` are translated to `lines:N-M` mode
 *
 *   Falls back to the built-in read for images, when the binary is missing,
 *   or on exec failure. Callers can always force full content with
 *   `mode: "full"`.
 *
 *   Requires `lean-ctx` (from pi-lean-ctx) to be on PATH.
 *
 * Use cases:
 *   - Letting the agent skim large repos without burning context window on
 *     full file bodies it doesn't need yet.
 *   - Cheaper "look around" reads early in a task, with explicit `mode:full`
 *     reads later when the agent needs to actually edit.
 *   - Working in monorepos / generated code where many files are big enough
 *     that the default full read is wasteful.
 *
 * Common usage patterns:
 *   - Agent calls `read({ path })` → tool returns the most useful
 *     compression for the file size; no caller change needed.
 *   - `read({ path, mode: "full" })` — force full body when editing.
 *   - `read({ path, offset: 100, limit: 40 })` — line range (translated to
 *     `lean-ctx --lines 100-139`).
 *   - `read({ path, mode: "signatures" })` / `mode: "map"` — explicit lean
 *     view of a code file.
 *
 * Design: compose, do not reimplement. createReadToolDefinition handles
 * images, rendering, and the fallback path. We only intercept the text-file
 * case to shell out to `lean-ctx`.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createReadToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, isAbsolute, resolve as resolvePath } from "node:path";

// ---------------------------------------------------------------------------
// Thresholds (mirrors pi-lean-ctx defaults)
// ---------------------------------------------------------------------------

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

const FULL_READ_EXTS = new Set([
  ".md",
  ".txt",
  ".json",
  ".json5",
  ".yaml",
  ".yml",
  ".toml",
  ".env",
  ".ini",
  ".xml",
  ".lock",
]);

const CODE_EXTS = new Set([
  ".rs",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".java",
  ".rb",
  ".c",
  ".cc",
  ".cpp",
  ".cxx",
  ".cs",
  ".kt",
  ".swift",
  ".php",
  ".sh",
  ".bash",
  ".zsh",
  ".lua",
  ".zig",
  ".scala",
  ".dart",
  ".ex",
  ".exs",
]);

const CODE_FULL_MAX = 8 * 1024; // <8KB code → full
const CODE_SIGNATURES_MIN = 96 * 1024; // >=96KB code → signatures
const NON_CODE_MAP_MIN = 48 * 1024; // other text >=48KB → map

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const readSchema = Type.Object({
  path: Type.String({
    description: "Path to the file to read (relative or absolute).",
  }),
  offset: Type.Optional(
    Type.Number({
      description: "Line number to start reading from (1-indexed).",
    }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of lines to read." }),
  ),
  mode: Type.Optional(
    Type.Union(
      [Type.Literal("full"), Type.Literal("map"), Type.Literal("signatures")],
      {
        description:
          "Override auto-select: full (complete content), map (deps + API signatures), signatures (AST only).",
      },
    ),
  ),
});

type Params = {
  path: string;
  offset?: number;
  limit?: number;
  mode?: "full" | "map" | "signatures";
};

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

function resolveBinary(): string | null {
  const envBin = process.env.LEAN_CTX_BIN;
  if (envBin && existsSync(envBin)) return envBin;
  for (const p of [
    "/opt/homebrew/bin/lean-ctx",
    "/usr/local/bin/lean-ctx",
    `${process.env.HOME}/.cargo/bin/lean-ctx`,
    `${process.env.HOME}/.local/bin/lean-ctx`,
  ]) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function chooseMode(
  absPath: string,
): Promise<"full" | "map" | "signatures"> {
  const ext = extname(absPath).toLowerCase();
  if (FULL_READ_EXTS.has(ext)) return "full";
  try {
    const { size } = await stat(absPath);
    if (!CODE_EXTS.has(ext)) return size > NON_CODE_MAP_MIN ? "map" : "full";
    if (size >= CODE_SIGNATURES_MIN) return "signatures";
    if (size >= CODE_FULL_MAX) return "map";
  } catch {
    // stat failed (missing file, perms) — let lean-ctx surface the error
  }
  return "full";
}

function normalizePath(p: string): string {
  return p.startsWith("@") ? p.slice(1) : p;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  const bin = resolveBinary();

  pi.registerTool({
    name: "read",
    label: "read",
    description:
      "Read file contents. Auto-compresses via lean-ctx: small files/configs → full content, medium code (8-96KB) → map (deps + API signatures), large code (>=96KB) → signatures (AST only). Use mode=full to force full content. Supports offset/limit for line ranges. Images fall back to native read.",
    promptSnippet:
      "Read file contents with automatic compression for large code files.",
    promptGuidelines: [
      "Use read for file inspection instead of cat/head/tail via bash.",
      "For large code files, the default `map` or `signatures` mode is usually enough to understand structure. Use mode=full only when you need to edit or inspect details.",
      "To read a specific range, use offset and limit (1-indexed lines).",
    ],
    parameters: readSchema,

    async execute(
      toolCallId,
      params: Params,
      signal,
      onUpdate,
      ctx: ExtensionContext,
    ) {
      const cwd = ctx.cwd;
      const native = createReadToolDefinition(cwd);
      const requested = normalizePath(params.path);
      const abs = isAbsolute(requested)
        ? resolvePath(requested)
        : resolvePath(cwd, requested);
      const ext = extname(abs).toLowerCase();

      // Images and missing binary: native handles it.
      if (IMAGE_EXTS.has(ext) || !bin) {
        return native.execute(
          toolCallId,
          { path: abs, offset: params.offset, limit: params.limit },
          signal,
          onUpdate as any,
          ctx,
        );
      }

      // Build mode string for lean-ctx.
      let mode: string;
      if (params.offset !== undefined || params.limit !== undefined) {
        const start = params.offset ?? 1;
        const end = params.limit ? start + params.limit - 1 : 999999;
        mode = `lines:${start}-${end}`;
      } else {
        mode = params.mode ?? (await chooseMode(abs));
      }

      const args = ["read", abs, "-m", mode];
      if (params.mode === "full") args.push("--fresh");

      const result = await pi.exec(bin, args);

      // On lean-ctx failure, fall back to native rather than erroring out.
      if (result.code !== 0) {
        return native.execute(
          toolCallId,
          { path: abs, offset: params.offset, limit: params.limit },
          signal,
          onUpdate as any,
          ctx,
        );
      }

      return {
        content: [{ type: "text" as const, text: result.stdout.trimEnd() }],
        details: { path: abs, mode, source: "lean-ctx" },
      };
    },

    // Delegate header rendering to native read so the tool call looks
    // identical to a normal read in the TUI.
    renderCall(args, theme, context) {
      const native = createReadToolDefinition(context.cwd);
      return native.renderCall!(args as any, theme, context as any);
    },
  });
}
