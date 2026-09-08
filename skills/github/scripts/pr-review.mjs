#!/usr/bin/env node
// PR review-thread wrapper over the `gh` CLI.
// Collapses the fiddly CodeRabbit/Copilot triage loop (fetch unresolved threads,
// reply, resolve, dashboard, wait for CI) into short commands. Shells out to
// `gh api` so it reuses gh's auth — it holds no token of its own. Zero deps.
//
// Usage: node pr-review.mjs <command> [args] [--repo owner/repo] [--pr N]
//   threads   [--unresolved] [--bots|--author LOGIN] [--json]
//   reply     <idx|threadId> <body> [--body-file F] [--comment CID] [--resolve]
//   resolve   <idx|threadId...> | --bots [--unresolved-only-noop]
//   surfaces
//   wait      [--timeout SEC] [--for-bots]
//
// `idx` refers to the numbered list printed by the last `threads` run (cached
// per repo+PR in the temp dir). A `threadId` starts with "PRRT_".

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BOTS = ["coderabbitai", "copilot-pull-request-reviewer"];
// REST logins carry a "[bot]" suffix; GraphQL thread-comment logins do not. Normalise.
const isBot = (login) => BOTS.includes((login || "").replace(/\[bot\]$/, ""));

// ---- gh plumbing ------------------------------------------------------------

function gh(args, { allowFail = false } = {}) {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (e) {
    if (allowFail) return (e.stdout || "") + (e.stderr || "");
    const msg = (e.stderr || e.stdout || e.message || "").toString().trim();
    fail(`gh ${args.slice(0, 3).join(" ")}… failed:\n${msg}`);
  }
}

function graphql(query, { strings = {}, ints = {} } = {}) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(strings)) args.push("-f", `${k}=${v}`);
  for (const [k, v] of Object.entries(ints)) args.push("-F", `${k}=${v}`);
  return JSON.parse(gh(args));
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

// ---- arg parsing ------------------------------------------------------------

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[a.slice(2)] = next;
          i++;
        } else {
          flags[a.slice(2)] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

// ---- repo / pr context (lazy) ----------------------------------------------

let _ctx = null;
function ctx(flags) {
  if (_ctx) return _ctx;
  let repo = flags.repo;
  if (!repo) {
    repo = gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).trim();
  }
  const [owner, name] = repo.split("/");
  if (!owner || !name) fail(`could not parse repo "${repo}" (use --repo owner/repo)`);
  let pr = flags.pr;
  if (!pr) {
    pr = gh(["pr", "view", "--json", "number", "-q", ".number"]).trim();
    if (!pr) fail("no PR for the current branch (use --pr N)");
  }
  _ctx = { owner, name, pr: parseInt(pr, 10) };
  return _ctx;
}

function cachePath(c) {
  return path.join(os.tmpdir(), `pr-review-${c.owner}-${c.name}-${c.pr}.json`);
}

// ---- thread fetching --------------------------------------------------------

const THREADS_Q = `
query($owner:String!,$name:String!,$pr:Int!){
  repository(owner:$owner,name:$name){
    pullRequest(number:$pr){
      reviewThreads(first:100){
        nodes{
          id isResolved isOutdated path line
          comments(first:1){ nodes{ author{login} body fullDatabaseId } }
        }
      }
    }
  }
}`;

function fetchThreads(c) {
  const data = graphql(THREADS_Q, { strings: { owner: c.owner, name: c.name }, ints: { pr: c.pr } });
  const nodes = data.data.repository.pullRequest.reviewThreads.nodes;
  if (nodes.length === 100) {
    console.error("warning: hit the 100-thread page cap; some threads may be missing.");
  }
  return nodes.map((t) => {
    const first = t.comments.nodes[0] || {};
    return {
      id: t.id,
      resolved: t.isResolved,
      outdated: t.isOutdated,
      path: t.path,
      line: t.line,
      author: first.author ? first.author.login : "?",
      body: (first.body || "").trim(),
      commentId: first.fullDatabaseId || null,
    };
  });
}

function filterThreads(threads, flags) {
  let out = threads;
  if (flags.unresolved) out = out.filter((t) => !t.resolved);
  if (flags.bots) out = out.filter((t) => isBot(t.author));
  else if (flags.author) out = out.filter((t) => t.author === flags.author);
  return out;
}

// ---- commands ---------------------------------------------------------------

