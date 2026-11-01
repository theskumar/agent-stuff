/**
 * Edit Guard Extension
 *
 * Warns, never blocks, when a bash call edits or reads a file in a way the
 * built-in tools do better:
 *   - in-place edits through Python (open(p).read() ... open(p,'w').write),
 *     Path.write_text, or sed -i  -> use the edit tool
 *   - reading a source or doc file with cat, head, tail or sed -n
 *     -> use the read tool
 *
 * The warning is appended to the bash result, so the agent sees it on the
 * next turn. It also fires for bash calls made inside codemode scripts.
 * Each warning kind fires at most MAX_PER_KIND times per session.
 *
 * Toggle: PI_EDIT_GUARD=0 pi disables it.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MAX_PER_KIND = 3;

const SEG = String.raw`(?:^|\n|[;&|]{1,2}|\$\()\s*`;
const FILE_EXT = String.raw`\.(?:md|mdx|ts|tsx|js|mjs|cjs|py|json|ya?ml|toml|txt|sh|go|rs|rb|swift|kt|java|css|html)\b`;

const pyEditRead = /\.read\(\)|\.read_text\(/;
const pyEditWrite = /open\([^)]*,\s*['"][wa]['"]\)|\.write_text\(/;
const sedInPlace = new RegExp(SEG + String.raw`sed\s+(?:-[a-zA-Z]*i|--in-place)`);
// cat/head/tail/sed -n on a code or doc file; skips heredoc writes (cat > f <<EOF).
const catRead = new RegExp(
  SEG +
    String.raw`(?:cat|head|tail|sed\s+-n)\s+(?:-[-\w]+\s+|'[^']*'\s+|"[^"]*"\s+|[\w,$]+\s+)*[^\s|<>;&]*` +
    FILE_EXT,
);

type Kind = "edit" | "read";

const MESSAGES: Record<Kind, string> = {
  edit: "[edit-guard] This bash call edited a file in place (Python read/write, write_text or sed -i). Use the `edit` tool for file edits: it shows a diff and fails loudly when the old text does not match.",
  read: "[edit-guard] This bash call read a file with cat/head/tail/sed -n. Use the `read` tool with offset/limit instead.",
};

export function classify(command: string): Kind | null {
  if ((pyEditRead.test(command) && pyEditWrite.test(command)) || sedInPlace.test(command))
    return "edit";
  if (catRead.test(command)) return "read";
  return null;
}

export default function (pi: ExtensionAPI) {
  if (/^(0|false|no|off)$/i.test(process.env.PI_EDIT_GUARD ?? "")) return;

  const counts: Record<Kind, number> = { edit: 0, read: 0 };
  pi.on("session_start", () => {
    counts.edit = 0;
    counts.read = 0;
  });

  pi.on("tool_result", (event) => {
    if (event.toolName !== "bash") return;
    const command = typeof event.input?.command === "string" ? event.input.command : "";
    const kind = classify(command);
    if (!kind || counts[kind] >= MAX_PER_KIND) return;
    counts[kind] += 1;

    const note = MESSAGES[kind];
    const content = [...event.content, { type: "text" as const, text: `\n${note}` }];
    const structured = event.structuredContent as Record<string, unknown> | undefined;
    if (
      structured &&
      typeof structured === "object" &&
      !Array.isArray(structured) &&
      typeof structured.output === "string"
    ) {
      return {
        content,
        structuredContent: { ...structured, output: `${structured.output}\n${note}` },
      };
    }
    return { content, structuredContent: event.structuredContent };
  });
}
