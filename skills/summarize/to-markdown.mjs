#!/usr/bin/env node
/**
 * Convert a URL or local file to Markdown using `uvx markitdown`.
 * Optionally summarize the produced Markdown via `pi` (claude-haiku-4.5).
 *
 * Note: `markitdown` can fetch URLs on its own; this script mainly adds:
 *   - optional writing to a temp file / specific output path
 *   - optional summarization via `pi`
 *   - ability to add a *custom summary prompt/context* (highly recommended)
 *
 * Usage:
 *   node to-markdown.mjs <url-or-path> [--out <file>] [--tmp] [--summary [prompt]] [--prompt <prompt>]
 *                        [--pi-provider <provider>] [--pi-model <model>]
 *
 * Examples:
 *   node to-markdown.mjs https://example.com
 *   node to-markdown.mjs ./spec.pdf --tmp
 *   node to-markdown.mjs ./spec.pdf --summary --prompt "..." --pi-provider anthropic
 *   node to-markdown.mjs ./spec.pdf --summary --prompt "..." --pi-model claude-sonnet-4-5
 */

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

const argv = process.argv.slice(2);

function usageAndExit(code = 1) {
  console.error('Usage: node to-markdown.mjs <url-or-path> [--out <file>] [--tmp] [--summary [prompt]] [--prompt <prompt>]');
  process.exit(code);
}

function isFlag(s) {
  return typeof s === 'string' && s.startsWith('--');
}

function isUrl(s) {
  return /^https?:\/\//i.test(s);
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function safeName(s) {
  return (s || 'document').replace(/[^a-z0-9._-]+/gi, '_');
}

function getInputBasename(s) {
  if (isUrl(s)) {
    const u = new URL(s);
    const b = basename(u.pathname);
    return safeName(b || 'document');
  }
  return safeName(basename(s));
}

function makeTmpMdPath(input) {
  const dir = join(tmpdir(), 'pi-summarize-out');
  ensureDir(dir);
  const base = getInputBasename(input);
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(16).slice(2, 8);
  return join(dir, `${base}-${stamp}-${rand}.md`);
}

// --- args parsing ---
let input = null;
let outPath = null;
let writeTmp = false;
let doSummary = false;
let summaryPrompt = null;
let piProvider = 'github-copilot';
let piModel = 'haiku';

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];

  if (a === '--out') {
    outPath = argv[i + 1] ?? null;
    if (!outPath || isFlag(outPath)) {
      console.error('Expected a value after --out');
      process.exit(1);
    }
    i++;
    continue;
  }

  if (a === '--tmp') {
    writeTmp = true;
    continue;
  }

  if (a === '--pi-provider') {
    piProvider = argv[i + 1] ?? null;
    if (!piProvider || isFlag(piProvider)) { console.error('Expected a value after --pi-provider'); process.exit(1); }
    i++;
    continue;
  }

  if (a === '--pi-model') {
    piModel = argv[i + 1] ?? null;
    if (!piModel || isFlag(piModel)) { console.error('Expected a value after --pi-model'); process.exit(1); }
    i++;
    continue;
  }

  if (a === '--prompt' || a === '--summary-prompt') {
    summaryPrompt = argv[i + 1] ?? null;
    if (!summaryPrompt || isFlag(summaryPrompt)) {
      console.error(`Expected a value after ${a}`);
      process.exit(1);
    }
    i++;
    continue;
  }

  if (a === '--summary') {
    doSummary = true;

    // Allow: --summary "extra instructions" (only if next token isn't a flag and input is already known)
    const next = argv[i + 1];
    if (input && next && !isFlag(next) && summaryPrompt == null) {
      summaryPrompt = next;
      i++;
    }
    continue;
  }

  if (isFlag(a)) {
    console.error(`Unknown flag: ${a}`);
    usageAndExit(1);
  }

  if (!input) {
    input = a;
  } else {
    // Extra bare arg. If summary is enabled and no prompt yet, treat as prompt for convenience.
    if (doSummary && summaryPrompt == null) {
      summaryPrompt = a;
    } else {
      console.error(`Unexpected argument: ${a}`);
      usageAndExit(1);
    }
  }
}

if (!input) usageAndExit(1);

