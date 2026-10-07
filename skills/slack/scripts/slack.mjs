#!/usr/bin/env node

/**
 * Slack MCP CLI backed by the user's claude.ai Slack connector.
 *
 * Calls Anthropic's MCP proxy directly: no model request and no Claude CLI
 * subprocess. Authentication comes from CLAUDE_CODE_OAUTH_TOKEN, macOS
 * Keychain, or ~/.claude/.credentials.json. Secrets are never printed.
 *
 * No npm dependencies; requires Node.js 20+.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const REGISTRY_URL = "https://api.anthropic.com/v1/mcp_servers?limit=1000";
const PROXY_BASE = process.env.ANTHROPIC_MCP_PROXY_URL ?? "https://mcp-proxy.anthropic.com/v1/mcp";
const ANTHROPIC_VERSION = "2023-06-01";
const MCP_REGISTRY_BETA = "mcp-servers-2025-12-04";
const PROTOCOL_VERSION = "2025-06-18";
const KEYCHAIN_SERVICE = "Claude Code-credentials";
const DEFAULT_TIMEOUT_MS = 30_000;
const CATCHUP_STATE_DIR = join(homedir(), ".cache", "slack-catchup");
const CATCHUP_PAGE_LIMIT = 20;
const CATCHUP_DEFAULT_MAX = 200;
const CATCHUP_DEFAULT_SINCE = "24h";
const CATCHUP_MAX_PARENT_LOOKUPS = 12;

const READ_TOOLS = new Set([
  "slack_search_public",
  "slack_search_public_and_private",
  "slack_search_channels",
  "slack_search_users",
  "slack_search_emojis",
  "slack_read_channel",
  "slack_read_thread",
  "slack_read_canvas",
  "slack_read_user_profile",
  "slack_read_file",
  "slack_list_channel_members",
  "slack_get_reactions",
]);

function fail(message, details) {
  const error = new Error(message);
  if (details) error.details = details;
  throw error;
}

function parseJson(text, label, { sensitive = false } = {}) {
  try {
    return JSON.parse(text);
  } catch {
    fail(`${label} returned invalid JSON.`, sensitive ? undefined : text.slice(0, 500));
  }
}

function credentialsFromObject(record, source) {
  const oauth = record?.claudeAiOauth;
  if (!oauth?.accessToken) return null;
  return {
    accessToken: oauth.accessToken,
    expiresAt: typeof oauth.expiresAt === "number" ? oauth.expiresAt : null,
    scopes: Array.isArray(oauth.scopes) ? oauth.scopes : [],
    source,
  };
}

function loadCredentials() {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return {
      accessToken: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      expiresAt: null,
      scopes: [],
      source: "CLAUDE_CODE_OAUTH_TOKEN",
    };
  }

  if (process.platform === "darwin") {
    try {
      const text = execFileSync(
        "security",
        ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      const credentials = credentialsFromObject(
        parseJson(text, "macOS Keychain credential", { sensitive: true }),
        "macOS Keychain",
      );
      if (credentials) return credentials;
    } catch (error) {
      if (process.env.SLACK_MCP_DEBUG === "1") {
        console.error(`slack: macOS Keychain credential unavailable: ${error.message}`);
      }
      // Fall through to the credentials file.
    }
  }

  const credentialsPath = join(homedir(), ".claude", ".credentials.json");
  if (existsSync(credentialsPath)) {
    const credentials = credentialsFromObject(
      parseJson(readFileSync(credentialsPath, "utf8"), credentialsPath, { sensitive: true }),
      credentialsPath,
    );
    if (credentials) return credentials;
  }

  fail(
    "Claude OAuth credentials not found. Set CLAUDE_CODE_OAUTH_TOKEN or sign in to Claude Code once.",
  );
}

function validateCredentials(credentials) {
  if (credentials.expiresAt !== null && credentials.expiresAt <= Date.now() + 30_000) {
    fail(
      `Claude OAuth token from ${credentials.source} is expired. Refresh it with Claude Code or set a current CLAUDE_CODE_OAUTH_TOKEN.`,
    );
  }
  if (credentials.scopes.length > 0 && !credentials.scopes.includes("user:mcp_servers")) {
    fail(`Claude OAuth token from ${credentials.source} lacks the user:mcp_servers scope.`);
  }
}

function timeoutSignal(ms = DEFAULT_TIMEOUT_MS) {
  return AbortSignal.timeout(ms);
}

async function responseBody(response) {
  const text = await response.text();
  if (!text.trim()) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const messages = text
      .split(/\r?\n\r?\n/)
      .map((event) =>
        event
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n"),
      )
      .filter(Boolean)
      .map((data) => parseJson(data, "MCP event"));
    if (messages.length === 0) fail("MCP proxy returned an empty event stream.", text.slice(0, 500));
    return messages.at(-1);
  }
  if (!text) return null;
  return parseJson(text, "HTTP endpoint");
}

async function checkedFetch(url, options, label) {
  const response = await fetch(url, { ...options, signal: options.signal ?? timeoutSignal() });
  const body = await responseBody(response);
  if (!response.ok) {
    const message = body?.error?.message ?? body?.message ?? `${label} failed`;
    fail(`${message} (HTTP ${response.status})`);
  }
  return { response, body };
}

async function findSlackConnector(accessToken) {
  const { body } = await checkedFetch(
    REGISTRY_URL,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-beta": MCP_REGISTRY_BETA,
      },
    },
    "Connector registry request",
  );

  const connectors = Array.isArray(body?.data) ? body.data : [];
  const configuredId = process.env.SLACK_MCP_CONNECTOR_ID;
  const connector = configuredId
    ? connectors.find((item) => item.id === configuredId)
    : (connectors.find((item) => item.display_name?.toLowerCase() === "slack")
      ?? connectors.find((item) => item.display_name?.toLowerCase().startsWith("slack ")));

  if (!connector) fail("Slack connector was not found in the claude.ai connector registry.");
  return connector;
}

class McpSession {
  constructor(accessToken, connectorId, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.accessToken = accessToken;
    this.connectorId = connectorId;
    this.timeoutMs = timeoutMs;
    this.clientSessionId = randomUUID();
    this.sessionId = null;
    this.nextId = 1;
  }

  get url() {
    return `${PROXY_BASE}/${encodeURIComponent(this.connectorId)}`;
  }

  headers(includeSession = true) {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "X-Mcp-Client-Session-Id": this.clientSessionId,
      ...(includeSession && this.sessionId
        ? { "Mcp-Session-Id": this.sessionId, "MCP-Protocol-Version": PROTOCOL_VERSION }
        : {}),
    };
  }

  async post(payload, { includeSession = true } = {}) {
    const { response, body } = await checkedFetch(
      this.url,
      {
        method: "POST",
        headers: this.headers(includeSession),
        body: JSON.stringify(payload),
        signal: timeoutSignal(this.timeoutMs),
      },
      `MCP ${payload.method ?? "request"}`,
    );
    return { response, body };
  }

  async connect() {
    const id = this.nextId++;
    const { response, body } = await this.post(
      {
        jsonrpc: "2.0",
        id,
        method: "initialize",
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "agent-stuff-slack", version: "1.0.0" },
        },
      },
      { includeSession: false },
    );
    if (body?.error) fail(`Slack MCP initialize failed: ${body.error.message ?? JSON.stringify(body.error)}`);
    this.sessionId = response.headers.get("mcp-session-id");
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
    return body?.result;
  }

  async request(method, params = {}) {
    const id = this.nextId++;
    const { body } = await this.post({ jsonrpc: "2.0", id, method, params });
    if (body?.error) fail(`Slack MCP ${method} failed: ${body.error.message ?? JSON.stringify(body.error)}`);
    return body?.result;
  }

  async close() {
    if (!this.sessionId) return;
    try {
      await fetch(this.url, {
        method: "DELETE",
        headers: this.headers(),
        signal: timeoutSignal(5_000),
      });
    } catch {
      // Session cleanup is best-effort.
    }
  }
}

function isWriteTool(name) {
  return !READ_TOOLS.has(name);
}

function makeCaller(session) {
  return async (name, callArgs = {}, { confirmWrite = false } = {}) => {
    if (isWriteTool(name) && !confirmWrite) {
      fail(`${name} may modify Slack. Pass { confirmWrite: true } after explicit user confirmation.`);
    }
    const result = await session.request("tools/call", { name, arguments: callArgs });
    if (result?.isError) {
      const value = toolText(result);
      fail(typeof value === "string" ? value : JSON.stringify(value));
    }
    return toolText(result);
  };
}

function toolText(result) {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  const text = blocks
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function printToolResult(result, asJson) {
  const value = toolText(result);
  if (asJson) {
    console.log(JSON.stringify({ ok: !result?.isError, result: value }, null, 2));
    if (result?.isError) process.exitCode = 1;
    return;
  }
  if (result?.isError) fail(typeof value === "string" ? value : JSON.stringify(value));
  if (typeof value === "string") {
    process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
    return;
  }
  if (value && typeof value === "object") {
    const primary = value.messages ?? value.results;
    if (typeof primary === "string") process.stdout.write(primary.endsWith("\n") ? primary : `${primary}\n`);
    else console.log(JSON.stringify(value, null, 2));
    if (value.pagination_info) process.stdout.write(`\n${value.pagination_info}\n`);
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}

/* ------------------------------ catchup ------------------------------ */

