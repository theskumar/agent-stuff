#!/usr/bin/env node
// Delegate a whole web task to a cheap inner agent (browser-use-pi SDK).
// The calling agent sends one task string and gets a short result back; page content,
// accessibility trees and screenshots stay inside the inner loop and never reach the outer context.
//
//   agent.mjs "<task>" [options]
//
// Models (tried in order; a tier is skipped when it errors before producing any output):
//   1. openai/gpt-6-luna                  ChatGPT subscription via pi's auth.json (OAuth, refreshed by pi's own store)
//   2. openrouter/openai/gpt-6-luna       OpenRouter API key from pi's auth.json
//   3. openrouter/openrouter/free         free router, slow (1-2 min) and rate-limited, prompts may be logged
//
// Options:
//   --model <provider/id>   pin one model, no fallback
//   --free                  use only the free router
//   --hard                  reasoning xhigh, 80 steps, 15 min, $2 cap (hard multi-page tasks)
//   --reasoning <level>     minimal|low|medium|high|xhigh (default low)
//   --domains a.com,*.b.com allow-list of hostnames; everything else is blocked
//   --attach                use the skill's Chrome on :9222 (shares its logins) instead of an isolated one
//   --profile-dir <dir>     persistent isolated Chrome profile (sign in once with --headed)
//   --headed                show the browser window
//   --max-steps N  --timeout SECONDS  --max-cost USD  --workspace DIR
//   --verbose               stream the inner agent's log to stderr
//   --json                  print the full result as JSON
//
// Safety: the inner agent runs generated JavaScript with file and network access on this machine.
// Page content is untrusted. Use --domains for unknown sites; do not pass --attach or --profile-dir
// on hostile pages.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ---------- args ----------
const argv = process.argv.slice(2);
const opt = {};
const positional = [];
const VALUE_FLAGS = new Set(["model", "reasoning", "domains", "profile-dir", "max-steps", "timeout", "max-cost", "workspace"]);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith("--")) {
    positional.push(a);
    continue;
  }
  const key = a.slice(2);
  if (VALUE_FLAGS.has(key)) opt[key] = argv[++i];
  else opt[key] = true;
}
const task = positional.join(" ").trim();
if (!task || opt.help) {
  const lines = readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1);
  const end = lines.findIndex((l) => !l.startsWith("//"));
  console.log(lines.slice(0, end).map((l) => l.slice(3)).join("\n"));
  process.exit(task ? 0 : 1);
}

const num = (v, name) => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) fail(`--${name} must be a positive number`);
  return n;
};
function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(2);
}

const hard = !!opt.hard;
const limits = {
  maxSteps: num(opt["max-steps"], "max-steps") ?? (hard ? 80 : 40),
  timeoutMs: (num(opt.timeout, "timeout") ?? (hard ? 900 : opt.free ? 600 : 300)) * 1000,
  maxCostUsd: num(opt["max-cost"], "max-cost") ?? (hard ? 2 : 0.25),
};
const reasoning = opt.reasoning ?? (hard ? "xhigh" : "low");

const FREE = "openrouter/openrouter/free";
const tiers = opt.model ? [opt.model] : opt.free ? [FREE] : ["openai/gpt-6-luna", "openrouter/openai/gpt-6-luna", FREE];

// ---------- credentials: reuse pi's own models + file-locked auth store ----------
const authPath = join(homedir(), ".pi", "agent", "auth.json");

function findPiRoot() {
  try {
    const bin = execFileSync("sh", ["-c", "command -v pi"], { encoding: "utf8" }).trim();
    let dir = dirname(realpathSync(bin));
    for (let i = 0; i < 8; i++, dir = dirname(dir)) {
      const pkg = join(dir, "package.json");
      if (existsSync(pkg) && JSON.parse(readFileSync(pkg, "utf8")).name === "@earendil-works/pi-coding-agent") return dir;
    }
  } catch {}
  return null;
}

