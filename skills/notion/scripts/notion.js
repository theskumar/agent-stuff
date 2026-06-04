#!/usr/bin/env node

// Notion skill: thin layer over the official Notion CLI (`ntn`).
//
// Auth, workspace selection, and token storage are fully delegated to ntn.
// This script adds:
//   - URL → page id parsing
//   - A JavaScript exec sandbox that exposes ntn-backed helpers
//   - CLI shortcuts for common page/files/api operations
//
// No npm dependencies. Requires `node` (stdlib) and the `ntn` binary on PATH.

const vm = require('node:vm');
const util = require('node:util');

const ntn = require('./ntn');

// ---------- argv parsing ----------

function parseArgs(argv) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--script') { opts.script = argv[++i]; continue; }
    if (a === '--timeout') {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) throw new Error('--timeout must be positive ms');
      opts.timeout = Math.min(Math.floor(n), 5 * 60_000);
      continue;
    }
    if (a === '--json') { opts.json = true; continue; }
    if (a === '--parent') { opts.parent = argv[++i]; continue; }
    if (a === '--content') { opts.content = argv[++i]; continue; }
    if (a === '--allow-deleting-content') { opts.allowDeletingContent = true; continue; }
    if (a === '--yes') { opts.yes = true; continue; }
    if (a === '--no-yes') { opts.yes = false; continue; }
    if (a === '-h' || a === '--help') { opts.help = true; continue; }
    positional.push(a);
  }
  return { positional, opts };
}

function readStdinText() {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function readContent(opts) {
  if (opts.content !== undefined) return opts.content;
  const stdin = await readStdinText();
  if (!stdin) throw new Error('Markdown content required: pass --content "..." or pipe via stdin.');
  return stdin;
}

// ---------- exec sandbox ----------

function formatLogArg(v) {
  if (typeof v === 'string') return v;
  return util.inspect(v, { depth: 6, maxArrayLength: 200, breakLength: 120, compact: 2 });
}

function makeConsole(logs) {
  const w = (level, args) =>
    logs.push({
      level,
      message: args.map(formatLogArg).join(' '),
      timestamp: new Date().toISOString(),
    });
  return {
    log: (...a) => w('log', a),
    info: (...a) => w('info', a),
    warn: (...a) => w('warn', a),
    error: (...a) => w('error', a),
    debug: (...a) => w('debug', a),
  };
}

function normalizeForJson(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value)) return value.map((x) => normalizeForJson(x, seen));
  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalizeForJson(v, seen);
    return out;
  }
  return value;
}

function withTimeout(p, ms) {
  if (!Number.isFinite(ms) || ms <= 0) return p;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Execution timed out after ${ms}ms.`)), ms);
    Promise.resolve(p).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

function buildExecHelper() {
  // Generic api callable: notion.api(method, path, body, opts) → JSON
  // Plus discovery accessors: notion.api.help / spec / docs.
  const api = (method, apiPath, body, opts) => ntn.apiCall(method, apiPath, body, opts);
  api.help = (apiPath) => ntn.apiMeta(apiPath, 'help');
  api.spec = (apiPath) => ntn.apiMeta(apiPath, 'spec');
  api.docs = (apiPath) => ntn.apiMeta(apiPath, 'docs');

  return {
    parsePageId: ntn.parsePageId,
    whoAmI: () => ntn.whoAmI(),
    page: {
      get: ntn.pageGet,
      create: ntn.pageCreate,
      update: ntn.pageUpdate,
      trash: ntn.pageTrash,
    },
    datasources: {
      resolve: ntn.datasourcesResolve,
      query: ntn.datasourcesQuery,
    },
    files: {
      list: ntn.filesList,
      get: ntn.filesGet,
    },
    api,
  };
}

// ---------- commands ----------

function printHelp() {
  console.log(`Notion skill (auth + workspace fully delegated to ntn)

Usage:
  node scripts/notion.js whoami
  node scripts/notion.js page get <id-or-url> [--json]
  node scripts/notion.js page create --parent <page:id|database:id|data-source:id> [--content <md>]
  node scripts/notion.js page update <id-or-url> [--content <md>] [--allow-deleting-content]
  node scripts/notion.js page trash <id-or-url> [--no-yes]
  node scripts/notion.js files list
  node scripts/notion.js files get <upload-id>
  node scripts/notion.js api <method> <path> [--content <json>]
  node scripts/notion.js exec [--script '...'] [--timeout 30000]

Page create/update read markdown from stdin if --content omitted.
\`api\` reads JSON body from stdin if --content omitted.

Auth: handled by ntn (\`ntn login\`). Default workspace from ntn config.
Override per-call with: NOTION_WORKSPACE_ID=<uuid> node scripts/notion.js ...

Requires the official Notion CLI (ntn). Install: curl -fsSL https://ntn.dev | bash

Exec example:
  node scripts/notion.js exec <<'JS'
  const md = await notion.page.get('https://www.notion.so/...');
  const users = await notion.api('GET', 'v1/users', null, { query: { page_size: 5 } });
  return { md_chars: md.length, user_count: users.results.length };
  JS
`);
}