function parsePermalink(value) {
  const match = /\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})/.exec(value);
  if (!match) return null;
  let threadTs = null;
  try {
    threadTs = new URL(value).searchParams.get("thread_ts");
  } catch {
    const raw = /thread_ts=([\d.]+)/.exec(value);
    threadTs = raw ? raw[1] : null;
  }
  return { channelId: match[1], ts: `${match[2]}.${match[3]}`, threadTs };
}

function parseTimestampLike(value) {
  const text = String(value).trim();

  const permalink = parsePermalink(text);
  if (permalink) return Number(permalink.threadTs ?? permalink.ts);

  const duration = /^(\d+(?:\.\d+)?)\s*(m|min|mins|h|hr|hrs|d|day|days|w|wk|weeks?)$/i.exec(text);
  if (duration) {
    const amount = Number(duration[1]);
    const unit = duration[2].toLowerCase();
    const seconds = unit.startsWith("m") ? 60 : unit.startsWith("h") ? 3600 : unit.startsWith("d") ? 86400 : 604800;
    return Date.now() / 1000 - amount * seconds;
  }

  if (/^\d{10}(\.\d{1,6})?$/.test(text)) return Number(text);
  if (/^\d{16}$/.test(text)) return Number(`${text.slice(0, 10)}.${text.slice(10)}`);

  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00` : text);
  if (Number.isNaN(parsed)) {
    fail(`Cannot read time value '${value}'. Use 2h, 3d, 2026-09-20, a Slack ts, a permalink, or 'last'.`);
  }
  return parsed / 1000;
}

function statePath(key) {
  return join(CATCHUP_STATE_DIR, `${key.replace(/[^\w.-]/g, "_")}.json`);
}

function readWatermark(key) {
  const path = statePath(key);
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8"))?.ts;
    return typeof value === "number" ? value : null;
  } catch {
    return null;
  }
}

function writeWatermark(key, ts) {
  try {
    mkdirSync(CATCHUP_STATE_DIR, { recursive: true });
    writeFileSync(statePath(key), JSON.stringify({ ts, savedAt: new Date().toISOString() }, null, 2));
  } catch {
    // Watermarks are best-effort.
  }
}

function dayFilter(seconds) {
  const date = new Date((seconds - 2 * 86400) * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return `after:${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function nextCursor(paginationInfo) {
  const match = /`([^`]+)`/.exec(paginationInfo ?? "");
  return match ? match[1] : null;
}

function splitTrailingMeta(body) {
  const extras = [];
  const text = String(body ?? "")
    .replace(/^(Reactions|Files):[ \t]*(.*)$/gm, (_line, label, value) => {
      extras.push(`${label.toLowerCase()}: ${value.trim()}`);
      return "";
    })
    .trim();
  return { text, extras };
}

function parseSearchBlocks(text) {
  const messages = [];
  const blocks = String(text ?? "").split(/^### Result \d+ of \d+\s*$/m).slice(1);
  for (const block of blocks) {
    const body = block.split(/^---\s*$/m)[0];
    const field = (name) => {
      const match = new RegExp(`^${name}:[ \\t]*(.*)$`, "m").exec(body);
      return match ? match[1].trim() : "";
    };
    const ts = field("Message_ts");
    if (!ts) continue;
    const channel = /^Channel:\s*#?([^(]*?)\s*(?:\(ID:\s*([A-Z0-9]+)\))?\s*$/m.exec(body);
    const participants = [...field("Participants").matchAll(/([^,(]+?)\s*\(ID:\s*(U[A-Z0-9]+)\)/g)].map((match) => ({
      name: match[1].trim(),
      id: match[2],
    }));
    const from = /^From:\s*(.*?)\s*(?:<([^>]*)>)?\s*(?:\(ID:\s*([A-Z0-9]+)\))?\s*$/m.exec(body);
    const permalink = /^Permalink:\s*(?:\[link\]\()?(\S+?)\)?\s*$/m.exec(body);
    const textMatch = /^Text:[ \t]*\n?([\s\S]*)$/m.exec(body);
    const link = permalink ? permalink[1] : "";
    const threadFromLink = /thread_ts=([\d.]+)/.exec(link);
    const replyCount = Number(field("Reply count") || 0);
    const { text: cleanText, extras } = splitTrailingMeta(textMatch ? textMatch[1] : "");
    messages.push({
      channel: channel ? channel[1].trim() : "unknown",
      channelId: channel?.[2] ?? "",
      participants,
      user: from ? from[1].trim() : "unknown",
      userId: from?.[3] ?? "",
      time: field("Time"),
      ts,
      tsNumber: Number(ts),
      replyCount: Number.isFinite(replyCount) ? replyCount : 0,
      permalink: link,
      threadTs: threadFromLink ? threadFromLink[1] : replyCount > 0 ? ts : null,
      text: cleanText,
      extras,
    });
  }
  return messages;
}

function parseThreadBlocks(text, channel, channelId, threadTs) {
  const messages = [];
  const sections = String(text ?? "").split(/^--- Reply \d+ of \d+ ---\s*$/m).slice(1);
  for (const section of sections) {
    const from = /^From:\s*(.*?)\s*(?:<([^>]*)>)?\s*(?:\((U[A-Z0-9]+)\))?\s*$/m.exec(section);
    const time = /^Time:\s*(.*)$/m.exec(section);
    const ts = /^Message TS:\s*([\d.]+)\s*$/m.exec(section);
    if (!ts) continue;
    const { text: body, extras } = splitTrailingMeta(section.slice(section.indexOf(ts[0]) + ts[0].length));
    messages.push({
      channel,
      channelId,
      participants: [],
      user: from ? from[1].trim() : "unknown",
      userId: from?.[3] ?? "",
      time: time ? time[1].trim() : "",
      ts: ts[1],
      tsNumber: Number(ts[1]),
      replyCount: 0,
      permalink: "",
      threadTs,
      text: body,
      extras,
    });
  }
  return messages;
}

function threadParentSummary(text) {
  const block = /=== THREAD PARENT MESSAGE ===([\s\S]*?)(?:=== THREAD REPLIES|$)/.exec(String(text ?? ""));
  if (!block) return null;
  const from = /^From:\s*(.*?)\s*(?:<[^>]*>)?\s*(?:\(U[A-Z0-9]+\))?\s*$/m.exec(block[1]);
  const ts = /^Message TS:\s*([\d.]+)\s*$/m.exec(block[1]);
  const body = ts ? block[1].slice(block[1].indexOf(ts[0]) + ts[0].length) : block[1];
  return { user: from ? from[1].trim() : "unknown", text: splitTrailingMeta(body).text };
}

async function resolveChannel(call, name) {
  const wanted = name.replace(/^#/, "").toLowerCase();
  const result = await call("slack_search_channels", { query: wanted, limit: 20, response_format: "detailed" });
  const text = typeof result === "string" ? result : (result?.results ?? "");
  const found = [];
  for (const block of String(text).split(/^### Result \d+ of \d+\s*$/m).slice(1)) {
    const channelName = /^Name:\s*#?(.*)$/m.exec(block);
    const id = /\/archives\/([A-Z0-9]+)/.exec(block);
    if (channelName && id) found.push({ name: channelName[1].trim(), id: id[1] });
  }
  if (found.length === 0) fail(`No channel matched '${name}'.`);
  const exact = found.find((item) => item.name.toLowerCase() === wanted);
  if (exact) return exact;
  if (found.length === 1) return found[0];
  fail(`'${name}' is ambiguous: ${found.slice(0, 8).map((item) => `#${item.name} (${item.id})`).join(", ")}.`);
}

async function currentUserId(session) {
  const list = await session.request("tools/list");
  for (const tool of list?.tools ?? []) {
    const match = /user_id is (U[A-Z0-9]+)/.exec(tool.description ?? "");
    if (match) return match[1];
  }
  return null;
}

async function searchSince(call, { filters, keywords, after, before, max, includeBots }) {
  const messages = [];
  let cursor;
  let truncated = false;
  while (messages.length < max) {
    const result = await call("slack_search_public_and_private", {
      keywords,
      filters,
      natural_language_query: "",
      content_types: "messages",
      after: String(Math.floor(after)),
      ...(before ? { before: String(Math.ceil(before)) } : {}),
      sort: "timestamp",
      sort_dir: "asc",
      response_format: "detailed",
      include_context: false,
      include_bots: Boolean(includeBots),
      limit: CATCHUP_PAGE_LIMIT,
      ...(cursor ? { cursor } : {}),
    });
    const page = parseSearchBlocks(typeof result === "string" ? result : result?.results);
    messages.push(...page);
    cursor = nextCursor(typeof result === "string" ? "" : result?.pagination_info);
    if (!cursor || page.length === 0) break;
    if (messages.length >= max) truncated = true;
  }
  return { messages: messages.slice(0, max), truncated: truncated || messages.length > max };
}

async function catchupThread(call, target, since, options) {
  const max = options.max ?? CATCHUP_DEFAULT_MAX;
  const messages = [];
  let cursor;
  let parent = null;
  while (messages.length < max) {
    const result = await call("slack_read_thread", {
      channel_id: target.channelId,
      message_ts: target.threadTs,
      oldest: String(Math.floor(since)),
      response_format: "detailed",
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    const text = typeof result === "string" ? result : (result?.messages ?? "");
    parent ??= threadParentSummary(text);
    messages.push(...parseThreadBlocks(text, target.channel ?? target.channelId, target.channelId, target.threadTs));
    cursor = nextCursor(typeof result === "string" ? "" : result?.pagination_info);
    if (!cursor) break;
  }
  return {
    messages: messages.filter((message) => message.tsNumber > since).slice(0, max),
    parents: parent ? new Map([[target.threadTs, parent]]) : new Map(),
    truncated: messages.length > max,
  };
}

function channelLabel(entry, me) {
  if (/^(DM|Group DM|MPIM)$/i.test(entry.channel)) {
    const names = (entry.participants ?? []).filter((person) => person.id !== me).map((person) => person.name);
    return names.length > 0 ? `DM ${names.join(", ")}` : entry.channel;
  }
  return /^[CGD][A-Z0-9]{6,}$/.test(entry.channel) ? entry.channel : `#${entry.channel}`;
}

