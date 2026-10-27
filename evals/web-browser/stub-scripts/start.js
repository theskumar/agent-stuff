#!/usr/bin/env node
// eval sandbox stub of web-browser/scripts/start.js: there is no browser here.
const HELP = "✗ Unknown option(s): --help\nUsage: start.js [--profile] [--chrome-profile <name>] [--reset-profile] [--no-stealth] [--list-profiles]\n\nOptions:\n  --profile           Copy your Chrome profile (logins/cookies) into an isolated cache\n  --chrome-profile <n> Which source Chrome profile dir to copy (default: Default)\n  --list-profiles     List your Chrome profiles (dir → display name) and exit\n  --reset-profile     Clear the cached copy before launch (forces a fresh copy)\n  --no-stealth        Opt out of stealth (adds the automation banner; alias --automation)\n  --stealth           Accepted, no-op (stealth is the default)\n\nExamples:\n  start.js\n  start.js --profile\n  start.js --list-profiles\n  start.js --profile --chrome-profile 'Profile 1'\n  start.js --no-stealth\n";
const LIST = null;
const a = process.argv.slice(2);
if (LIST && a.includes("--list")) { process.stdout.write(LIST); process.exit(0); }
if (HELP && (a.length === 0 || a.includes("--help") || a.includes("-h"))) { process.stdout.write(HELP); process.exit(a.length ? 1 : 1); }
console.error("✗ eval sandbox: no browser or network here, so start.js did not run. Reply with the commands you would run instead.");
process.exit(1);
