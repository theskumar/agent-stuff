#!/usr/bin/env node
// Accessibility-tree view + id-based actions. Ids are Chrome backendNodeIds,
// stable across CLI calls until the page reloads.
//   ax.js state [--all]                 [id] role "name" = value; "*" marks ids new since the last state
//   ax.js click <id> [--state]          scroll into view, real mouse click at element center
//   ax.js type <id> <text> [--enter] [--state]   focus, replace text, optionally press Enter
//   ax.js select <id> <text> [--state]  pick a native <select> option by visible text
//   ax.js settle                        wait until the page is quiet (no requests, no DOM changes)
// Every action waits for the page to settle, then prints one outcome line:
//   "navigated to <url>" | "page changed" | "no change". --state appends the new state.
// Idea borrowed from browser-use/browser-use-pi (src/ax.ts): settle detection, outcome lines, new-id markers.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { connect } from "./cdp.js";

const CONTROLS = new Set(
  "button link textbox searchbox combobox listbox option checkbox radio switch slider spinbutton tab menuitem menuitemcheckbox menuitemradio treeitem".split(
    " ",
  ),
);
const QUIET_MS = 150; // no real DOM change and no in-flight request for this long
const CAP_MS = 3000; // never wait longer than this
const LONG_POLL_MS = 1500; // requests open longer than this are treated as long-poll/analytics
const LAST_FILE = join(homedir(), ".cache", "agent-web", "ax-last.json");

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
const prop = (n, name) => n.properties?.find((p) => p.name === name)?.value?.value;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const isContextLoss = (e) =>
  /Execution context was destroyed|Cannot find context|Inspected target navigated|Target closed|No frame|Session with given id not found/.test(
    String(e?.message ?? e),
  );

const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const rest = argv.slice(1).filter((a) => !a.startsWith("--"));
if (!["state", "click", "type", "select", "settle"].includes(cmd)) {
  console.log(
    "Usage: ax.js state [--all] | click <id> | type <id> <text> [--enter] | select <id> <text> | settle   (actions accept --state)",
  );
  process.exit(1);
}

const timeout = setTimeout(() => {
  console.error("✗ Global timeout exceeded (45s)");
  process.exit(1);
}, 45000);

let cdp;

// ---- page probe: a MutationObserver that survives until the document changes ----
const PROBE = `(() => {
  const w = window;
  if (!w.__axObs) {
    w.__axLast = performance.now(); w.__axN = 0; w.__axDoc = Math.random();
    const styled = new WeakMap();
    w.__axObs = new MutationObserver((records) => {
      const now = performance.now(); let real = false;
      for (const r of records) {
        // Writing an attribute's current value changes nothing.
        if (r.attributeName && r.oldValue === r.target.getAttributeNS(r.attributeNamespace, r.attributeName)) continue;
        if (r.attributeName !== 'style') real = true;
        else if (now - (styled.get(r.target) ?? -1e9) > 200) real = true; // animation loops go quiet
        if (r.attributeName === 'style') styled.set(r.target, now);
      }
      if (real) { w.__axLast = now; w.__axN++; }
    });
    w.__axObs.observe(document, { subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true });
    for (const t of ['input', 'change']) addEventListener(t, () => w.__axN++, true);
  }
  return { idle: performance.now() - w.__axLast, ready: document.readyState, url: location.href, title: document.title, n: w.__axN, doc: w.__axDoc };
})()`;

