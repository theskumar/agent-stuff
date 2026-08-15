#!/usr/bin/env node

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEBUG_HOST = process.env.BROWSER_DEBUG_HOST || "localhost";
const DEBUG_PORT = Number(process.env.BROWSER_DEBUG_PORT || 9222);

if (!Number.isInteger(DEBUG_PORT) || DEBUG_PORT < 1 || DEBUG_PORT > 65535) {
  console.error("✗ Invalid BROWSER_DEBUG_PORT (expected 1-65535)");
  process.exit(1);
}

const argv = process.argv.slice(2);
const flags = new Set();
let chromeProfile = "Default";
let listProfiles = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--chrome-profile") {
    chromeProfile = argv[++i];
    if (!chromeProfile) {
      console.error("✗ --chrome-profile needs a value (e.g. --chrome-profile 'Profile 1')");
      process.exit(1);
    }
  } else if (a === "--list-profiles") {
    listProfiles = true;
  } else {
    flags.add(a);
  }
}
const useProfile = flags.has("--profile");
const resetProfile = flags.has("--reset-profile");
// Stealth is the default. Opt out with --no-stealth (alias --automation) to get
// the old automation banner + navigator.webdriver=true behavior.
const stealth = !(flags.has("--no-stealth") || flags.has("--automation"));

function printUsage() {
  console.log(
    "Usage: start.js [--profile] [--chrome-profile <name>] [--reset-profile] [--no-stealth] [--list-profiles]",
  );
  console.log("\nOptions:");
  console.log("  --profile           Copy your Chrome profile (logins/cookies) into an isolated cache");
  console.log("  --chrome-profile <n> Which source Chrome profile dir to copy (default: Default)");
  console.log("  --list-profiles     List your Chrome profiles (dir → display name) and exit");
  console.log("  --reset-profile     Clear the cached copy before launch (forces a fresh copy)");
  console.log("  --no-stealth        Opt out of stealth (adds the automation banner; alias --automation)");
  console.log("  --stealth           Accepted, no-op (stealth is the default)");
  console.log("\nExamples:");
  console.log("  start.js");
  console.log("  start.js --profile");
  console.log("  start.js --list-profiles");
  console.log("  start.js --profile --chrome-profile 'Profile 1'");
  console.log("  start.js --no-stealth");
}

const KNOWN_FLAGS = new Set([
  "--profile",
  "--reset-profile",
  "--stealth",
  "--no-stealth",
  "--automation",
]);
const unknownArgs = [...flags].filter((a) => !KNOWN_FLAGS.has(a));
if (unknownArgs.length > 0) {
  console.error(`✗ Unknown option(s): ${unknownArgs.join(" ")}`);
  printUsage();
  process.exit(1);
}

const HOME = process.env["HOME"] || homedir();
const CACHE_ROOT = join(HOME, ".cache", "agent-web");
const SOURCE_CHROME_DIR = join(HOME, "Library", "Application Support", "Google", "Chrome");
const BROWSER_ROOT = join(CACHE_ROOT, "browser");
const FRESH_PROFILE_DIR = join(BROWSER_ROOT, "fresh-profile");
const PROFILE_COPY_DIR = join(BROWSER_ROOT, "profile-copy");
const STATE_FILE = join(BROWSER_ROOT, "state.json");

const mode = useProfile ? "profile-copy" : "fresh";
const userDataDir = useProfile ? PROFILE_COPY_DIR : FRESH_PROFILE_DIR;