function groupForRender(messages) {
  const channels = new Map();
  for (const message of messages) {
    const key = message.channelId || message.channel;
    if (!channels.has(key)) {
      channels.set(key, {
        channel: message.channel,
        channelId: message.channelId,
        participants: message.participants ?? [],
        groups: new Map(),
      });
    }
    const entry = channels.get(key);
    const groupKey = message.threadTs ?? `solo:${message.ts}`;
    if (!entry.groups.has(groupKey)) entry.groups.set(groupKey, { threadTs: message.threadTs, messages: [] });
    entry.groups.get(groupKey).messages.push(message);
  }
  return channels;
}

function renderCatchup({ messages, parents, truncated, label, target, me }) {
  const lines = [];
  const header = `# Catchup · ${target} · since ${label} · ${messages.length} message${messages.length === 1 ? "" : "s"}`;
  lines.push(header, "");
  if (messages.length === 0) {
    lines.push("Nothing new.");
    return `${lines.join("\n")}\n`;
  }

  for (const entry of groupForRender(messages).values()) {
    const count = [...entry.groups.values()].reduce((total, group) => total + group.messages.length, 0);
    lines.push(`## ${channelLabel(entry, me)} — ${count} new`);
    for (const group of entry.groups.values()) {
      if (group.threadTs) {
        const parent = parents.get(group.threadTs);
        const parentInSet = group.messages.some((message) => message.ts === group.threadTs);
        const summary = parent
          ? `${parent.user}: ${parent.text.replace(/\s+/g, " ").slice(0, 110)}`
          : parentInSet
            ? ""
            : `thread ${group.threadTs}`;
        lines.push(summary ? `### thread · ${summary}` : "### thread");
        const link = group.messages.find((message) => message.permalink)?.permalink;
        if (link) lines.push(link);
      }
      const indent = group.threadTs ? "  " : "";
      for (const message of group.messages) {
        const stamp = message.time.slice(5, 16) || message.ts;
        const marker = message.ts === group.threadTs ? " [parent]" : "";
        const body = message.text.replace(/\n/g, `\n${indent}    `);
        const extras = message.extras?.length > 0 ? ` [${message.extras.join("; ")}]` : "";
        lines.push(`${indent}${stamp} ${message.user}${marker}: ${body}${extras}`);
      }
      if (group.threadTs) lines.push("");
    }
    lines.push("");
  }
  if (truncated) lines.push("Truncated. Re-run with a larger --max or a later --since.");
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

async function runCatchup(session, call, args, options) {
  const rawTarget = args[0];
  const permalink = rawTarget ? parsePermalink(rawTarget) : null;
  const explicitThread = options.threadTs ?? permalink?.threadTs ?? null;

  let scope = { key: "all", label: "all my channels", filters: dayFilter(0), keywords: [] };
  let threadTarget = null;

  if (permalink) {
    if (explicitThread) {
      threadTarget = { channelId: permalink.channelId, threadTs: explicitThread, channel: permalink.channelId };
    } else {
      scope = {
        key: permalink.channelId,
        label: permalink.channelId,
        filters: `in:<#${permalink.channelId}>`,
        keywords: [],
        defaultSince: permalink.ts,
      };
    }
  } else if (options.dms) {
    scope = { key: "dms", label: "DMs", filters: "is:dm", keywords: [] };
  } else if (options.mentions) {
    const me = await currentUserId(session);
    if (!me) fail("Cannot determine your Slack user ID for --mentions.");
    scope = { key: "mentions", label: "mentions", filters: "", keywords: [`<@${me}>`] };
  } else if (rawTarget && /^[CGD][A-Z0-9]{6,}$/.test(rawTarget)) {
    if (options.threadTs) threadTarget = { channelId: rawTarget, threadTs: options.threadTs, channel: rawTarget };
    else scope = { key: rawTarget, label: rawTarget, filters: `in:<#${rawTarget}>`, keywords: [] };
  } else if (rawTarget && /^U[A-Z0-9]{6,}$/.test(rawTarget)) {
    scope = { key: rawTarget, label: `DM ${rawTarget}`, filters: `is:dm with:<@${rawTarget}>`, keywords: [] };
  } else if (rawTarget && !options.all) {
    const channel = await resolveChannel(call, rawTarget);
    if (options.threadTs) threadTarget = { channelId: channel.id, threadTs: options.threadTs, channel: channel.name };
    else scope = { key: channel.id, label: `#${channel.name}`, filters: `in:<#${channel.id}>`, keywords: [] };
  }

  const stateKey = threadTarget ? `thread-${threadTarget.channelId}-${threadTarget.threadTs}` : scope.key;
  const sinceInput = options.since ?? scope.defaultSince ?? CATCHUP_DEFAULT_SINCE;
  let since;
  if (sinceInput === "last") {
    since = readWatermark(stateKey);
    if (since === null) {
      since = parseTimestampLike(CATCHUP_DEFAULT_SINCE);
      process.stderr.write(`slack: no saved watermark for ${stateKey}; using ${CATCHUP_DEFAULT_SINCE}.\n`);
    }
  } else {
    since = parseTimestampLike(sinceInput);
  }
  const until = options.until ? parseTimestampLike(options.until) : null;
  const label = `${new Date(since * 1000).toLocaleString()}${until ? ` until ${new Date(until * 1000).toLocaleString()}` : ""}`;

  let messages;
  let truncated;
  const parents = new Map();

  if (threadTarget) {
    if (/^[CGD][A-Z0-9]{6,}$/.test(threadTarget.channel)) {
      const head = await call("slack_read_channel", {
        channel_id: threadTarget.channelId,
        limit: 1,
        response_format: "concise",
      }).catch(() => null);
      const name = /^Channel:\s*#?(\S+)\s*\(/m.exec(typeof head === "string" ? head : (head?.messages ?? ""));
      if (name) threadTarget.channel = name[1];
    }
    const result = await catchupThread(call, threadTarget, since, options);
    messages = result.messages;
    truncated = result.truncated;
    for (const [key, value] of result.parents) parents.set(key, value);
  } else {
    const filters = [scope.filters, scope.filters.includes("after:") ? "" : dayFilter(since)]
      .filter(Boolean)
      .join(" ")
      .trim();
    const result = await searchSince(call, {
      filters,
      keywords: scope.keywords,
      after: since,
      before: until,
      max: options.max ?? CATCHUP_DEFAULT_MAX,
      includeBots: options.bots,
    });
    messages = result.messages.filter((message) => message.tsNumber > since && (!until || message.tsNumber <= until));
    truncated = result.truncated;

    if (!options.noContext) {
      const present = new Set(messages.map((message) => message.ts));
      const orphans = [...new Set(messages.map((message) => message.threadTs).filter(Boolean))]
        .filter((threadTs) => !present.has(threadTs))
        .slice(0, CATCHUP_MAX_PARENT_LOOKUPS);
      for (const threadTs of orphans) {
        const channelId = messages.find((message) => message.threadTs === threadTs)?.channelId;
        if (!channelId) continue;
        try {
          const result = await call("slack_read_thread", {
            channel_id: channelId,
            message_ts: threadTs,
            limit: 1,
            response_format: "detailed",
          });
          const parent = threadParentSummary(typeof result === "string" ? result : result?.messages);
          if (parent) parents.set(threadTs, parent);
        } catch {
          // Thread context is best-effort.
        }
      }
    }
  }

  messages.sort((left, right) => left.tsNumber - right.tsNumber);
  const me = messages.some((message) => /^(DM|Group DM|MPIM)$/i.test(message.channel))
    ? await currentUserId(session)
    : null;
  let scopeLabel = scope.label;
  if (!threadTarget && /^[CGD][A-Z0-9]{6,}$/.test(scopeLabel) && messages.length > 0) {
    scopeLabel = channelLabel({ channel: messages[0].channel, participants: messages[0].participants }, me);
  }
  const targetLabel = threadTarget
    ? `thread ${threadTarget.threadTs} in ${channelLabel({ channel: threadTarget.channel }, me)}`
    : scopeLabel;

  if (!options.noSave) {
    const newest = messages.length > 0 ? messages.at(-1).tsNumber : since;
    writeWatermark(stateKey, Math.max(newest, readWatermark(stateKey) ?? 0));
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          target: targetLabel,
          since,
          sinceLabel: label,
          until,
          truncated,
          count: messages.length,
          threads: Object.fromEntries(parents),
          messages: options.brief
            ? messages.map((message) => ({ ...message, text: message.text.slice(0, 200) }))
            : messages,
        },
        null,
        2,
      ),
    );
    return;
  }

  const rendered = options.brief
    ? messages.map((message) => ({ ...message, text: message.text.replace(/\s+/g, " ").slice(0, 200) }))
    : messages;
  process.stdout.write(renderCatchup({ messages: rendered, parents, truncated, label, target: targetLabel, me }));
}

