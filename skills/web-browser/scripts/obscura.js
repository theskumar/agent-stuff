#!/usr/bin/env node

// Obscura backend for the web-browser skill.
//
// Use Obscura (headless Rust engine, built-in stealth) when NO login is
// required: fast, low-memory, anonymous scraping of public pages.
// Use Chrome (start.js --profile) when a page needs YOUR logged-in session,
// or when a site is behind a hard anti-bot (DataDome / Cloudflare Turnstile).
//
// This wrapper auto-installs the stealth build on first use and exposes a few
// convenience subcommands over the `obscura` CLI.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir, arch, platform } from "node:os";
import { join } from "node:path";

const DIR = join(homedir(), ".cache", "agent-web", "obscura");
const BIN = join(DIR, "obscura");
const RELEASE = "https://github.com/h4ckf0r0day/obscura/releases/latest/download";

// Signatures that mean "an anti-bot served a challenge instead of the page".
const CHALLENGE = [
  /captcha-delivery\.com/i, // DataDome
  /DataDome Device Check/i,
  /geo\.captcha-delivery/i,
  /Just a moment/i, // Cloudflare
  /cf-challenge|__cf_chl|challenge-platform/i,
  /Attention Required/i,
  /Checking your browser/i,
  /px-captcha|_px|PerimeterX/i,
  /verify you are (a )?human/i,
  /unusual traffic/i,
];

function assetName() {
  const a = arch() === "arm64" ? "aarch64" : "x86_64";
  const p = platform() === "darwin" ? "macos" : "linux";
  return `obscura-${a}-${p}-stealth.tar.gz`;
}

