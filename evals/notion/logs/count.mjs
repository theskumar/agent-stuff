#!/usr/bin/env node
// Count notion skill usage in Pi and Claude Code session logs (last N days).
// Usage: node count.mjs [days=60]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const days = Number(process.argv[2] ?? 60);
const since = Date.now() - days * 86400e3;
const roots = [
  ["pi", join(homedir(), ".pi/agent/sessions")],
  ["claude", join(homedir(), ".claude/projects")],
];

function* walk(dir) {
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith(".jsonl")) yield p;
  }
}

const seenCalls = new Set();
const calls = []; // {host, session, id, cmd, err, errText}
const skillReads = new Map(); // session -> true
const sessionsWithCalls = new Map();
const hostSessions = { pi: new Set(), claude: new Set() };

const IGNORE = /skill-diet|\/tmp\/diet|grep .*notion|rg .*notion/;
const NOTION = /notion\.js|notion-mcp\.mjs|(^|[\s;&|(])ntn\s/;

for (const [host, root] of roots) {
  for (const f of walk(root)) {
    let st; try { st = statSync(f); } catch { continue; }
    if (st.mtimeMs < since) continue;
    const session = host === "claude" && f.includes("/subagents/") ? f.split("/subagents/")[0] : f;
    hostSessions[host].add(session);
    const pending = new Map();
    for (const line of readFileSync(f, "utf8").split("\n")) {
      if (!line.includes("notion") && !line.includes("ntn") && !line.includes("tool")) continue;
      let d; try { d = JSON.parse(line); } catch { continue; }
      const m = d.message;
      if (!m || !Array.isArray(m.content)) continue;
      for (const c of m.content) {
        // calls
        let id, cmd, path;
        if (c.type === "toolCall") { id = c.id; cmd = c.arguments?.command; path = c.arguments?.path; }
        else if (c.type === "tool_use") { id = c.id; cmd = c.input?.command; path = c.input?.file_path ?? c.input?.path; if (c.name === "Skill" && /notion/.test(c.input?.skill ?? "")) skillReads.set(session, true); }
        if (id) {
          if (path && /skills\/notion\/SKILL\.md$/.test(path)) skillReads.set(session, true);
          if (typeof cmd === "string" && /skills\/notion\/SKILL\.md/.test(cmd) && /cat|sed|head/.test(cmd)) skillReads.set(session, true);
          if (typeof cmd === "string" && NOTION.test(cmd) && !IGNORE.test(cmd) && !seenCalls.has(id)) {
            seenCalls.add(id);
            const rec = { host, session, id, cmd, err: false, errText: "" };
            calls.push(rec); pending.set(id, rec);
            sessionsWithCalls.set(session, host);
          }
        }
        // results
        let rid, isErr, text;
        if (m.role === "toolResult") { rid = m.toolCallId; isErr = m.isError; text = (m.content || []).map((x) => x.text || "").join(""); }
        else if (c.type === "tool_result") { rid = c.tool_use_id; isErr = c.is_error; text = typeof c.content === "string" ? c.content : (c.content || []).map((x) => x.text || "").join(""); }
        if (rid && pending.has(rid)) {
          const rec = pending.get(rid);
          const e = text.match(/(^|\n)(error: .*|notion-mcp: .*|Error: .*|.*"ok": false.*|.*failed: .*)/);
          if (isErr || e) { rec.err = true; rec.errText = (e ? e[2] : text.split("\n").find(Boolean) || "").slice(0, 160); }
        }
        // skill loaded by name (pi /skill:notion expands into a user message)
        if (m.role === "user" && c.type === "text" && /<skill name="notion"|\/skill:notion|skills\/notion\/SKILL\.md/.test(c.text || "")) skillReads.set(session, true);
      }
    }
  }
}

function op(cmd) {
  const segs = [];
  for (const m of cmd.matchAll(/notion\.js["']?\s+([a-z]+)(?:\s+([a-z]+))?/g)) {
    const sub = ["page", "blocks", "db", "comment", "files"].includes(m[1]) ? `${m[1]} ${m[2] ?? ""}` : m[1];
    segs.push(`notion.js ${sub}`.trim());
  }
  for (const m of cmd.matchAll(/notion-mcp\.mjs["']?\s+([a-z]+)(?:\s+([a-z]+))?/g)) segs.push(`notion-mcp ${m[1]}${m[1] === "list" ? " " + (m[2] ?? "") : ""}`);
  for (const m of cmd.matchAll(/(?:^|[\s;&|(])ntn\s+([a-z-]+)(?:\s+([a-z]+))?/g)) segs.push(`ntn ${m[1]}${["pages", "datasources", "files"].includes(m[1]) ? " " + (m[2] ?? "") : ""}`);
  return segs.length ? segs : ["(other)"];
}

const opCount = new Map();
const helperCount = new Map();
for (const c of calls) {
  for (const o of op(c.cmd)) opCount.set(o, (opCount.get(o) || 0) + 1);
  if (/notion\.js["']?\s+exec/.test(c.cmd)) for (const m of c.cmd.matchAll(/notion\.([a-zA-Z]+(?:\.[a-zA-Z]+)?)\(/g)) helperCount.set(m[1], (helperCount.get(m[1]) || 0) + 1);
}
const errs = new Map();
for (const c of calls.filter((c) => c.err)) {
  const k = c.errText.replace(/[0-9a-f]{8}-?[0-9a-f-]{20,}/g, "<id>").slice(0, 120);
  errs.set(k, (errs.get(k) || 0) + 1);
}
const sort = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
const sess = [...sessionsWithCalls.keys()];
console.log(`window: ${days} days; sessions scanned: pi=${hostSessions.pi.size} claude=${hostSessions.claude.size}`);
console.log(`notion calls: ${calls.length} (pi=${calls.filter((c) => c.host === "pi").length}, claude=${calls.filter((c) => c.host === "claude").length}) in ${sess.length} sessions (pi=${sess.filter((s) => sessionsWithCalls.get(s) === "pi").length}, claude=${sess.filter((s) => sessionsWithCalls.get(s) === "claude").length})`);
console.log(`sessions with calls that also loaded the skill: ${sess.filter((s) => skillReads.get(s)).length}/${sess.length}`);
console.log(`\nops:`); for (const [k, v] of sort(opCount)) console.log(`  ${String(v).padStart(4)}  ${k}`);
console.log(`\nexec helpers:`); for (const [k, v] of sort(helperCount)) console.log(`  ${String(v).padStart(4)}  notion.${k}`);
console.log(`\nerrors (${calls.filter((c) => c.err).length}):`); for (const [k, v] of sort(errs)) console.log(`  ${String(v).padStart(4)}  ${k}`);
if (process.env.DUMP) for (const c of calls) console.log(`${c.host}\t${c.err ? "ERR" : "ok"}\t${c.cmd.replace(/\s+/g, " ").slice(0, 220)}`);
