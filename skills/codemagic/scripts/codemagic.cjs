#!/usr/bin/env node
// Codemagic REST API wrapper for agent skills
// Auth: CODEMAGIC_API_TOKEN env var or ~/.config/codemagic/api-token

const https = require("https");
const fs = require("fs");
const path = require("path");

const API_BASE = "https://api.codemagic.io";

const IN_PROGRESS = new Set([
  "queued",
  "preparing",
  "fetching",
  "building",
  "testing",
  "publishing",
  "finishing",
]);

function getApiToken() {
  if (process.env.CODEMAGIC_API_TOKEN) return process.env.CODEMAGIC_API_TOKEN;
  const tokenFile = path.join(
    process.env.HOME || "",
    ".config",
    "codemagic",
    "api-token"
  );
  if (fs.existsSync(tokenFile))
    return fs.readFileSync(tokenFile, "utf8").trim();
  console.error(
    "No CODEMAGIC_API_TOKEN env var or ~/.config/codemagic/api-token file found."
  );
  console.error(
    "Get token at: Codemagic → Teams → Personal Account → Integrations → Codemagic API → Show"
  );
  process.exit(1);
}

function request(method, apiPath, body) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + apiPath);
    const headers = {
      "x-auth-token": getApiToken(),
      "Content-Type": "application/json",
    };
    if (payload) headers["Content-Length"] = Buffer.byteLength(payload);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 401 || res.statusCode === 403) {
            return reject(
              new Error(
                `Auth failed (HTTP ${res.statusCode}). Check CODEMAGIC_API_TOKEN.`
              )
            );
          }
          let json;
          try {
            json = data ? JSON.parse(data) : {};
          } catch (e) {
            return reject(
              new Error(
                `HTTP ${res.statusCode}, non-JSON response: ${data.slice(0, 500)}`
              )
            );
          }
          if (res.statusCode >= 400) {
            return reject(
              new Error(
                `HTTP ${res.statusCode}: ${json.error || json.message || data.slice(0, 500)}`
              )
            );
          }
          resolve(json);
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function print(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function summarizeApp(a) {
  const workflows = a.workflows
    ? Object.values(a.workflows).map((w) => w.name)
    : [];
  return {
    id: a._id,
    name: a.appName,
    repo: a.repository && (a.repository.htmlUrl || a.repository.name),
    workflows,
    branches: a.branches,
  };
}

function summarizeBuild(b) {
  return {
    id: b._id,
    status: b.status,
    workflow: (b.config && b.config.name) || b.workflowId,
    branch: b.branch,
    tag: b.tag || undefined,
    index: b.index,
    message: b.message ? b.message.split("\n")[0] : undefined,
    startedAt: b.startedAt,
    finishedAt: b.finishedAt,
    artefacts: (b.artefacts || []).map((x) => x.name),
  };
}

// --- Commands ---

async function apps() {
  const data = await request("GET", "/apps");
  print((data.applications || []).map(summarizeApp));
}

async function app(appId) {
  if (!appId) {
    console.error("Usage: app <appId>");
    process.exit(1);
  }
  const data = await request("GET", `/apps/${appId}`);
  print(data.application || data);
}

async function builds(flags) {
  const params = new URLSearchParams();
  if (flags.app) params.set("appId", flags.app);
  if (flags.workflow) params.set("workflowId", flags.workflow);
  if (flags.branch) params.set("branch", flags.branch);
  if (flags.tag) params.set("tag", flags.tag);
  const qs = params.toString();
  const data = await request("GET", `/builds${qs ? "?" + qs : ""}`);
  const limit = flags.limit ? parseInt(flags.limit) : 10;
  print((data.builds || []).slice(0, limit).map(summarizeBuild));
}

async function getBuild(buildId, opts = {}) {
  if (!buildId) {
    console.error("Usage: build|status <buildId>");
    process.exit(1);
  }
  const data = await request("GET", `/builds/${buildId}`);
  const b = data.build || data;
  if (opts.full) print(b);
  else print(summarizeBuild(b));
  return b;
}

async function trigger(flags) {
  if (!flags.app || !flags.workflow) {
    console.error(
      "Usage: trigger --app <appId> --workflow <workflowId> [--branch b | --tag t] [--var K=V]... [--input K=V]... [--label L]..."
    );
    process.exit(1);
  }
  const body = { appId: flags.app, workflowId: flags.workflow };
  if (flags.branch) body.branch = flags.branch;
  if (flags.tag) body.tag = flags.tag;

  const toPairs = (v) =>
    (Array.isArray(v) ? v : [v]).map((kv) => {
      const i = kv.indexOf("=");
      if (i < 0) {
        console.error(`Bad key=value pair: ${kv}`);
        process.exit(1);
      }
      return [kv.slice(0, i), kv.slice(i + 1)];
    });

  if (flags.var) {
    body.environment = { variables: Object.fromEntries(toPairs(flags.var)) };
  }
  if (flags.input) {
    body.inputs = Object.fromEntries(toPairs(flags.input));
  }
  if (flags.label) {
    body.labels = Array.isArray(flags.label) ? flags.label : [flags.label];
  }

  const data = await request("POST", "/builds", body);
  if (!data.buildId) {
    console.error(`Trigger failed: ${JSON.stringify(data)}`);
    process.exit(1);
  }
  print({
    buildId: data.buildId,
    url: `https://codemagic.io/app/${flags.app}/build/${data.buildId}`,
  });
}

async function cancel(buildId) {
  if (!buildId) {
    console.error("Usage: cancel <buildId>");
    process.exit(1);
  }
  await request("POST", `/builds/${buildId}/cancel`);
  console.log(`Canceled ${buildId}`);
}

async function watch(buildId, flags) {
  if (!buildId) {
    console.error("Usage: watch <buildId> [--interval 30] [--timeout 3600]");
    process.exit(1);
  }
  const interval = (flags.interval ? parseInt(flags.interval) : 30) * 1000;
  const timeout = (flags.timeout ? parseInt(flags.timeout) : 3600) * 1000;
  const start = Date.now();
  let lastStatus = null;
  for (;;) {
    const data = await request("GET", `/builds/${buildId}`);
    const b = data.build || data;
    if (b.status !== lastStatus) {
      console.log(`[${new Date().toISOString()}] ${b.status}`);
      lastStatus = b.status;
    }
    if (!IN_PROGRESS.has(b.status)) {
      print(summarizeBuild(b));
      process.exit(b.status === "finished" ? 0 : 1);
    }
    if (Date.now() - start > timeout) {
      console.error(`Watch timed out after ${timeout / 1000}s (still ${b.status})`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

async function artifacts(buildId) {
  if (!buildId) {
    console.error("Usage: artifacts <buildId>");
    process.exit(1);
  }
  const data = await request("GET", `/builds/${buildId}`);
  const b = data.build || data;
  print(
    (b.artefacts || []).map((a) => ({
      name: a.name,
      type: a.type,
      size: a.size,
      url: a.url,
    }))
  );
}

function downloadUrl(url, dest) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = {};
    // Only send token to api.codemagic.io; redirect targets are pre-signed
    if (u.hostname === "api.codemagic.io")
      headers["x-auth-token"] = getApiToken();
    https
      .get({ hostname: u.hostname, path: u.pathname + u.search, headers }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(downloadUrl(res.headers.location, dest));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }
        const out = fs.createWriteStream(dest);
        res.pipe(out);
        out.on("finish", () => out.close(() => resolve(dest)));
        out.on("error", reject);
      })
      .on("error", reject);
  });
}

