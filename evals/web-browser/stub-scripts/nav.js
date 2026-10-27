#!/usr/bin/env node
// eval sandbox stub of web-browser/scripts/nav.js: there is no browser here.
const HELP = "Usage: nav.js <url> [--new]\n\nExamples:\n  nav.js https://example.com       # Navigate current tab\n  nav.js https://example.com --new # Open in new tab\n";
const LIST = null;
const a = process.argv.slice(2);
if (LIST && a.includes("--list")) { process.stdout.write(LIST); process.exit(0); }
if (HELP && (a.length === 0 || a.includes("--help") || a.includes("-h"))) { process.stdout.write(HELP); process.exit(a.length ? 0 : 1); }
console.error("✗ eval sandbox: no browser or network here, so nav.js did not run. Reply with the commands you would run instead.");
process.exit(1);
