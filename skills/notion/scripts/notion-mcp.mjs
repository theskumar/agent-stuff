#!/usr/bin/env node

/**
 * Notion MCP CLI backed by the user's claude.ai Notion connector.
 *
 * FALLBACK ONLY. The primary Notion interface is the direct REST API via `ntn`
 * (scripts/notion.js). Use this script solely for capabilities the REST API
 * cannot practically do:
 *   - semantic search across Notion AND connected sources (Slack, Drive,
 *     GitHub, Jira, Linear, ...) and people search   -> `search`
 *   - the user's sidebar lists (private/shared/favorite/recent)  -> `list`
 * Both run as the *user's* OAuth identity, so they see everything the user can
 * see (unlike a PAT integration, which only sees explicitly-shared pages).
 *
 * Calls Anthropic's MCP proxy directly: no model request and no Claude CLI
 * subprocess. Authentication comes from CLAUDE_CODE_OAUTH_TOKEN, macOS
 * Keychain, or ~/.claude/.credentials.json. Secrets are never printed.
 *
 * No npm dependencies; requires Node.js 20+.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const REGISTRY_URL = "https://api.anthropic.com/v1/mcp_servers?limit=1000";
const PROXY_BASE = process.env.ANTHROPIC_MCP_PROXY_URL ?? "https://mcp-proxy.anthropic.com/v1/mcp";
const ANTHROPIC_VERSION = "2023-06-01";
const MCP_REGISTRY_BETA = "mcp-servers-2025-12-04";
const PROTOCOL_VERSION = "2025-06-18";
const KEYCHAIN_SERVICE = "Claude Code-credentials";
const DEFAULT_TIMEOUT_MS = 30_000;

// Read-only Notion connector tools (readOnlyHint=true). Everything else is
// treated as a write and blocked without --confirm-write (fails closed).
const READ_TOOLS = new Set([
  "notion-search",
  "notion-fetch",
  "notion-download-attachment",
  "notion-get-comments",
  "notion-get-async-task",
  "notion-get-teams",
  "notion-get-users",
  "notion-query-data-sources",
  "notion-query-database-view",
  "notion-query-meeting-notes",
  "notion-list-private-pages",
  "notion-list-shared-pages",
  "notion-list-favorite-pages",
  "notion-list-recent-pages",
  "notion-search-agents",
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
      if (process.env.NOTION_MCP_DEBUG === "1") {
        console.error(`notion-mcp: macOS Keychain credential unavailable: ${error.message}`);
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

async function findNotionConnector(accessToken) {
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
  const configuredId = process.env.NOTION_MCP_CONNECTOR_ID;
  const connector = configuredId
    ? connectors.find((item) => item.id === configuredId)
    : (connectors.find((item) => item.display_name?.toLowerCase() === "notion")
      ?? connectors.find((item) => item.display_name?.toLowerCase().startsWith("notion ")));

  if (!connector) fail("Notion connector was not found in the claude.ai connector registry.");
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
          clientInfo: { name: "agent-stuff-notion", version: "1.0.0" },
        },
      },
      { includeSession: false },
    );
    if (body?.error) fail(`Notion MCP initialize failed: ${body.error.message ?? JSON.stringify(body.error)}`);
    this.sessionId = response.headers.get("mcp-session-id");
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
    return body?.result;
  }

  async request(method, params = {}) {
    const id = this.nextId++;
    const { body } = await this.post({ jsonrpc: "2.0", id, method, params });
    if (body?.error) fail(`Notion MCP ${method} failed: ${body.error.message ?? JSON.stringify(body.error)}`);
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
  console.log(JSON.stringify(value, null, 2));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseCli(argv) {
  const positional = [];
  const options = { json: false, confirmWrite: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--confirm-write") options.confirmWrite = true;
    else if (arg === "--user") options.user = true;
    else if (arg === "--query") {
      options.query = argv[++index];
      if (options.query === undefined) fail("--query requires a value.");
    } else if (arg === "--created-after") {
      options.createdAfter = argv[++index];
      if (!DATE_RE.test(options.createdAfter ?? "")) fail("--created-after must be YYYY-MM-DD.");
    } else if (arg === "--created-before") {
      options.createdBefore = argv[++index];
      if (!DATE_RE.test(options.createdBefore ?? "")) fail("--created-before must be YYYY-MM-DD.");
    } else if (arg === "--limit") {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 1 || value > 200) fail("--limit must be an integer from 1 to 200.");
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
  console.log(`Notion MCP CLI - claude.ai Notion connector (FALLBACK for what REST can't do)

Primary Notion interface is scripts/notion.js (direct REST via ntn). Use this
only for semantic/connected-source search and the user's sidebar lists.

Usage:
  notion-mcp.mjs auth
  notion-mcp.mjs search <query> [--limit N<=25] [--user]
                        [--created-after YYYY-MM-DD] [--created-before YYYY-MM-DD] [--json]
  notion-mcp.mjs list <private|shared|favorite|recent> [--limit N] [--json]
  notion-mcp.mjs tools [--json]
  notion-mcp.mjs call <tool-name> '<arguments-json>' [--confirm-write] [--json]

search: semantic search across Notion + connected sources (Slack, Drive, GitHub,
        Jira, Linear, ...). --user finds people by name/email.
list:   the current user's sidebar (no REST equivalent).
call:   generic escape hatch for other read tools (e.g. notion-fetch,
        notion-query-meeting-notes) if you ever need them. Writes need --confirm-write.

Examples:
  notion-mcp.mjs search 'Q3 revenue plan' --limit 5
  notion-mcp.mjs search jane@example.com --user
  notion-mcp.mjs list recent --limit 10
  notion-mcp.mjs call notion-fetch '{"id":"https://notion.so/..."}'

Auth order: CLAUDE_CODE_OAUTH_TOKEN, macOS Keychain, ~/.claude/.credentials.json.
Writes are blocked unless --confirm-write is provided.`);
}

function commandToCall(command, args, options) {
  switch (command) {
    case "search": {
      if (!args.length) fail("Usage: search <query> [--limit N] [--user] [--created-after/-before YYYY-MM-DD]");
      const params = {
        query: args.join(" "),
        query_type: options.user ? "user" : "internal",
      };
      if (options.limit !== undefined) {
        if (options.limit > 25) fail("search supports --limit up to 25.");
        params.page_size = options.limit;
      }
      const range = {};
      if (options.createdAfter) range.start_date = options.createdAfter;
      if (options.createdBefore) range.end_date = options.createdBefore;
      if (Object.keys(range).length) params.filters = { created_date_range: range };
      return ["notion-search", params];
    }
    case "list": {
      const which = args[0];
      const map = {
        private: "notion-list-private-pages",
        shared: "notion-list-shared-pages",
        favorite: "notion-list-favorite-pages",
        favorites: "notion-list-favorite-pages",
        recent: "notion-list-recent-pages",
      };
      const tool = map[which];
      if (!tool) fail("Usage: list <private|shared|favorite|recent> [--limit N]");
      const params = {};
      if (options.limit !== undefined) params.limit = options.limit;
      return [tool, params];
    }
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
  const connector = await findNotionConnector(credentials.accessToken);

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
          const kind = READ_TOOLS.has(tool.name) ? "READ " : "WRITE";
          const description = (tool.description ?? "").replace(/\s+/g, " ").slice(0, 100);
          console.log(`[${kind}] ${tool.name}\t${description}`);
        }
      }
      return;
    }

    let toolName;
    let toolArguments;
    if (command === "call") {
      toolName = args[0];
      if (!toolName) fail("Usage: call <tool-name> '<arguments-json>'");
      toolArguments = await parseArgumentsJson(args[1] ?? "{}");
    } else {
      const mapped = commandToCall(command, args, options);
      if (!mapped) fail(`Unknown command: ${command}. Run with --help.`);
      [toolName, toolArguments] = mapped;
    }

    if (isWriteTool(toolName) && !options.confirmWrite) {
      fail(`${toolName} may modify Notion. Re-run with --confirm-write after explicit user confirmation.`);
    }

    const result = await session.request("tools/call", { name: toolName, arguments: toolArguments });
    printToolResult(result, options.json);
  } finally {
    await session.close();
  }
}

main().catch((error) => {
  console.error(`notion-mcp: ${error.message}`);
  if (error.details && process.env.NOTION_MCP_DEBUG === "1") console.error(error.details);
  process.exitCode = 1;
});
