#!/usr/bin/env node
// Coverage check for the notion skill. Read-only: it runs only `ntn ... --help` and `ntn api ls`.
// Warns when a command, flag or API endpoint that SKILL.md names no longer resolves in ntn or in the
// skill's scripts, and when an ntn command is missing from SKILL.md. Run it after `ntn update`.
// Usage: node scripts/coverage.mjs [skill-dir]   (exit 1 on any warning; ntn missing only warns)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const dir = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = readFileSync(join(dir, "SKILL.md"), "utf8");
// Names count only inside code: fenced blocks and inline code spans.
const code = [...skill.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n") + "\n" +
  [...skill.replace(/```[\s\S]*?```/g, "").matchAll(/`([^`\n]+)`/g)].map((m) => m[1]).join("\n");
const js = readFileSync(join(dir, "scripts/notion.js"), "utf8");
const mcp = readFileSync(join(dir, "scripts/notion-mcp.mjs"), "utf8");
let warnings = 0;
const warn = (m) => { warnings++; console.log("WARN", m); };
const indexLine = (name) => (skill.match(new RegExp(`^- ${name}: (.*)$`, "m")) ?? [])[1] ?? "";

// notion.js: commands, subcommands and flags parsed by the script.
const jsFlags = new Set([...js.matchAll(/a === '(--?[a-z-]+)'/g)].map((m) => m[1]));
const listed = new Set([...(js.match(/const FLAGS = \[([\s\S]*?)\];/)?.[1] ?? "").matchAll(/'(--[a-z-]+)'/g)].map((m) => m[1]));
for (const f of jsFlags) if (f.startsWith("--") && !listed.has(f)) warn(`notion.js: ${f} is parsed but missing from FLAGS`);
for (const f of listed) if (!jsFlags.has(f)) warn(`notion.js: ${f} is in FLAGS but not parsed`);
const jsCmds = new Set([...js.matchAll(/cmd === '([a-z]+)'/g)].map((m) => m[1]));
const jsSubs = new Set([...js.matchAll(/sub === '([a-z]+)'/g)].map((m) => m[1]));
for (const m of code.matchAll(/node scripts\/notion\.js ([a-z]+)(?: ([a-z]+))?([^\n`#]*)/g)) {
  if (!jsCmds.has(m[1])) warn(`notion.js ${m[1]}: no such command`);
  if (m[2] && ["page", "blocks", "db", "comment", "files"].includes(m[1]) && !jsSubs.has(m[2])) warn(`notion.js ${m[1]} ${m[2]}: no such subcommand`);
  for (const f of m[3].matchAll(/(--[a-z-]+)/g)) if (!jsFlags.has(f[1])) warn(`notion.js ${m[1]} ${m[2] ?? ""}: flag ${f[1]} not parsed`);
}
for (const f of indexLine("notion.js").matchAll(/(--[a-z-]+)/g)) if (!jsFlags.has(f[1])) warn(`notion.js index: flag ${f[1]} not parsed`);
for (const c of jsCmds) if (c !== "help" && !new RegExp(`\\b${c}\\b`).test(skill)) warn(`notion.js ${c} is not named in the skill`);

