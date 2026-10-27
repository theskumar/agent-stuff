#!/usr/bin/env node
// eval sandbox stub of web-browser/scripts/emulate.js: there is no browser here.
const HELP = "Usage: emulate.js <device> [--landscape]\n       emulate.js --reset\n       emulate.js --list\n\nExamples:\n  emulate.js --list\n  emulate.js iphone-14\n  emulate.js pixel-7 --landscape\n  emulate.js --reset\n";
const LIST = "iphone-se    375x667 @2x (iPhone SE)\niphone-14    390x844 @3x (iPhone 14)\npixel-7      412x915 @2.625x (Pixel 7)\ngalaxy-s20   360x800 @3x (Galaxy S20)\n";
const a = process.argv.slice(2);
if (LIST && a.includes("--list")) { process.stdout.write(LIST); process.exit(0); }
if (HELP && (a.length === 0 || a.includes("--help") || a.includes("-h"))) { process.stdout.write(HELP); process.exit(a.length ? 0 : 1); }
console.error("✗ eval sandbox: no browser or network here, so emulate.js did not run. Reply with the commands you would run instead.");
process.exit(1);
