import { AGENT_TOOL, CLAUDE_CODE_TOOL, CODEX_TOOL } from "@luke/features/agent-tools";
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
 * name and needs no reading, and a subagent's call (`Agent`) keeps its name,
 * which the tab draws as a delegation's row, as eve's `delegate` is drawn.
 *
 * Each harness has one table, keyed by the names its calls are stored under,
 * which no two harnesses share: Claude Code's and Codex's (`CODEX_TOOL`,
 * `codex-moments.ts`), joined in `NATIVE_TOOL_CALLS`. Nothing here draws.
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

/** The makers a native subagent's model is named under, as the catalog's ids begin. */
const ANTHROPIC = "anthropic";
const OPENAI = "openai";

/**
 * A subagent call's input with its model named as the catalog names it
 * (`anthropic/sonnet`), so its row wears its maker's mark; a model already
 * so named, or none, as it is.
 */
function withMaker(input: WireValue | undefined, maker: string): WireValue | undefined {
  const model = inputString(input, "model");
  if (!isRecord(input) || model === undefined || model.includes("/")) return input;
  return { ...input, model: `${maker}/${model}` };
}

/** Each line of some words behind a patch's mark for it, as a patch spells a removal or an addition; the newline that ends the words' last line opens no line of its own. */
function patchLines(mark: string, words: string | undefined): readonly string[] {
  if (words === undefined || words === "") return [];
  const lines = words.split("\n");
  if (words.endsWith("\n")) lines.pop();
  return lines.map((line) => `${mark}${line}`);
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
 * `read_web_page` and `web_search`, the list as `write_todos`, a skill as
 * `load_skill`, and a monitor as the command it watches. A subagent's
 * call and a scheduled wakeup keep their names.
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
    tool: AGENT_TOOL.WEB_SEARCH,
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
  // Note that a wakeup keeps its name, because it schedules a prompt for later rather than pausing the turn as `sleep` does: it is drawn as a plain call, its reason and prompt in its body.
  [CLAUDE_CODE_TOOL.SCHEDULE_WAKEUP]: (call) => call,
  // Note that a subagent's call keeps its name, which the tab draws as a delegation's row, its model named as the catalog names Anthropic's.
  [CLAUDE_CODE_TOOL.AGENT]: (call) => ({ ...call, input: withMaker(call.input, ANTHROPIC) }),
};

/** A Codex command's answer, `{output, exitCode}`, as eve's shell answers one; the exit code is none while it runs or once it was stopped. */
function codexTerminalAnswer(output: WireValue | undefined): WireValue | undefined {
  if (!isRecord(output) || !isWireString(output.output)) return output;
  const exitCode = isWireNumber(output.exitCode) ? output.exitCode : 0;
  return { stdout: output.output, stderr: "", exitCode };
}

/** The header `apply_patch` opens a file's change with, for each kind of change Codex reports. */
const CODEX_CHANGE_HEADER: Readonly<Record<string, string>> = {
  add: "Add",
  delete: "Delete",
  update: "Update",
};

/**
 * One file of a Codex file change as `apply_patch` spells it: a file added
 * as its lines added, one deleted as its lines removed, and an update as the
 * unified diff Codex reports, which is already marked line by line; a move
 * names where the file went, as `apply_patch` does.
 */
function codexFilePatch(change: WireValue): readonly string[] {
  const path = inputString(change, "path") ?? "";
  const kind = isRecord(change) ? change.kind : undefined;
  const type = inputString(kind, "type") ?? "update";
  const diff = inputString(change, "diff");
  const header = `*** ${CODEX_CHANGE_HEADER[type] ?? "Update"} File: ${path}`;
  if (type === "add") return [header, ...patchLines("+", diff)];
  if (type === "delete") return [header, ...patchLines("-", diff)];
  const moved = inputString(kind, "move_path");
  return [
    header,
    ...(moved === undefined ? [] : [`*** Move to: ${moved}`]),
    ...patchLines("", diff),
  ];
}

/** A Codex file change's files as one `apply_patch`, which the edit renderer reads each file and its coloured lines from. */
function codexPatch(input: WireValue | undefined): WireValue | undefined {
  const changes = isRecord(input) ? input.changes : undefined;
  if (!Array.isArray(changes)) return input;
  return { patchText: changes.flatMap(codexFilePatch).join("\n") };
}

/** A plan step's status as the wire spells a to-do's: Codex's `inProgress` and `completed` are in progress and done. */
function codexStepStatus(status: WireValue | undefined): WireValue | undefined {
  if (status === "inProgress") return CODING_AGENT_TODO_STATUS.IN_PROGRESS;
  if (status === "completed") return CODING_AGENT_TODO_STATUS.DONE;
  return status;
}

/** Codex's plan as `write_todos` takes a list: each step's words and status; a step that does not read is kept, so the list reads as JSON rather than as a shorter list. */
function codexTodosInput(input: WireValue | undefined): WireValue | undefined {
  const plan = isRecord(input) ? input.plan : undefined;
  if (!Array.isArray(plan)) return input;
  return {
    todos: plan.map((step: WireValue) =>
      isRecord(step)
        ? { content: step.step ?? "", status: codexStepStatus(step.status) ?? "" }
        : step,
    ),
  };
}

