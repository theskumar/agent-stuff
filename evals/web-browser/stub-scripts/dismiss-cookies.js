#!/usr/bin/env node
// eval sandbox stub of web-browser/scripts/dismiss-cookies.js: there is no browser here.
const HELP = "/**\nCookie Consent Dismissal Helper\n\nAutomatically accepts cookie consent dialogs on EU websites.\nSupports common CMPs: OneTrust, Cookiebot, Didomi, Quantcast, Google, BBC, Amazon, etc.\n\nUsage:\n  ./dismiss-cookies.js          # Accept cookies\n  ./dismiss-cookies.js --reject # Reject cookies (where possible)\n/\n";
const LIST = null;
const a = process.argv.slice(2);
if (LIST && a.includes("--list")) { process.stdout.write(LIST); process.exit(0); }
if (HELP && (a.length === 0 || a.includes("--help") || a.includes("-h"))) { process.stdout.write(HELP); process.exit(a.length ? 0 : 0); }
console.error("✗ eval sandbox: no browser or network here, so dismiss-cookies.js did not run. Reply with the commands you would run instead.");
process.exit(1);
