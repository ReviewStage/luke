import { AGENT_TOOL, CLAUDE_CODE_TOOL } from "@luke/features/agent-tools";
import { CODING_AGENT_TODO_STATUS } from "@luke/features/coding-agent-wire";
import { isRecord, isWireNumber, isWireString, type WireValue } from "@luke/wire";

/**
 * native-tool-calls.ts -- a call a native harness made, as the transcript draws it: the tool of Luke's whose renderer draws its kind, and its input and answer in that tool's shapes.
 *
 * A coding agent running on a provider's own harness stores each call under
 * the harness's own tool name (`CLAUDE_CODE_TOOL`), with the harness's own
 * input and, for its own tools, the text the model read as the answer
 * (`claude-code-moments.ts`). The transcript has a renderer for every kind of
 * call those tools make, written for the tools eve gives an agent, so each
 * harness's call is read here once as the eve call that does the same thing:
 * its name, its input under the keys that tool takes, and its answer under the
 * key that tool answers its words in. Everything after the read (rows, the
 * to-do list, a loaded skill, a copy of the transcript) then draws it as it
 * draws eve's. A call to Luke's own MCP server is stored under Luke's tool's
 * name and needs no reading, and a subagent's call (`Agent`), which no eve tool
 * makes as one call, keeps its name for `tool-call-model.ts` to draw.
 *
 * Each harness has one table, keyed by the names its calls are stored under,
 * which no two harnesses share; Codex's joins Claude Code's in
 * `NATIVE_TOOL_CALLS`. Nothing here draws.
 */

/** A call as the transcript reads it: the tool, its input, and its answer, none while it runs. */
export interface DrawnCall {
  readonly tool: string;
  readonly input: WireValue | undefined;
  readonly output: WireValue | undefined;
}

/** How one harness tool's call is read as the eve call that draws it. */
type NativeCallReading = (call: DrawnCall) => DrawnCall;

/** The words a harness tool answered, which its own tools answer as the text the model read; nothing for any other answer. */
function answerWords(output: WireValue | undefined): string | undefined {
  return isWireString(output) ? output : undefined;
}

/** The answer under the key the eve tool answers its words in; an answer that is not words, or none yet, as it is. */
function wordsUnder(output: WireValue | undefined, key: string): WireValue | undefined {
  const words = answerWords(output);
  return words === undefined ? output : { [key]: words };
}

/** A command's answer as eve's shell answers one: the terminal's words as its output. Note that the CLI folds the command's errors into the same words, so none are told apart. */
function terminalAnswer(output: WireValue | undefined): WireValue | undefined {
  const words = answerWords(output);
  return words === undefined ? output : { stdout: words, stderr: "", exitCode: 0 };
}

/** The string under a key of the input, or nothing where it holds none. */
function inputString(input: WireValue | undefined, key: string): string | undefined {
  return isRecord(input) && isWireString(input[key]) ? input[key] : undefined;
}

/** Each line of some words behind a patch's mark for it, as a patch spells a removal or an addition. */
function patchLines(mark: string, words: string | undefined): readonly string[] {
  return words === undefined || words === ""
    ? []
    : words.split("\n").map((line) => `${mark}${line}`);
}

/** A change to one file as `apply_patch` spells it, which the edit renderer reads its file and its coloured lines from. */
function patchOf(path: string, hunk: string, removed: readonly string[], added: readonly string[]) {
  return [`*** Update File: ${path}`, hunk, ...removed, ...added].join("\n");
}

/** A to-do's status as the wire spells it: Claude Code's `completed` is done, and the rest are spelled alike. */
function todoStatus(status: WireValue | undefined): WireValue | undefined {
  return status === "completed" ? CODING_AGENT_TODO_STATUS.DONE : status;
}

/** A `TodoWrite` list as `write_todos` takes one: each item's words and status; an item that does not read is kept, so the list reads as JSON rather than as a shorter list. */
function todosInput(input: WireValue | undefined): WireValue | undefined {
  const todos = isRecord(input) ? input.todos : undefined;
  if (!Array.isArray(todos)) return input;
  return {
    todos: todos.map((todo: WireValue) =>
      isRecord(todo)
        ? { content: todo.content ?? "", status: todoStatus(todo.status) ?? "" }
        : todo,
    ),
  };
}

/** What a monitor watches, as the command its row names: its command, or the socket it opened. */
function watched(input: WireValue | undefined): string {
  const socket = isRecord(input) ? input.ws : undefined;
  return inputString(input, "command") ?? inputString(socket, "url") ?? "";
}

/**
 * Claude Code's tools, each read as the eve call that does what it does:
 * a command as `bash`, a read as `read_file`, a whole file written as
 * `write_file`, an edit or a notebook cell as an `apply_patch` of the lines
 * it changed, a search as `glob` or `grep`, a page and a web search as
 * `read_web_page` and `search_web`, the list as `write_todos`, a skill as
 * `load_skill`, a wakeup as the pause `sleep` takes, and a monitor as the
 * command it watches. A subagent's call keeps its name.
 */