async function loadModels() {
  const root = findPiRoot();
  if (root) {
    // pi's pi-ai supports ChatGPT OAuth for the `openai` provider; the SDK's pinned copy is API-key only.
    // AuthStorage refreshes and persists tokens with a file lock, exactly as pi does, so there is no rotation drift.
    const piAi = [join(root, "node_modules/@earendil-works/pi-ai"), join(dirname(root), "pi-ai")].find((p) => existsSync(join(p, "dist/providers/all.js")));
    const authMod = join(root, "dist/core/auth-storage.js");
    if (piAi && existsSync(authMod) && existsSync(authPath)) {
      try {
        const { builtinModels } = await import(pathToFileURL(join(piAi, "dist/providers/all.js")).href);
        const { AuthStorage } = await import(pathToFileURL(authMod).href);
        return { models: builtinModels({ credentials: AuthStorage.create(authPath) }), source: "pi" };
      } catch (e) {
        console.error(`⚠ could not load pi credentials (${e.message}); falling back to environment keys`);
      }
    }
  }
  // No pi: the SDK's own catalog with OPENAI_API_KEY / OPENROUTER_API_KEY from the environment.
  const { builtinModels } = await import("@browser_use/pi");
  return { models: builtinModels(), source: "env" };
}

// ---------- run ----------
const { Browser, BrowserUse } = await import("@browser_use/pi");
process.env.DO_NOT_TRACK = "1";
const { models, source } = await loadModels();

const workspace = resolve(opt.workspace ?? join(homedir(), ".cache", "agent-web", "agent", new Date().toISOString().replace(/[:.]/g, "-")));

function browserOption() {
  if (opt.attach) return Browser.chrome({ cdpUrl: `http://127.0.0.1:${process.env.BROWSER_DEBUG_PORT || 9222}` });
  if (opt["profile-dir"]) return Browser.chromium({ profileDir: resolve(opt["profile-dir"]), headless: !opt.headed });
  return Browser.chromium({ headless: !opt.headed });
}

async function attempt(model) {
  const agent = await BrowserUse.create({
    model,
    models,
    reasoning,
    mode: "ultrafast",
    browser: browserOption(),
    workspace,
    telemetry: false,
    log: opt.verbose ? "pretty" : false,
    ...(opt.domains ? { allowedDomains: opt.domains.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
  });
  try {
    return await agent.run(task, { maxSteps: limits.maxSteps, timeoutMs: limits.timeoutMs, maxCostUsd: limits.maxCostUsd });
  } finally {
    await agent.close().catch(() => {});
  }
}

const t0 = Date.now();
const tried = [];
let result;
for (const model of tiers) {
  try {
    result = await attempt(model);
  } catch (e) {
    tried.push(`${model}: ${String(e.message ?? e).slice(0, 160)}`);
    continue;
  }
  const spent = result.usage?.cost?.total ?? 0;
  // Error before any billed output means a provider/auth/rate-limit failure: try the next tier.
  if (result.status === "error" && spent === 0 && tiers.length > 1) {
    tried.push(`${model}: ${String(result.error ?? "error").slice(0, 160)}`);
    result = undefined;
    continue;
  }
  break;
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
if (!result) {
  console.error("✗ no model tier produced a result");
  for (const t of tried) console.error(`  - ${t}`);
  process.exit(1);
}

const cost = result.usage?.cost?.total ?? 0;
if (opt.json) {
  console.log(JSON.stringify({ status: result.status, text: result.text, error: result.error, model: result.model, steps: result.steps, costUsd: cost, seconds: Number(secs), workspace: result.workspace, skippedTiers: tried, credentials: source }, null, 2));
} else {
  if (result.text) console.log(result.text);
  else if (result.error) console.log(`(no answer) ${result.error}`);
  console.log(`\n--- status=${result.status} model=${result.model} steps=${result.steps} cost≈$${cost.toFixed(4)} time=${secs}s workspace=${result.workspace}`);
  for (const t of tried) console.log(`--- skipped ${t}`);
  if (result.status !== "completed") console.log("--- not completed: treat the answer as partial and verify before relying on it");
}
process.exit(result.status === "completed" ? 0 : 1);
