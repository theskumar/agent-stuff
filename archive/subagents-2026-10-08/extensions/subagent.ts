import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { Stats } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { StringEnum } from "@earendil-works/pi-ai";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const ATTACH_FLAG = "attach-subagent";
const CHILD_ENV = "PI_TMUX_SUBAGENT_CHILD";
const RESULT_ENV = "PI_TMUX_SUBAGENT_RESULT";
const RUNS_DIR = "tmux-subagents";
const POLL_INTERVAL_MS = 500;
const PREVIEW_BODY_LINES = 6;
// Finished children keep their tmux session so the pane stays readable after the
// fact. Nothing else reaps them, and they are visible in the parent's own tmux
// server, so sweep the stale ones at startup.
const REAP_SESSION_AGE_MS = 2 * 60 * 60 * 1000;
const REAP_RUN_DIR_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// herdr has no `pane_dead` flag. Once the child command returns, the pane drops
// back to its shell prompt; if it is back at the shell this long after launch we
// treat the child as exited even if we never sampled it mid-run.
const HERDR_STARTUP_GRACE_MS = 5_000;
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const EXTENSION_PATH = fileURLToPath(import.meta.url);

type RunStatus = "queued" | "running" | "completed" | "failed";

interface ChildResult {
  version: 1;
  status: "completed" | "failed";
  output: string;
  error?: string;
  stopReason?: string;
  sessionFile?: string;
  provider?: string;
  model?: string;
  thinking?: string;
  finishedAt: number;
}

interface RunDetails {
  status: RunStatus;
  task: string;
  cwd: string;
  label: string;
  attachCommand: string;
  captureCommand: string;
  killCommand: string;
  provider: string;
  model: string;
  thinking: string;
  agentStatus?: string;
  pane?: string;
  output?: string;
  sessionFile?: string;
  startedAt?: number;
  finishedAt?: number;
}

interface RunSpec {
  task: string;
  cwd: string;
  attachmentId: string;
  label: string;
  attachCommand: string;
  captureCommand: string;
  killCommand: string;
  provider: string;
  model: string;
  thinking: string;
  trusted: boolean;
}

/**
 * A live child pane, addressed differently per backend. `create()` fills in the
 * real target; the other fields hold backend-private bookkeeping.
 */
interface RunHandle {
  /** Send/capture/exit-check target: a tmux or herdr pane id. */
  paneId: string;
  /** tmux session name (kill target); unused by herdr. */
  session?: string;
  /** tmux window id (remain-on-exit target); unused by herdr. */
  windowId?: string;
  /** herdr exit guard: set once the child was observed running. */
  sawRunning?: boolean;
  /** herdr exit guard anchor: when the launch command was submitted. */
  launchedAt?: number;
}

function shellQuote(value: string): string {
  if (value.length === 0) return "''";
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function privateTmuxSocketPath(): string {
  return path.join(getAgentDir(), "tmux-subagents.sock");
}

/**
 * Children run on the parent's tmux server whenever the parent is itself inside
 * tmux, so `pi --attach-subagent` can `switch-client` instead of nesting a
 * second tmux client inside the caller's pane. Only a parent started outside
 * tmux falls back to the private socket.
 */
function tmuxSocketPath(): string {
  return currentTmuxSocket() ?? privateTmuxSocketPath();
}

function tmuxSessionName(sessionId: string): string {
  return `pi-agent-${sessionId}`;
}

function currentTmuxSocket(): string | undefined {
  const socket = process.env.TMUX?.split(",", 1)[0]?.trim();
  return socket || undefined;
}

function runsRoot(): string {
  return path.join(getAgentDir(), RUNS_DIR);
}

/**
 * Children can live on any tmux server, so each run records the socket it was
 * created on. Attaching resolves the socket from that record rather than
 * guessing, which keeps `pi --attach-subagent` working from a plain terminal.
 */
function findRecordedSocket(childSessionId: string): string | undefined {
  let parents: string[];
  try {
    parents = readdirSync(runsRoot());
  } catch {
    return undefined;
  }
  for (const parent of parents) {
    const metaPath = path.join(runsRoot(), parent, childSessionId, "meta.json");
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { socket?: unknown };
      if (typeof meta.socket === "string" && meta.socket) return meta.socket;
    } catch {
      // Not this parent, or the run predates meta.json.
    }
  }
  return undefined;
}

function socketHasSession(socket: string, session: string): boolean {
  const probe = spawnSync("tmux", ["-S", socket, "has-session", "-t", session], {
    stdio: "ignore",
  });
  return probe.status === 0;
}

function resolveAttachSocket(session: string, childSessionId: string): string {
  const recorded = findRecordedSocket(childSessionId);
  if (recorded && socketHasSession(recorded, session)) return recorded;
  for (const candidate of [currentTmuxSocket(), privateTmuxSocketPath()]) {
    if (candidate && socketHasSession(candidate, session)) return candidate;
  }
  return recorded ?? tmuxSocketPath();
}