/* ---------------------------------------------------------------------- */

function parseCli(argv) {
  const positional = [];
  const options = { limit: undefined, json: false, confirmWrite: false, publicOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--confirm-write") options.confirmWrite = true;
    else if (arg === "--public") options.publicOnly = true;
    else if (arg === "--dms") options.dms = true;
    else if (arg === "--mentions") options.mentions = true;
    else if (arg === "--all") options.all = true;
    else if (arg === "--bots") options.bots = true;
    else if (arg === "--brief") options.brief = true;
    else if (arg === "--no-context") options.noContext = true;
    else if (arg === "--no-save") options.noSave = true;
    else if (arg === "--since") {
      options.since = argv[++index];
      if (!options.since) fail("--since requires a value (2h, 3d, 2026-09-20, a ts, a permalink, or 'last').");
    } else if (arg === "--until") {
      options.until = argv[++index];
      if (!options.until) fail("--until requires a value.");
    } else if (arg === "--max") {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 1 || value > 1000) fail("--max must be an integer from 1 to 1000.");
      options.max = value;
    } else if (arg === "--thread") {
      options.threadTs = argv[++index];
      if (!options.threadTs) fail("--thread requires a message timestamp.");
    } else if (arg === "--limit") {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 1 || value > 100) fail("--limit must be an integer from 1 to 100.");
      options.limit = value;
    } else if (arg === "--timeout") {
      const value = Number(argv[++index]);
      if (!Number.isFinite(value) || value < 1) fail("--timeout must be a positive number of milliseconds.");
      options.timeout = Math.min(value, 5 * 60_000);
    } else if (arg === "-h" || arg === "--help") options.help = true;
    else positional.push(arg);
  }
  return { positional, options };
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