function cmdThreads(flags) {
  const c = ctx(flags);
  const all = fetchThreads(c);
  const list = filterThreads(all, flags);
  // Cache the filtered list so `reply <idx>` / `resolve <idx>` resolve indices.
  fs.writeFileSync(cachePath(c), JSON.stringify(list), "utf8");

  if (flags.json) {
    console.log(JSON.stringify(list, null, 2));
    return;
  }
  const openCount = all.filter((t) => !t.resolved).length;
  console.log(`${c.owner}/${c.name} #${c.pr} — ${all.length} threads, ${openCount} unresolved` + (list.length !== all.length ? ` (showing ${list.length})` : ""));
  if (!list.length) {
    console.log("  (none match)");
    return;
  }
  list.forEach((t, i) => {
    const mark = t.resolved ? "\u2713" : "\u25cf"; // ✓ / ●
    const tags = [t.resolved ? "resolved" : "open", t.outdated ? "outdated" : null].filter(Boolean).join(",");
    const loc = t.path ? `${t.path}:${t.line ?? "?"}` : "(file-level)";
    const body = t.body.replace(/\s+/g, " ").slice(0, 160);
    console.log(`#${i + 1} ${mark} ${loc}  @${t.author} [${tags}]`);
    console.log(`     ${body}`);
  });
  console.log(`\nReply/resolve by number, e.g.  reply 1 "..." --resolve   |   resolve 2 3`);
}

function resolveTarget(target, c) {
  if (/^PRRT_/.test(target)) return { id: target };
  if (/^\d+$/.test(target)) {
    let cache;
    try {
      cache = JSON.parse(fs.readFileSync(cachePath(c), "utf8"));
    } catch {
      fail("no cached thread list — run `threads` first, or pass a PRRT_ id");
    }
    const item = cache[parseInt(target, 10) - 1];
    if (!item) fail(`index ${target} out of range (run \`threads\` again)`);
    return item;
  }
  fail(`unrecognised target "${target}" (use an index or a PRRT_ id)`);
}

function resolveThread(id) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = graphql(
        `mutation($t:ID!){resolveReviewThread(input:{threadId:$t}){thread{isResolved}}}`,
        { strings: { t: id } }
      );
      if (r.data.resolveReviewThread.thread.isResolved) return true;
    } catch {
      /* transient — retry */
    }
    if (attempt < 3) sleep(800);
  }
  return false;
}

function postReply(target, body, flags) {
  const c = ctx(flags);
  const item = resolveTarget(target, c);
  if (flags.comment || (item.commentId && flags["via-rest"])) {
    const cid = flags.comment || item.commentId;
    gh(["api", "-X", "POST", `repos/${c.owner}/${c.name}/pulls/${c.pr}/comments/${cid}/replies`, "-f", `body=${body}`]);
  } else {
    graphql(
      `mutation($t:ID!,$b:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$t,body:$b}){comment{url}}}`,
      { strings: { t: item.id, b: body } }
    );
  }
  console.log(`replied to ${item.id}`);
  if (flags.resolve) {
    const ok = resolveThread(item.id);
    console.log(ok ? `resolved ${item.id}` : `RESOLVE FAILED ${item.id}`);
  }
}

function cmdReply(positional, flags) {
  const target = positional[0];
  if (!target) fail("usage: reply <idx|threadId> <body> [--body-file F] [--resolve]");
  let body = positional.slice(1).join(" ");
  if (flags["body-file"]) body = fs.readFileSync(flags["body-file"], "utf8");
  if (!body.trim()) fail("empty body (pass text or --body-file)");
  postReply(target, body, flags);
}

function cmdResolve(positional, flags) {
  const c = ctx(flags);
  let targets = positional;
  if (flags.bots) {
    const list = filterThreads(fetchThreads(c), { unresolved: true, bots: true });
    if (!list.length) {
      console.log("no unresolved bot threads.");
      return;
    }
    targets = list.map((t) => t.id);
  }
  if (!targets.length) fail("usage: resolve <idx|threadId...>  |  resolve --bots");
  let ok = 0;
  for (const t of targets) {
    const item = resolveTarget(t, c);
    const done = resolveThread(item.id);
    console.log(done ? `resolved ${item.id}` : `RESOLVE FAILED ${item.id}`);
    if (done) ok++;
  }
  console.log(`\n${ok}/${targets.length} resolved.`);
}