async function cmdWhoami() {
  const me = await ntn.whoAmI();
  console.log(JSON.stringify({ ok: true, ...me }, null, 2));
}

async function cmdPage(opts, positional) {
  const sub = positional[0];
  const target = positional[1];

  if (sub === 'get') {
    if (!target) throw new Error('Usage: page get <id-or-url>');
    const result = await ntn.pageGet(target, { json: opts.json });
    if (opts.json) {
      console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    } else {
      process.stdout.write(result);
      if (!result.endsWith('\n')) process.stdout.write('\n');
    }
    return;
  }

  if (sub === 'create') {
    if (!opts.parent) throw new Error('--parent <page:id|database:id|data-source:id> required');
    const content = await readContent(opts);
    const result = await ntn.pageCreate({ parent: opts.parent, content });
    console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    return;
  }

  if (sub === 'update') {
    if (!target) throw new Error('Usage: page update <id-or-url>');
    const content = await readContent(opts);
    const result = await ntn.pageUpdate(target, {
      content,
      allowDeletingContent: opts.allowDeletingContent,
    });
    console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    return;
  }

  if (sub === 'trash') {
    if (!target) throw new Error('Usage: page trash <id-or-url>');
    const result = await ntn.pageTrash(target, { yes: opts.yes !== false });
    console.log(JSON.stringify({ ok: true, message: result }, null, 2));
    return;
  }

  throw new Error(`Unknown page subcommand: ${sub}. Use get|create|update|trash.`);
}

async function cmdFiles(opts, positional) {
  const sub = positional[0];
  if (sub === 'list') {
    const out = await ntn.filesList();
    console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
    return;
  }
  if (sub === 'get') {
    const id = positional[1];
    if (!id) throw new Error('Usage: files get <upload-id>');
    const out = await ntn.filesGet(id);
    console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
    return;
  }
  throw new Error(`Unknown files subcommand: ${sub}. Use list|get.`);
}

async function cmdApi(opts, positional) {
  const method = positional[0];
  const apiPath = positional[1];
  if (!method || !apiPath) {
    throw new Error('Usage: api <method> <path> [--content <json>]');
  }
  let body = null;
  if (opts.content !== undefined && opts.content !== '') {
    body = opts.content;
  } else if (!process.stdin.isTTY) {
    const stdin = await readStdinText();
    if (stdin.trim()) body = stdin;
  }
  const result = await ntn.apiCall(method, apiPath, body);
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
}

async function cmdExec(opts, positional) {
  let script = opts.script;
  if (!script && positional.length > 0) script = positional.join(' ');
  if (!script) script = await readStdinText();
  script = String(script || '').trim();
  if (!script) {
    throw new Error('No script provided. Pass --script "..." or pipe via stdin/heredoc.');
  }

  const timeoutMs = opts.timeout || 30_000;
  const logs = [];

  try {
    const notion = buildExecHelper();
    const context = vm.createContext({
      Buffer,
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      setTimeout,
      clearTimeout,
      fetch,
      console: makeConsole(logs),
      notion,
    });
    const wrapped = `(async () => {\n${script}\n})()`;
    const compiled = new vm.Script(wrapped, { filename: 'notion-exec.js', displayErrors: true });
    const result = await withTimeout(
      Promise.resolve(compiled.runInContext(context, { displayErrors: true })),
      timeoutMs,
    );
    console.log(
      JSON.stringify(
        {
          ok: true,
          timeoutMs,
          logs,
          result: normalizeForJson(result),
        },
        null,
        2,
      ),
    );
  } catch (err) {
    const msg = err?.message || String(err);
    console.log(
      JSON.stringify(
        {
          ok: false,
          timeoutMs,
          logs,
          error: { name: err?.name || 'Error', message: msg, stack: err?.stack || null },
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}

async function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = positional;

  if (!cmd || opts.help || cmd === 'help') return printHelp();
  if (cmd === 'whoami') return cmdWhoami();
  if (cmd === 'page') return cmdPage(opts, rest);
  if (cmd === 'files') return cmdFiles(opts, rest);
  if (cmd === 'api') return cmdApi(opts, rest);
  if (cmd === 'exec') return cmdExec(opts, rest);
  throw new Error(`Unknown command: ${cmd}`);
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
