#!/usr/bin/env node
// Linear GraphQL API wrapper for agent skills
// Auth: LINEAR_API_KEY env var or ~/.config/linear/api-key

const https = require("https");
const fs = require("fs");
const path = require("path");

const API_URL = "https://api.linear.app/graphql";

function getApiKey() {
  if (process.env.LINEAR_API_KEY) return process.env.LINEAR_API_KEY;
  const keyFile = path.join(
    process.env.HOME || "",
    ".config",
    "linear",
    "api-key"
  );
  if (fs.existsSync(keyFile)) return fs.readFileSync(keyFile, "utf8").trim();
  console.error(
    "No LINEAR_API_KEY env var or ~/.config/linear/api-key file found."
  );
  console.error(
    "Create a key at: Linear → Settings → Account → Security & Access → Personal API keys"
  );
  process.exit(1);
}

function graphql(query, variables = {}) {
  const body = JSON.stringify({ query, variables });
  return new Promise((resolve, reject) => {
    const url = new URL(API_URL);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: getApiKey(),
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (json.errors) {
              reject(
                new Error(json.errors.map((e) => e.message).join("; "))
              );
            } else {
              resolve(json.data);
            }
          } catch (e) {
            reject(new Error(`Failed to parse response: ${data.slice(0, 500)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// --- Commands ---

async function me() {
  const data = await graphql(`{ viewer { id name email } }`);
  console.log(JSON.stringify(data.viewer, null, 2));
}

async function teams() {
  const data = await graphql(`{
    teams { nodes { id name key } }
  }`);
  console.log(JSON.stringify(data.teams.nodes, null, 2));
}

async function issue(idOrKey) {
  let filter;
  if (idOrKey.includes("-")) {
    const [teamKey, num] = idOrKey.split("-");
    const data = await graphql(
      `query($filter: IssueFilter) {
        issues(filter: $filter, first: 1) {
          nodes {
            id identifier title description priority priorityLabel
            state { name } assignee { name }
            labels { nodes { name } }
            parent { identifier title }
            children { nodes { identifier title state { name } } }
            comments { nodes { body user { name } createdAt } }
            url
          }
        }
      }`,
      {
        filter: {
          team: { key: { eq: teamKey.toUpperCase() } },
          number: { eq: parseInt(num) },
        },
      }
    );
    if (data.issues.nodes.length === 0) {
      console.error(`Issue ${idOrKey} not found`);
      process.exit(1);
    }
    console.log(JSON.stringify(data.issues.nodes[0], null, 2));
  } else {
    const data = await graphql(
      `query($id: String!) {
        issue(id: $id) {
          id identifier title description priority priorityLabel
          state { name } assignee { name }
          labels { nodes { name } }
          parent { identifier title }
          children { nodes { identifier title state { name } } }
          comments { nodes { body user { name } createdAt } }
          url
        }
      }`,
      { id: idOrKey }
    );
    console.log(JSON.stringify(data.issue, null, 2));
  }
}

async function search(query, opts = {}) {
  const limit = opts.limit || 10;
  const teamKey = opts.team;
  const state = opts.state;

  let filter = {};
  if (teamKey) filter.team = { key: { eq: teamKey.toUpperCase() } };
  if (state) filter.state = { name: { eqIgnoreCase: state } };

  const data = await graphql(
    `query($filter: IssueFilter, $first: Int) {
      issues(filter: $filter, first: $first, orderBy: updatedAt) {
        nodes {
          identifier title priority priorityLabel
          state { name } assignee { name }
          labels { nodes { name } }
          url
        }
      }
    }`,
    { filter, first: limit }
  );

  const issues = data.issues.nodes;
  if (query) {
    const q = query.toLowerCase();
    const filtered = issues.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        (i.identifier && i.identifier.toLowerCase().includes(q))
    );
    console.log(JSON.stringify(filtered, null, 2));
  } else {
    console.log(JSON.stringify(issues, null, 2));
  }
}

async function searchIssues(term, opts = {}) {
  const limit = opts.limit || 25;
  const data = await graphql(
    `query($term: String!, $first: Int) {
      searchIssues(term: $term, first: $first) {
        nodes {
          identifier title priority priorityLabel
          state { name } assignee { name }
          labels { nodes { name } }
          url
        }
      }
    }`,
    { term, first: limit }
  );
  console.log(JSON.stringify(data.searchIssues.nodes, null, 2));
}

async function updateIssue(idOrKey, updates) {
  let issueId = idOrKey;
  if (idOrKey.includes("-")) {
    const [teamKey, num] = idOrKey.split("-");
    const data = await graphql(
      `query($filter: IssueFilter) {
        issues(filter: $filter, first: 1) { nodes { id } }
      }`,
      {
        filter: {
          team: { key: { eq: teamKey.toUpperCase() } },
          number: { eq: parseInt(num) },
        },
      }
    );
    if (data.issues.nodes.length === 0) {
      console.error(`Issue ${idOrKey} not found`);
      process.exit(1);
    }
    issueId = data.issues.nodes[0].id;
  }

  const input = {};
  if (updates.title) input.title = updates.title;
  if (updates.description) input.description = updates.description;
  if (updates.state) {
    const statesData = await graphql(`{
      workflowStates { nodes { id name } }
    }`);
    const st = statesData.workflowStates.nodes.find(
      (s) => s.name.toLowerCase() === updates.state.toLowerCase()
    );
    if (st) input.stateId = st.id;
    else console.error(`State "${updates.state}" not found`);
  }
  if (updates.priority !== undefined) input.priority = updates.priority;

  const data = await graphql(
    `mutation($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success issue { identifier title state { name } url }
      }
    }`,
    { id: issueId, input }
  );
  console.log(JSON.stringify(data.issueUpdate, null, 2));
}

async function addComment(idOrKey, body) {
  let issueId = idOrKey;
  if (idOrKey.includes("-")) {
    const [teamKey, num] = idOrKey.split("-");
    const data = await graphql(
      `query($filter: IssueFilter) {
        issues(filter: $filter, first: 1) { nodes { id } }
      }`,
      {
        filter: {
          team: { key: { eq: teamKey.toUpperCase() } },
          number: { eq: parseInt(num) },
        },
      }
    );
    if (data.issues.nodes.length === 0) {
      console.error(`Issue ${idOrKey} not found`);
      process.exit(1);
    }
    issueId = data.issues.nodes[0].id;
  }

  const data = await graphql(
    `mutation($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success comment { id body createdAt }
      }
    }`,
    { input: { issueId, body } }
  );
  console.log(JSON.stringify(data.commentCreate, null, 2));
}

async function createIssue(opts) {
  const teamsData = await graphql(`{ teams { nodes { id key } } }`);
  const team = teamsData.teams.nodes.find(
    (t) => t.key.toUpperCase() === opts.team.toUpperCase()
  );
  if (!team) {
    console.error(`Team "${opts.team}" not found`);
    process.exit(1);
  }

  const input = { teamId: team.id, title: opts.title };
  if (opts.description) input.description = opts.description;
  if (opts.priority !== undefined) input.priority = opts.priority;
  if (opts.parent) {
    const [pTeam, pNum] = opts.parent.split("-");
    const pData = await graphql(
      `query($filter: IssueFilter) {
        issues(filter: $filter, first: 1) { nodes { id } }
      }`,
      {
        filter: {
          team: { key: { eq: pTeam.toUpperCase() } },
          number: { eq: parseInt(pNum) },
        },
      }
    );
    if (pData.issues.nodes.length > 0) input.parentId = pData.issues.nodes[0].id;
  }

  const data = await graphql(
    `mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success issue { identifier title state { name } url }
      }
    }`,
    { input }
  );
  console.log(JSON.stringify(data.issueCreate, null, 2));
}

async function rawQuery(query, variables) {
  const data = await graphql(query, variables || {});
  console.log(JSON.stringify(data, null, 2));
}

// --- CLI ---

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve(null);
    let data = "";
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data.trim() || null));
  });
}

function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        flags[key] = args[++i];
      } else {
        flags[key] = true;
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
    console.log(`Usage: node linear.js <command> [args]

Commands:
  me                          Show authenticated user
  teams                       List teams
  issue <KEY>                 Get issue details (e.g. CSL-24)
  search [query]              Search issues (--team, --state, --limit)
  find <term>                 Full-text search issues
  create --team KEY --title T Create issue (--description, --priority, --parent)
  update <KEY> [--flags]      Update issue (--title, --description, --state, --priority)
  comment <KEY> <body>        Add comment (body from arg or stdin)
  query <graphql> [--vars {}] Raw GraphQL query`);
    return;
  }

  const cmd = args[0];
  const rest = args.slice(1);
  const { flags, positional } = parseArgs(rest);

  switch (cmd) {
    case "me":
      return me();
    case "teams":
      return teams();
    case "issue":
    case "get":
      return issue(positional[0] || flags.id);
    case "search":
    case "list":
      return search(positional[0], {
        team: flags.team,
        state: flags.state,
        limit: flags.limit ? parseInt(flags.limit) : undefined,
      });
    case "find":
      return searchIssues(positional[0], {
        limit: flags.limit ? parseInt(flags.limit) : undefined,
      });
    case "create":
      return createIssue({
        team: flags.team,
        title: flags.title,
        description: flags.description || (await readStdin()),
        priority: flags.priority ? parseInt(flags.priority) : undefined,
        parent: flags.parent,
      });
    case "update":
      return updateIssue(positional[0], {
        title: flags.title,
        description: flags.description,
        state: flags.state,
        priority: flags.priority ? parseInt(flags.priority) : undefined,
      });
    case "comment": {
      const body = positional[1] || flags.body || (await readStdin());
      return addComment(positional[0], body);
    }
    case "query":
    case "graphql": {
      const q = positional[0] || (await readStdin());
      const vars = flags.vars ? JSON.parse(flags.vars) : undefined;
      return rawQuery(q, vars);
    }
    default:
      console.error(`Unknown command: ${cmd}`);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
