import {
  AGENT_TOOL,
  CLAUDE_CODE_TOOL,
  CODEX_TOOL,
  CONNECTION_TOOL,
} from "@luke/features/agent-tools";
import { CODING_AGENT_TODO_STATUS } from "@luke/features/coding-agent-wire";
import { INTEGRATION_REMOTE_TOOL, integrationConnectionOf } from "@luke/features/integration-wire";
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

/** The hunks the CLI reports an edit changed, each with the lines around it, as a patch spells them; nothing where it reported none. */
function reportedHunks(input: WireValue | undefined): readonly string[] | undefined {
  const hunks = isRecord(input) ? input.structuredPatch : undefined;
  if (!Array.isArray(hunks) || hunks.length === 0) return undefined;
  return hunks.flatMap((hunk: WireValue) => {
    if (!isRecord(hunk) || !Array.isArray(hunk.lines)) return [];
    const { oldStart, oldLines, newStart, newLines } = hunk;
    const lines = hunk.lines.filter(isWireString);
    return [`@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`, ...lines];
  });
}

/** An edit's patch: the hunks the CLI reported, with their context, where it reported them, and otherwise the lines replaced and their replacement. */
function editPatch(input: WireValue | undefined): string {
  const path = inputString(input, "file_path") ?? "";
  const hunks = reportedHunks(input);
  if (hunks !== undefined) return [`*** Update File: ${path}`, ...hunks].join("\n");
  return patchOf(
    path,
    isRecord(input) && input.replace_all === true ? "@@ every occurrence" : "@@",
    patchLines("-", inputString(input, "old_string")),
    patchLines("+", inputString(input, "new_string")),
  );
}

/** How `apply_patch` names what it did to a file, as its answer lists each. */
const PATCH_OPERATION = { ADD: "add", DELETE: "delete", UPDATE: "update" } as const;

/** A file edit's answer as `apply_patch` answers one, a line naming each file it changed; an answer that is not the CLI's words, or none yet, as it is. */
function editAnswer(output: WireValue | undefined, path: string): WireValue | undefined {
  return answerWords(output) === undefined
    ? output
    : { files: [{ operation: PATCH_OPERATION.UPDATE, path }] };
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
    input: { patchText: editPatch(input) },
    output: editAnswer(output, inputString(input, "file_path") ?? ""),
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
      output: editAnswer(output, inputString(input, "notebook_path") ?? ""),
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
  // Note that a wakeup keeps its name, because it schedules a prompt for later rather than pausing the turn as `sleep` does: `tool-call-model.ts` draws it as the time it checks back at.
  [CLAUDE_CODE_TOOL.SCHEDULE_WAKEUP]: (call) => call,
  // Note that a subagent's call keeps its name, because no eve tool makes one as a single call: `tool-call-model.ts` draws it.
  [CLAUDE_CODE_TOOL.AGENT]: (call) => call,
};

/** A Codex command's answer, `{output, exitCode}`, as eve's shell answers one; the exit code is none while it runs or once it was stopped. */
function codexTerminalAnswer(output: WireValue | undefined): WireValue | undefined {
  if (!isRecord(output) || !isWireString(output.output)) return output;
  const exitCode = isWireNumber(output.exitCode) ? output.exitCode : 0;
  return { stdout: output.output, stderr: "", exitCode };
}

/** A login shell's wrapper around a command, as Codex runs every one (`/bin/bash -lc '…'`): the shell, its flags, and the command as one quoted word. */
const SHELL_WRAPPER = /^(?:\S*\/)?(?:bash|zsh|sh) -l?c ([\s\S]+)$/u;

