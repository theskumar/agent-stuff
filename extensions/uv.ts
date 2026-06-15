/**
 * UV Extension
 *
 * What it is:
 *   Redirects classic Python tooling to `uv` equivalents inside pi. Wraps
 *   the built-in `bash` tool so a small `intercepted-commands/` directory is
 *   prepended to `$PATH`. Shim scripts there intercept `pip`, `pip3`,
 *   `poetry`, `python`, and `python3` and either block them with a helpful
 *   error message or rewrite them as `uv run …`.
 *
 *   Because PATH shims can be bypassed via explicit interpreter paths
 *   (`.venv/bin/python`), the extension also blocks disallowed invocations
 *   at bash spawn time so the agent can't sidestep the policy.
 *
 *   Requires `uv` to be installed.
 *
 * Use cases:
 *   - Steering agents toward the project's `uv`-managed environment in
 *     Python repos that have standardized on uv.
 *   - Preventing accidental `pip install` / `poetry add` invocations that
 *     would mutate the wrong environment.
 *   - Educating the agent on the correct uv idiom by surfacing the
 *     equivalent command in the error message.
 *
 * Common usage patterns:
 *   - Install and forget; replacements happen transparently when bash runs.
 *   - The agent learns from the shim's error message and retries with the
 *     suggested `uv` form, e.g.:
 *       `pip install requests`     → suggests `uv add requests` or `uv run --with requests …`.
 *       `python script.py`         → rewritten to `uv run python script.py`.
 *       `python -m venv .venv`     → blocked; pointer to `uv venv`.
 *       `poetry add foo`           → blocked; pointer to `uv add foo`.
 *
 * Intercepted commands:
 * - pip/pip3: Blocked with suggestions to use `uv add` or `uv run --with`
 * - poetry: Blocked with uv equivalents (uv init, uv add, uv sync, uv run)
 * - python/python3: Redirected through `uv run` to a real interpreter path,
 *   with special handling to block `python -m pip`, `python -m venv`, and
 *   `python -m py_compile`
 *
 * The shim scripts are located in the intercepted-commands directory and
 * provide helpful error messages with the equivalent uv commands.
 *
 * Note: PATH shims are bypassable via explicit interpreter paths
 * (for example `.venv/bin/python`). To close that gap, this extension also
 * blocks disallowed invocations at bash spawn time.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";

const __dirname = dirname(fileURLToPath(import.meta.url));
const interceptedCommandsPath = join(__dirname, "..", "intercepted-commands");

function getBlockedCommandMessage(command: string): string | null {
  // Match commands at the start of a shell segment (start/newline/; /&& /|| /|)
  const pipCommandPattern = /(?:^|\n|[;|&]{1,2})\s*(?:\S+\/)?pip\s*(?:$|\s)/m;
  const pip3CommandPattern = /(?:^|\n|[;|&]{1,2})\s*(?:\S+\/)?pip3\s*(?:$|\s)/m;
  const poetryCommandPattern = /(?:^|\n|[;|&]{1,2})\s*(?:\S+\/)?poetry\s*(?:$|\s)/m;

  // Match python invocations including explicit paths like .venv/bin/python
  // and .venv/bin/python3.12.
  const pythonPipPattern =
    /(?:^|\n|[;|&]{1,2})\s*(?:\S+\/)?python(?:3(?:\.\d+)?)?\b[^\n;|&]*(?:\s-m\s*pip\b|\s-mpip\b)/m;
  const pythonVenvPattern =
    /(?:^|\n|[;|&]{1,2})\s*(?:\S+\/)?python(?:3(?:\.\d+)?)?\b[^\n;|&]*(?:\s-m\s*venv\b|\s-mvenv\b)/m;
  const pythonPyCompilePattern =
    /(?:^|\n|[;|&]{1,2})\s*(?:\S+\/)?python(?:3(?:\.\d+)?)?\b[^\n;|&]*(?:\s-m\s*py_compile\b|\s-mpy_compile\b)/m;

  if (pipCommandPattern.test(command)) {
    return [
      "Error: pip is disabled. Use uv instead:",
      "",
      "  To install a package for a script: uv run --with PACKAGE python script.py",
      "  To add a dependency to the project: uv add PACKAGE",
      "",
    ].join("\n");
  }

  if (pip3CommandPattern.test(command)) {
    return [
      "Error: pip3 is disabled. Use uv instead:",
      "",
      "  To install a package for a script: uv run --with PACKAGE python script.py",
      "  To add a dependency to the project: uv add PACKAGE",
      "",
    ].join("\n");
  }

  if (poetryCommandPattern.test(command)) {
    return [
      "Error: poetry is disabled. Use uv instead:",
      "",
      "  To initialize a project: uv init",
      "  To add a dependency: uv add PACKAGE",
      "  To sync dependencies: uv sync",
      "  To run commands: uv run COMMAND",
      "",
    ].join("\n");
  }

  if (pythonPipPattern.test(command)) {
    return [
      "Error: 'python -m pip' is disabled. Use uv instead:",
      "",
      "  To install a package for a script: uv run --with PACKAGE python script.py",
      "  To add a dependency to the project: uv add PACKAGE",
      "",
    ].join("\n");
  }

  if (pythonVenvPattern.test(command)) {
    return [
      "Error: 'python -m venv' is disabled. Use uv instead:",
      "",
      "  To create a virtual environment: uv venv",
      "",
    ].join("\n");
  }

  if (pythonPyCompilePattern.test(command)) {
    return [
      "Error: 'python -m py_compile' is disabled because it writes .pyc files to __pycache__.",
      "",
      "  To verify syntax without bytecode output: uv run python -m ast path/to/file.py >/dev/null",
      "",
    ].join("\n");
  }

  return null;
}

export default function (pi: ExtensionAPI) {
  const cwd = process.cwd();
  const bashTool = createBashTool(cwd, {
    commandPrefix: `export PATH="${interceptedCommandsPath}:$PATH"`,
    spawnHook: (ctx) => {
      const blockedMessage = getBlockedCommandMessage(ctx.command);
      if (blockedMessage) {
        throw new Error(blockedMessage);
      }
      return ctx;
    },
  });

  pi.registerTool(bashTool);
}
