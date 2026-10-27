#!/usr/bin/env node
// Per version: skill files actually opened (read tool, or cat/sed/head/less/rg/grep in bash) and help calls.
// Usage: node reads.mjs <eval-dir>
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2];
const per = {};
for (const name of readdirSync(join(dir, "runs"))) {
  const f = join(dir, "runs", name, "result.json");
  if (!existsSync(f)) continue;
  const r = JSON.parse(readFileSync(f, "utf8"));
  const v = (per[r.version] ??= { runs: 0, files: {}, help: 0, mcp: 0, ntnDirect: 0, scriptCalls: 0 });
  v.runs++;
  for (const c of r.calls || []) {
    if (c.name === "read" && c.path) {
      const m = c.path.match(/\/sk\/[^/]+\/notion\/(.+)$/);
      if (m) v.files[m[1]] = (v.files[m[1]] || 0) + 1;
    }
    const cmd = c.command || "";
    for (const m of cmd.matchAll(/\b(?:cat|sed|head|tail|less|rg|grep|wc)\b[^|;&]*?\/sk\/[^/]+\/notion\/([^\s'"|;&]+)/g)) v.files[m[1]] = (v.files[m[1]] || 0) + 1;
    if (/--help|\s-h\b|--docs|--spec|api ls/.test(cmd)) v.help++;
    if (/notion-mcp\.mjs/.test(cmd)) v.mcp++;
    if (/(^|[\s;&|(])ntn\s/.test(cmd)) v.ntnDirect++;
    if (/notion\.js/.test(cmd)) v.scriptCalls++;
  }
}
for (const [v, s] of Object.entries(per)) {
  const files = Object.entries(s.files).map(([k, n]) => `${k}×${n}`).join(", ");
  console.log(`${v}: runs=${s.runs} opened: ${files || "-"} | help/docs calls ${s.help} | notion.js calls ${s.scriptCalls} | ntn direct ${s.ntnDirect} | notion-mcp ${s.mcp}`);
}
