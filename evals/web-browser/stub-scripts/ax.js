#!/usr/bin/env node
// eval sandbox stub of web-browser/scripts/ax.js: there is no browser here.
const HELP = "Usage: ax.js state [--all] | click <id> | type <id> <text> [--enter] | select <id> <text> | settle   (actions accept --state)\n";
const LIST = null;
const a = process.argv.slice(2);
if (LIST && a.includes("--list")) { process.stdout.write(LIST); process.exit(0); }
if (HELP && (a.length === 0 || a.includes("--help") || a.includes("-h"))) { process.stdout.write(HELP); process.exit(a.length ? 0 : 1); }
console.error("✗ eval sandbox: no browser or network here, so ax.js did not run. Reply with the commands you would run instead.");
process.exit(1);
