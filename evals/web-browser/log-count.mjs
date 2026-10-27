#!/usr/bin/env node
// Count web-browser skill script calls in the last 60 days of pi and Claude Code session logs.
// Usage: node log-count.mjs [days=60]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const days = Number(process.argv[2] || 60);
const skipDev = process.argv.includes("--no-dev"); // drop sessions whose cwd is the skill repo (skill development)
const since = Date.now() - days * 864e5;
const roots = [join(homedir(), ".pi/agent/sessions"), join(homedir(), ".claude/projects")];
const SCRIPTS = "start|nav|eval|ax|obscura|agent|screenshot|pick|dismiss-cookies|content|emulate|watch|logs-tail|net-summary";
const CALL_RE = new RegExp(`(?:^|[\\s/'"\`(])(${SCRIPTS})\\.m?js\\b([^\\n\`"';|&)]*)`, "g");

function* files(dir) {
  let ents = [];
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (e.name.endsWith(".jsonl") && statSync(p).mtimeMs >= since) yield p;
  }
}

const seen = new Set();
const ops = {}, flags = {}, errors = {}, host = { pi: new Set(), claude: new Set() };
const sessionsWithCalls = new Set(), sessionsReadSkill = new Set();
let total = 0;
const pendingIds = new Map(); // tool id -> op, to match results

const unesc = (s) => s.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\'/g, "'");

for (const root of roots) {
  const h = root.includes(".pi") ? "pi" : "claude";
  for (const f of files(root)) {
    if (skipDev && /agent-stuff/.test(f)) continue;
    const lines = readFileSync(f, "utf8").split("\n");
    // A session's identity: file name. Forks repeat call ids; seen dedups them across files.
    for (const line of lines) {
      if (!line.includes(".js") && !line.includes("web-browser")) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      const msg = o.message || {};
      const content = Array.isArray(msg.content) ? msg.content : [];
      for (const c of content) {
        // tool calls (pi: toolCall/arguments, claude: tool_use/input)
        if (c.type === "toolCall" || c.type === "tool_use") {
          const id = c.id; if (!id || seen.has(id)) continue;
          const args = JSON.stringify(c.arguments ?? c.input ?? {});
          const text = unesc(args);
          if (/web-browser\/SKILL\.md|skill:web-browser/.test(text)) sessionsReadSkill.add(f);
          if (!/web-browser|agent-web|\b(ax|obscura|start|nav)\.js|agent\.mjs/.test(text)) continue;
          let hit = false;
          for (const m of text.matchAll(CALL_RE)) {
            const op = m[1];
            if (op === "eval" && !/web-browser|scripts\/eval\.js|\.\/eval\.js/.test(text)) continue;
            hit = true; total++;
            const arg = m[2].trim().split(/\s+/);
            const sub = ["ax", "obscura"].includes(op) && arg[0] && !arg[0].startsWith("-") ? `${op} ${arg[0]}` : op;
            ops[sub] = (ops[sub] || 0) + 1;
            for (const a of arg) if (/^--[a-z]/.test(a)) flags[`${op} ${a}`] = (flags[`${op} ${a}`] || 0) + 1;
          }
          if (hit) { seen.add(id); sessionsWithCalls.add(f); host[h].add(f); pendingIds.set(id, true); }
        }
        // tool results with ✗ errors
        const rid = c.tool_use_id || msg.toolCallId;
        if ((c.type === "tool_result" || msg.role === "toolResult") && rid && pendingIds.has(rid)) {
          const t = typeof c.content === "string" ? c.content : JSON.stringify(c.content ?? c.text ?? "");
          for (const m of unesc(t).matchAll(/✗ ([^\n\\]{0,90})/g)) {
            if (m[1].includes("${")) continue; // source code, not a real error
            const k = m[1].replace(/\d+/g, "N").replace(/https?:\S+/g, "URL").trim();
            errors[k] = (errors[k] || 0) + 1;
          }
        }
      }
      if (msg.role === "user" && typeof msg.content === "string" && /skill:web-browser|web-browser\/SKILL\.md/.test(msg.content)) sessionsReadSkill.add(f);
      if (msg.role === "user" && Array.isArray(msg.content) && /skill:web-browser|<skill name="web-browser"/.test(JSON.stringify(msg.content))) sessionsReadSkill.add(f);
    }
  }
}

const sort = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
console.log(`window: ${days} days; calls: ${total}; sessions with calls: ${sessionsWithCalls.size} (pi ${host.pi.size}, claude ${host.claude.size}); sessions that loaded the skill: ${sessionsReadSkill.size}; sessions with calls that loaded it: ${[...sessionsWithCalls].filter((s) => sessionsReadSkill.has(s)).length}`);
let cum = 0;
console.log("\nops (cumulative %):");
for (const [k, v] of sort(ops)) { cum += v; console.log(`${String(v).padStart(5)}  ${(100 * cum / total).toFixed(0).padStart(3)}%  ${k}`); }
console.log("\nflags:"); for (const [k, v] of sort(flags).slice(0, 40)) console.log(`${String(v).padStart(5)}  ${k}`);
console.log("\nerrors:"); for (const [k, v] of sort(errors).slice(0, 30)) console.log(`${String(v).padStart(5)}  ${k}`);