/** A shell word's text: a single-quoted word as it is, `'\''` its quote, and a double-quoted one with its escapes undone; nothing for a word that is not one quoted whole. */
function unquoted(word: string): string | undefined {
  const inner = word.slice(1, -1);
  if (word.length >= 2 && word.startsWith("'") && word.endsWith("'")) {
    return inner.replaceAll("'\\''", "").includes("'") ? undefined : inner.replaceAll("'\\''", "'");
  }
  if (word.length >= 2 && word.startsWith('"') && word.endsWith('"')) {
    return /(?<!\\)"/u.test(inner) ? undefined : inner.replace(/\\([\\"$`])/gu, "$1");
  }
  return /^[^\s'"\\]+$/u.test(word) ? word : undefined;
}

/** A Codex command as the model wrote it, without the login shell Codex wraps it in; a command it did not wrap, or one whose wrapper does not read, as it is. */
function unwrappedCommand(command: string): string {
  const word = SHELL_WRAPPER.exec(command.trim())?.[1];
  return (word === undefined ? undefined : unquoted(word)) ?? command;
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

/** A Codex file change's answer as `apply_patch` answers one, each file and what was done to it, once it completed; any other answer as its status. */
function codexPatchAnswer(input: WireValue | undefined, output: WireValue | undefined) {
  const status = inputString(output, "status");
  const changes = isRecord(input) ? input.changes : undefined;
  if (status !== "completed" || !Array.isArray(changes)) return status ?? output;
  return {
    files: changes.map((change: WireValue) => {
      const type = inputString(isRecord(change) ? change.kind : undefined, "type");
      return {
        operation: type === "add" || type === "delete" ? type : PATCH_OPERATION.UPDATE,
        path: inputString(change, "path") ?? "",
      };
    }),
  };
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
 * search as `search_web`, and the turn's plan as `write_todos`. A call to
 * an MCP server other than Luke's is named by its server and its tool, which
 * the generic row draws, its arguments as its input. A subagent's call keeps
 * its name for `tool-call-model.ts` to draw as one call, its task and its
 * subagents' words read as a native subagent's.
 */
const CODEX_CALLS: Record<(typeof CODEX_TOOL)[keyof typeof CODEX_TOOL], NativeCallReading> = {
  [CODEX_TOOL.COMMAND_EXECUTION]: ({ input, output }) => ({
    tool: AGENT_TOOL.BASH,
    input: { command: unwrappedCommand(inputString(input, "command") ?? "") },
    output: codexTerminalAnswer(output),
  }),
  [CODEX_TOOL.FILE_CHANGE]: ({ input, output }) => ({
    tool: AGENT_TOOL.APPLY_PATCH,
    input: codexPatch(input),
    output: codexPatchAnswer(input, output),
  }),
  [CODEX_TOOL.WEB_SEARCH]: ({ input, output }) => ({
    tool: AGENT_TOOL.SEARCH_WEB,
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
  [CODEX_TOOL.SUBAGENT]: ({ input, output }) => ({
    tool: CODEX_TOOL.SUBAGENT,
    input: codexSubagentInput(input),
    output: codexSubagentAnswer(output),
  }),
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

/** The native tools that run a command in the sandbox, whose failure is the command's exit rather than the call's. */
const COMMAND_TOOLS: ReadonlySet<string> = new Set([
  CLAUDE_CODE_TOOL.BASH,
  CLAUDE_CODE_TOOL.MONITOR,
  CODEX_TOOL.COMMAND_EXECUTION,
]);

/** The line Claude Code tells a command's non-zero exit in, among its words. */
const EXIT_LINE = /^(?:Error: )?Exit code (\d+)$/u;

/** A Claude Code command's failure, its words as the CLI told them, as eve's shell answers one: its output, and the exit code it named. */
function claudeCodeFailure(words: string): WireValue {
  const lines = words.split("\n");
  const exit = lines.findIndex((line) => EXIT_LINE.test(line.trim()));
  const exitCode = Number(EXIT_LINE.exec(lines[exit]?.trim() ?? "")?.[1] ?? 1);
  const stdout = lines.filter((_line, index) => index !== exit).join("\n");
  return { stdout, stderr: "", exitCode };
}

/**
 * A native command that ended in error, as eve's shell answers a command
 * that exited non-zero: its output, ending in its exit code, as an answer
 * rather than a failed call, since a failing exit is what the command said
 * and not something the tool could not do. The words are the error's, which
 * the harness told the model in place of an answer; Codex's own answer
 * already holds its output and its exit. Nothing for any other call.
 */
export function failedCommandCall(
  call: DrawnCall,
  errorText: string | undefined,
): DrawnCall | undefined {
  if (!COMMAND_TOOLS.has(call.tool)) return undefined;
  if (call.tool === CODEX_TOOL.COMMAND_EXECUTION && isRecord(call.output)) return drawnCall(call);
  const words = errorText ?? answerWords(call.output) ?? "";
  return { ...drawnCall({ ...call, output: undefined }), output: claudeCodeFailure(words) };
}

/**
 * A native agent's `connection_execute`, which Luke's MCP server answers
 * whole, drawn as eve draws the integration's own call it ran: under the
 * integration's remote name, its input the envelope of the tool's own name
 * and what it was sent, and its answer the tool's own result. Nothing for a
 * call of a connection that is no integration's, or one whose input does
 * not name a tool.
 */
export function connectionCall(
  call: DrawnCall & { readonly callId: string },
): DrawnCall | undefined {
  if (call.tool !== CONNECTION_TOOL.EXECUTE) return undefined;
  const connection = inputString(call.input, "connection");
  const remoteTool = inputString(call.input, "tool");
  const account = connection === undefined ? undefined : integrationConnectionOf(connection);
  if (account === undefined || remoteTool === undefined) return undefined;
  const sent = isRecord(call.input) && isRecord(call.input.input) ? call.input.input : {};
  return {
    tool: INTEGRATION_REMOTE_TOOL[account.provider],
    input: {
      remoteTool,
      parentCallId: call.callId,
      input: sent,
      ...(account.place > 1 && connection !== undefined ? { connection } : undefined),
    },
    output:
      isRecord(call.output) && call.output.output !== undefined ? call.output.output : call.output,
  };
}