function ensureDir(path) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function isProcessAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readState() {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeState(state) {
  ensureDir(BROWSER_ROOT);
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function clearState() {
  try {
    rmSync(STATE_FILE, { force: true });
  } catch {
    // ignore
  }
}

// Read source Chrome profiles from Local State (dir → human name).
function listChromeProfiles() {
  try {
    const j = JSON.parse(readFileSync(join(SOURCE_CHROME_DIR, "Local State"), "utf8"));
    const cache = j.profile?.info_cache || {};
    return Object.entries(cache).map(([dir, info]) => ({ dir, name: info?.name || dir }));
  } catch {
    return [];
  }
}

// Is the user's real Chrome running? (our isolated instance carries BROWSER_ROOT in argv)
function isSourceChromeRunning() {
  try {
    const out = execSync(
      `pgrep -fl "Google Chrome.app/Contents/MacOS/Google Chrome" 2>/dev/null || true`,
      { encoding: "utf8" },
    );
    return out.split("\n").some((line) => line.trim() && !line.includes(BROWSER_ROOT));
  } catch {
    return false;
  }
}

async function isDebugEndpointUp() {
  try {
    const response = await fetch(
      `http://${DEBUG_HOST}:${DEBUG_PORT}/json/version`,
    );
    return response.ok;
  } catch {
    return false;
  }
}

function resolveChromeBinary() {
  if (process.env.BROWSER_BIN && existsSync(process.env.BROWSER_BIN)) {
    return process.env.BROWSER_BIN;
  }

  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  ];

  return candidates.find((path) => existsSync(path)) || null;
}

ensureDir(BROWSER_ROOT);

if (listProfiles) {
  const profiles = listChromeProfiles();
  if (!profiles.length) {
    console.error(`✗ No Chrome profiles found at ${SOURCE_CHROME_DIR}`);
    process.exit(1);
  }
  console.log("Available Chrome profiles (use --chrome-profile <dir>):");
  for (const p of profiles) {
    console.log(`  ${p.dir.padEnd(12)} →  ${p.name}`);
  }
  process.exit(0);
}

if (resetProfile) {
  rmSync(userDataDir, { recursive: true, force: true });
}

const state = readState();
if (state?.pid && !isProcessAlive(state.pid)) {
  clearState();
}

if (await isDebugEndpointUp()) {
  const runningState = readState();

  if (
    runningState?.pid &&
    isProcessAlive(runningState.pid) &&
    runningState.port === DEBUG_PORT
  ) {
    if (
      runningState.mode === mode &&
      runningState.userDataDir === userDataDir &&
      (!useProfile || runningState.chromeProfile === chromeProfile)
    ) {
      console.log(
        `✓ Chrome already running on :${DEBUG_PORT} (reusing ${mode} profile)`,
      );
      process.exit(0);
    }

    console.error(
      `✗ Chrome already running on :${DEBUG_PORT} in ${runningState.mode} mode`,
    );
    console.error("  Close it first before switching browser profile modes.");
    process.exit(1);
  }

  console.error(`✗ Debugging endpoint :${DEBUG_PORT} is already in use`);
  console.error(
    "  Refusing to reuse unknown instance to avoid attaching to your regular profile.",
  );
  console.error(
    `  Close the process using :${DEBUG_PORT} or set BROWSER_DEBUG_PORT to a different port.`,
  );
  process.exit(1);
}

ensureDir(userDataDir);

if (useProfile) {
  if (!existsSync(SOURCE_CHROME_DIR)) {
    console.error("✗ Could not find your local Chrome profile directory");
    console.error(`  Expected: ${SOURCE_CHROME_DIR}`);
    process.exit(1);
  }

  const srcProfileDir = join(SOURCE_CHROME_DIR, chromeProfile);
  if (!existsSync(srcProfileDir)) {
    console.error(`✗ Chrome profile "${chromeProfile}" not found in ${SOURCE_CHROME_DIR}`);
    const profiles = listChromeProfiles();
    if (profiles.length) {
      console.error("  Available profiles (pass --chrome-profile <dir>):");
      for (const p of profiles) {
        console.error(`    ${p.dir.padEnd(12)} →  ${p.name}`);
      }
    }
    process.exit(1);
  }

  if (isSourceChromeRunning()) {
    console.error(
      "⚠ Your Chrome is running — recently added logins may not be flushed to disk yet.",
    );
    console.error(
      "  For the freshest session, quit Chrome then re-run. Copying current on-disk state anyway…",
    );
  }

  const destDefault = join(userDataDir, "Default");
  ensureDir(destDefault);

  // Drop stale files left by older copies. rsync --delete PROTECTS excluded files
  // from deletion, so a previously-copied Preferences/Secure Preferences/Local
  // State would survive and keep firing the "Something went wrong" dialog.
  // --delete-excluded (below) clears Default/; remove these explicitly too.
  rmSync(join(userDataDir, "Local State"), { force: true });
  rmSync(join(destDefault, "Preferences"), { force: true });
  rmSync(join(destDefault, "Secure Preferences"), { force: true });

  // Copy ONLY login/session-relevant paths, incrementally. Chrome ≥ M96 stores
  // cookies under Network/Cookies, so the whole Network/ dir is included.
  //
  // Deliberately NOT copied: Preferences / Secure Preferences / Local State.
  // Chrome HMAC-validates Preferences against a profile-path-bound seed; copying
  // it into a different profile path triggers the "Something went wrong when
  // opening your profile" dialog. Logins do not need it. On macOS cookies decrypt
  // via the Keychain "Chrome Safe Storage" key, so Local State is unnecessary too.
  const includeRules = [
    "Cookies",
    "Cookies-journal",
    "Login Data",
    "Login Data-journal",
    "Web Data",
    "Web Data-journal",
    "Network/***",
    "Local Storage/***",
    "Session Storage/***",
    "IndexedDB/***",
  ]
    .map((p) => `--include='${p}'`)
    .join(" ");

  execSync(
    `rsync -a --delete --delete-excluded ${includeRules} --exclude='*' "${srcProfileDir}/" "${destDefault}/"`,
    { stdio: "pipe" },
  );
}

for (const staleFile of [
  "SingletonCookie",
  "SingletonLock",
  "SingletonSocket",
  "DevToolsActivePort",
  "DevToolsActivePort.lock",
]) {
  try {
    rmSync(join(userDataDir, staleFile), { force: true });
  } catch {
    // ignore
  }
}

const chromeBinary = resolveChromeBinary();

if (!chromeBinary) {
  console.error("✗ Could not find Chrome/Chromium binary");
  console.error("  Set BROWSER_BIN=/path/to/chrome and retry");
  process.exit(1);
}

const chromeArgs = [
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${userDataDir}`,
  "--profile-directory=Default",
  "--disable-search-engine-choice-screen",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-features=ProfilePicker",
];

if (!stealth) {
  chromeArgs.push("--enable-automation");
}

// Stealth: simply omit --enable-automation. That alone keeps navigator.webdriver
// false, and stealth.js re-asserts it via a CDP patch on every navigation.
// We deliberately do NOT add --disable-blink-features=AutomationControlled: it is
// redundant here and triggers Chrome's "unsupported command-line flag" warning bar.

const chromeProc = spawn(chromeBinary, chromeArgs, {
  detached: true,
  stdio: "ignore",
});
chromeProc.unref();

let connected = false;
for (let i = 0; i < 30; i++) {
  if (await isDebugEndpointUp()) {
    connected = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 500));
}

if (!connected) {
  console.error(`✗ Failed to connect to Chrome on :${DEBUG_PORT}`);
  console.error(`  Attempted binary: ${chromeBinary}`);
  process.exit(1);
}

writeState({
  pid: chromeProc.pid,
  mode,
  stealth,
  chromeProfile: useProfile ? chromeProfile : null,
  userDataDir,
  port: DEBUG_PORT,
  startedAt: new Date().toISOString(),
});

const scriptDir = dirname(fileURLToPath(import.meta.url));
const watcherPath = join(scriptDir, "watch.js");
spawn(process.execPath, [watcherPath], { detached: true, stdio: "ignore" }).unref();

console.log(
  `✓ Chrome started on :${DEBUG_PORT} with ${useProfile ? "profile-copy" : "fresh"} profile`,
);
if (useProfile) {
  console.log(`  copied from Chrome profile: ${chromeProfile}`);
}
console.log(`  profile dir: ${userDataDir}`);
