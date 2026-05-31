#!/usr/bin/env node

import { connect } from "./cdp.js";
import { applyActiveEmulation } from "./emulation-state.js";
import { applyStealthPatches } from "./stealth.js";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const DEBUG = process.env.DEBUG === "1";
const log = DEBUG ? (...args) => console.error("[debug]", ...args) : () => {};

const url = process.argv[2];
if (!url) {
  console.log("Usage: content.js <url>");
  console.log("\nExtract readable content from a page as markdown.");
  process.exit(1);
}

const globalTimeout = setTimeout(() => {
  console.error("✗ Global timeout exceeded (60s)");
  process.exit(1);
}, 60000);

try {
  log("connecting...");
  const cdp = await connect(5000);

  log("getting pages...");
  const pages = await cdp.getPages();
  const page = pages.at(-1);

  if (!page) {
    console.error("✗ No active tab found");
    process.exit(1);
  }

  log("attaching to page...");
  const sessionId = await cdp.attachToPage(page.targetId);

  log("applying active emulation (if configured)...");
  await applyActiveEmulation(cdp, sessionId);

  log("applying stealth patches (if configured)...");
  await applyStealthPatches(cdp, sessionId);

  log("navigating...");
  await cdp.navigate(sessionId, url);

  log("waiting for page load...");
  await new Promise((r) => setTimeout(r, 3000));

  log("extracting HTML...");
  const html = await cdp.evaluate(
    sessionId,
    "document.documentElement.outerHTML",
    30000
  );

  log("closing cdp...");
  cdp.close();

  log("parsing with readability...");
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  td.use(gfm);

  if (article) {
    if (article.title) console.log(`# ${article.title}\n`);
    if (article.byline) console.log(`*${article.byline}*\n`);
    if (article.excerpt) console.log(`> ${article.excerpt}\n`);
    console.log(td.turndown(article.content));
  } else {
    log("readability failed, falling back to body text...");
    const title = dom.window.document.title;
    if (title) console.log(`# ${title}\n`);
    const body = dom.window.document.body;
    if (body) {
      console.log(td.turndown(body.innerHTML));
    }
  }

  log("done");
} catch (e) {
  console.error("✗", e.message);
  process.exit(1);
} finally {
  clearTimeout(globalTimeout);
  setTimeout(() => process.exit(0), 100);
}
