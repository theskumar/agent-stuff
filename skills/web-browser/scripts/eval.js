#!/usr/bin/env node

import { connect, takeTabArg } from "./cdp.js";
import { applyActiveEmulation } from "./emulation-state.js";

const DEBUG = process.env.DEBUG === "1";
const log = DEBUG ? (...args) => console.error("[debug]", ...args) : () => {};

function isSyntaxError(error) {
  return error?.message?.startsWith("SyntaxError");
}

let tabMatch, args;
try {
  ({ tab: tabMatch, args } = takeTabArg(process.argv.slice(2)));
} catch (e) {
  console.error("✗", e.message);
  process.exit(1);
}
const code = args.join(" ");
const help = code === "--help" || code === "-h";
if (!code || help) {
  console.log("Usage: eval.js 'code' [--tab <url-substring>]");
  console.log("\nExamples:");
  console.log('  eval.js "document.title"');
  console.log("  eval.js \"document.querySelectorAll('a').length\"");
  console.log("  eval.js 'document.querySelector(\"button\")?.click(); \"clicked\"'");
  process.exit(help ? 0 : 1);
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
  const page = await cdp.pickPage(tabMatch);

  log("attaching to page...");
  const sessionId = await cdp.attachToPage(page.targetId);

  log("applying active emulation (if configured)...");
  await applyActiveEmulation(cdp, sessionId);

  log("evaluating...");
  let result;
  try {
    const expression = `(async () => { return (${code}); })()`;
    result = await cdp.evaluate(sessionId, expression);
  } catch (e) {
    if (!isSyntaxError(e)) throw e;
    log("falling back to console-style statement evaluation...");
    result = await cdp.evaluateRepl(sessionId, code);
  }

  log("formatting result...");
  if (Array.isArray(result)) {
    for (let i = 0; i < result.length; i++) {
      if (i > 0) console.log("");
      for (const [key, value] of Object.entries(result[i])) {
        console.log(`${key}: ${value}`);
      }
    }
  } else if (typeof result === "object" && result !== null) {
    for (const [key, value] of Object.entries(result)) {
      console.log(`${key}: ${value}`);
    }
  } else {
    console.log(result);
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
