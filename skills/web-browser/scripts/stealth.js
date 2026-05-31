import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STATE_FILE = join(
  process.env["HOME"] || homedir(),
  ".cache",
  "agent-web",
  "browser",
  "state.json"
);

export function isStealthMode() {
  if (!existsSync(STATE_FILE)) return false;
  try {
    const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    return state?.stealth === true;
  } catch {
    return false;
  }
}

const STEALTH_PATCHES = `
Object.defineProperty(navigator, 'webdriver', { get: () => false });

Object.defineProperty(navigator, 'plugins', {
  get: () => [1, 2, 3, 4, 5],
});

Object.defineProperty(navigator, 'languages', {
  get: () => ['en-US', 'en'],
});

window.chrome = { runtime: {}, loadTimes: function() {}, csi: function() {} };

const originalQuery = window.navigator.permissions.query;
window.navigator.permissions.query = (parameters) =>
  parameters.name === 'notifications'
    ? Promise.resolve({ state: Notification.permission })
    : originalQuery(parameters);
`;

export async function applyStealthPatches(cdp, sessionId) {
  if (!isStealthMode()) return;
  await cdp.send(
    "Page.addScriptToEvaluateOnNewDocument",
    { source: STEALTH_PATCHES },
    sessionId
  );
}
