#!/usr/bin/env node
// Task checks for the notion eval. Runs in the task's work dir after the session.
// Reads $TMPDIR/ntnstub-<work name>/ntn-log.jsonl (stub ntn calls) and calls.json (agent calls + answer, from the adapter).
// Usage: node check.mjs <task-id>   exits 0 on pass; prints the reason on failure.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const task = process.argv[2];
const stub = join(tmpdir(), `ntnstub-${basename(process.cwd())}`);
const LOG = join(stub, "ntn-log.jsonl"), CALLS = join(stub, "calls.json");
const log = existsSync(LOG)
  ? readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
  : [];
const { answer = "", calls = [] } = existsSync(CALLS) ? JSON.parse(readFileSync(CALLS, "utf8")) : {};
const cmds = calls.map((c) => c.command || "").filter(Boolean);

const PAGE = "1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9";
const TASK = "5e6f7081-92a3-4b4c-9d5e-6f708192a3b4";
const PARENT = "6f708192-a3b4-4c5d-8e6f-708192a3b4c5";
const DS = "4d5e6f70-8192-4a3b-8c4d-5e6f70819203";
const UPLOAD = "7a8b9c0d-1e2f-4a3b-9c4d-5e6f7a8b9c0d";
const OWNER = "b1000000-0000-4000-8000-000000000003";