function install({ force = false } = {}) {
  if (existsSync(BIN) && !force) return;
  mkdirSync(DIR, { recursive: true });
  const asset = assetName();
  const url = `${RELEASE}/${asset}`;
  console.error(`[obscura] installing stealth build: ${asset}`);
  execFileSync("curl", ["-fL", "--retry", "3", "-o", join(DIR, asset), url], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  execFileSync("tar", ["xzf", join(DIR, asset), "-C", DIR], { stdio: "inherit" });
  execFileSync("rm", ["-f", join(DIR, asset)]);
  // macOS Gatekeeper: strip quarantine so the binary runs.
  if (platform() === "darwin") {
    try {
      execFileSync("xattr", ["-dr", "com.apple.quarantine", DIR], { stdio: "ignore" });
    } catch {}
  }
  const v = execFileSync(BIN, ["--version"]).toString().trim();
  console.error(`[obscura] ready: ${v}`);
}

function warnIfChallenged(text) {
  if (!text) return false;
  const hit = CHALLENGE.find((re) => re.test(text));
  if (hit) {
    console.error(
      "\n[obscura] ⚠ anti-bot challenge detected (%s).\n" +
        "          Obscura cannot pass this. Use Chrome with your session:\n" +
        "          ./start.js --profile   (stealth is default; a warmed profile carries the clearance cookie)\n",
      hit.source,
    );
    return true;
  }
  return false;
}

// Run obscura, capture stdout, scan for challenge pages, then print.
function runCaptured(args) {
  const r = spawnSync(BIN, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    process.stderr.write(r.stderr || "");
    process.exit(r.status || 1);
  }
  const out = r.stdout || "";
  warnIfChallenged(out || r.stderr);
  process.stdout.write(out);
}

// Run obscura with inherited stdio (long-running / writes files itself).
function runInherit(args) {
  const r = spawnSync(BIN, args, { stdio: "inherit" });
  process.exit(r.status || 0);
}

function usage() {
  console.log(`Usage: obscura.js <command> [args]

Anonymous, no-login scraping via the Obscura headless engine.

Commands:
  content <url> [flags]     Readable page text            (fetch --dump text)
  html <url> [flags]        Rendered HTML                 (fetch --dump html)
  links <url> [flags]       All links as JSON             (fetch --dump links)
  cookies <url> [flags]     Cookie jar as JSON            (fetch --dump cookies)
  eval <url> <js> [flags]   Run JS, print result          (fetch --eval)
  shot <url> [out.png]      Screenshot to file            (fetch --screenshot)
  check <url>               Report {title, blocked?}      (probe an anti-bot)
  scrape <url...> [flags]   Parallel multi-URL scrape     (scrape)
  serve [--port N]          Start CDP server (Puppeteer/Playwright client)
  install [--force]         (Re)install the stealth binary
  -- <raw obscura args>     Passthrough to the obscura CLI

Default flags added to fetch commands: --wait-until networkidle0 --timeout 30
Append your own flags to override (e.g. --timeout 60 --proxy socks5://...).

When to use what:
  no login needed          -> obscura.js (this)
  YOUR logged-in session   -> ./start.js --profile  + nav.js/eval.js/...
  hard anti-bot (Klook...) -> ./start.js --profile  (obscura hits the challenge)
`);
}

const [cmd, ...rest] = process.argv.slice(2);

if (!cmd || cmd === "-h" || cmd === "--help") {
  usage();
  process.exit(cmd ? 0 : 1);
}

if (cmd === "install") {
  install({ force: rest.includes("--force") });
  process.exit(0);
}

install();

const FETCH_DEFAULTS = ["--wait-until", "networkidle0", "--timeout", "30"];

switch (cmd) {
  case "content": {
    const [url, ...flags] = rest;
    if (!url) { usage(); break; }
    runCaptured(["fetch", url, ...FETCH_DEFAULTS, "--dump", "text", ...flags]);
    break;
  }
  case "html": {
    const [url, ...flags] = rest;
    if (!url) { usage(); break; }
    runCaptured(["fetch", url, ...FETCH_DEFAULTS, "--dump", "html", ...flags]);
    break;
  }
  case "links": {
    const [url, ...flags] = rest;
    if (!url) { usage(); break; }
    runCaptured(["fetch", url, ...FETCH_DEFAULTS, "--dump", "links", ...flags]);
    break;
  }
  case "cookies": {
    const [url, ...flags] = rest;
    if (!url) { usage(); break; }
    runCaptured(["fetch", url, ...FETCH_DEFAULTS, "--dump", "cookies", ...flags]);
    break;
  }
  case "eval": {
    const [url, js, ...flags] = rest;
    if (!url || !js) { usage(); break; }
    runCaptured(["fetch", url, ...FETCH_DEFAULTS, "--eval", js, ...flags]);
    break;
  }
  case "shot": {
    const [url, out = "obscura-shot.png", ...flags] = rest;
    if (!url) { usage(); break; }
    runInherit(["fetch", url, ...FETCH_DEFAULTS, "--screenshot", out, ...flags]);
    break;
  }
  case "check": {
    const [url] = rest;
    if (!url) { usage(); break; }
    const js =
      "JSON.stringify({title:document.title,bodyLen:document.body.innerText.length," +
      "html:document.documentElement.outerHTML.slice(0,600)})";
    const r = spawnSync(BIN, ["fetch", url, ...FETCH_DEFAULTS, "--eval", js], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    const line = (r.stdout || "").trim().split("\n").pop() || "{}";
    let info = {};
    try {
      info = JSON.parse(line);
    } catch {}
    const blocked = warnIfChallenged(info.html || r.stdout || "");
    console.log(
      JSON.stringify({ url, title: info.title ?? null, bodyLen: info.bodyLen ?? 0, blocked }),
    );
    break;
  }
  case "scrape": {
    if (!rest.length) { usage(); break; }
    runInherit(["scrape", ...rest]);
    break;
  }
  case "serve": {
    const args = ["serve"];
    if (!rest.includes("--port")) args.push("--port", "9222");
    args.push(...rest);
    console.error(
      "[obscura] CDP server up. Connect a PERSISTENT client (puppeteer-core / playwright-core).\n" +
        "          The skill's one-shot scripts do NOT work here: obscura drops tabs when a\n" +
        "          connection closes. For script-driven work use one-shot commands above.",
    );
    runInherit(args);
    break;
  }
  case "--": {
    runInherit(rest);
    break;
  }
  default:
    usage();
    process.exit(1);
}