function cmdSurfaces(flags) {
  const c = ctx(flags);
  const api = (p, jq) => gh(["api", "--paginate", `repos/${c.owner}/${c.name}/${p}`, "--jq", jq], { allowFail: true }).replace(/\s+$/, "");
  console.log(`=== ${c.owner}/${c.name} #${c.pr} review surfaces ===\n`);
  console.log("summary comments (author @ time):");
  console.log((api(`issues/${c.pr}/comments`, ".[] | \"  \" + .user.login + \" @ \" + .created_at") || "  (none)"));
  console.log("\nformal reviews (author [state]):");
  console.log((api(`pulls/${c.pr}/reviews`, ".[] | \"  \" + .user.login + \" [\" + .state + \"]\"") || "  (none)"));
  const inline = api(`pulls/${c.pr}/comments`, "length");
  console.log(`\ninline review comments: ${inline || 0}`);
  console.log("\nchecks:");
  console.log(gh(["pr", "checks", String(c.pr)], { allowFail: true }).trim() || "  (none)");
}

function checksSettled(c) {
  const out = gh(["pr", "checks", String(c.pr), "--json", "bucket,name,state"], { allowFail: true });
  let rows;
  try {
    rows = JSON.parse(out);
  } catch {
    return { settled: true, rows: [] }; // no checks configured
  }
  const pending = rows.filter((r) => r.bucket === "pending" || r.state === "IN_PROGRESS" || r.state === "QUEUED");
  return { settled: pending.length === 0, rows, pending };
}

function cmdWait(flags) {
  const c = ctx(flags);
  const timeout = parseInt(flags.timeout || "600", 10) * 1000;
  const start = Date.now();
  const startIso = new Date().toISOString();
  const interval = 15000;
  while (true) {
    const { settled, rows, pending } = checksSettled(c);
    let botDone = true;
    if (flags["for-bots"]) {
      const reviews = JSON.parse(
        gh(["api", `repos/${c.owner}/${c.name}/pulls/${c.pr}/reviews`, "--jq", "[.[] | {a:.user.login, t:.submitted_at}]"], { allowFail: true }) || "[]"
      );
      botDone = reviews.some((r) => isBot(r.a) && r.t && r.t > startIso);
    }
    const elapsed = Math.round((Date.now() - start) / 1000);
    process.stdout.write(`\r[${elapsed}s] checks ${settled ? "settled" : `${pending.length} pending`}${flags["for-bots"] ? `, bot review ${botDone ? "posted" : "waiting"}` : ""}   `);
    if (settled && botDone) {
      console.log("\n");
      const fails = rows.filter((r) => r.bucket === "fail");
      if (fails.length) {
        console.log(`checks failed: ${fails.map((r) => r.name).join(", ")}`);
        process.exit(1);
      }
      console.log("done.");
      return;
    }
    if (Date.now() - start > timeout) {
      console.log(`\ntimed out after ${flags.timeout || 600}s.`);
      process.exit(1);
    }
    sleep(interval);
  }
}

// ---- dispatch ---------------------------------------------------------------

const USAGE = `pr-review — CodeRabbit/Copilot triage over gh

Commands:
  threads   [--unresolved] [--bots | --author LOGIN] [--json]
              List review threads, numbered. Numbers are reused by reply/resolve.
  reply     <idx|threadId> <body> [--body-file F] [--comment CID] [--resolve]
              Reply to a thread (GraphQL). --resolve also resolves it.
  resolve   <idx|threadId...>  |  --bots
              Resolve threads (retries transient failures). --bots = all unresolved bot threads.
  surfaces    One-shot dashboard: summary comments, reviews, inline count, checks.
  wait      [--timeout SEC] [--for-bots]
              Block until CI checks settle (and, with --for-bots, a new bot review lands).

Context is auto-detected from the current branch's PR. Override with --repo owner/repo --pr N.`;

const [, , command, ...rest] = process.argv;
const { positional, flags } = parseArgs(rest);

switch (command) {
  case "threads":
    cmdThreads(flags);
    break;
  case "reply":
    cmdReply(positional, flags);
    break;
  case "resolve":
    cmdResolve(positional, flags);
    break;
  case "surfaces":
    cmdSurfaces(flags);
    break;
  case "wait":
    cmdWait(flags);
    break;
  case undefined:
  case "-h":
  case "--help":
  case "help":
    console.log(USAGE);
    break;
  default:
    console.error(`unknown command: ${command}\n`);
    console.log(USAGE);
    process.exit(1);
}