const CLAUDE_CODE_CALLS: Record<
  (typeof CLAUDE_CODE_TOOL)[keyof typeof CLAUDE_CODE_TOOL],
  NativeCallReading
> = {
  [CLAUDE_CODE_TOOL.BASH]: ({ input, output }) => ({
    tool: AGENT_TOOL.BASH,
    input,
    output: terminalAnswer(output),
  }),
  [CLAUDE_CODE_TOOL.MONITOR]: ({ input, output }) => ({
    tool: AGENT_TOOL.BASH,
    input: { command: watched(input), description: inputString(input, "description") ?? "" },
    output: terminalAnswer(output),
  }),
  [CLAUDE_CODE_TOOL.READ]: ({ input, output }) => ({
    tool: AGENT_TOOL.READ_FILE,
    input: { filePath: inputString(input, "file_path") ?? "" },
    output: wordsUnder(output, "content"),
  }),
  [CLAUDE_CODE_TOOL.WRITE]: ({ input, output }) => ({
    tool: AGENT_TOOL.WRITE_FILE,
    input: {
      filePath: inputString(input, "file_path") ?? "",
      content: inputString(input, "content") ?? "",
    },
    output,
  }),
  [CLAUDE_CODE_TOOL.EDIT]: ({ input, output }) => ({
    tool: AGENT_TOOL.APPLY_PATCH,
    input: {
      patchText: patchOf(
        inputString(input, "file_path") ?? "",
        isRecord(input) && input.replace_all === true ? "@@ every occurrence" : "@@",
        patchLines("-", inputString(input, "old_string")),
        patchLines("+", inputString(input, "new_string")),
      ),
    },
    output,
  }),
  [CLAUDE_CODE_TOOL.NOTEBOOK_EDIT]: ({ input, output }) => {
    const mode = inputString(input, "edit_mode") ?? "replace";
    const cell = inputString(input, "cell_id");
    return {
      tool: AGENT_TOOL.APPLY_PATCH,
      input: {
        patchText: patchOf(
          inputString(input, "notebook_path") ?? "",
          cell === undefined ? `@@ ${mode} cell` : `@@ ${mode} cell ${cell}`,
          [],
          mode === "delete" ? [] : patchLines("+", inputString(input, "new_source")),
        ),
      },
      output,
    };
  },
  [CLAUDE_CODE_TOOL.GLOB]: ({ input, output }) => ({
    tool: AGENT_TOOL.GLOB,
    input,
    output: wordsUnder(output, "content"),
  }),
  [CLAUDE_CODE_TOOL.GREP]: ({ input, output }) => ({
    tool: AGENT_TOOL.GREP,
    input,
    output: wordsUnder(output, "content"),
  }),
  [CLAUDE_CODE_TOOL.WEB_FETCH]: ({ input, output }) => ({
    tool: AGENT_TOOL.READ_WEB_PAGE,
    input: { url: inputString(input, "url") ?? "" },
    output: wordsUnder(output, "text"),
  }),
  [CLAUDE_CODE_TOOL.WEB_SEARCH]: ({ input, output }) => ({
    tool: AGENT_TOOL.SEARCH_WEB,
    input: { query: inputString(input, "query") ?? "" },
    output,
  }),
  [CLAUDE_CODE_TOOL.TODO_WRITE]: ({ input, output }) => ({
    tool: AGENT_TOOL.WRITE_TODOS,
    input: todosInput(input),
    output,
  }),
  [CLAUDE_CODE_TOOL.SKILL]: ({ input, output }) => ({
    tool: AGENT_TOOL.LOAD_SKILL,
    input: { skill: inputString(input, "skill") ?? "" },
    output,
  }),
  [CLAUDE_CODE_TOOL.SCHEDULE_WAKEUP]: ({ input, output }) => {
    const seconds = isRecord(input) ? input.delaySeconds : undefined;
    return {
      tool: AGENT_TOOL.SLEEP,
      input: isWireNumber(seconds) ? { seconds } : {},
      output,
    };
  },
  // Note that a subagent's call keeps its name, because no eve tool makes one as a single call: `tool-call-model.ts` draws it.
  [CLAUDE_CODE_TOOL.AGENT]: (call) => call,
};

/** Every native harness's calls, by the names they are stored under. */
const NATIVE_TOOL_CALLS: ReadonlyMap<string, NativeCallReading> = new Map(
  Object.entries(CLAUDE_CODE_CALLS),
);

/** A stored call as the transcript draws it: a native harness's as the eve call that does the same, and any other as it is. */
export function drawnCall(call: DrawnCall): DrawnCall {
  return NATIVE_TOOL_CALLS.get(call.tool)?.(call) ?? call;
}