function attachFlagValue(argv: string[]): string | undefined {
  const flag = `--${ATTACH_FLAG}`;
  for (let index = 2; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--") break;
    if (argument === flag) {
      const value = argv[index + 1];
      return !value || value.startsWith("--") ? "" : value;
    }
    if (argument.startsWith(`${flag}=`)) return argument.slice(flag.length + 1);
  }
  return undefined;
}

function tmuxCommandPrefix(): string {
  return `tmux -S ${shellQuote(tmuxSocketPath())}`;
}

function tmuxArgs(...args: string[]): string[] {
  return ["-S", tmuxSocketPath(), ...args];
}

function attachToSubagentAndExit(rawTarget: string): never {
  const target = rawTarget.trim();
  if (!target) {
    console.error(`Error: --${ATTACH_FLAG} requires the session id printed by the subagent tool.`);
    process.exit(2);
  }

  let socket: string | undefined;
  let session: string;
  if (target.startsWith("v1.")) {
    // Keep attachment working for sessions started before session-id targets.
    try {
      const legacy = JSON.parse(Buffer.from(target.slice(3), "base64url").toString("utf8")) as {
        s?: unknown;
        p?: unknown;
      };
      if (typeof legacy.s !== "string" || !legacy.s || typeof legacy.p !== "string" || !legacy.p) {
        throw new Error("missing tmux session or socket");
      }
      session = legacy.s;
      socket = legacy.p;
    } catch (error) {
      console.error(
        `Error: invalid legacy subagent target: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(2);
    }
  } else {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(target)
    ) {
      console.error(`Error: invalid subagent session id: ${target}`);
      process.exit(2);
    }
    session = tmuxSessionName(target);
    socket = resolveAttachSocket(session, target);
  }

  const sameServer = currentTmuxSocket() === socket;
  const args = ["-S", socket, sameServer ? "switch-client" : "attach-session", "-t", session];
  const env = { ...process.env };
  if (!sameServer) {
    env.TMUX = undefined;
    env.TMUX_PANE = undefined;
  }
  const result = spawnSync("tmux", args, { stdio: "inherit", env });
  if (result.error) console.error(`Failed to run tmux: ${result.error.message}`);
  process.exit(result.status ?? 1);
}

function getPiInvocationParts(): string[] {
  const currentScript = process.argv[1];
  if (currentScript && existsSync(currentScript)) {
    return [process.execPath, currentScript];
  }

  const execName = path.basename(process.execPath).toLowerCase();
  if (!/^(node|bun)(\.exe)?$/.test(execName)) {
    return [process.execPath];
  }

  return ["pi"];
}

function textFromAssistant(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: "text"; text: string } => {
      return Boolean(
        part && typeof part === "object" && part.type === "text" && typeof part.text === "string",
      );
    })
    .map((part) => part.text)
    .join("\n");
}

function findLastAssistant(ctx: ExtensionContext): Record<string, unknown> | undefined {
  const branch = ctx.sessionManager.getBranch();
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index];
    if (entry.type !== "message") continue;
    const message = entry.message as unknown as Record<string, unknown>;
    if (message.role === "assistant") return message;
  }
  return undefined;
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, filePath);
}

function registerChildReporter(pi: ExtensionAPI, resultPath: string): void {
  let reported = false;

  const report = async (ctx: ExtensionContext, fallbackError?: string): Promise<void> => {
    if (reported) return;
    reported = true;

    const assistant = findLastAssistant(ctx);
    const stopReason = typeof assistant?.stopReason === "string" ? assistant.stopReason : undefined;
    const assistantError =
      typeof assistant?.errorMessage === "string" ? assistant.errorMessage : undefined;
    const failed =
      !assistant || stopReason === "error" || stopReason === "aborted" || Boolean(fallbackError);
    const output = assistant ? textFromAssistant(assistant) : "";
    const result: ChildResult = {
      version: 1,
      status: failed ? "failed" : "completed",
      output,
      error:
        fallbackError ??
        assistantError ??
        (!assistant ? "Subagent exited without an assistant response." : undefined),
      stopReason,
      sessionFile: ctx.sessionManager.getSessionFile(),
      provider: typeof assistant?.provider === "string" ? assistant.provider : ctx.model?.provider,
      model: typeof assistant?.model === "string" ? assistant.model : ctx.model?.id,
      thinking: pi.getThinkingLevel(),
      finishedAt: Date.now(),
    };

    try {
      await writeJsonAtomic(resultPath, result);
    } catch (error) {
      console.error(
        `[tmux-subagent] Failed to write result: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  // agent_settled was added after older peer type declarations but is present
  // in the Pi runtime this extension targets.
  (
    pi.on as unknown as (
      event: "agent_settled",
      handler: (event: unknown, ctx: ExtensionContext) => void | Promise<void>,
    ) => void
  )("agent_settled", async (_event, ctx) => {
    await report(ctx);
    ctx.shutdown();
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (!reported) await report(ctx, "Subagent session shut down before the task settled.");
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function newestSessionFile(sessionDir: string): string | undefined {
  let entries: string[];
  try {
    entries = readdirSync(sessionDir);
  } catch {
    return undefined;
  }
  // Session filenames start with an ISO timestamp, so lexical order is chronological.
  const newest = entries
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .at(-1);
  return newest ? path.join(sessionDir, newest) : undefined;
}

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}\u2026` : text;
}

function toolArgSummary(args: unknown): string {
  if (!isRecord(args)) return "";
  const preferred = ["command", "cmd", "script", "path", "file", "pattern", "query", "url", "task"];
  let value: unknown;
  for (const key of preferred) {
    if (typeof args[key] === "string" && args[key]) {
      value = args[key];
      break;
    }
  }
  if (value === undefined) {
    value =
      Object.values(args).find((entry) => typeof entry === "string" && entry) ??
      JSON.stringify(args);
  }
  return clip(String(value), 100);
}

/**
 * A clean, structured live preview built from the child's own session JSONL,
 * which is far more useful than scraping its full-screen TUI. Works for every
 * backend because the child always writes to a known session dir.
 */
function readSessionActivity(sessionDir: string): string | undefined {
  const file = newestSessionFile(sessionDir);
  if (!file) return undefined;
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    return undefined;
  }

  let steps = 0;
  let body: string | undefined;
  let tool: { name: string; summary: string } | undefined;
  let result: string | undefined;

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) continue;
    const message = entry.message;
    const parts = Array.isArray(message.content) ? message.content : [];
    if (message.role === "assistant") {
      for (const part of parts) {
        if (!isRecord(part)) continue;
        if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
          body = part.text.trim();
        } else if (
          part.type === "thinking" &&
          typeof part.thinking === "string" &&
          part.thinking.trim()
        ) {
          body = `\u{1f4ad} ${part.thinking.trim()}`;
        } else if (part.type === "toolCall" && typeof part.name === "string") {
          steps++;
          tool = { name: part.name, summary: toolArgSummary(part.arguments) };
        }
      }
    } else if (message.role === "toolResult") {
      for (const part of parts) {
        if (!isRecord(part)) continue;
        if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
          result = clip(part.text.trim().split("\n")[0] ?? "", 100);
        }
      }
    }
  }

  const lines: string[] = [];
  if (body) lines.push(...body.split("\n").slice(-PREVIEW_BODY_LINES));
  if (tool) lines.push(`\u2192 ${tool.name}${tool.summary ? `: ${tool.summary}` : ""}`);
  if (result) lines.push(`\u2190 ${result}`);
  if (steps > 0) lines.push(`(${steps} tool call${steps === 1 ? "" : "s"})`);
  const summary = lines.join("\n").trim();
  return summary || undefined;
}

function formatDuration(
  startedAt: number | undefined,
  finishedAt = Date.now(),
): string | undefined {
  if (startedAt === undefined) return undefined;
  const seconds = Math.max(0, Math.round((finishedAt - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function detailsFor(spec: RunSpec, status: RunStatus, extra: Partial<RunDetails> = {}): RunDetails {
  return {
    status,
    task: spec.task,
    cwd: spec.cwd,
    label: spec.label,
    attachCommand: spec.attachCommand,
    captureCommand: spec.captureCommand,
    killCommand: spec.killCommand,
    provider: spec.provider,
    model: spec.model,
    thinking: spec.thinking,
    ...extra,
  };
}

function partialText(details: RunDetails): string {
  const lines = [
    `Subagent ${details.status}${details.agentStatus ? ` · ${details.agentStatus}` : ""} in ${details.label}.`,
    `Attach: ${details.attachCommand}`,
    `Capture: ${details.captureCommand}`,
  ];
  if (details.pane) lines.push("", details.pane);
  return lines.join("\n");
}

function truncateToolText(text: string): string {
  const truncated = truncateHead(text, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });
  if (!truncated.truncated) return truncated.content;
  return `${truncated.content}\n\n[Output truncated. Full output is available in the child session file.]`;
}

function resultText(details: RunDetails): string {
  const duration = formatDuration(details.startedAt, details.finishedAt);
  const lines = [
    `Subagent ${details.status}${duration ? ` after ${duration}` : ""}.`,
    `Model: ${details.provider}/${details.model} (${details.thinking})`,
    `Session: ${details.label}`,
    `Attach: ${details.attachCommand}`,
    `Capture: ${details.captureCommand}`,
    `Clean up: ${details.killCommand}`,
  ];
  if (details.sessionFile) lines.push(`Child session: ${details.sessionFile}`);
  if (details.output) lines.push("", details.output);
  return truncateToolText(lines.join("\n"));
}

async function abortableDelay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) throw new Error("Subagent aborted.");
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error("Subagent aborted."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Delete run dirs nobody will read again. Backend-agnostic. */
async function reapStaleRunDirs(): Promise<void> {
  const now = Date.now();
  let parents: string[];
  try {
    parents = readdirSync(runsRoot());
  } catch {
    return;
  }
  for (const parent of parents) {
    const parentDir = path.join(runsRoot(), parent);
    try {
      const info = await stat(parentDir);
      if (now - info.mtimeMs < REAP_RUN_DIR_AGE_MS) continue;
      await rm(parentDir, { recursive: true, force: true });
    } catch {
      // Raced with another pi process, or not ours to delete.
    }
  }
}

async function validateCwd(cwd: string): Promise<void> {
  let info: Stats;
  try {
    info = await stat(cwd);
  } catch {
    throw new Error(`Subagent working directory does not exist: ${cwd}`);
  }
  if (!info.isDirectory()) throw new Error(`Subagent working directory is not a directory: ${cwd}`);
}

function isSameOrDescendant(base: string, candidate: string): boolean {
  const relative = path.relative(base, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function resolveModel(
  ctx: ExtensionContext,
  providerOverride: string | undefined,
  modelOverride: string | undefined,
): { provider: string; model: string } {
  const explicitProvider = providerOverride?.trim();
  const explicitModel = modelOverride?.trim();
  let provider = explicitProvider || ctx.model?.provider || "";
  let model = explicitModel || ctx.model?.id || "";

  // A slash in an inherited id can be part of the id itself (for example,
  // OpenRouter's openai/gpt-* models). Only interpret an explicit model as
  // provider/model when no separate provider was supplied. If both are given
  // and the prefixes agree, accept the redundant canonical provider/model form.
  const slashIndex = explicitModel?.indexOf("/") ?? -1;
  if (explicitModel && slashIndex > 0) {
    const modelProvider = explicitModel.slice(0, slashIndex);
    if (!explicitProvider) {
      provider = modelProvider;
      model = explicitModel.slice(slashIndex + 1);
    } else if (explicitProvider === modelProvider) {
      model = explicitModel.slice(slashIndex + 1);
    }
  }

  if (!provider || !model) {
    throw new Error("No model is active. Pass both provider and model to the subagent tool.");
  }
  return { provider, model };
}

/**
 * The terminal multiplexer that hosts child panes. tmux runs children in
 * detached sessions on a private (or the caller's) socket; herdr runs them in a
 * background tab of the current session and knows pi natively. Both keep the
 * `result.json` IPC from `registerChildReporter` as the authoritative output.
 */
interface Backend {
  readonly kind: "tmux" | "herdr";
  /** Whether to close the child pane once the run settles (herdr has no reaper). */
  readonly autoCloseOnSettle: boolean;
  /** Throw a clear error if the multiplexer is unavailable. */
  ensureAvailable(pi: ExtensionAPI): Promise<void>;
  /** Wrap the `env ... pi ...` string into the shell command actually launched. */
  wrapLaunch(command: string): string;
  /** Placeholder handle used for command previews before the pane exists. */
  initialHandle(sessionName: string): RunHandle;
  /** Create the pane/session, mutating `handle` with the real target. */
  create(pi: ExtensionAPI, opts: { cwd: string; label: string; handle: RunHandle }): Promise<void>;
  /** Send and submit the launch command in the child pane. */
  launch(pi: ExtensionAPI, handle: RunHandle, command: string): Promise<void>;
  /** Whether the child process has exited (pane dead / shell prompt returned). */
  hasExited(pi: ExtensionAPI, handle: RunHandle): Promise<boolean>;
  /** Native lifecycle status for the header (herdr: idle/working/blocked/done). */
  statusHint(pi: ExtensionAPI, handle: RunHandle): Promise<string | undefined>;
  /** Tear the pane/session down. */
  close(pi: ExtensionAPI, handle: RunHandle): Promise<void>;
  /** Human-facing attach/capture/cleanup command hints. */
  commands(
    handle: RunHandle,
    attachmentId: string,
  ): { attach: string; capture: string; kill: string };
  /** Short label shown as the run title. */
  label(handle: RunHandle): string;
  /** Optional startup housekeeping (kill stale sessions). */
  reap(pi: ExtensionAPI): Promise<void>;
}

const tmuxBackend: Backend = {
  kind: "tmux",
  autoCloseOnSettle: false,
  async ensureAvailable(pi) {
    const version = await pi.exec("tmux", ["-V"], { timeout: 5_000 });
    if (version.code !== 0) {
      throw new Error(
        `tmux is required for subagents: ${version.stderr.trim() || "tmux not found"}`,
      );
    }
  },
  wrapLaunch(command) {
    return `exec ${command}`;
  },
  initialHandle(sessionName) {
    // Until the pane exists, address the session by name so preview commands work.
    return { paneId: sessionName, session: sessionName };
  },
  async create(pi, { cwd, handle }) {
    const session = handle.session ?? handle.paneId;
    const created = await pi.exec(
      "tmux",
      tmuxArgs(
        "new-session",
        "-d",
        "-s",
        session,
        "-n",
        "pi",
        "-c",
        cwd,
        "-P",
        "-F",
        "#{window_id} #{pane_id}",
      ),
    );
    if (created.code !== 0) {
      throw new Error(
        `Failed to create tmux session: ${created.stderr.trim() || created.stdout.trim()}`,
      );
    }
    // base-index/pane-base-index are user settings, so window/pane indices cannot
    // be assumed to be 0; read the real ids that new-session reports.
    const [windowId, paneId] = created.stdout.trim().split(/\s+/, 2);
    if (!windowId || !paneId) {
      throw new Error(`tmux did not report the new window and pane: ${created.stdout.trim()}`);
    }
    handle.windowId = windowId;
    handle.paneId = paneId;
    handle.session = session;
    const remain = await pi.exec(
      "tmux",
      tmuxArgs("set-window-option", "-t", windowId, "remain-on-exit", "on"),
    );
    if (remain.code !== 0) {
      throw new Error(remain.stderr.trim() || "Failed to set remain-on-exit.");
    }
  },
  async launch(pi, handle, command) {
    const sent = await pi.exec(
      "tmux",
      tmuxArgs("send-keys", "-t", handle.paneId, "-l", "--", command),
    );
    if (sent.code !== 0) throw new Error(sent.stderr.trim() || "Failed to start child Pi.");
    const entered = await pi.exec("tmux", tmuxArgs("send-keys", "-t", handle.paneId, "Enter"));
    if (entered.code !== 0) {
      throw new Error(entered.stderr.trim() || "Failed to submit child command.");
    }
  },
  async hasExited(pi, handle) {
    const dead = await pi.exec(
      "tmux",
      tmuxArgs("display-message", "-p", "-t", handle.paneId, "#{pane_dead}"),
    );
    return dead.code === 0 && dead.stdout.trim() === "1";
  },
  async statusHint() {
    // tmux has no native notion of agent lifecycle state.
    return undefined;
  },
  async close(pi, handle) {
    if (handle.session) await pi.exec("tmux", tmuxArgs("kill-session", "-t", handle.session));
  },
  commands(handle, attachmentId) {
    const tmux = tmuxCommandPrefix();
    return {
      attach: `pi --${ATTACH_FLAG} ${shellQuote(attachmentId)}`,
      capture: `${tmux} capture-pane -p -J -t ${shellQuote(handle.paneId)}`,
      kill: `${tmux} kill-session -t ${shellQuote(handle.session ?? handle.paneId)}`,
    };
  },
  label(handle) {
    return handle.session ?? handle.paneId;
  },
  async reap(pi) {
    const sockets = new Set([tmuxSocketPath(), privateTmuxSocketPath()]);
    const now = Date.now();
    for (const socket of sockets) {
      const listed = await pi.exec(
        "tmux",
        ["-S", socket, "list-panes", "-a", "-F", "#{session_name} #{pane_dead} #{session_created}"],
        { timeout: 5_000 },
      );
      if (listed.code !== 0) continue;
      for (const line of listed.stdout.split("\n")) {
        const [session, dead, created] = line.trim().split(/\s+/);
        if (!session || !/^pi-agent-[0-9a-f-]{36}$/i.test(session)) continue;
        if (dead !== "1") continue;
        const createdMs = Number(created) * 1000;
        if (Number.isFinite(createdMs) && now - createdMs < REAP_SESSION_AGE_MS) continue;
        await pi.exec("tmux", ["-S", socket, "kill-session", "-t", session], { timeout: 5_000 });
      }
    }
  },
};

function herdrPaneId(stdout: string, key: "pane" | "root_pane"): string | undefined {
  try {
    const parsed = JSON.parse(stdout) as { result?: Record<string, { pane_id?: unknown }> };
    const paneId = parsed.result?.[key]?.pane_id;
    return typeof paneId === "string" && paneId ? paneId : undefined;
  } catch {
    return undefined;
  }
}

const herdrBackend: Backend = {
  kind: "herdr",
  autoCloseOnSettle: true,
  async ensureAvailable(pi) {
    const version = await pi.exec("herdr", ["--version"], { timeout: 5_000 });
    if (version.code !== 0) {
      throw new Error(
        `herdr is required for subagents in this session: ${version.stderr.trim() || "herdr not found"}`,
      );
    }
  },
  wrapLaunch(command) {
    // No `exec`: when the child exits, the pane returns to its shell prompt, which
    // keeps it readable and lets `pane process-info` report the exit.
    return command;
  },
  initialHandle() {
    return { paneId: "(pending)" };
  },
  async create(pi, { cwd, label, handle }) {
    // A background tab (rather than splitting the caller's pane) keeps the user's
    // own pi TUI full-size, mirroring tmux's detached-session behavior.
    const created = await pi.exec(
      "herdr",
      ["tab", "create", "--cwd", cwd, "--no-focus", "--label", label],
      { timeout: 15_000 },
    );
    if (created.code !== 0) {
      throw new Error(
        `Failed to create herdr tab: ${created.stderr.trim() || created.stdout.trim()}`,
      );
    }
    const paneId = herdrPaneId(created.stdout, "root_pane");
    if (!paneId) {
      throw new Error(`herdr did not report a pane id: ${created.stdout.trim()}`);
    }
    handle.paneId = paneId;
  },
  async launch(pi, handle, command) {
    handle.launchedAt = Date.now();
    // `pane run` sends the command text and Enter atomically.
    const run = await pi.exec("herdr", ["pane", "run", handle.paneId, command], {
      timeout: 10_000,
    });
    if (run.code !== 0) {
      throw new Error(run.stderr.trim() || run.stdout.trim() || "Failed to start child Pi.");
    }
  },
  async hasExited(pi, handle) {
    const info = await pi.exec("herdr", ["pane", "process-info", "--pane", handle.paneId], {
      timeout: 5_000,
    });
    if (info.code !== 0) {
      // Pane gone (user closed it): treat as exited so the loop falls back to result.json.
      return /not_found/.test(info.stderr) || /not_found/.test(info.stdout);
    }
    let procInfo: { foreground_process_group_id?: number; shell_pid?: number } | undefined;
    try {
      procInfo = (JSON.parse(info.stdout) as { result?: { process_info?: typeof procInfo } }).result
        ?.process_info;
    } catch {
      return false;
    }
    if (
      !procInfo ||
      typeof procInfo.foreground_process_group_id !== "number" ||
      typeof procInfo.shell_pid !== "number"
    ) {
      return false;
    }
    const backToShell = procInfo.foreground_process_group_id === procInfo.shell_pid;
    if (!backToShell) {
      handle.sawRunning = true;
      return false;
    }
    // At the shell prompt: the child exited if we observed it running, or enough
    // time has passed that it must have started and finished.
    const grace =
      handle.launchedAt !== undefined && Date.now() - handle.launchedAt > HERDR_STARTUP_GRACE_MS;
    return handle.sawRunning === true || grace;
  },
  async statusHint(pi, handle) {
    if (handle.paneId === "(pending)") return undefined;
    const info = await pi.exec("herdr", ["pane", "get", handle.paneId], { timeout: 5_000 });
    if (info.code !== 0) return undefined;
    try {
      const status = (JSON.parse(info.stdout) as { result?: { pane?: { agent_status?: unknown } } })
        .result?.pane?.agent_status;
      return typeof status === "string" && status !== "unknown" ? status : undefined;
    } catch {
      return undefined;
    }
  },
  async close(pi, handle) {
    if (handle.paneId && handle.paneId !== "(pending)") {
      await pi.exec("herdr", ["pane", "close", handle.paneId], { timeout: 10_000 });
    }
  },
  commands(handle) {
    const pane = handle.paneId;
    return {
      attach: `herdr agent attach ${pane}`,
      capture: `herdr pane read ${pane} --source visible`,
      kill: `herdr pane close ${pane}`,
    };
  },
  label(handle) {
    return handle.paneId === "(pending)" ? "herdr pane" : `herdr ${handle.paneId}`;
  },
  async reap() {
    // herdr panes are user-visible and lifecycle-managed; auto-close on settle
    // handles our own panes, and we never sweep panes the user may still want.
  },
};

/** Pick the multiplexer that hosts child panes based on the parent's environment. */
function detectBackend(): Backend {
  if (process.env.HERDR_ENV === "1" && process.env.HERDR_PANE_ID) return herdrBackend;
  return tmuxBackend;
}

function applyCommands(spec: RunSpec, backend: Backend, handle: RunHandle): void {
  const commands = backend.commands(handle, spec.attachmentId);
  spec.attachCommand = commands.attach;
  spec.captureCommand = commands.capture;
  spec.killCommand = commands.kill;
  spec.label = backend.label(handle);
}

export default function subagentExtension(pi: ExtensionAPI): void {
  pi.registerFlag(ATTACH_FLAG, {
    description: "Attach using the child session id printed by the subagent tool",
    type: "string",
  });
  const attachTarget = attachFlagValue(process.argv);
  if (attachTarget !== undefined) attachToSubagentAndExit(attachTarget);

  if (process.env[CHILD_ENV] === "1") {
    const resultPath = process.env[RESULT_ENV];
    if (!resultPath) {
      console.error(`[tmux-subagent] ${RESULT_ENV} is required in child mode.`);
      return;
    }
    registerChildReporter(pi, resultPath);
    return;
  }

  const backend = detectBackend();

  void backend.reap(pi).catch(() => {
    // Housekeeping only; never block startup on it.
  });
  void reapStaleRunDirs().catch(() => {
    // Housekeeping only; never block startup on it.
  });

  let queueTail: Promise<void> = Promise.resolve();
  let queueDepth = 0;
  let activeHandle: RunHandle | undefined;

  const withSerialExecution = async <T>(
    signal: AbortSignal | undefined,
    onQueued: () => void,
    fn: () => Promise<T>,
  ): Promise<T> => {
    const queued = queueDepth > 0;
    queueDepth++;
    const previous = queueTail;
    let release!: () => void;
    queueTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    if (queued) onQueued();

    try {
      await previous;
      if (signal?.aborted) throw new Error("Subagent aborted while waiting in the serial queue.");
      return await fn();
    } finally {
      queueDepth--;
      release();
    }
  };

  pi.on("session_shutdown", async () => {
    if (!activeHandle) return;
    await backend.close(pi, activeHandle);
    activeHandle = undefined;
  });

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Run one delegated task in a separate interactive Pi process inside tmux. Calls are serialized: only one child works at a time, even if several calls are requested together. The child inherits the current provider, model, and thinking level unless overridden. Live pane output and a copy/paste pi --attach-subagent command are shown while it runs. Output is capped at 50KB or 2000 lines; the complete child session is preserved on disk.",
    promptSnippet: "Run one delegated task in an observable, tmux-backed Pi session",
    promptGuidelines: [
      "Use subagent once per delegated task; subagent calls are serialized automatically, so prefer multiple simple calls over asking one child to orchestrate other children.",
    ],
    parameters: Type.Object({
      task: Type.String({ description: "The complete task for the child Pi process" }),
      cwd: Type.Optional(
        Type.String({ description: "Working directory. Defaults to the current project." }),
      ),
      provider: Type.Optional(
        Type.String({ description: "Provider override. Defaults to the current provider." }),
      ),
      model: Type.Optional(
        Type.String({
          description: "Model id or provider/model override. Defaults to the current model.",
        }),
      ),
      thinking: Type.Optional(
        StringEnum(THINKING_LEVELS, {
          description: "Thinking level override. Defaults to the current thinking level.",
        }),
      ),
    }),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (!params.task.trim()) throw new Error("Subagent task must not be empty.");
      const cwd = path.resolve(ctx.cwd, params.cwd?.trim() || ".");
      const selectedModel = resolveModel(ctx, params.provider, params.model);
      const thinking = params.thinking ?? pi.getThinkingLevel();
      const childSessionId = randomUUID();
      const runDir = path.join(
        getAgentDir(),
        RUNS_DIR,
        ctx.sessionManager.getSessionId(),
        childSessionId,
      );
      const resultPath = path.join(runDir, "result.json");
      const sessionName = tmuxSessionName(childSessionId);
      const tabLabel = `pi-agent ${childSessionId.slice(0, 8)}`;
      const handle = backend.initialHandle(sessionName);
      const spec: RunSpec = {
        task: params.task,
        cwd,
        attachmentId: childSessionId,
        label: backend.label(handle),
        attachCommand: "",
        captureCommand: "",
        killCommand: "",
        provider: selectedModel.provider,
        model: selectedModel.model,
        thinking,
        trusted: isSameOrDescendant(path.resolve(ctx.cwd), cwd) && ctx.isProjectTrusted(),
      };
      applyCommands(spec, backend, handle);

      return withSerialExecution(
        signal,
        () => {
          const details = detailsFor(spec, "queued");
          onUpdate?.({
            content: [{ type: "text", text: "Waiting for the active subagent to finish..." }],
            details,
          });
        },
        async () => {
          await validateCwd(cwd);
          await mkdir(runDir, { recursive: true, mode: 0o700 });
          const promptPath = path.join(runDir, "task.md");
          const sessionDir = path.join(runDir, "session");
          await mkdir(sessionDir, { recursive: true, mode: 0o700 });
          await writeFile(promptPath, `# Delegated task\n\n${params.task}\n`, {
            encoding: "utf8",
            mode: 0o600,
          });
          await writeJsonAtomic(path.join(runDir, "meta.json"), {
            version: 1,
            backend: backend.kind,
            socket: tmuxSocketPath(),
            tmuxSession: sessionName,
            cwd,
            startedAt: Date.now(),
          });

          const piArgs = [
            ...getPiInvocationParts(),
            "--provider",
            selectedModel.provider,
            "--model",
            selectedModel.model,
            "--thinking",
            thinking,
            "--session-dir",
            sessionDir,
            "--session-id",
            childSessionId,
            "--name",
            sessionName,
            spec.trusted ? "--approve" : "--no-approve",
            "--extension",
            EXTENSION_PATH,
            `@${promptPath}`,
          ];
          const childCommand = backend.wrapLaunch(
            [
              "env",
              `${CHILD_ENV}=1`,
              `${RESULT_ENV}=${shellQuote(resultPath)}`,
              piArgs.map(shellQuote).join(" "),
            ].join(" "),
          );

          await backend.ensureAvailable(pi);

          const startedAt = Date.now();
          // Track before create so a mid-create failure is still torn down on shutdown.
          activeHandle = handle;
          await backend.create(pi, { cwd, label: tabLabel, handle });
          applyCommands(spec, backend, handle);

          const settle = async (): Promise<void> => {
            if (backend.autoCloseOnSettle) await backend.close(pi, handle);
            if (activeHandle === handle) activeHandle = undefined;
          };

          try {
            const initialDetails = detailsFor(spec, "running", { startedAt });
            onUpdate?.({
              content: [{ type: "text", text: partialText(initialDetails) }],
              details: initialDetails,
            });

            await backend.launch(pi, handle, childCommand);

            let lastPreview = "";
            let lastFrame = "";
            let childResult: ChildResult | undefined;
            while (!childResult) {
              if (signal?.aborted) throw new Error("Subagent aborted.");
              try {
                childResult = JSON.parse(await readFile(resultPath, "utf8")) as ChildResult;
                break;
              } catch {
                // The result file is created atomically when the child settles.
              }

              // Prefer the child's structured session log over scraping its TUI.
              const preview = readSessionActivity(sessionDir) ?? "Working\u2026 (no output yet)";
              const agentStatus = await backend.statusHint(pi, handle);
              lastPreview = preview;
              const frame = `${agentStatus ?? ""}\u0000${preview}`;
              if (frame !== lastFrame) {
                lastFrame = frame;
                const details = detailsFor(spec, "running", {
                  pane: preview,
                  agentStatus,
                  startedAt,
                });
                onUpdate?.({ content: [{ type: "text", text: partialText(details) }], details });
              }

              if (await backend.hasExited(pi, handle)) {
                await abortableDelay(100, signal);
                try {
                  childResult = JSON.parse(await readFile(resultPath, "utf8")) as ChildResult;
                  break;
                } catch {
                  await settle();
                  throw new Error(
                    `Child Pi exited before reporting a result.\n\n${lastPreview || "No output."}\n\nInspect: ${spec.captureCommand}`,
                  );
                }
              }

              await abortableDelay(POLL_INTERVAL_MS, signal);
            }

            const finalPreview = readSessionActivity(sessionDir) ?? lastPreview;
            const status: RunStatus = childResult.status === "completed" ? "completed" : "failed";
            let rawOutput = childResult.output.trim();
            if (childResult.status === "failed" && childResult.error?.trim()) {
              rawOutput += `${rawOutput ? "\n\n" : ""}Error: ${childResult.error.trim()}`;
            }
            const output = truncateToolText(rawOutput || "(no text output)");
            const details = detailsFor(spec, status, {
              pane: finalPreview,
              output,
              sessionFile: childResult.sessionFile,
              provider: childResult.provider ?? spec.provider,
              model: childResult.model ?? spec.model,
              thinking: childResult.thinking ?? spec.thinking,
              startedAt,
              finishedAt: childResult.finishedAt,
            });

            await settle();
            if (childResult.status === "failed") {
              throw new Error(resultText(details));
            }
            return {
              content: [{ type: "text", text: resultText(details) }],
              details,
            };
          } catch (error) {
            if (signal?.aborted) {
              await backend.close(pi, handle);
              activeHandle = undefined;
            }
            throw error;
          } finally {
            if (activeHandle === handle) activeHandle = undefined;
          }
        },
      );
    },

    renderCall(args, theme) {
      const task = args.task?.trim() || "...";
      const firstLine = task.split("\n", 1)[0] ?? task;
      const preview = firstLine.length > 100 ? `${firstLine.slice(0, 100)}…` : firstLine;
      let text = theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("dim", preview);
      const overrides = [args.provider, args.model, args.thinking].filter(Boolean);
      if (overrides.length > 0) text += `\n  ${theme.fg("muted", overrides.join(" · "))}`;
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme) {
      const details = result.details as RunDetails | undefined;
      if (!details) {
        const content = result.content.find((part) => part.type === "text");
        return new Text(content?.type === "text" ? content.text : "(no output)", 0, 0);
      }

      const running = isPartial || details.status === "queued" || details.status === "running";
      const blocked = running && details.agentStatus === "blocked";
      const icon = blocked
        ? theme.fg("error", "⚠")
        : running
          ? theme.fg("warning", details.status === "queued" ? "◦" : "●")
          : details.status === "completed"
            ? theme.fg("success", "✓")
            : theme.fg("error", "✗");
      const duration = formatDuration(details.startedAt, details.finishedAt);
      const statusExtra = running && details.agentStatus ? ` · ${details.agentStatus}` : "";
      let text = `${icon} ${theme.fg("toolTitle", theme.bold(details.label))}`;
      text += theme.fg(
        "muted",
        ` · ${details.status}${statusExtra}${duration ? ` · ${duration}` : ""}`,
      );
      text += `\n  ${theme.fg("accent", details.attachCommand)}`;
      text += `\n  ${theme.fg("dim", `${details.provider}/${details.model} (${details.thinking})`)}`;

      if (running && details.pane) {
        const paneLines = details.pane.split("\n");
        const visible = expanded ? paneLines : paneLines.slice(-8);
        text += `\n\n${visible.map((line) => theme.fg("dim", line)).join("\n")}`;
      } else if (!running && details.output) {
        const outputLines = details.output.split("\n");
        const visible = expanded ? outputLines : outputLines.slice(0, 8);
        text += `\n\n${visible.map((line) => theme.fg("toolOutput", line)).join("\n")}`;
        if (!expanded && outputLines.length > visible.length)
          text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
        text += `\n\n  ${theme.fg("dim", `capture: ${details.captureCommand}`)}`;
        text += `\n  ${theme.fg("dim", `cleanup: ${details.killCommand}`)}`;
      }
      return new Text(text, 0, 0);
    },
  });
}
