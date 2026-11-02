/**
 * Titlebar Spinner Extension
 *
 * What it is:
 *   While an agent turn is in flight, animates a braille spinner in the
 *   terminal's window title (via `ctx.ui.setTitle()`). On idle the title
 *   resets to `π - <session> - <cwd>` so you can read it at a glance from
 *   the OS window list.
 *
 *   No chat/UI surface — purely a title-bar affordance.
 *
 * Use cases:
 *   - Quickly tell which terminal tab/window is actively working when you
 *     have several pi sessions open.
 *   - Spot at a glance (in the OS taskbar / `cmd-tab` / tmux window list)
 *     when a long turn finishes.
 *   - Helpful companion to `notify.ts` when notifications are noisy or
 *     unsupported in your terminal.
 *
 * Common usage patterns:
 *   - Install and forget; spinner starts/stops with `agent_start` /
 *     `agent_end`.
 *   - Works in any terminal that respects the OSC window-title escape
 *     sequence (essentially all of them).
 */

import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function getBaseTitle(pi: ExtensionAPI, ctx: ExtensionContext): string {
  const cwd = path.basename(ctx.cwd);
  const session = pi.getSessionName();
  return session ? `π - ${session} - ${cwd}` : `π - ${cwd}`;
}

export default function (pi: ExtensionAPI) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let frameIndex = 0;

  function stopAnimation(ctx: ExtensionContext) {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    frameIndex = 0;
    ctx.ui.setTitle(getBaseTitle(pi, ctx));
  }

  function startAnimation(ctx: ExtensionContext) {
    stopAnimation(ctx);
    timer = setInterval(() => {
      const frame = BRAILLE_FRAMES[frameIndex % BRAILLE_FRAMES.length];
      const cwd = path.basename(ctx.cwd);
      const session = pi.getSessionName();
      const title = session ? `${frame} π - ${session} - ${cwd}` : `${frame} π - ${cwd}`;
      ctx.ui.setTitle(title);
      frameIndex++;
    }, 80);
  }

  // Only a terminal has a window title to animate. Pi Web keeps the browser
  // tab title to itself, so there every frame would be a wasted event.
  pi.on("agent_start", async (_event, ctx) => {
    if (ctx.mode === "tui") startAnimation(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (ctx.mode === "tui") stopAnimation(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (ctx.mode === "tui") stopAnimation(ctx);
  });
}
