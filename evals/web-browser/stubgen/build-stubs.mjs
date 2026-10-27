#!/usr/bin/env node
// Writes eval-sandbox stubs of the web-browser scripts into <dest>.
// A stub prints the real script's usage for help-style calls and refuses everything else,
// so no eval session can launch Chrome, copy the real profile, or reach a live CDP port.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dest = process.argv[2];
if (!dest) throw new Error("usage: build-stubs.mjs <dest-scripts-dir>");
mkdirSync(dest, { recursive: true });
const help = (n) => readFileSync(join(here, "help", `${n}.txt`), "utf8");
const code = (n) => Number(readFileSync(join(here, "help", `${n}.code`), "utf8").trim());
const tools = ["start.js", "nav.js", "eval.js", "ax.js", "pick.js", "content.js", "screenshot.js", "emulate.js", "obscura.js", "agent.mjs", "dismiss-cookies.js", "watch.js", "logs-tail.js", "net-summary.js"];
for (const n of tools) {
  let h = null, c = 0;
  try { h = help(n); c = code(n); } catch {}
  const list = n === "emulate.js" ? help("emulate.list") : null;
  const src = `#!/usr/bin/env node
// eval sandbox stub of web-browser/scripts/${n}: there is no browser here.
const HELP = ${JSON.stringify(h)};
const LIST = ${JSON.stringify(list)};
const a = process.argv.slice(2);
if (LIST && a.includes("--list")) { process.stdout.write(LIST); process.exit(0); }
if (HELP && (a.length === 0 || a.includes("--help") || a.includes("-h"))) { process.stdout.write(HELP); process.exit(a.length ? ${c === 1 && n === "start.js" ? 1 : 0} : ${c}); }
console.error("✗ eval sandbox: no browser or network here, so ${n} did not run. Reply with the commands you would run instead.");
process.exit(1);
`;
  writeFileSync(join(dest, n), src);
  chmodSync(join(dest, n), 0o755);
}
for (const lib of ["cdp.js", "devices.js", "emulation-state.js", "stealth.js"])
  writeFileSync(join(dest, lib), `throw new Error("eval sandbox: ${lib} is not available");\n`);
writeFileSync(join(dest, "package.json"), readFileSync(join(here, "..", "..", "sk", "before", "web-browser", "scripts", "package.json")));