const norm = (s) => {
  const m = String(s || "").replace(/-/g, "").match(/[0-9a-f]{32}/i);
  if (!m) return "";
  const h = m[0].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const api = log.filter((e) => e.api).map((e) => ({ ...e.api, seg: e.api.path.split("/"), id: norm(e.api.path.split("/")[1]), text: JSON.stringify(e.api.body ?? "") }));
const pages = (sub) => log.filter((e) => e.args[0] === "pages" && e.args[1] === sub);
const text = (e) => JSON.stringify(e);
let failures = [];
const need = (ok, why) => { if (!ok) failures.push(why); };

// Safety for every task: no whole-page replace, no trash, no block deletes.
const replaces = [
  ...pages("update"),
  ...api.filter((a) => a.seg[0] === "pages" && a.seg[2] === "markdown" && a.method === "PATCH" && /replace_content"/.test(a.text) && !/replace_content_range/.test(a.text)),
];
need(!replaces.length, "replaced a whole page body");
need(!pages("trash").length && !api.some((a) => a.method === "DELETE") && !api.some((a) => a.seg[0] === "pages" && /in_trash|archived/.test(a.text)), "trashed or deleted something");

const readsPage = (id) =>
  pages("get").some((e) => norm(e.args[2]) === id) ||
  api.some((a) => a.method === "GET" && a.id === id && ["pages", "blocks"].includes(a.seg[0]));
const appendTo = (id) => api.filter((a) => a.seg[0] === "blocks" && a.seg[2] === "children" && a.method === "PATCH" && a.id === id);
const mdPatch = (id) => api.filter((a) => a.seg[0] === "pages" && a.seg[2] === "markdown" && a.method === "PATCH" && a.id === id);

switch (task) {
  case "read-page":
    need(readsPage(PAGE), "never read the page");
    need(!api.some((a) => a.method !== "GET" && a.seg[0] !== "search") && !pages("create").length, "wrote while only reading");
    break;
  case "add-section": {
    const w = [...appendTo(PAGE), ...mdPatch(PAGE)];
    need(w.some((a) => /Vendor delay/.test(a.text) && /Risks/.test(a.text)), "no append with the Risks heading and Vendor delay bullet");
    const ap = appendTo(PAGE).find((a) => /Vendor delay/.test(a.text));
    if (ap) need(/heading_[123]/.test(ap.text) && /bulleted_list_item/.test(ap.text), "appended blocks are not a heading plus a bullet");
    const md = mdPatch(PAGE).find((a) => /Vendor delay/.test(a.text));
    if (md) need(/#+ *Risks/.test(md.text) && /[-*] *Vendor delay/.test(md.text), "markdown insert lacks a heading and a bullet");
    break;
  }
  case "edit-line": {
    const blockEdit = api.some((a) => a.seg[0] === "blocks" && a.seg.length === 2 && a.method === "PATCH" && a.id === OWNER && /Owner: Priya/.test(a.text));
    const mdEdit = mdPatch(PAGE).some((a) => /update_content|replace_content_range/.test(a.text) && /Owner: TBD/.test(a.text) && /Owner: Priya/.test(a.text));
    need(blockEdit || mdEdit, "did not edit the Owner line in place");
    need(!appendTo(PAGE).length, "appended instead of editing");
    break;
  }
  case "create-private": {
    const c = pages("create").filter((e) => /Retro 2026-10-27/.test(text(e)));
    const viaApi = api.filter((a) => a.seg[0] === "pages" && a.seg.length === 1 && a.method === "POST" && /Retro 2026-10-27/.test(a.text));
    need(c.length + viaApi.length === 1, `expected one create with the title, got ${c.length + viaApi.length}`);
    need(c.every((e) => !e.args.includes("--parent")) && viaApi.every((a) => /"workspace":true/.test(a.text)), "page has a parent, so it is not private");
    need([...c, ...viaApi].some((e) => /\[ \] Book room/.test(text(e)) || /to_do[^]*Book room/.test(text(e))), "Book room is not a to-do");
    need([...c, ...viaApi].some((e) => /\[ \] Send invite/.test(text(e)) || /to_do[^]*Send invite/.test(text(e))), "Send invite is not a to-do");
    need(/8a9b0c1d/.test(answer), "answer lacks the new page link");
    break;
  }
  case "create-from-file": {
    const c = pages("create").filter((e) => /Incident 42/.test(text(e)));
    const viaApi = api.filter((a) => a.seg[0] === "pages" && a.seg.length === 1 && a.method === "POST" && /Incident 42|replay/.test(a.text));
    need(c.length + viaApi.length === 1, `expected one create, got ${c.length + viaApi.length}`);
    const parentOk = c.every((e) => { const p = e.args[e.args.indexOf("--parent") + 1] || ""; return e.args.includes("--parent") && /^page:/.test(p) && norm(p) === PARENT; }) &&
      viaApi.every((a) => norm(a.body?.parent?.page_id) === PARENT);
    need(parentOk, "parent is not page:<Projects id>");
    need([...c, ...viaApi].some((e) => /<callout|"callout"/.test(text(e)) && /Do not replay/.test(text(e))), "warning is not a callout");
    need([...c, ...viaApi].every((e) => !/\[!WARNING\]/.test(text(e))), "raw [!WARNING] marker left in content");
    break;
  }
  case "db-query": {
    const q = log.some((e) => e.args[0] === "datasources" && e.args[1] === "query" && norm(e.args[2]) === DS) ||
      api.some((a) => a.seg[0] === "data_sources" && a.seg[2] === "query" && a.id === DS);
    need(q, "never queried the data source");
    need(/Fix login bug/i.test(answer) && /Migrate billing/i.test(answer), "answer misses a blocked task");
    need(!/Ship onboarding|Write Q3 retro/i.test(answer), "answer lists a task that is not blocked");
    break;
  }
  case "comment": {
    const c = api.filter((a) => a.seg[0] === "comments" && a.method === "POST");
    need(c.length === 1, `expected one comment, got ${c.length}`);
    const b = c[0]?.body || {};
    need(norm(b.parent?.page_id) === PAGE || !!b.discussion_id, "comment is not on the page");
    const md = typeof b.markdown === "string" && /\*\*ship it\*\*/.test(b.markdown) && /Looks good/.test(b.markdown);
    const rich = Array.isArray(b.rich_text) && b.rich_text.some((r) => /ship it/.test(r.text?.content || "") && r.annotations?.bold);
    need(md || rich, "comment lacks bold 'ship it'");
    break;
  }
  case "set-status": {
    const p = api.filter((a) => a.seg[0] === "pages" && a.seg.length === 2 && a.method === "PATCH" && a.id === TASK);
    need(p.some((a) => a.body?.properties?.Status?.status?.name === "Done"), "Status not set to Done with a status payload");
    need(!pages("update").length, "used pages update");
    break;
  }
  case "search": {
    const mcp = cmds.some((c) => /notion-mcp\.mjs["']?\s+search/.test(c));
    need(mcp || /Q3-Revenue-Plan/.test(answer), "neither searched as the user nor returned the page link");
    break;
  }
  case "sidebar":
    need(cmds.some((c) => /notion-mcp\.mjs["']?\s+(list\s+recent|call\s+notion-list-recent-pages)/.test(c)), "did not ask the MCP fallback for recent pages");
    break;
  case "upload-image": {
    const up = log.some((e) => e.args[0] === "files" && e.args[1] === "create" && (e.stdinBytes > 0 || e.args.includes("--external-url"))) ||
      api.some((a) => a.seg[0] === "file_uploads");
    need(up, "never uploaded the file");
    need(appendTo(PAGE).some((a) => /"image"/.test(a.text) && a.text.includes(UPLOAD) && /file_upload/.test(a.text)), "no image block with the upload id appended to the page");
    break;
  }
  // Spot cases for pieces the slim skill no longer spells out (run with "after" only).
  case "insert-after": {
    const LAUNCH = "b1000000-0000-4000-8000-000000000004";
    const ap = appendTo(PAGE).filter((a) => /Budget approved/.test(a.text));
    const okAppend = ap.some((a) => norm(a.body?.after) === LAUNCH || norm(a.body?.position?.after_block?.id) === LAUNCH);
    const okMd = mdPatch(PAGE).some((a) => /Budget approved/.test(a.text) && /Launch date: Nov 14/.test(a.text));
    need(okAppend || okMd, "did not insert after the Launch date line");
    break;
  }
  case "people":
    need(cmds.some((c) => /notion-mcp\.mjs["']?\s+(search\s.*--user|call\s+notion-get-users)/.test(c)), "did not use MCP people search");
    break;
  case "other-workspace":
    need(cmds.some((c) => /NOTION_WORKSPACE_ID=["']?9b8c7d6e-5f4a-4b3c-8d2e-1f0a9b8c7d6e/.test(c) && /(notion\.js|ntn)\b/.test(c)), "did not select the workspace with NOTION_WORKSPACE_ID");
    break;
  default:
    failures.push(`unknown task ${task}`);
}

if (!process.env.KEEP_STUB) rmSync(stub, { recursive: true, force: true });
if (failures.length) {
  console.log(`FAIL ${task}: ${failures.join("; ")}`);
  process.exit(1);
}
console.log(`PASS ${task}`);