function fetchUrlToTmp(url) {
  // Pre-fetch URLs with curl using a browser Accept header to avoid servers returning
  // 406 Not Acceptable when markitdown's "Accept: text/markdown" preference confuses them.
  const tmpFile = join(tmpdir(), `pi-markitdown-fetch-${Date.now().toString(36)}.html`);
  const result = spawnSync('curl', [
    '-sL',
    '-o', tmpFile,
    '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    '-H', 'User-Agent: Mozilla/5.0 (compatible; markitdown-fetcher)',
    '--max-time', '30',
    url
  ], { encoding: 'utf-8' });
  if (result.error) throw new Error(`curl failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`curl exited ${result.status}: ${(result.stderr || '').trim()}`);
  return tmpFile;
}

function spawnMarkitdown(arg) {
  return spawnSync('uvx', ['--from', 'markitdown[pdf]', 'markitdown', arg], {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024
  });
}

function runMarkitdown(arg) {
  // Try markitdown's native URL fetching first.
  // Fall back to pre-fetching with curl if it fails (e.g. 406 Not Acceptable —
  // some servers reject markitdown's "Accept: text/markdown" primary preference).
  if (!isUrl(arg)) {
    const result = spawnMarkitdown(arg);
    if (result.error) throw new Error(`Failed to run uvx markitdown: ${result.error.message}`);
    if (result.status !== 0) {
      throw new Error(`markitdown failed for ${arg}\n${(result.stderr || '').trim()}`);
    }
    return result.stdout;
  }

  // --- URL path: try direct first, curl fallback on failure ---
  const direct = spawnMarkitdown(arg);
  if (!direct.error && direct.status === 0) return direct.stdout;

  // Direct failed — retry via curl pre-fetch
  const tmpFetched = fetchUrlToTmp(arg);
  try {
    const result = spawnMarkitdown(tmpFetched);
    if (result.error) throw new Error(`Failed to run uvx markitdown: ${result.error.message}`);
    if (result.status !== 0) {
      // Surface both the original and curl-fallback errors for easier debugging
      const origErr = (direct.stderr || '').trim();
      const fallbackErr = (result.stderr || '').trim();
      throw new Error(
        `markitdown failed for ${arg}` +
        (origErr ? `\n[direct] ${origErr}` : '') +
        (fallbackErr ? `\n[curl fallback] ${fallbackErr}` : '')
      );
    }
    return result.stdout;
  } finally {
    try { unlinkSync(tmpFetched); } catch {}
  }
}

function summarizeWithPi(markdown, { mdPathForNote = null, extraPrompt = null } = {}) {
  const MAX_CHARS = 140_000;
  let truncated = false;
  let body = markdown;
  if (body.length > MAX_CHARS) {
    // Keep start + end for better summaries.
    const head = body.slice(0, 110_000);
    const tail = body.slice(-20_000);
    body = `${head}\n\n[...TRUNCATED ${body.length - (head.length + tail.length)} chars...]\n\n${tail}`;
    truncated = true;
  }

  const note = mdPathForNote ? `\n\n(Generated markdown file: ${mdPathForNote})\n` : '';
  const truncNote = truncated ? '\n\nNote: Input was truncated due to size.' : '';

  const contextBlock = extraPrompt
    ? `\n\nUser-provided context / instructions (follow these closely):\n${extraPrompt}\n`
    : `\n\nNo extra context was provided. If the summary seems misaligned, ask the user for what to focus on (goals, audience, what to extract).\n`;

  const prompt = `You are summarizing a document that has been converted to Markdown.${note}
${contextBlock}
Please produce:
- A short 1-paragraph executive summary
- 8-15 bullet points of key facts / decisions / requirements
- A section "Open questions / missing info" (bullets)

Be concise. Preserve important numbers, names, and constraints.
${truncNote}

--- BEGIN DOCUMENT (Markdown) ---
${body}
--- END DOCUMENT ---`;

  const piArgs = [
    ...(piProvider ? ['--provider', piProvider] : []),
    '--model', piModel,
    '--no-tools',
    '--no-session',
    '-p',
    prompt
  ];
  const result = spawnSync('pi', piArgs, {
    encoding: 'utf-8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: 120_000
  });

  if (result.error) {
    throw new Error(`Failed to run pi: ${result.error.message}`);
  }
  if (result.status !== 0) {
    // Strip OSC/ANSI escape sequences that pi emits for terminal notifications
    // e.g. ]777;notify;Ready for input; or ESC ] ... ST
    const raw = (result.stderr || '').trim();
    const clean = raw.replace(/[\x1b\x9d][\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[\x00-\x7f]|\][^\x07]*(?:\x07|\x1b\\)/g, '').trim();
    throw new Error(`pi failed${clean ? `\n${clean}` : ''}`);
  }
  return (result.stdout || '').trim();
}

async function main() {
  if (!isUrl(input) && !existsSync(input)) {
    throw new Error(`File not found: ${input}`);
  }

  const md = runMarkitdown(input);

  // If the user requested an explicit output file, write it there.
  if (outPath) {
    writeFileSync(outPath, md, 'utf-8');
  }

  // When summarizing we *always* write a temp markdown file and always return its path as a hint.
  // When --tmp is passed, we write a temp file as well.
  let tmpMdPath = null;
  if (writeTmp || doSummary) {
    tmpMdPath = makeTmpMdPath(input);
    writeFileSync(tmpMdPath, md, 'utf-8');
  }

  if (writeTmp && tmpMdPath) {
    // When only asked for tmp path, print path and exit.
    if (!doSummary && !outPath) {
      console.log(tmpMdPath);
      return;
    }
  }

  if (doSummary) {
    const summary = summarizeWithPi(md, { mdPathForNote: tmpMdPath ?? outPath, extraPrompt: summaryPrompt });
    process.stdout.write(summary);
    if (tmpMdPath) {
      process.stdout.write(`\n\n[Hint: Full document Markdown saved to: ${tmpMdPath}]\n`);
    }
    return;
  }

  process.stdout.write(md);
}

main().catch(err => {
  console.error(err?.message || String(err));
  process.exit(1);
});
