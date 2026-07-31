/**
 * Session Name Extension
 *
 * What it is:
 *   Two small things around pi's built-in session name (`/name`):
 *     1. `Ctrl+Shift+N` opens a prefilled, single-line rename dialog, so the
 *        name can be set or amended mid-session without retyping it.
 *     2. Mirrors the session name into the tmux window name, so the status
 *        bar says what the pane is actually working on.
 *
 *   The tmux mirror listens on `session_info_changed`, so renames from any
 *   source sync: `/name`, this extension's shortcut, and the session
 *   selector's `Ctrl+R`.
 *
 * Behavior:
 *   - No name → the window is left alone. A fresh unnamed session never
 *     claims a window you named by hand before launching pi.
 *   - Name set → `tmux rename-window` (which also disables that window's
 *     `automatic-rename`, so the label sticks).
 *   - Name cleared (submit an empty dialog) → `automatic-rename` back on, so
 *     tmux resumes deriving the name itself.
 *   - Quit → the pre-pi window name and `automatic-rename` state are
 *     restored. Session replacement (`new`/`resume`/`fork`/`reload`) skips
 *     the restore, since a `session_start` resync follows immediately.
 *   - Outside tmux, the whole thing is inert.
 *
 * Common usage patterns:
 *   - `Ctrl+Shift+N` — set, amend, or clear the session name.
 *   - `Ctrl+Shift+N`, Enter — re-sync tmux without touching the session.
 *   - `/name` — unchanged built-in; also syncs to tmux.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, keyHint } from "@earendil-works/pi-coding-agent";
import type { Focusable } from "@earendil-works/pi-tui";
import { Container, Input, Spacer, Text, getKeybindings } from "@earendil-works/pi-tui";

// tmux window names show up in a narrow status bar and tmux does not truncate
// `#W` itself, so a long name would push the rest of the bar around.
const MAX_WINDOW_NAME = 20;

// =============================================================================
// tmux
// =============================================================================

type WindowState = {
  name: string;
  automaticRename: boolean;
};

/** Window state captured before the first rename, restored on quit. */
let priorWindowState: WindowState | null = null;

function tmuxPane(): string | undefined {
  if (!process.env.TMUX) return undefined;
  return process.env.TMUX_PANE || undefined;
}

