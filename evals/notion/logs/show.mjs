#!/usr/bin/env node
// Print the result text of Pi tool calls whose command matches a regex.
// Usage: node show.mjs <regex> [maxChars=800]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const re = new RegExp(process.argv[2]);
const max = Number(process.argv[3] ?? 800);
const since = Date.now() - 60 * 86400e3;
function* walk(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) yield* walk(p); else if (p.endsWith(".jsonl")) yield p; } }
const seen = new Set();
for (const f of walk(join(homedir(), ".pi/agent/sessions"))) {
  if (statSync(f).mtimeMs < since) continue;
  const want = new Map();
  for (const line of readFileSync(f, "utf8").split("\n")) {
    let d; try { d = JSON.parse(line); } catch { continue; }
    const m = d.message; if (!m || !Array.isArray(m.content)) continue;
    for (const c of m.content) if (c.type === "toolCall" && typeof c.arguments?.command === "string" && re.test(c.arguments.command) && !seen.has(c.id)) { seen.add(c.id); want.set(c.id, c.arguments.command); }
    if (m.role === "toolResult" && want.has(m.toolCallId)) {
      console.log("### CMD:", want.get(m.toolCallId).replace(/\s+/g, " ").slice(0, 300));
      console.log((m.content || []).map((x) => x.text || "").join("").slice(0, max));
      console.log();
    }
  }
}