async function parseArgumentsJson(value) {
  const text = value === "-" ? await readStdin() : value;
  if (!text?.trim()) return {};
  const parsed = parseJson(text, "Tool arguments");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("Tool arguments must be a JSON object.");
  return parsed;
}

function help() {
  console.log(`Slack MCP CLI - use claude.ai Slack connector without model inference

Usage:
  slack.mjs auth
  slack.mjs tools [--json]
  slack.mjs call <tool-name> '<arguments-json>' [--confirm-write] [--json]
  slack.mjs exec '<script>' [--json]
  slack.mjs channels <query> [--limit N] [--json]
  slack.mjs messages <channel-or-user-id> [--limit N] [--json]
  slack.mjs thread <channel-id> <message-ts> [--json]
  slack.mjs catchup [<channel|#name|channel-id|user-id|permalink>] [--dms|--mentions|--all]
                    [--since 2h|3d|2026-09-20|<ts>|<permalink>|last] [--until <time>]
                    [--thread <ts>] [--max N] [--brief] [--bots] [--no-context] [--no-save] [--json]
  slack.mjs search <query> [--limit N] [--public] [--json]
  slack.mjs users <query> [--limit N] [--json]
  slack.mjs profile <user-id> [--json]
  slack.mjs draft <channel-or-user-id> <message|-> [--thread <message-ts>] --confirm-write [--json]

catchup: Everything new since a time, including replies to older threads, grouped
  by channel and thread. Default --since 24h. 'last' resumes from the saved
  watermark in ~/.cache/slack-catchup; every run saves a new one unless --no-save.
  A permalink with thread_ts catches up that thread; one without it means
  "this channel since that message".

exec: Run custom JS with 'call(toolName, args, opts)' and 'tools' available.
  Script from arg or stdin. Writes require { confirmWrite: true } in call opts.

Examples:
  slack.mjs channels ai-hub
  slack.mjs messages C0123456789 --limit 20
  slack.mjs catchup ai-hub --since 3d
  slack.mjs catchup --mentions --since last
  slack.mjs catchup --dms --since 8h --brief
  slack.mjs catchup 'https://acme.slack.com/archives/C0123456789/p1784801848744239?thread_ts=1784801848.744239'
  slack.mjs search 'from:alice after:2026-07-01 release'
  slack.mjs draft C123 'Editable text, not sent' --confirm-write
  printf '%s' 'Multiline draft' | slack.mjs draft C123 - --thread 1784801848.744239 --confirm-write
  slack.mjs call slack_send_message '{"channel_id":"C123","message":"Hello"}' --confirm-write
  printf '%s' '{"query":"general"}' | slack.mjs call slack_search_channels - --json

  # exec: custom JS
  slack.mjs exec 'const ch = await call("slack_search_channels", {query:"general",limit:1}); return ch;'

Auth order: CLAUDE_CODE_OAUTH_TOKEN, macOS Keychain, ~/.claude/.credentials.json.
Writes, including drafts, are blocked unless --confirm-write is provided.`);
}

