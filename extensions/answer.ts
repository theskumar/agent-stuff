/**
 * Answer Extension
 *
 * What it is:
 *   When the assistant ends a turn by asking the user a batch of questions,
 *   this extension extracts those questions as structured JSON via a side LLM
 *   call, then opens an interactive TUI so the user can answer each question
 *   one at a time without scrolling back through the transcript. The
 *   compiled answers are then submitted as the user's next message.
 *
 *   Demonstrates the "prompt generator + custom TUI" pattern: command grabs
 *   the last assistant message, runs structured extraction, walks the user
 *   through a custom editor, then sends a single combined reply.
 *
 * Use cases:
 *   - Reviewing and answering long lists of clarifying questions from a
 *     planning / scoping turn without losing track of which one you're on.
 *   - Quickly approving/rejecting decisions the assistant batched at the end
 *     of its turn.
 *   - Generating a clean, well-formatted user response when there are 5+
 *     questions to address.
 *
 * Common usage patterns:
 *   - `/answer` — extract and walk through questions from the last assistant
 *     message.
 *   - `Ctrl+.` — same as `/answer`, faster keybinding.
 *   - Skip a question with the configured "next" key; submit when done to
 *     send all answers as the next user message.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { type Api, type Model, type UserMessage, complete } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Editor,
  type EditorTheme,
  Key,
  type TUI,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

// Structured output format for question extraction
interface ExtractedQuestion {
  question: string;
  context?: string;
}

interface ExtractionResult {
  questions: ExtractedQuestion[];
}

const SYSTEM_PROMPT = `You are a question extractor. Given text from a conversation, extract any questions that need answering.

Output a JSON object with this structure:
{
  "questions": [
    {
      "question": "The question text",
      "context": "Optional context that helps answer the question"
    }
  ]
}

Rules:
- Extract all questions that require user input
- Keep questions in the order they appeared
- Be concise with question text
- Include context only when it provides essential information for answering
- If no questions are found, return {"questions": []}

Example output:
{
  "questions": [
    {
      "question": "What is your preferred database?",
      "context": "We can only configure MySQL and PostgreSQL because of what is implemented."
    },
    {
      "question": "Should we use TypeScript or JavaScript?"
    }
  ]
}`;

interface AnswerConfig {
  provider: string;
  model: string;
}

const CONFIG_PATH = join(homedir(), ".pi", "agent", "extensions", "answer.config.json");
const DEFAULT_CONFIG: AnswerConfig = {
  provider: "claude-bridge",
  model: "claude-haiku-4-5",
};

/**
 * Load the fast-extraction model config from disk.
 * Writes the default config on first run.
 */
function loadConfig(): AnswerConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = readFileSync(CONFIG_PATH, "utf8");
      const parsed = JSON.parse(raw) as Partial<AnswerConfig>;
      return {
        provider: parsed.provider || DEFAULT_CONFIG.provider,
        model: parsed.model || DEFAULT_CONFIG.model,
      };
    }
  } catch {
    // fall through and write defaults
  }
  try {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
  } catch {
    // best-effort; in-memory default still works
  }
  return { ...DEFAULT_CONFIG };
}

/**
 * Resolve the extraction model from config. Returns the model on success, or an
 * error string describing why it couldn't be used (so the caller can surface it
 * instead of silently showing "Cancelled").
 */
async function resolveExtractionModel(
  _currentModel: Model<Api>,
  modelRegistry: ModelRegistry,
): Promise<
  | { ok: true; model: Model<Api>; usedFallback: boolean; configured: AnswerConfig }
  | { ok: false; error: string; configured: AnswerConfig }
> {
  const cfg = loadConfig();
  const found = modelRegistry.find(cfg.provider, cfg.model);
  if (!found) {
    return {
      ok: false,
      error: `configured model ${cfg.provider}/${cfg.model} not found in registry. Edit ${CONFIG_PATH} or install the provider.`,
      configured: cfg,
    };
  }
  const auth = await modelRegistry.getApiKeyAndHeaders(found);
  if (auth.ok === false) {
    return {
      ok: false,
      error: `auth failed for ${cfg.provider}/${cfg.model}: ${auth.error}. Edit ${CONFIG_PATH} or fix provider auth.`,
      configured: cfg,
    };
  }
  return { ok: true, model: found, usedFallback: false, configured: cfg };
}

/**
 * Parse the JSON response from the LLM
 */