async function download(buildId, flags) {
  if (!buildId) {
    console.error("Usage: download <buildId> [--name pattern] [--dir .]");
    process.exit(1);
  }
  const data = await request("GET", `/builds/${buildId}`);
  const b = data.build || data;
  let arts = b.artefacts || [];
  if (flags.name)
    arts = arts.filter((a) =>
      a.name.toLowerCase().includes(flags.name.toLowerCase())
    );
  if (arts.length === 0) {
    console.error("No matching artifacts");
    process.exit(1);
  }
  const dir = flags.dir || ".";
  fs.mkdirSync(dir, { recursive: true });
  for (const a of arts) {
    const dest = path.join(dir, a.name);
    await downloadUrl(a.url, dest);
    console.log(`✓ ${dest} (${a.size} bytes)`);
  }
}

async function rawApi(method, apiPath, flags) {
  if (!method || !apiPath) {
    console.error("Usage: api <GET|POST|DELETE> </path> [--data '{...}']");
    process.exit(1);
  }
  const body = flags.data ? JSON.parse(flags.data) : undefined;
  const data = await request(method.toUpperCase(), apiPath, body);
  print(data);
}

// --- CLI ---

function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      let val = true;
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        val = args[++i];
      }
      // Repeatable flags (--var, --input, --label) accumulate into arrays
      if (key in flags) {
        if (!Array.isArray(flags[key])) flags[key] = [flags[key]];
        flags[key].push(val);
      } else {
        flags[key] = val;
      }
    } else {
      positional.push(args[i]);
    }
  }
  return { flags, positional };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log(`Usage: node codemagic.cjs <command> [args]

Commands:
  apps                          List apps (id, name, workflows)
  app <appId>                   Full app details (workflow ids, branches)
  builds [--flags]              List recent builds (--app, --workflow, --branch, --tag, --limit)
  build <buildId>               Build details (--full for raw object)
  status <buildId>              Alias for build (compact summary)
  trigger --app A --workflow W  Start build (--branch, --tag, --var K=V, --input K=V, --label L)
  watch <buildId>               Poll until done (--interval secs, --timeout secs); exit 0 iff finished
  cancel <buildId>              Cancel running build
  artifacts <buildId>           List artifacts with URLs
  download <buildId>            Download artifacts (--name pattern, --dir .)
  api <METHOD> <path>           Raw API call (--data '{...}')`);
    return;
  }

  const cmd = args[0];
  const { flags, positional } = parseArgs(args.slice(1));

  switch (cmd) {
    case "apps":
      return apps();
    case "app":
      return app(positional[0]);
    case "builds":
    case "list":
      return builds(flags);
    case "build":
      return getBuild(positional[0], { full: !!flags.full });
    case "status":
      return getBuild(positional[0], { full: false });
    case "trigger":
      return trigger(flags);
    case "watch":
      return watch(positional[0], flags);
    case "cancel":
      return cancel(positional[0]);
    case "artifacts":
      return artifacts(positional[0]);
    case "download":
      return download(positional[0], flags);
    case "api":
      return rawApi(positional[0], positional[1], flags);
    default:
      console.error(`Unknown command: ${cmd}`);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
