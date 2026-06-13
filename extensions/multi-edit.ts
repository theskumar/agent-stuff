/**
 * Multi-Edit Extension
 *
 * What it is:
 *   Overrides pi's built-in `edit` tool so the agent can:
 *     1. Apply edits across multiple files in a single tool call (each
 *        `edits[]` entry may carry its own `path`; top-level `path` is the
 *        default).
 *     2. Apply Codex-style `*** Begin Patch ... *** End Patch` patches with
 *        Add File / Delete File / Update File hunks.
 *     3. Keep working with the original single-file shapes
 *        (`{path, edits[]}` and the legacy `{path, oldText, newText}`),
 *        so existing prompts and skills continue to work unchanged.
 *
 * Use cases:
 *   - Coordinated renames or refactors touching N files in one turn (fewer
 *     tool calls, fewer LLM round-trips).
 *   - Applying a unified Codex-style patch the model already produced, with
 *     proper add/delete file semantics.
 *   - Backwards-compatible drop-in for skills/prompts that assume the
 *     built-in `edit` shape.
 *
 * Common usage patterns:
 *   - Single file (built-in shape):
 *       edit({ path: "src/a.ts", edits: [{ oldText, newText }] })
 *   - Multi-file in one call:
 *       edit({ edits: [
 *         { path: "src/a.ts", oldText, newText },
 *         { path: "src/b.ts", oldText, newText },
 *       ] })
 *   - Codex patch:
 *       edit({ patch: `*** Begin Patch
 *       *** Update File: src/a.ts
 *       @@
 *       -foo
 *       +bar
 *       *** End Patch` })
 *
 * Design: compose, do not reimplement. The single-file code path delegates to the
 * built-in `edit` tool definition (`createEditToolDefinition`) so BOM handling,
 * CRLF/LF preservation, the file mutation queue, fuzzy matching, and the live
 * TUI diff preview all keep working without us copying that logic.
 *
 * Multi-file edits are decomposed into one built-in call per file. Patch updates
 * are converted into per-file `edits[]` arrays (one edit per hunk) and dispatched
 * to the built-in. Patch Add/Delete go through `withFileMutationQueue` directly.
 *
 * Tradeoff: for multi-file or patch shapes, the live preview is not available
 * (built-in's renderer only knows the single-file shape). The header still renders
 * and the post-execution diff is included in the result.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	createEditToolDefinition,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { unlink as fsUnlink, writeFile as fsWriteFile } from "node:fs/promises";
import { isAbsolute, resolve as resolvePath } from "node:path";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const editItemSchema = Type.Object({
	path: Type.Optional(
		Type.String({
			description:
				"Path to the file to edit (relative or absolute). Inherits from the top-level `path` if omitted.",
		}),
	),
	oldText: Type.String({
		description:
			"Exact text for one targeted replacement. Must be unique in the file and must not overlap any other edit's oldText.",
	}),
	newText: Type.String({ description: "Replacement text for this edit." }),
});

const multiEditSchema = Type.Object({
	path: Type.Optional(
		Type.String({
			description:
				"Default path used by edits[] entries that omit their own `path`. Optional when every edits[] entry sets its own path.",
		}),
	),
	edits: Type.Optional(
		Type.Array(editItemSchema, {
			description:
				"One or more targeted replacements. Each `oldText` is matched against the ORIGINAL file content (not against the result of earlier edits). Provide a per-item `path` to edit multiple files in a single call.",
		}),
	),
	patch: Type.Optional(
		Type.String({
			description:
				"Codex-style apply_patch payload (*** Begin Patch ... *** End Patch). Mutually exclusive with path/edits/oldText/newText.",
		}),
	),
	// Legacy single-edit shape, auto-promoted into edits[].
	oldText: Type.Optional(Type.String()),
	newText: Type.Optional(Type.String()),
});

type Params = {
	path?: string;
	edits?: Array<{ path?: string; oldText: string; newText: string }>;
	patch?: string;
	oldText?: string;
	newText?: string;
};

// ---------------------------------------------------------------------------
// prepareArguments: accept JSON-string `edits` from models that misencode arrays.
// ---------------------------------------------------------------------------

function prepareArguments(input: unknown): Params {
	if (!input || typeof input !== "object") return input as Params;
	const args = { ...(input as Record<string, unknown>) } as Record<string, unknown>;
	if (typeof args.edits === "string") {
		try {
			const parsed = JSON.parse(args.edits as string);
			if (Array.isArray(parsed)) args.edits = parsed;
		} catch {
			// leave as-is; schema validation will reject it
		}
	}
	return args as Params;
}

// ---------------------------------------------------------------------------
// Codex patch parser (ported from mitsuhiko/agent-stuff, trimmed).
// ---------------------------------------------------------------------------

interface UpdateChunk {
	oldLines: string[];
	newLines: string[];
}
type PatchOp =
	| { kind: "add"; path: string; contents: string }
	| { kind: "delete"; path: string }
	| { kind: "update"; path: string; chunks: UpdateChunk[] };

function normalizeToLF(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function ensureTrailingNewline(content: string): string {
	return content.endsWith("\n") ? content : `${content}\n`;
}

function parseUpdateChunk(
	lines: string[],
	startIndex: number,
	lastContentLine: number,
	allowMissingContext: boolean,
): { chunk: UpdateChunk; nextIndex: number } {
	let i = startIndex;
	const first = lines[i].trimEnd();

	if (first === "@@" || first.startsWith("@@ ")) {
		// Context marker. We don't use it directly; the hunk body itself must
		// be unique enough for the built-in matcher to locate it.
		i++;
	} else if (!allowMissingContext) {
		throw new Error(
			`Expected update hunk to start with @@ context marker, got: '${lines[i]}'`,
		);
	}

	const oldLines: string[] = [];
	const newLines: string[] = [];
	let parsed = 0;

	while (i <= lastContentLine) {
		const raw = lines[i];
		const trimmed = raw.trimEnd();

		if (trimmed === "*** End of File") {
			if (parsed === 0) throw new Error("Update hunk does not contain any lines");
			i++;
			break;
		}
		if (parsed > 0 && (trimmed.startsWith("@@") || trimmed.startsWith("*** "))) {
			break;
		}
		if (raw.length === 0) {
			oldLines.push("");
			newLines.push("");
			parsed++;
			i++;
			continue;
		}
		const marker = raw[0];
		const body = raw.slice(1);
		if (marker === " ") {
			oldLines.push(body);
			newLines.push(body);
		} else if (marker === "-") {
			oldLines.push(body);
		} else if (marker === "+") {
			newLines.push(body);
		} else if (parsed === 0) {
			throw new Error(
				`Unexpected line in update hunk: '${raw}'. Each line must start with ' ', '+', or '-'.`,
			);
		} else {
			break;
		}
		parsed++;
		i++;
	}

	if (parsed === 0) throw new Error("Update hunk does not contain any lines");
	return { chunk: { oldLines, newLines }, nextIndex: i };
}

function parsePatch(patchText: string): PatchOp[] {
	const lines = normalizeToLF(patchText).trim().split("\n");
	if (lines.length < 2) throw new Error("Patch is empty or invalid");
	if (lines[0].trim() !== "*** Begin Patch")
		throw new Error("The first line of the patch must be '*** Begin Patch'");
	if (lines[lines.length - 1].trim() !== "*** End Patch")
		throw new Error("The last line of the patch must be '*** End Patch'");

	const ops: PatchOp[] = [];
	let i = 1;
	const lastContentLine = lines.length - 2;

	while (i <= lastContentLine) {
		if (lines[i].trim() === "") {
			i++;
			continue;
		}
		const line = lines[i].trim();

		if (line.startsWith("*** Add File: ")) {
			const path = line.slice("*** Add File: ".length);
			i++;
			const contentLines: string[] = [];
			while (i <= lastContentLine) {
				const next = lines[i];
				if (next.trim().startsWith("*** ")) break;
				if (!next.startsWith("+")) {
					throw new Error(
						`Invalid add-file line '${next}'. Add file lines must start with '+'.`,
					);
				}
				contentLines.push(next.slice(1));
				i++;
			}
			ops.push({
				kind: "add",
				path,
				contents: contentLines.length > 0 ? `${contentLines.join("\n")}\n` : "",
			});
			continue;
		}

		if (line.startsWith("*** Delete File: ")) {
			ops.push({ kind: "delete", path: line.slice("*** Delete File: ".length) });
			i++;
			continue;
		}

		if (line.startsWith("*** Update File: ")) {
			const path = line.slice("*** Update File: ".length);
			i++;
			if (i <= lastContentLine && lines[i].trim().startsWith("*** Move to: ")) {
				throw new Error("Patch move operations (*** Move to:) are not supported.");
			}
			const chunks: UpdateChunk[] = [];
			while (i <= lastContentLine) {
				if (lines[i].trim() === "") {
					i++;
					continue;
				}
				if (lines[i].trim().startsWith("*** ")) break;
				const parsed = parseUpdateChunk(lines, i, lastContentLine, chunks.length === 0);
				chunks.push(parsed.chunk);
				i = parsed.nextIndex;
			}
			if (chunks.length === 0) {
				throw new Error(`Update hunk for '${path}' is empty`);
			}
			ops.push({ kind: "update", path, chunks });
			continue;
		}

		throw new Error(
			`'${line}' is not a valid hunk header. Valid headers: '*** Add File:', '*** Delete File:', '*** Update File:'.`,
		);
	}

	return ops;
}

// ---------------------------------------------------------------------------
// Dispatch helpers
// ---------------------------------------------------------------------------

function resolveAbs(cwd: string, p: string): string {
	return isAbsolute(p) ? resolvePath(p) : resolvePath(cwd, p);
}

function extractText(content: Array<{ type: string; text?: string }>): string {
	return content
		.filter((c) => c.type === "text")
		.map((c) => c.text ?? "")
		.join("\n");
}

function isSingleFileShape(params: Params): boolean {
	if (params.patch !== undefined) return false;
	const edits = params.edits ?? [];
	const paths = new Set<string>();
	if (params.path) paths.add(params.path);
	for (const e of edits) if (e.path) paths.add(e.path);
	return paths.size <= 1;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "edit",
		label: "edit",
		description:
			"Edit files using exact text replacement. Each edits[].oldText must match a unique, non-overlapping region of the original file. Supports multiple edits in one call, multi-file edits via per-item path, and Codex-style patches via the `patch` parameter.",
		promptSnippet:
			"Make precise file edits with exact text replacement, including multiple disjoint edits and multi-file edits in one call.",
		promptGuidelines: [
			"Use edit for precise changes (edits[].oldText must match exactly).",
			"When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls.",
			"To edit multiple files in one call, give each edits[] entry its own `path` (the top-level `path` is the default when omitted).",
			"Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.",
			"Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.",
			"Use `patch` (Codex *** Begin Patch ... *** End Patch) when you need to Add, Delete, or apply hunk-based Updates across files in a single call.",
		],
		parameters: multiEditSchema,
		renderShell: "self",
		prepareArguments: prepareArguments as any,

		async execute(toolCallId, params, signal, onUpdate, ctx: ExtensionContext) {
			const cwd = ctx.cwd;
			const builtin = createEditToolDefinition(cwd);

			// --- Patch path -------------------------------------------------
			if (params.patch !== undefined) {
				if (
					params.path !== undefined ||
					params.edits !== undefined ||
					params.oldText !== undefined ||
					params.newText !== undefined
				) {
					throw new Error(
						"`patch` is mutually exclusive with path/edits/oldText/newText.",
					);
				}
				const ops = parsePatch(params.patch);
				const summaries: string[] = [];
				const diffs: string[] = [];
				let firstChangedLine: number | undefined;

				for (const op of ops) {
					if (signal?.aborted) throw new Error("Operation aborted");

					if (op.kind === "add") {
						const abs = resolveAbs(cwd, op.path);
						await withFileMutationQueue(abs, async () => {
							await fsWriteFile(abs, ensureTrailingNewline(op.contents), "utf-8");
						});
						summaries.push(`Added file ${op.path}.`);
						continue;
					}
					if (op.kind === "delete") {
						const abs = resolveAbs(cwd, op.path);
						await withFileMutationQueue(abs, async () => {
							await fsUnlink(abs);
						});
						summaries.push(`Deleted file ${op.path}.`);
						continue;
					}
					// Update: one edit per hunk; builtin handles BOM, line endings, mutation queue.
					const edits = op.chunks.map((c) => ({
						oldText: c.oldLines.join("\n"),
						newText: c.newLines.join("\n"),
					}));
					const result = await builtin.execute(
						toolCallId,
						{ path: op.path, edits },
						signal,
						onUpdate as any,
						ctx,
					);
					summaries.push(extractText(result.content as any));
					const details = result.details as
						| { diff?: string; firstChangedLine?: number }
						| undefined;
					if (details?.diff) diffs.push(`File: ${op.path}\n${details.diff}`);
					if (firstChangedLine === undefined && details?.firstChangedLine !== undefined) {
						firstChangedLine = details.firstChangedLine;
					}
				}

				return {
					content: [
						{
							type: "text" as const,
							text: `Applied patch with ${ops.length} operation(s).\n${summaries.join("\n")}`,
						},
					],
					details: { diff: diffs.join("\n\n"), firstChangedLine },
				};
			}

			// --- edits[] path -----------------------------------------------
			// Promote legacy oldText/newText into edits[].
			let edits = params.edits ? [...params.edits] : [];
			if (params.oldText !== undefined && params.newText !== undefined) {
				edits.unshift({
					path: params.path,
					oldText: params.oldText,
					newText: params.newText,
				});
			} else if (params.oldText !== undefined || params.newText !== undefined) {
				throw new Error("`oldText` and `newText` must be provided together.");
			}
			if (edits.length === 0) {
				throw new Error(
					"No edits provided. Supply edits[], legacy oldText/newText, or patch.",
				);
			}

			// Resolve and validate per-item paths.
			const resolved = edits.map((e, i) => {
				const display = e.path ?? params.path;
				if (!display) {
					throw new Error(
						`Edit ${i + 1} has no path. Set a per-item path or a top-level path.`,
					);
				}
				return {
					absPath: resolveAbs(cwd, display),
					displayPath: display,
					oldText: e.oldText,
					newText: e.newText,
				};
			});

			// Group by absolute path while preserving first-seen display path / order.
			const groups = new Map<
				string,
				{ displayPath: string; items: Array<{ oldText: string; newText: string }> }
			>();
			for (const r of resolved) {
				let g = groups.get(r.absPath);
				if (!g) {
					g = { displayPath: r.displayPath, items: [] };
					groups.set(r.absPath, g);
				}
				g.items.push({ oldText: r.oldText, newText: r.newText });
			}

			// Single-file: pure delegation. Built-in handles preview and result rendering.
			if (groups.size === 1) {
				const g = [...groups.values()][0];
				return await builtin.execute(
					toolCallId,
					{ path: g.displayPath, edits: g.items },
					signal,
					onUpdate as any,
					ctx,
				);
			}

			// Multi-file: one built-in call per file, aggregate.
			const summaries: string[] = [];
			const diffs: string[] = [];
			let firstChangedLine: number | undefined;

			for (const g of groups.values()) {
				if (signal?.aborted) throw new Error("Operation aborted");
				const result = await builtin.execute(
					toolCallId,
					{ path: g.displayPath, edits: g.items },
					signal,
					onUpdate as any,
					ctx,
				);
				summaries.push(extractText(result.content as any));
				const details = result.details as
					| { diff?: string; firstChangedLine?: number }
					| undefined;
				if (details?.diff) diffs.push(`File: ${g.displayPath}\n${details.diff}`);
				if (firstChangedLine === undefined && details?.firstChangedLine !== undefined) {
					firstChangedLine = details.firstChangedLine;
				}
			}

			return {
				content: [
					{
						type: "text" as const,
						text: `Applied edits across ${groups.size} files.\n${summaries.join("\n")}`,
					},
				],
				details: { diff: diffs.join("\n\n"), firstChangedLine },
			};
		},

		// Delegate rendering to the built-in. For single-file shape this gives
		// us the live diff preview and final render for free. For multi-file or
		// patch shapes the built-in renderer will skip the preview (its shape
		// check returns null) but the header still renders correctly.
		renderCall(args, theme, context) {
			const builtin = createEditToolDefinition(context.cwd);
			const delegateArgs = isSingleFileShape(args as Params)
				? normalizeForBuiltinRender(args as Params)
				: { path: "(multiple files)", edits: [] };
			return builtin.renderCall!(delegateArgs as any, theme, context as any);
		},

		renderResult(result, options, theme, context) {
			const builtin = createEditToolDefinition(context.cwd);
			const delegateArgs = isSingleFileShape(context.args as Params)
				? normalizeForBuiltinRender(context.args as Params)
				: { path: "(multiple files)", edits: [] };
			const delegateContext = { ...context, args: delegateArgs };
			return builtin.renderResult!(result as any, options, theme, delegateContext as any);
		},
	});
}

// Convert our extended shape into the built-in's `{path, edits[]}` shape for
// rendering. Used only when isSingleFileShape returned true.
function normalizeForBuiltinRender(
	params: Params,
): { path: string; edits: Array<{ oldText: string; newText: string }> } {
	const edits = params.edits ? [...params.edits] : [];
	if (params.oldText !== undefined && params.newText !== undefined) {
		edits.unshift({ oldText: params.oldText, newText: params.newText });
	}
	const path =
		params.path ?? edits.find((e) => e.path)?.path ?? "";
	return {
		path,
		edits: edits.map((e) => ({ oldText: e.oldText, newText: e.newText })),
	};
}