/** The few words a Codex subagent call is named by where it carries no task: what it did to the subagents it names. */
const CODEX_SUBAGENT_DOING: Readonly<Record<string, string>> = {
  wait: "Wait for subagents",
  closeAgent: "Close a subagent",
  resumeAgent: "Resume a subagent",
};

/** The collab tool that starts a subagent on a thread of its own, as `CollabAgentTool` spells it. */
const CODEX_SPAWN_AGENT = "spawnAgent";

/** A Codex spawn's input as Claude Code's `Agent` takes one: its task, and the model and effort it asked for, where it named them. */
function codexSpawnInput(input: WireValue | undefined): WireValue | undefined {
  const model = inputString(input, "model");
  const effort = inputString(input, "effort");
  return withMaker(
    {
      prompt: inputString(input, "prompt") ?? "",
      ...(model === undefined ? undefined : { model }),
      ...(effort === undefined ? undefined : { effort }),
    },
    OPENAI,
  );
}

/** A Codex subagent call's input as a native subagent's is drawn: its task, and the words naming it where it has none. */
function codexSubagentInput(input: WireValue | undefined): WireValue | undefined {
  if (!isRecord(input)) return input;
  const prompt = inputString(input, "prompt") ?? "";
  const tool = inputString(input, "tool") ?? "";
  return prompt.trim() === ""
    ? { prompt, description: CODEX_SUBAGENT_DOING[tool] ?? tool }
    : { prompt };
}

/** A Codex subagent call's answer as the subagents' words, each state's message, or its status where none said any; any other answer as it is. */
function codexSubagentAnswer(output: WireValue | undefined): WireValue | undefined {
  const states = isRecord(output) ? output.agentsStates : undefined;
  if (!isRecord(states)) return output;
  const words = Object.values(states).flatMap((state) => {
    const message = inputString(state, "message")?.trim();
    return message === undefined || message === "" ? [] : [message];
  });
  return words.length > 0 ? words.join("\n\n") : (inputString(output, "status") ?? output);
}

/**
 * Codex's items, each read as the eve call that does what it does: a
 * command as `bash`, a file change as an `apply_patch` of its files, a web
 * search as `web_search`, and the turn's plan as `write_todos`. A call to
 * an MCP server other than Luke's is named by its server and its tool, which
 * the generic row draws, its arguments as its input. A spawn of a subagent
 * is read as Claude Code's `Agent`, the one name the tab draws a native
 * subagent's delegation row by (`delegates`); any other subagent call keeps
 * its name for `tool-call-model.ts` to draw as one call, its task and its
 * subagents' words read as a native subagent's.
 */
const CODEX_CALLS: Record<(typeof CODEX_TOOL)[keyof typeof CODEX_TOOL], NativeCallReading> = {
  [CODEX_TOOL.COMMAND_EXECUTION]: ({ input, output }) => ({
    tool: AGENT_TOOL.BASH,
    input: { command: inputString(input, "command") ?? "" },
    output: codexTerminalAnswer(output),
  }),
  [CODEX_TOOL.FILE_CHANGE]: ({ input, output }) => ({
    tool: AGENT_TOOL.APPLY_PATCH,
    input: codexPatch(input),
    output: inputString(output, "status") ?? output,
  }),
  [CODEX_TOOL.WEB_SEARCH]: ({ input, output }) => ({
    tool: AGENT_TOOL.WEB_SEARCH,
    input: { query: inputString(input, "query") ?? "" },
    output,
  }),
  [CODEX_TOOL.TODO_LIST]: ({ input, output }) => ({
    tool: AGENT_TOOL.WRITE_TODOS,
    input: codexTodosInput(input),
    output,
  }),
  // Note that the server's name is joined to the tool's with a dot, which no tool of Luke's or eve's is named with, so no renderer of theirs takes it.
  [CODEX_TOOL.MCP_TOOL_CALL]: ({ input, output }) => ({
    tool: `${inputString(input, "server") ?? ""}.${inputString(input, "tool") ?? ""}`,
    input: isRecord(input) ? input.arguments : input,
    output,
  }),
  [CODEX_TOOL.SUBAGENT]: ({ input, output }) =>
    inputString(input, "tool") === CODEX_SPAWN_AGENT
      ? {
          tool: CLAUDE_CODE_TOOL.AGENT,
          input: codexSpawnInput(input),
          output: codexSubagentAnswer(output),
        }
      : {
          tool: CODEX_TOOL.SUBAGENT,
          input: codexSubagentInput(input),
          output: codexSubagentAnswer(output),
        },
};

/** Every native harness's calls, by the names they are stored under. */
const NATIVE_TOOL_CALLS: ReadonlyMap<string, NativeCallReading> = new Map([
  ...Object.entries(CLAUDE_CODE_CALLS),
  ...Object.entries(CODEX_CALLS),
]);

/** A stored call as the transcript draws it: a native harness's as the eve call that does the same, and any other as it is. */
export function drawnCall(call: DrawnCall): DrawnCall {
  return NATIVE_TOOL_CALLS.get(call.tool)?.(call) ?? call;
}