function parseExtractionResult(text: string): ExtractionResult | null {
  try {
    // Try to find JSON in the response (it might be wrapped in markdown code blocks)
    let jsonStr = text;

    // Remove markdown code block if present
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);
    if (parsed && Array.isArray(parsed.questions)) {
      return parsed as ExtractionResult;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Interactive Q&A component for answering extracted questions
 */
class QnAComponent implements Component {
  private questions: ExtractedQuestion[];
  private answers: string[];
  private currentIndex = 0;
  private editor: Editor;
  private tui: TUI;
  private onDone: (result: string | null) => void;
  private showingConfirmation = false;

  // Cache
  private cachedWidth?: number;
  private cachedLines?: string[];

  // Colors - using proper reset sequences
  private dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
  private bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
  private cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
  private green = (s: string) => `\x1b[32m${s}\x1b[0m`;
  private yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
  private gray = (s: string) => `\x1b[90m${s}\x1b[0m`;

  constructor(questions: ExtractedQuestion[], tui: TUI, onDone: (result: string | null) => void) {
    this.questions = questions;
    this.answers = questions.map(() => "");
    this.tui = tui;
    this.onDone = onDone;

    // Create a minimal theme for the editor
    const editorTheme: EditorTheme = {
      borderColor: this.dim,
      selectList: {
        selectedPrefix: this.cyan,
        selectedText: (s: string) => `\x1b[44m${s}\x1b[0m`,
        description: this.gray,
        scrollInfo: this.dim,
        noMatch: this.yellow,
      },
    };

    this.editor = new Editor(tui, editorTheme);
    // Disable the editor's built-in submit (which clears the editor)
    // We'll handle Enter ourselves to preserve the text
    this.editor.disableSubmit = true;
    this.editor.onChange = () => {
      this.invalidate();
      this.tui.requestRender();
    };
  }

  private allQuestionsAnswered(): boolean {
    this.saveCurrentAnswer();
    return this.answers.every((a) => (a?.trim() || "").length > 0);
  }

  private saveCurrentAnswer(): void {
    this.answers[this.currentIndex] = this.editor.getText();
  }

  private navigateTo(index: number): void {
    if (index < 0 || index >= this.questions.length) return;
    this.saveCurrentAnswer();
    this.currentIndex = index;
    this.editor.setText(this.answers[index] || "");
    this.invalidate();
  }

  private submit(): void {
    this.saveCurrentAnswer();

    // Build the response text
    const parts: string[] = [];
    for (let i = 0; i < this.questions.length; i++) {
      const q = this.questions[i];
      const a = this.answers[i]?.trim() || "(no answer)";
      parts.push(`Q: ${q.question}`);
      if (q.context) {
        parts.push(`> ${q.context}`);
      }
      parts.push(`A: ${a}`);
      parts.push("");
    }

    this.onDone(parts.join("\n").trim());
  }

  private cancel(): void {
    this.onDone(null);
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  handleInput(data: string): void {
    // Handle confirmation dialog
    if (this.showingConfirmation) {
      if (matchesKey(data, Key.enter) || data.toLowerCase() === "y") {
        this.submit();
        return;
      }
      if (
        matchesKey(data, Key.escape) ||
        matchesKey(data, Key.ctrl("c")) ||
        data.toLowerCase() === "n"
      ) {
        this.showingConfirmation = false;
        this.invalidate();
        this.tui.requestRender();
        return;
      }
      return;
    }

    // Global navigation and commands
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.cancel();
      return;
    }

    // Tab / Shift+Tab for navigation
    if (matchesKey(data, Key.tab)) {
      if (this.currentIndex < this.questions.length - 1) {
        this.navigateTo(this.currentIndex + 1);
        this.tui.requestRender();
      }
      return;
    }
    if (matchesKey(data, Key.shift("tab"))) {
      if (this.currentIndex > 0) {
        this.navigateTo(this.currentIndex - 1);
        this.tui.requestRender();
      }
      return;
    }

    // Arrow up/down for question navigation when editor is empty
    // (Editor handles its own cursor navigation when there's content)
    if (matchesKey(data, Key.up) && this.editor.getText() === "") {
      if (this.currentIndex > 0) {
        this.navigateTo(this.currentIndex - 1);
        this.tui.requestRender();
        return;
      }
    }
    if (matchesKey(data, Key.down) && this.editor.getText() === "") {
      if (this.currentIndex < this.questions.length - 1) {
        this.navigateTo(this.currentIndex + 1);
        this.tui.requestRender();
        return;
      }
    }

    // Handle Enter ourselves (editor's submit is disabled)
    // Plain Enter moves to next question or shows confirmation on last question
    // Shift+Enter adds a newline (handled by editor)
    if (matchesKey(data, Key.enter) && !matchesKey(data, Key.shift("enter"))) {
      this.saveCurrentAnswer();
      if (this.currentIndex < this.questions.length - 1) {
        this.navigateTo(this.currentIndex + 1);
      } else {
        // On last question - show confirmation
        this.showingConfirmation = true;
      }
      this.invalidate();
      this.tui.requestRender();
      return;
    }

    // Pass to editor
    this.editor.handleInput(data);
    this.invalidate();
    this.tui.requestRender();
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const lines: string[] = [];
    const boxWidth = Math.min(width - 4, 120); // Allow wider box
    const contentWidth = boxWidth - 4; // 2 chars padding on each side

    // Helper to create horizontal lines (dim the whole thing at once)
    const horizontalLine = (count: number) => "─".repeat(count);

    // Helper to create a box line
    const boxLine = (content: string, leftPad = 2): string => {
      const paddedContent = " ".repeat(leftPad) + content;
      const contentLen = visibleWidth(paddedContent);
      const rightPad = Math.max(0, boxWidth - contentLen - 2);
      return this.dim("│") + paddedContent + " ".repeat(rightPad) + this.dim("│");
    };

    const emptyBoxLine = (): string => {
      return this.dim("│") + " ".repeat(boxWidth - 2) + this.dim("│");
    };

    const padToWidth = (line: string): string => {
      const len = visibleWidth(line);
      return line + " ".repeat(Math.max(0, width - len));
    };

    // Title
    lines.push(padToWidth(this.dim(`╭${horizontalLine(boxWidth - 2)}╮`)));
    const title = `${this.bold(this.cyan("Questions"))} ${this.dim(`(${this.currentIndex + 1}/${this.questions.length})`)}`;
    lines.push(padToWidth(boxLine(title)));
    lines.push(padToWidth(this.dim(`├${horizontalLine(boxWidth - 2)}┤`)));

    // Progress indicator
    const progressParts: string[] = [];
    for (let i = 0; i < this.questions.length; i++) {
      const answered = (this.answers[i]?.trim() || "").length > 0;
      const current = i === this.currentIndex;
      if (current) {
        progressParts.push(this.cyan("●"));
      } else if (answered) {
        progressParts.push(this.green("●"));
      } else {
        progressParts.push(this.dim("○"));
      }
    }
    lines.push(padToWidth(boxLine(progressParts.join(" "))));
    lines.push(padToWidth(emptyBoxLine()));

    // Current question
    const q = this.questions[this.currentIndex];
    const questionText = `${this.bold("Q:")} ${q.question}`;
    const wrappedQuestion = wrapTextWithAnsi(questionText, contentWidth);
    for (const line of wrappedQuestion) {
      lines.push(padToWidth(boxLine(line)));
    }

    // Context if present
    if (q.context) {
      lines.push(padToWidth(emptyBoxLine()));
      const contextText = this.gray(`> ${q.context}`);
      const wrappedContext = wrapTextWithAnsi(contextText, contentWidth - 2);
      for (const line of wrappedContext) {
        lines.push(padToWidth(boxLine(line)));
      }
    }

    lines.push(padToWidth(emptyBoxLine()));

    // Render the editor component (multi-line input) with padding
    // Skip the first and last lines (editor's own border lines)
    const answerPrefix = this.bold("A: ");
    const editorWidth = contentWidth - 4 - 3; // Extra padding + space for "A: "
    const editorLines = this.editor.render(editorWidth);
    for (let i = 1; i < editorLines.length - 1; i++) {
      if (i === 1) {
        // First content line gets the "A: " prefix
        lines.push(padToWidth(boxLine(answerPrefix + editorLines[i])));
      } else {
        // Subsequent lines get padding to align with the first line
        lines.push(padToWidth(boxLine(`   ${editorLines[i]}`)));
      }
    }

    lines.push(padToWidth(emptyBoxLine()));

    // Confirmation dialog or footer with controls
    if (this.showingConfirmation) {
      lines.push(padToWidth(this.dim(`├${horizontalLine(boxWidth - 2)}┤`)));
      const confirmMsg = `${this.yellow("Submit all answers?")} ${this.dim("(Enter/y to confirm, Esc/n to cancel)")}`;
      lines.push(padToWidth(boxLine(truncateToWidth(confirmMsg, contentWidth))));
    } else {
      lines.push(padToWidth(this.dim(`├${horizontalLine(boxWidth - 2)}┤`)));
      const controls = `${this.dim("Tab/Enter")} next · ${this.dim("Shift+Tab")} prev · ${this.dim("Shift+Enter")} newline · ${this.dim("Esc")} cancel`;
      lines.push(padToWidth(boxLine(truncateToWidth(controls, contentWidth))));
    }
    lines.push(padToWidth(this.dim(`╰${horizontalLine(boxWidth - 2)}╯`)));

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }
}

export default function (pi: ExtensionAPI) {
  const answerHandler = async (ctx: ExtensionContext) => {
    if (!ctx.hasUI) {
      ctx.ui.notify("answer requires interactive mode", "error");
      return;
    }

    if (!ctx.model) {
      ctx.ui.notify("No model selected", "error");
      return;
    }

    // Find the last assistant message on the current branch
    const branch = ctx.sessionManager.getBranch();
    let lastAssistantText: string | undefined;

    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (entry.type === "message") {
        const msg = entry.message;
        if ("role" in msg && msg.role === "assistant") {
          if (msg.stopReason !== "stop") {
            ctx.ui.notify(`Last assistant message incomplete (${msg.stopReason})`, "error");
            return;
          }
          const textParts = msg.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text);
          if (textParts.length > 0) {
            lastAssistantText = textParts.join("\n");
            break;
          }
        }
      }
    }

    if (!lastAssistantText) {
      ctx.ui.notify("No assistant messages found", "error");
      return;
    }

    // Resolve extraction model from config (default: claude-bridge / claude-haiku-4-5)
    const resolved = await resolveExtractionModel(ctx.model, ctx.modelRegistry);
    if (!resolved.ok) {
      ctx.ui.notify(`answer: ${resolved.error}`, "error");
      return;
    }
    const extractionModel = resolved.model;

    // Run extraction with loader UI. Surface real errors instead of silent "Cancelled".
    type ExtractionOutcome =
      | { kind: "ok"; result: ExtractionResult }
      | { kind: "empty" }
      | { kind: "aborted" }
      | { kind: "parse-failed"; raw: string }
      | { kind: "error"; message: string };

    const outcome = await ctx.ui.custom<ExtractionOutcome>((tui, theme, _kb, done) => {
      const loader = new BorderedLoader(
        tui,
        theme,
        `Extracting questions using ${extractionModel.id}...`,
      );
      loader.onAbort = () => done({ kind: "aborted" });

      const doExtract = async (): Promise<ExtractionOutcome> => {
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(extractionModel);
        if (auth.ok === false) {
          return { kind: "error", message: auth.error };
        }
        // Inline the extraction instructions into the user message. Some
        // providers (notably claude-bridge, which uses the Claude Code preset)
        // ignore the systemPrompt parameter, so we cannot rely on it alone.
        const userText = `${SYSTEM_PROMPT}\n\n---\n\nText to extract questions from:\n\n${lastAssistantText!}\n\nRespond with the JSON object only. Do not answer the questions yourself.`;
        const userMessage: UserMessage = {
          role: "user",
          content: [{ type: "text", text: userText }],
          timestamp: Date.now(),
        };

        const response = await complete(
          extractionModel,
          { systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
          { apiKey: auth.apiKey, headers: auth.headers, signal: loader.signal },
        );

        if (response.stopReason === "aborted") {
          return { kind: "aborted" };
        }

        const responseText = response.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("\n");

        const parsed = parseExtractionResult(responseText);
        if (!parsed) {
          return { kind: "parse-failed", raw: responseText };
        }
        if (parsed.questions.length === 0) {
          return { kind: "empty" };
        }
        return { kind: "ok", result: parsed };
      };

      doExtract()
        .then(done)
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          done({ kind: "error", message });
        });

      return loader;
    });

    if (outcome.kind === "aborted") {
      ctx.ui.notify("Cancelled", "info");
      return;
    }
    if (outcome.kind === "error") {
      ctx.ui.notify(
        `answer: extraction failed (${extractionModel.api}/${extractionModel.id}): ${outcome.message}`,
        "error",
      );
      return;
    }
    if (outcome.kind === "parse-failed") {
      const preview = outcome.raw.replace(/\s+/g, " ").slice(0, 120);
      ctx.ui.notify(
        `answer: could not parse JSON from ${extractionModel.id}. Got: ${preview}`,
        "error",
      );
      return;
    }
    if (outcome.kind === "empty") {
      ctx.ui.notify("No questions found in the last message", "info");
      return;
    }
    const extractionResult = outcome.result;

    // Show the Q&A component
    const answersResult = await ctx.ui.custom<string | null>((tui, _theme, _kb, done) => {
      return new QnAComponent(extractionResult.questions, tui, done);
    });

    if (answersResult === null) {
      ctx.ui.notify("Cancelled", "info");
      return;
    }

    // Send the answers directly as a message and trigger a turn
    pi.sendMessage(
      {
        customType: "answers",
        content: `I answered your questions in the following way:\n\n${answersResult}`,
        display: true,
      },
      { triggerTurn: true },
    );
  };

  pi.registerCommand("answer", {
    description: "Extract questions from last assistant message into interactive Q&A",
    handler: (_args, ctx) => answerHandler(ctx),
  });

  pi.registerShortcut("ctrl+.", {
    description: "Extract and answer questions",
    handler: answerHandler,
  });
}