function limitFor(command, requested, maximum, fallback = 20) {
  if (requested !== undefined && requested > maximum) {
    fail(`${command} supports --limit up to ${maximum}. Use pagination for additional results.`);
  }
  return requested ?? fallback;
}

async function draftToCall(args, options) {
  const channelId = args[0];
  if (!channelId) fail("Usage: draft <channel-or-user-id> <message|-> [--thread <message-ts>] --confirm-write");

  const messageArgs = args.slice(1);
  let message;
  if (messageArgs.length === 0 || (messageArgs.length === 1 && messageArgs[0] === "-")) {
    message = (await readStdin()).replace(/\r?\n$/, "");
  } else {
    message = messageArgs.join(" ");
  }
  if (!message) fail("Draft message is empty. Pass text as an argument or pipe it on stdin.");

  return [
    "slack_send_message_draft",
    {
      channel_id: channelId,
      message,
      ...(options.threadTs ? { thread_ts: options.threadTs } : {}),
    },
  ];
}

function commandToCall(command, args, options) {
  const limit = options.limit;
  switch (command) {
    case "channels":
      if (!args.length) fail("Usage: channels <query> [--limit N]");
      return [
        "slack_search_channels",
        { query: args.join(" "), limit: limitFor(command, limit, 20), response_format: "detailed" },
      ];
    case "messages":
      if (!args[0]) fail("Usage: messages <channel-or-user-id> [--limit N]");
      return [
        "slack_read_channel",
        { channel_id: args[0], limit: limitFor(command, limit, 100), response_format: "detailed" },
      ];
    case "thread":
      if (!args[0] || !args[1]) fail("Usage: thread <channel-id> <message-ts>");
      return ["slack_read_thread", { channel_id: args[0], message_ts: args[1], response_format: "detailed" }];
    case "search":
      if (!args.length) fail("Usage: search <query> [--limit N] [--public]");
      return [
        options.publicOnly ? "slack_search_public" : "slack_search_public_and_private",
        {
          query: args.join(" "),
          content_types: "messages",
          limit: limitFor(command, limit, 20),
          sort: "timestamp",
          sort_dir: "desc",
          response_format: "detailed",
          include_context: false,
        },
      ];
    case "users":
      if (!args.length) fail("Usage: users <query> [--limit N]");
      return [
        "slack_search_users",
        { query: args.join(" "), limit: limitFor(command, limit, 20), response_format: "detailed" },
      ];
    case "profile":
      if (!args[0]) fail("Usage: profile <user-id>");
      return ["slack_read_user_profile", { user_id: args[0], response_format: "detailed" }];
    default:
      return null;
  }
}

