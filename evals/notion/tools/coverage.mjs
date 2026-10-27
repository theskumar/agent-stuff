#!/usr/bin/env node
// Coverage check for the notion skill: every command and flag the skill names exists in the tool, and every public
// operation of the tool is named in the skill. Warns, never fails hard on ntn being absent.
// Usage: node coverage.mjs <skill-dir>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const dir = process.argv[2];
const skill = readFileSync(join(dir, "SKILL.md"), "utf8");
// Names count only inside code: fenced blocks and inline code spans.
const code = [...skill.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n") + "\n" +
  [...skill.replace(/```[\s\S]*?```/g, "").matchAll(/`([^`\n]+)`/g)].map((m) => m[1]).join("\n");
const js = readFileSync(join(dir, "scripts/notion.js"), "utf8");
const mcp = readFileSync(join(dir, "scripts/notion-mcp.mjs"), "utf8");
let misses = 0;
const miss = (m) => { misses++; console.log("MISS", m); };

// notion.js: commands and flags parsed by the script.
const jsFlags = new Set([...js.matchAll(/a === '(--?[a-z-]+)'/g)].map((m) => m[1]));
const jsCmds = new Set([...js.matchAll(/cmd === '([a-z]+)'/g)].map((m) => m[1]));
const jsSubs = new Set([...js.matchAll(/sub === '([a-z]+)'/g)].map((m) => m[1]));
for (const m of code.matchAll(/node scripts\/notion\.js ([a-z]+)(?: ([a-z]+))?([^\n`#]*)/g)) {
  if (!jsCmds.has(m[1])) miss(`notion.js ${m[1]}: no such command`);
  if (m[2] && ["page", "blocks", "db", "comment", "files"].includes(m[1]) && !jsSubs.has(m[2])) miss(`notion.js ${m[1]} ${m[2]}: no such subcommand`);
  for (const f of m[3].matchAll(/(--[a-z-]+)/g)) if (!jsFlags.has(f[1])) miss(`notion.js ${m[1]} ${m[2] ?? ""}: flag ${f[1]} not parsed (silently becomes a positional)`);
}
for (const c of jsCmds) if (c !== "help" && !new RegExp(`\\b${c}\\b`).test(skill)) miss(`notion.js ${c} is not named in the skill`);

// notion-mcp.mjs
const mcpFlags = new Set([...mcp.matchAll(/arg === "(--?[a-z-]+)"/g)].map((m) => m[1]));
const mcpCmds = new Set(["auth", "search", "list", "tools", "call"]);
for (const m of code.matchAll(/notion-mcp\.mjs ([a-z]+)([^\n`#]*)/g)) {
  if (!mcpCmds.has(m[1])) miss(`notion-mcp.mjs ${m[1]}: no such command`);
  for (const f of m[2].matchAll(/(--[a-z-]+)/g)) if (!mcpFlags.has(f[1])) miss(`notion-mcp.mjs ${m[1]}: flag ${f[1]} not parsed`);
}
for (const c of mcpCmds) if (!new RegExp(`notion-mcp\\.mjs[^\\n]*\\b${c}\\b|\\b${c}\\b[^\\n]*notion-mcp`).test(skill) && !skill.includes("`" + c)) miss(`notion-mcp.mjs ${c} is not named`);

// ntn: subcommands and flags against `ntn ... --help`.
const help = (args) => { const r = spawnSync("ntn", [...args, "--help"], { encoding: "utf8" }); return r.status === 0 ? r.stdout : null; };
const top = help([]);
if (!top) console.log("WARN ntn not found; skipped ntn checks");
else {
  const cmds = [...top.split("Options:")[0].matchAll(/^  ([a-z]+)\s{2,}/gm)].map((m) => m[1]).filter((c) => c !== "help");
  for (const c of cmds) if (!new RegExp(`\\b${c}\\b`).test(skill)) miss(`ntn ${c} is not named in the skill`);
  for (const m of code.matchAll(/(?:^|[\s(])ntn ([a-z]+)(?: ([a-z]+))?([^\n`#]*)/g)) {
    if (!cmds.includes(m[1])) { miss(`ntn ${m[1]}: no such command`); continue; }
    const sub = m[2] && !["ls"].includes(m[2]) && m[1] !== "api" ? m[2] : null;
    const h = help(sub ? [m[1], sub] : [m[1]]);
    if (!h) { miss(`ntn ${m[1]} ${sub ?? ""}: help failed`); continue; }
    for (const f of m[3].matchAll(/(--[a-z-]+)/g)) if (!h.includes(f[1])) miss(`ntn ${m[1]} ${sub ?? ""}: flag ${f[1]} not in help`);
  }
}
console.log(misses ? `${misses} misses` : "coverage ok");
process.exit(misses ? 1 : 0);