async function main() {
  cdp = await connect(5000);
  const page = (await cdp.getPages()).at(-1);
  if (!page) throw new Error("No active tab found");
  const sid = await cdp.attachToPage(page.targetId);
  const send = (m, p = {}) => cdp.send(m, p, sid);

  const probe = async () => {
    try {
      return await cdp.evaluate(sid, PROBE, 5000);
    } catch (e) {
      if (isContextLoss(e)) return null; // mid-navigation: no context to ask
      throw e;
    }
  };

  // Track in-flight requests from CDP events (no page patching).
  const inflight = new Map();
  let lastNetAt = 0;
  await send("Network.enable");
  cdp.on("Network.requestWillBeSent", (p, s) => {
    if (s === sid) {
      inflight.set(p.requestId, Date.now());
      lastNetAt = Date.now();
    }
  });
  for (const ev of ["Network.loadingFinished", "Network.loadingFailed"])
    cdp.on(ev, (p, s) => {
      if (s === sid) {
        inflight.delete(p.requestId);
        lastNetAt = Date.now();
      }
    });
  const netBusy = () => {
    const now = Date.now();
    for (const [id, t] of inflight) if (now - t > LONG_POLL_MS) inflight.delete(id);
    return inflight.size > 0 || now - lastNetAt < QUIET_MS;
  };

  // Wait until loaded, DOM quiet and network quiet. `since` forces the quiet window to start after an action.
  async function settle(since = 0) {
    const start = Date.now();
    while (Date.now() - start < CAP_MS) {
      const p = await probe();
      if (p) {
        const idle = Math.min(p.idle, Date.now() - (since || start));
        if (p.ready !== "loading" && idle >= QUIET_MS && !netBusy()) return p;
      }
      await delay(50);
    }
    return await probe();
  }

  // ---- state ----
  async function state() {
    const all = flags.has("--all");
    await settle();
    await send("Accessibility.enable");
    const { nodes } = await send("Accessibility.getFullAXTree");
    const info = (await probe()) ?? JSON.parse(await cdp.evaluate(sid, "JSON.stringify({url:location.href,title:document.title})"));
    let previous = null;
    try {
      const saved = JSON.parse(readFileSync(LAST_FILE, "utf8"));
      if (saved.target === page.targetId && saved.url === info.url) previous = new Set(saved.ids);
    } catch {}
    const ids = [];
    const out = [`# ${info.title}`, `url: ${info.url}`];
    let pendingText = [];
    const flush = () => {
      if (pendingText.length) out.push(clip(norm(pendingText.join(" ")), 200));
      pendingText = [];
    };
    const mark = (id) => (previous && !previous.has(id) ? "*" : "");
    // getFullAXTree is not guaranteed to be in document order: walk from the root.
    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    const ordered = [];
    const walk = (n) => {
      ordered.push(n);
      for (const c of n.childIds ?? []) if (byId.has(c)) walk(byId.get(c));
    };
    const root = nodes.find((n) => !n.parentId) ?? nodes[0];
    if (root) walk(root);
    for (const n of ordered) {
      if (n.ignored || n.backendDOMNodeId == null) continue;
      const role = n.role?.value;
      const name = norm(n.name?.value);
      const id = n.backendDOMNodeId;
      if (role === "StaticText") {
        if (name) pendingText.push(name);
        continue;
      }
      if (role === "heading") {
        flush();
        ids.push(id);
        out.push(`## ${mark(id)}[${id}] ${name}`);
        continue;
      }
      if (CONTROLS.has(role)) {
        // Link/button text already appears via its name; drop the StaticText it owns.
        pendingText = [];
        ids.push(id);
        const value = norm(n.value?.value);
        const states = ["disabled", "checked", "selected", "expanded", "required"]
          .filter((s) => prop(n, s) === true || (s === "checked" && prop(n, s) === "true"))
          .join(",");
        out.push(
          `${mark(id)}[${id}] ${role}${name ? ` "${clip(name, 80)}"` : ""}${value ? ` = ${clip(value, 60)}` : ""}${states ? ` (${states})` : ""}`,
        );
      } else if (all && name && role !== "generic" && role !== "none") {
        flush();
        ids.push(id);
        out.push(`${mark(id)}[${id}] ${role} "${clip(name, 80)}"`);
      }
    }
    flush();
    try {
      mkdirSync(join(homedir(), ".cache", "agent-web"), { recursive: true });
      writeFileSync(LAST_FILE, JSON.stringify({ target: page.targetId, url: info.url, ids }));
    } catch {}
    console.log(out.join("\n"));
  }

  // ---- actions ----
  async function act(describe, run) {
    const before = (await probe()) ?? {};
    const actedAt = Date.now();
    const note = await run();
    // A navigation destroys the context; settle() copes by probing again until a new document answers.
    const after = await settle(actedAt);
    let outcome;
    if (!after) outcome = "page unresponsive";
    else if (after.doc !== before.doc || after.url !== before.url) outcome = `navigated to ${after.url}`;
    else if (after.n !== before.n) outcome = "page changed";
    else outcome = "no change";
    console.log(`${describe}${note ? ` ${note}` : ""} -> ${outcome}`);
    if (flags.has("--state")) await state();
  }

  if (cmd === "settle") {
    const p = await settle();
    console.log(p ? `settled: ${p.url}` : "page unresponsive");
    return;
  }
  if (cmd === "state") return state();

  const id = Number(rest[0]);
  if (!Number.isInteger(id)) throw new Error(`Bad id: ${rest[0]}`);
  await send("DOM.enable");
  const { object: el } = await send("DOM.resolveNode", { backendNodeId: id });

  if (cmd === "click") {
    return act(`clicked [${id}]`, async () => {
      const hidden = (await cdp.evaluate(sid, "document.visibilityState")) === "hidden";
      if (hidden) {
        // Occluded window: Chrome stalls ~5s then drops real mouse input. Fall back to a DOM click.
        const r = await send("Runtime.callFunctionOn", {
          objectId: el.objectId,
          returnByValue: true,
          functionDeclaration: "function(){this.scrollIntoView({block:'center'});this.click();return 'ok'}",
        });
        return `(DOM click: page hidden)${r.exceptionDetails ? " ✗ " + r.exceptionDetails.text : ""}`;
      }
      await send("DOM.scrollIntoViewIfNeeded", { backendNodeId: id });
      const { model } = await send("DOM.getBoxModel", { backendNodeId: id });
      const q = model.content;
      const x = (q[0] + q[2] + q[4] + q[6]) / 4;
      const y = (q[1] + q[3] + q[5] + q[7]) / 4;
      const base = { x, y, button: "left", clickCount: 1 };
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", ...base });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
      return `at ${Math.round(x)},${Math.round(y)}`;
    });
  }

  const text = rest[1] ?? "";
  if (cmd === "select") {
    return act(`selected [${id}]`, async () => {
      const r = await send("Runtime.callFunctionOn", {
        objectId: el.objectId,
        returnByValue: true,
        functionDeclaration: `function(t){const o=[...this.options].find(o=>o.text.trim()===t||o.value===t);if(!o)return 'no option: '+t;this.value=o.value;this.dispatchEvent(new Event('input',{bubbles:true}));this.dispatchEvent(new Event('change',{bubbles:true}));return o.text.trim()}`,
        arguments: [{ value: text }],
      });
      return JSON.stringify(r.result.value);
    });
  }

  // type
  return act(`typed into [${id}]`, async () => {
    await send("DOM.scrollIntoViewIfNeeded", { backendNodeId: id });
    await send("DOM.focus", { backendNodeId: id });
    // Replace existing text: select all contents, then insert.
    await send("Runtime.callFunctionOn", {
      objectId: el.objectId,
      functionDeclaration: `function(){if(this.select)this.select();else{const r=document.createRange();r.selectNodeContents(this);const s=getSelection();s.removeAllRanges();s.addRange(r)}}`,
    });
    await send("Input.insertText", { text });
    if (flags.has("--enter")) {
      const k = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" };
      await send("Input.dispatchKeyEvent", { type: "keyDown", ...k });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...k });
      return "+ Enter";
    }
    return "";
  });
}

try {
  await main();
} catch (e) {
  console.error("✗", e.message === "fetch failed" ? "Chrome not reachable on the debug port. Run ./scripts/start.js" : e.message);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  cdp?.close();
}