async function main() {
  const { positional, options } = parseCli(process.argv.slice(2));
  const [command, ...args] = positional;
  if (!command || options.help) {
    help();
    return;
  }

  const credentials = loadCredentials();
  validateCredentials(credentials);
  const connector = await findSlackConnector(credentials.accessToken);

  if (command === "auth") {
    console.log(
      JSON.stringify(
        {
          ok: true,
          credentialSource: credentials.source,
          expiresAt: credentials.expiresAt ? new Date(credentials.expiresAt).toISOString() : null,
          hasMcpScope: credentials.scopes.length === 0 ? null : credentials.scopes.includes("user:mcp_servers"),
          connector: {
            id: connector.id,
            displayName: connector.display_name,
            eligible: connector.eligible,
            eligibilityReason: connector.eligibility_reason ?? null,
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  const session = new McpSession(credentials.accessToken, connector.id, options.timeout ?? DEFAULT_TIMEOUT_MS);
  try {
    await session.connect();
    if (command === "tools") {
      const result = await session.request("tools/list");
      if (options.json) console.log(JSON.stringify(result?.tools ?? [], null, 2));
      else {
        for (const tool of result?.tools ?? []) {
          const description = (tool.description ?? "").replace(/\s+/g, " ").slice(0, 120);
          console.log(`${tool.name}\t${description}`);
        }
      }
      return;
    }

    if (command === "exec") {
      let script = args[0];
      if (!script || script === "-") script = await readStdin();
      if (!script?.trim()) fail("exec requires a script argument or stdin.");

      const toolsList = await session.request("tools/list");
      const availableTools = toolsList?.tools ?? [];
      const call = makeCaller(session);

      const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
      const fn = new AsyncFunction("call", "tools", "options", script);
      const result = await fn(call, availableTools, options);
      if (result !== undefined) {
        if (typeof result === "string") console.log(result);
        else console.log(JSON.stringify(result, null, 2));
      }
      return;
    }

    if (command === "catchup") {
      await runCatchup(session, makeCaller(session), args, options);
      return;
    }

    let toolName;
    let toolArguments;
    if (command === "call") {
      toolName = args[0];
      if (!toolName) fail("Usage: call <tool-name> '<arguments-json>'");
      toolArguments = await parseArgumentsJson(args[1] ?? "{}");
    } else if (command === "draft") {
      [toolName, toolArguments] = await draftToCall(args, options);
    } else {
      const mapped = commandToCall(command, args, options);
      if (!mapped) fail(`Unknown command: ${command}. Run with --help.`);
      [toolName, toolArguments] = mapped;
    }

    if (isWriteTool(toolName) && !options.confirmWrite) {
      fail(`${toolName} may modify Slack. Re-run with --confirm-write after explicit user confirmation.`);
    }

    const result = await session.request("tools/call", { name: toolName, arguments: toolArguments });
    printToolResult(result, options.json);
  } finally {
    await session.close();
  }
}

main().catch((error) => {
  console.error(`slack: ${error.message}`);
  if (error.details && process.env.SLACK_MCP_DEBUG === "1") console.error(error.details);
  process.exitCode = 1;
});
