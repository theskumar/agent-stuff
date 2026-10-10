/**
 * codex_web_search: web search through the ChatGPT Codex backend.
 *
 * Reuses a ChatGPT subscription login, so searches draw on the plan's quota
 * instead of per-call API billing. Tries pi's `openai` "Sign in with ChatGPT"
 * login first (api.openai.com Responses API, the preferred pi login), then the
 * `openai-codex` login (Codex backend). Both accept the hosted `web_search` tool; a
 * small model runs the searches and returns a short cited answer plus the URLs
 * it consulted.
 *
 * Note: this calls the subscription backend from a non-Codex client, which is
 * outside what OpenAI officially supports. It may break or be rate-limited.
 *
 * Config: CODEX_SEARCH_MODEL overrides the per-backend default model.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const JWT_CLAIM_PATH = "https://api.openai.com/auth";

type Backend = { provider: string; endpoint: string; defaultModel: string; accountHeader: boolean };

// Order matters: the first provider with a login wins.
const BACKENDS: Backend[] = [
  {
    provider: "openai",
    endpoint: "https://api.openai.com/v1/responses",
    defaultModel: "gpt-6-luna",
    accountHeader: false,
  },
  {
    provider: "openai-codex",
    endpoint: "https://chatgpt.com/backend-api/codex/responses",
    defaultModel: "gpt-5.6-luna",
    accountHeader: true,
  },
];
const MAX_SOURCES = 15;

const INSTRUCTIONS = [
  "You are a web research tool called by another agent.",
  "Search the web to answer the query. Prefer primary sources (official docs, repos, registries, changelogs).",
  "Answer concisely with concrete facts, versions, and dates. Cite source URLs inline.",
  "If the sources disagree or you could not verify something, say so plainly.",
].join(" ");

type Source = { url: string; title?: string };

type SearchResult = {
  answer: string;
  queries: string[];
  sources: Source[];
  model: string;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
};

// Citations come back with ?utm_source=openai appended; strip it so URLs dedupe.
function cleanUrl(url: string): string {
  return url.replace(/([?&])utm_source=openai(&?)/g, (_m, sep: string, next: string) =>
    next ? sep : "",
  );
}

function accountIdFromToken(token: string): string {
  const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
  const id = payload?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
  if (!id) throw new Error("openai-codex token has no ChatGPT account id");
  return id;
}

async function codexSearch(
  backend: Backend,
  token: string,
  query: string,
  model: string,
  signal?: AbortSignal,
): Promise<SearchResult> {
  const res = await fetch(backend.endpoint, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(backend.accountHeader ? { "chatgpt-account-id": accountIdFromToken(token) } : {}),
      originator: "pi",
      "OpenAI-Beta": "responses=experimental",
      accept: "text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      stream: true,
      instructions: INSTRUCTIONS,
      input: [{ role: "user", content: [{ type: "input_text", text: query }] }],
      tools: [{ type: "web_search" }],
      tool_choice: "auto",
      include: ["web_search_call.action.sources"],
      reasoning: { effort: "low" },
      text: { verbosity: "low" },
    }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    throw new Error(`Codex search failed: HTTP ${res.status} ${detail}`);
  }

  // The backend streams SSE; with store:false the final response.completed
  // carries an empty `output`, so items are collected as they finish.
  const items: any[] = [];
  let usage: SearchResult["usage"];
  for (const line of (await res.text()).split("\n")) {
    if (!line.startsWith("data: ")) continue;
    let event: any;
    try {
      event = JSON.parse(line.slice(6));
    } catch {
      continue;
    }
    if (event.type === "response.output_item.done") items.push(event.item);
    if (event.type === "response.completed") usage = event.response?.usage;
    if (event.type === "response.failed" || event.type === "error") {
      throw new Error(
        `Codex search failed: ${JSON.stringify(event.response?.error ?? event).slice(0, 500)}`,
      );
    }
  }

  const queries: string[] = [];
  const sources = new Map<string, Source>();
  const addSource = (url: string, title?: string) => {
    const key = cleanUrl(url);
    if (!sources.has(key) || title)
      sources.set(key, { url: key, title: title ?? sources.get(key)?.title });
  };
  const answer: string[] = [];
  for (const item of items) {
    if (item.type === "web_search_call") {
      const action = item.action ?? {};
      for (const q of action.queries ?? (action.query ? [action.query] : [])) queries.push(q);
      if (action.url) addSource(action.url);
      for (const s of action.sources ?? []) if (s.url) addSource(s.url);
    }
    if (item.type === "message") {
      for (const part of item.content ?? []) {
        if (part.type !== "output_text") continue;
        answer.push(cleanUrl(part.text));
        for (const a of part.annotations ?? []) {
          if (a.type === "url_citation" && a.url) addSource(a.url, a.title);
        }
      }
    }
  }
  return {
    answer: answer.join("\n").trim(),
    queries,
    sources: [...sources.values()],
    model,
    usage,
  };
}

function formatResult(r: SearchResult): string {
  const lines = [r.answer || "(no answer text returned)"];
  if (r.queries.length) lines.push("", `Searched: ${r.queries.map((q) => `"${q}"`).join(", ")}`);
  const shown = r.sources.slice(0, MAX_SOURCES);
  if (shown.length) {
    lines.push("", "Sources:");
    for (const s of shown) lines.push(`- ${s.title ? `${s.title}: ` : ""}${s.url}`);
    if (r.sources.length > shown.length) lines.push(`- (+${r.sources.length - shown.length} more)`);
  }
  return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "codex_web_search",
    label: "Codex Web Search",
    description:
      "Search the live web via a ChatGPT subscription login (openai, else openai-codex). " +
      "Returns a concise cited answer, the queries run, and source URLs. " +
      "Use for current facts: versions, releases, docs, people, companies, news.",
    promptSnippet: "Search the live web and get a cited answer",
    promptGuidelines: [
      "Use codex_web_search when you need current or external facts you cannot read from local files.",
      "Ask one focused question per call; follow up by fetching a returned source URL when exact wording matters.",
    ],
    parameters: Type.Object({
      query: Type.String({
        description: "A focused question or search query, in natural language",
      }),
    }),
    outputSchema: Type.Object({
      answer: Type.String(),
      queries: Type.Array(Type.String()),
      sources: Type.Array(Type.Object({ url: Type.String(), title: Type.Optional(Type.String()) })),
      model: Type.String(),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      let backend: Backend | undefined;
      let token: string | undefined;
      for (const b of BACKENDS) {
        token = await ctx.modelRegistry.getApiKeyForProvider(b.provider);
        if (token) {
          backend = b;
          break;
        }
      }
      if (!backend || !token)
        throw new Error(
          "No ChatGPT login. Run /login and choose Sign in with ChatGPT (openai), or ChatGPT (openai-codex).",
        );
      const model = process.env.CODEX_SEARCH_MODEL || backend.defaultModel;
      const result = await codexSearch(backend, token, params.query, model, signal);
      return {
        content: [{ type: "text", text: formatResult(result) }],
        structuredContent: {
          answer: result.answer,
          queries: result.queries,
          sources: result.sources,
          model: result.model,
        },
        details: { model: result.model, usage: result.usage, sourceCount: result.sources.length },
      };
    },
  });
}
