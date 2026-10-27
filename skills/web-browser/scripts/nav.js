#!/usr/bin/env node

import { connect, takeTabArg } from "./cdp.js";
import { applyActiveEmulation } from "./emulation-state.js";
import { applyStealthPatches } from "./stealth.js";

const DEBUG = process.env.DEBUG === "1";
const log = DEBUG ? (...args) => console.error("[debug]", ...args) : () => {};

function printUsage() {
  console.log("Usage: nav.js <url> [--new | --tab <url-substring>]");
  console.log("\nExamples:");
  console.log("  nav.js https://example.com                 # Navigate the last tab");
  console.log("  nav.js https://example.com --new           # Open in a new tab");
  console.log("  nav.js https://example.com --tab github.com # Navigate the tab whose URL contains github.com");
}

let tabMatch, args;
try {
  ({ tab: tabMatch, args } = takeTabArg(process.argv.slice(2)));
} catch (e) {
  console.error("✗", e.message);
  process.exit(1);
}
if (args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(0);
}
const newTab = args.includes("--new");
const unknown = args.filter((a) => a.startsWith("--") && a !== "--new");
const [url, ...extra] = args.filter((a) => !a.startsWith("--"));

if (unknown.length || extra.length) {
  console.error(`✗ Unknown argument(s): ${[...unknown, ...extra].join(" ")}`);
  printUsage();
  process.exit(1);
}
if (newTab && tabMatch) {
  console.error("✗ Pass --new or --tab, not both");
  process.exit(1);
}
if (!url) {
  printUsage();
  process.exit(1);
}

// Global timeout
const globalTimeout = setTimeout(() => {
  console.error("✗ Global timeout exceeded (45s)");
  process.exit(1);
}, 45000);

try {
  log("connecting...");
  const cdp = await connect(5000);

  log("getting pages...");
  let targetId;

  if (newTab) {
    log("creating new tab...");
    const { targetId: newTargetId } = await cdp.send("Target.createTarget", {
      url: "about:blank",
    });
    targetId = newTargetId;
  } else {
    const page = await cdp.pickPage(tabMatch);
    targetId = page.targetId;
  }

  log("attaching to page...");
  const sessionId = await cdp.attachToPage(targetId);

  log("applying active emulation (if configured)...");
  const activeEmulation = await applyActiveEmulation(cdp, sessionId);

  log("applying stealth patches (if configured)...");
  await applyStealthPatches(cdp, sessionId);

  log("navigating...");
  await cdp.navigate(sessionId, url);

  console.log(newTab ? "✓ Opened:" : "✓ Navigated to:", url);
  if (activeEmulation) {
    console.log(
      `  emulation: ${activeEmulation.preset.id}${activeEmulation.landscape ? " (landscape)" : ""}`,
    );
  }

  log("closing...");
  cdp.close();
  log("done");
} catch (e) {
  console.error("✗", e.message);
  process.exit(1);
} finally {
  clearTimeout(globalTimeout);
  setTimeout(() => process.exit(0), 100);
}