// notion-mcp.mjs: commands are auth, tools, call, plus the aliases in commandToCall.
const mcpFlags = new Set([...mcp.matchAll(/arg === "(--?[a-z-]+)"/g)].map((m) => m[1]));
const mcpCmds = new Set(["auth", "tools", "call", ...[...mcp.matchAll(/case "([a-z]+)": \{/g)].map((m) => m[1])]);
for (const m of code.matchAll(/notion-mcp\.mjs ([a-z]+)([^\n`#]*)/g)) {
  if (!mcpCmds.has(m[1])) warn(`notion-mcp.mjs ${m[1]}: no such command`);
  for (const f of m[2].matchAll(/(--[a-z-]+)/g)) if (!mcpFlags.has(f[1])) warn(`notion-mcp.mjs ${m[1]}: flag ${f[1]} not parsed`);
}
for (const f of indexLine("notion-mcp.mjs").matchAll(/(--[a-z-]+)/g)) if (!mcpFlags.has(f[1])) warn(`notion-mcp.mjs index: flag ${f[1]} not parsed`);
for (const c of mcpCmds) if (!new RegExp(`notion-mcp\\.mjs[^\\n]*\\b${c}\\b`).test(skill) && !skill.includes("`" + c)) warn(`notion-mcp.mjs ${c} is not named in the skill`);

// ntn: commands, subcommands, flags and API endpoints against the installed ntn.
const run = (args) => { const r = spawnSync("ntn", args, { encoding: "utf8" }); return r.status === 0 ? r.stdout : null; };
const help = (args) => run([...args, "--help"]);
const commands = (text) => [...(text.split(/^Options:/m)[0].split(/^Commands:/m)[1] ?? "").matchAll(/^  ([a-z]+)\s{2,}/gm)].map((m) => m[1]).filter((c) => c !== "help");
const top = help([]);
if (!top) console.log("WARN ntn not found; skipped ntn checks");
else {
  const cmds = commands(top);
  const subsOf = new Map();
  const subs = (c) => { if (!subsOf.has(c)) subsOf.set(c, commands(help([c]) ?? "")); return subsOf.get(c); };
  for (const c of cmds) if (!new RegExp(`\\b${c}\\b`).test(skill)) warn(`ntn ${c} is not named in the skill`);
  for (const m of code.matchAll(/(?:^|[\s(])ntn ([a-z]+)(?: ([a-z]+))?([^\n`#]*)/g)) {
    if (!cmds.includes(m[1])) { warn(`ntn ${m[1]}: no such command`); continue; }
    const sub = m[2] && subs(m[1]).includes(m[2]) ? m[2] : null;
    if (m[2] && !sub && subs(m[1]).length && m[1] !== "api") warn(`ntn ${m[1]} ${m[2]}: no such subcommand`);
    const h = help(sub ? [m[1], sub] : [m[1]]);
    if (!h) { warn(`ntn ${m[1]} ${sub ?? ""}: help failed`); continue; }
    for (const f of m[3].matchAll(/(--[a-z-]+)/g)) if (!h.includes(f[1])) warn(`ntn ${m[1]} ${sub ?? ""}: flag ${f[1]} not in help`);
  }
  // Index line: `pages get|create`, `api <path> [--help|--docs|--spec]`, `whoami`, ...
  for (const m of indexLine("ntn").matchAll(/`([a-z]+)((?: [a-z|]+)?)([^`]*)`/g)) {
    if (!cmds.includes(m[1])) { warn(`ntn ${m[1]}: no such command`); continue; }
    for (const s of m[2].trim().split("|").filter(Boolean)) if (!subs(m[1]).includes(s)) warn(`ntn ${m[1]} ${s}: no such subcommand`);
    const h = m[3].includes("--") ? help([m[1]]) ?? "" : "";
    for (const f of m[3].matchAll(/(--[a-z-]+)/g)) if (!h.includes(f[1])) warn(`ntn ${m[1]}: flag ${f[1]} not in help`);
  }
  // API endpoints: every `[METHOD] v1/...` path must match a line of `ntn api ls`.
  const norm = (p) => p.replace(/^\/?/, "/").replace(/(\$\{[^}]*\}|<[^>]*>|\{[^}]*\})/g, "*").replace(/[/.]+$/, "");
  const ls = (run(["api", "ls"]) ?? "").split("\n").map((l) => l.split("\t")).filter((f) => f.length >= 2).map(([method, p]) => [method, norm(p)]);
  if (!ls.length) warn("ntn api ls returned nothing; skipped endpoint checks");
  else for (const m of new Set([...code.matchAll(/(?:\b(GET|POST|PATCH|DELETE) )?(v1\/[\w/<>{}$.-]*[\w>}])/g)].map((m) => `${m[1] ?? ""} ${m[2]}`))) {
    const [method, p] = m.trim().includes(" ") ? m.trim().split(" ") : [null, m.trim()];
    if (norm(p) === "/v1/*") continue; // the generic `v1/<path>` placeholder
    const re = new RegExp(`^${norm(p).replace(/[.+?^$()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]+")}$`);
    const hits = ls.filter(([, q]) => re.test(q.replace(/\*/g, "x")));
    if (!hits.length) warn(`api ${p}: no such endpoint in ntn api ls`);
    else if (method && !hits.some(([x]) => x === method)) warn(`api ${method} ${p}: method not in ntn api ls`);
  }
}
console.log(warnings ? `${warnings} warnings` : "coverage ok");
process.exit(warnings ? 1 : 0);
