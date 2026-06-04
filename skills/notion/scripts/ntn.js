// Thin wrapper around the official Notion CLI (`ntn`).
//
// Auth is fully delegated to ntn: tokens live in the OS keychain (or
// ~/.config/notion/auth.json when NOTION_KEYRING=0). Workspace selection is
// ntn's default, overridable via the NOTION_WORKSPACE_ID env var.
//
// Exports:
//   parsePageId(input)                -> canonical UUID from URL/id
//   ensureNtn()                       -> validates ntn is installed (memoized)
//   runNtn({ args, stdin, json })     -> { stdout, stderr, parsed? }
//
// Domain helpers (each returns parsed JSON when ntn supports JSON output,
// otherwise raw stdout text):
//   pageGet / pageCreate / pageUpdate / pageTrash
//   datasourcesResolve / datasourcesQuery
//   filesList / filesGet
//   apiCall(method, path, body)       -> generic ntn api passthrough
//   apiMeta(path, 'help'|'spec'|'docs') -> documentation text
//   whoAmI()                          -> identity tab-separated string

const { spawnSync, spawn } = require('node:child_process');

const UUID_RE =
  /([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})/i;
const HEX32_RE = /([0-9a-f]{32})/i;

function formatUuid(hex) {
  const h = hex.replace(/-/g, '').toLowerCase();
  if (h.length !== 32) throw new Error(`Bad UUID hex length: ${hex}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function parsePageId(input) {
  if (!input) throw new Error('Page id or URL required.');
  const cleaned = String(input).trim().split(/[?#]/)[0];
  const uuid = cleaned.match(UUID_RE);
  if (uuid) return formatUuid(uuid[1]);
  const hex = cleaned.match(HEX32_RE);
  if (hex) return formatUuid(hex[1]);
  throw new Error(`Could not extract Notion page id from: ${input}`);
}

const INSTALL_HINT =
  'ntn (Notion CLI) is required but not installed.\n' +
  'Install: curl -fsSL https://ntn.dev | bash\n' +
  'Then: ntn login\n' +
  'Docs: https://developers.notion.com/cli/get-started';

const LOGIN_HINT =
  'ntn is installed but no workspace is authenticated.\n' +
  'Run: ntn login';

let _ntnChecked = false;
let _ntnAvailable = false;

function ensureNtn() {
  if (_ntnChecked) {
    if (!_ntnAvailable) throw new Error(INSTALL_HINT);
    return 'ntn';
  }
  _ntnChecked = true;
  const r = spawnSync('ntn', ['--version'], { stdio: 'ignore' });
  _ntnAvailable = r.status === 0;
  if (!_ntnAvailable) throw new Error(INSTALL_HINT);
  return 'ntn';
}

function runNtn({ args, stdin, json = false }) {
  ensureNtn();
  return new Promise((resolve, reject) => {
    const child = spawn('ntn', args, {
      env: process.env,
      stdio: [stdin !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        const msg = stderr.trim() || stdout.trim() || `exit ${code}`;
        const hint = /no auth token|not authenticated|run `ntn login`/i.test(msg)
          ? `\n${LOGIN_HINT}`
          : '';
        const err = new Error(`ntn ${args.join(' ')} failed: ${msg}${hint}`);
        err.code = code;
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      const out = { stdout, stderr };
      if (json) {
        try {
          out.parsed = JSON.parse(stdout);
        } catch (e) {
          out.parseError = e.message;
        }
      }
      resolve(out);
    });
    if (stdin !== undefined) {
      child.stdin.end(typeof stdin === 'string' ? stdin : String(stdin));
    }
  });
}

function tryParseJson(text) {
  if (typeof text !== 'string') return text;
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

// ---------- pages ----------

async function pageGet(idOrUrl, { json = false, notionVersion } = {}) {
  const id = parsePageId(idOrUrl);
  const args = ['pages', 'get', id];
  if (json) args.push('--json');
  if (notionVersion) args.push('--notion-version', notionVersion);
  const { stdout, parsed } = await runNtn({ args, json });
  return json ? (parsed ?? stdout) : stdout;
}

async function pageCreate({ parent, content, notionVersion } = {}) {
  if (!parent) throw new Error('pageCreate: parent required (e.g. "page:<id>")');
  if (content === undefined || content === null) {
    throw new Error('pageCreate: content (markdown string) required');
  }
  const args = ['pages', 'create', '--parent', parent];
  if (notionVersion) args.push('--notion-version', notionVersion);
  const { stdout } = await runNtn({ args, stdin: content });
  return tryParseJson(stdout);
}

async function pageUpdate(
  idOrUrl,
  { content, allowDeletingContent = false, notionVersion } = {},
) {
  const id = parsePageId(idOrUrl);
  if (content === undefined || content === null) {
    throw new Error('pageUpdate: content (markdown string) required');
  }
  const args = ['pages', 'update', id];
  if (allowDeletingContent) args.push('--allow-deleting-content');
  if (notionVersion) args.push('--notion-version', notionVersion);
  const { stdout } = await runNtn({ args, stdin: content });
  return tryParseJson(stdout);
}

async function pageTrash(idOrUrl, { yes = true, notionVersion } = {}) {
  const id = parsePageId(idOrUrl);
  const args = ['pages', 'trash', id];
  if (yes) args.push('--yes');
  if (notionVersion) args.push('--notion-version', notionVersion);
  const { stdout } = await runNtn({ args });
  return stdout.trim();
}

// ---------- datasources ----------

async function datasourcesResolve(databaseId, { notionVersion } = {}) {
  const args = ['datasources', 'resolve', databaseId];
  if (notionVersion) args.push('--notion-version', notionVersion);
  const { stdout } = await runNtn({ args });
  return stdout.trim();
}

async function datasourcesQuery(
  dataSourceId,
  { limit, startCursor, sort, filter, notionVersion } = {},
) {
  const args = ['datasources', 'query', dataSourceId];
  if (limit !== undefined) args.push('--limit', String(limit));
  if (startCursor) args.push('--start-cursor', startCursor);
  if (sort) {
    const sorts = Array.isArray(sort) ? sort : [sort];
    for (const s of sorts) args.push('--sort', s);
  }
  if (notionVersion) args.push('--notion-version', notionVersion);
  if (filter) {
    args.push('--filter-file', '-');
    const { stdout } = await runNtn({
      args,
      stdin: typeof filter === 'string' ? filter : JSON.stringify(filter),
    });
    return tryParseJson(stdout);
  }
  const { stdout } = await runNtn({ args });
  return tryParseJson(stdout);
}

// ---------- files ----------

async function filesList() {
  const { stdout } = await runNtn({ args: ['files', 'list'] });
  return tryParseJson(stdout);
}

async function filesGet(uploadId) {
  const { stdout } = await runNtn({ args: ['files', 'get', uploadId] });
  return tryParseJson(stdout);
}

// ---------- api ----------

// Generic Notion API passthrough via `ntn api`. Replaces raw fetch.
//   apiCall('GET',   'v1/users')
//   apiCall('POST',  'v1/pages',          { parent: { page_id: 'abc' }, ... })
//   apiCall('PATCH', 'v1/pages/<id>',     { archived: true })
//   apiCall('GET',   'v1/users',          null, { query: { page_size: 100 } })
async function apiCall(method, apiPath, body = null, opts = {}) {
  if (!method) throw new Error('apiCall: method required (GET|POST|PATCH|DELETE)');
  if (!apiPath) throw new Error('apiCall: path required (e.g. "v1/users")');
  const upper = method.toUpperCase();
  const args = [apiPath];
  if (upper !== 'GET' || body) {
    args.push('-X', upper);
  }
  if (opts.query && typeof opts.query === 'object') {
    for (const [k, v] of Object.entries(opts.query)) {
      args.push(`${k}==${typeof v === 'string' ? v : JSON.stringify(v)}`);
    }
  }
  if (body !== null && body !== undefined) {
    args.push('-d', typeof body === 'string' ? body : JSON.stringify(body));
  }
  if (opts.notionVersion) {
    args.push('--notion-version', opts.notionVersion);
  }
  const { stdout } = await runNtn({ args: ['api', ...args] });
  return tryParseJson(stdout);
}

async function apiMeta(path, kind /* 'help' | 'spec' | 'docs' */) {
  const flag = `--${kind}`;
  const { stdout } = await runNtn({ args: ['api', path, flag] });
  return stdout;
}

// ---------- misc ----------

async function whoAmI() {
  const { stdout } = await runNtn({ args: ['whoami'] });
  const fields = stdout.trim().split('\t');
  return {
    raw: stdout.trim(),
    bot_id: fields[0],
    bot_name: fields[1],
    bot_type: fields[2],
    email: fields[3],
    workspace_id: fields[4],
    workspace_name: fields[5],
    user_id: fields[6],
    user_name: fields[7],
    owner_type: fields[8],
  };
}

module.exports = {
  parsePageId,
  ensureNtn,
  runNtn,
  pageGet,
  pageCreate,
  pageUpdate,
  pageTrash,
  datasourcesResolve,
  datasourcesQuery,
  filesList,
  filesGet,
  apiCall,
  apiMeta,
  whoAmI,
};
