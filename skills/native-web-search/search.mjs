#!/usr/bin/env node

import { spawn } from "child_process";

function parseArgs(argv) {
	const out = {
		model: "haiku",
		purpose: "general research support",
		timeoutMs: 120000,
		json: false,
		help: false,
		query: "",
	};

	const positional = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") {
			out.help = true;
			continue;
		}
		if (arg === "--json") {
			out.json = true;
			continue;
		}
		if (arg === "--model") {
			out.model = argv[++i] || out.model;
			continue;
		}
		if (arg.startsWith("--model=")) {
			out.model = arg.slice("--model=".length) || out.model;
			continue;
		}
		if (arg === "--purpose") {
			out.purpose = argv[++i] || out.purpose;
			continue;
		}
		if (arg.startsWith("--purpose=")) {
			out.purpose = arg.slice("--purpose=".length) || out.purpose;
			continue;
		}
		if (arg === "--timeout") {
			out.timeoutMs = Math.max(1000, Number(argv[++i] || out.timeoutMs));
			continue;
		}
		if (arg.startsWith("--timeout=")) {
			out.timeoutMs = Math.max(1000, Number(arg.slice("--timeout=".length) || out.timeoutMs));
			continue;
		}
		positional.push(arg);
	}

	out.query = positional.join(" ").trim();
	return out;
}

function usage() {
	return `Usage:
  node search.mjs "<query>" [--purpose "<why>"] [--model <id>] [--timeout <ms>] [--json]

Examples:
  node search.mjs "latest python release" --purpose "update dependency notes"
  node search.mjs "vite 7 breaking changes" --json`;
}

function buildSystemPrompt() {
	return "You are a fast web research assistant. Always produce practical summaries and include full source URLs (no shortened links).";
}

function buildUserPrompt(query, purpose) {
	return `Search the internet for: ${query}\n\nPurpose: ${purpose}\n\nReturn a concise research summary with:\n- 3 to 7 key findings\n- for every finding: title, why it matters for this purpose, and a full canonical URL (https://...)\n- if multiple sources disagree, call that out\n- finish with a short recommendation on which source(s) to trust first.`;
}

function runClaude({ model, query, purpose, timeoutMs }) {
	return new Promise((resolve, reject) => {
		const args = [
			"-p",
			buildUserPrompt(query, purpose),
			"--model",
			model,
			"--allowedTools",
			"WebSearch",
			"WebFetch",
			"--append-system-prompt",
			buildSystemPrompt(),
			"--output-format",
			"text",
		];

		const child = spawn("claude", args, { stdio: ["ignore", "pipe", "pipe"] });

		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`claude timed out after ${timeoutMs}ms`));
		}, timeoutMs);

		child.stdout.on("data", (d) => {
			stdout += d.toString();
		});
		child.stderr.on("data", (d) => {
			stderr += d.toString();
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			if (err.code === "ENOENT") {
				reject(new Error("`claude` CLI not found on PATH. Install Claude Code first."));
			} else {
				reject(err);
			}
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			const text = stdout.trim();
			if (code !== 0) {
				reject(new Error(`claude exited ${code}: ${stderr.trim() || text || "no output"}`));
				return;
			}
			if (!text) {
				reject(new Error("claude returned an empty response"));
				return;
			}
			resolve(text);
		});
	});
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help || !args.query) {
		console.error(usage());
		process.exit(args.help ? 0 : 1);
	}

	const text = await runClaude({
		model: args.model,
		query: args.query,
		purpose: args.purpose,
		timeoutMs: args.timeoutMs,
	});

	if (args.json) {
		console.log(
			JSON.stringify(
				{
					model: args.model,
					query: args.query,
					purpose: args.purpose,
					result: text,
				},
				null,
				2,
			),
		);
		return;
	}

	console.log(`Model: ${args.model}`);
	console.log("");
	console.log(text);
}

main().catch((err) => {
	console.error(`Error: ${err?.message || err}`);
	process.exit(1);
});