/** `#` is a format escape in tmux status strings; drop it rather than render garbage. */
function formatWindowName(name: string): string {
  const clean = name.replace(/#/g, "").replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_WINDOW_NAME) return clean;
  return `${clean.slice(0, MAX_WINDOW_NAME - 1)}…`;
}

function execError(result: { stderr?: string; stdout?: string }): string {
  return result.stderr?.trim() || result.stdout?.trim() || "unknown tmux error";
}

async function capturePriorWindowState(pi: ExtensionAPI, pane: string): Promise<void> {
  if (priorWindowState) return;
  const result = await pi.exec("tmux", [
    "display-message",
    "-p",
    "-t",
    pane,
    "#{window_name}|#{automatic-rename}",
  ]);
  if (result.code !== 0) return;
  const [name, automatic] = result.stdout.trim().split("|");
  if (name === undefined) return;
  priorWindowState = { name, automaticRename: automatic === "1" };
}

/**
 * Push `name` (or, when undefined, "no name") to the tmux window.
 * Errors are reported only for user-initiated renames; background syncs stay quiet.
 */
async function syncWindowName(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  name: string | undefined,
  opts: { notifyOnError: boolean },
): Promise<void> {
  const pane = tmuxPane();
  if (!pane) return;

  const windowName = name ? formatWindowName(name) : "";
  if (!windowName) {
    // Cleared: hand naming back to tmux rather than leave a stale label.
    const result = await pi.exec("tmux", ["setw", "-t", pane, "automatic-rename", "on"]);
    if (result.code !== 0 && opts.notifyOnError && ctx.hasUI) {
      ctx.ui.notify(`Failed to release tmux window name: ${execError(result)}`, "error");
    }
    return;
  }

  await capturePriorWindowState(pi, pane);
  const result = await pi.exec("tmux", ["rename-window", "-t", pane, windowName]);
  if (result.code !== 0 && opts.notifyOnError && ctx.hasUI) {
    ctx.ui.notify(`Failed to rename tmux window: ${execError(result)}`, "error");
  }
}

async function restoreWindowName(pi: ExtensionAPI): Promise<void> {
  const pane = tmuxPane();
  const prior = priorWindowState;
  if (!pane || !prior) return;
  priorWindowState = null;

  if (prior.automaticRename) {
    await pi.exec("tmux", ["setw", "-t", pane, "automatic-rename", "on"]);
    return;
  }
  await pi.exec("tmux", ["rename-window", "-t", pane, prior.name]);
}

// =============================================================================
// Rename dialog
// =============================================================================

class PrefilledInput extends Input {
  constructor(value: string) {
    super();
    this.setValue(value);
    // setValue() clamps the cursor to its previous position (0), leaving the
    // caret before the prefilled text. `cursor` is private in the types only.
    (this as unknown as { cursor: number }).cursor = value.length;
  }
}

/**
 * Single-line prefilled input, modelled on pi's ExtensionInputComponent.
 * `ctx.ui.input()` ignores its placeholder argument and cannot prefill, which
 * is exactly what amending an existing name needs.
 */
class SessionNameDialog extends Container implements Focusable {
  private readonly input: Input;
  private _focused = false;

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value;
  }

  constructor(
    theme: Theme,
    title: string,
    initialValue: string,
    private readonly onSubmit: (value: string) => void,
    private readonly onCancel: () => void,
  ) {
    super();
    this.input = new PrefilledInput(initialValue);

    this.addChild(new DynamicBorder());
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.fg("accent", title), 1, 0));
    this.addChild(new Spacer(1));
    this.addChild(this.input);
    this.addChild(new Spacer(1));
    this.addChild(
      new Text(
        `${keyHint("tui.select.confirm", "submit")}  ${keyHint("tui.select.cancel", "cancel")}  ${theme.fg("dim", "empty clears the name")}`,
        1,
        0,
      ),
    );
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder());
  }

  handleInput(keyData: string): void {
    const kb = getKeybindings();
    if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n") {
      this.onSubmit(this.input.getValue());
    } else if (kb.matches(keyData, "tui.select.cancel")) {
      this.onCancel();
    } else {
      this.input.handleInput(keyData);
    }
  }
}

/** Returns undefined when cancelled. */
async function promptForName(ctx: ExtensionContext, current: string): Promise<string | undefined> {
  if (ctx.mode !== "tui") {
    // RPC dialogs cannot prefill; the title carries the current name instead.
    const title = current ? `Session name (current: ${current})` : "Session name";
    return ctx.ui.input(title);
  }

  return ctx.ui.custom<string | undefined>(
    (_tui, theme, _keybindings, done) =>
      new SessionNameDialog(
        theme,
        "Session name",
        current,
        (value) => done(value),
        () => done(undefined),
      ),
  );
}

// =============================================================================
// Extension Export
// =============================================================================

export default function (pi: ExtensionAPI): void {
  pi.registerShortcut("ctrl+shift+n", {
    description: "Set session name",
    handler: async (ctx) => {
      if (!ctx.hasUI) return;

      const current = pi.getSessionName() ?? "";
      const value = await promptForName(ctx, current);
      if (value === undefined) return;

      const next = value.trim();
      if (next === current) {
        // No session entry for a no-op edit, but still re-push to tmux so the
        // dialog doubles as a manual re-sync when the window drifted.
        await syncWindowName(pi, ctx, next || undefined, { notifyOnError: true });
        return;
      }

      // Fires session_info_changed, which drives the tmux sync below.
      pi.setSessionName(next);
      ctx.ui.notify(
        next ? `Session name set: ${pi.getSessionName() ?? next}` : "Session name cleared",
        "info",
      );
    },
  });

  pi.on("session_info_changed", async (event, ctx) => {
    await syncWindowName(pi, ctx, event.name, { notifyOnError: true });
  });

  pi.on("session_start", async (_event, ctx) => {
    const name = pi.getSessionName();
    if (!name) return;
    await syncWindowName(pi, ctx, name, { notifyOnError: false });
  });

  pi.on("session_shutdown", async (event, _ctx) => {
    // new/resume/fork/reload replace the session in-process; a session_start
    // resync follows, so restoring here would only flicker the status bar.
    if (event.reason !== "quit") return;
    await restoreWindowName(pi);
  });
}
