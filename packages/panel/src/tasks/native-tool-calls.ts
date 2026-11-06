import { AGENT_TOOL, CLAUDE_CODE_TOOL, CODEX_TOOL } from "@repo/features/agent-tools";
import { AGENT_TODO_STATUS } from "@repo/features/agent-wire";
import { isRecord, isWireNumber, isWireString, type WireValue } from "@repo/wire";

export interface DrawnCall {
  readonly tool: string;
  readonly input: WireValue | undefined;
  readonly output: WireValue | undefined;
}

type NativeCallReading = (call: DrawnCall) => DrawnCall;

function answerWords(output: WireValue | undefined): string | undefined {
  return isWireString(output) ? output : undefined;
}

function wordsUnder(output: WireValue | undefined, key: string): WireValue | undefined {
  const words = answerWords(output);
  return words === undefined ? output : { [key]: words };
}

function terminalAnswer(output: WireValue | undefined): WireValue | undefined {
  const words = answerWords(output);
  return words === undefined ? output : { stdout: words, stderr: "", exitCode: 0 };
}

function inputString(input: WireValue | undefined, key: string): string | undefined {
  return isRecord(input) && isWireString(input[key]) ? input[key] : undefined;
}

const ANTHROPIC = "anthropic";
const OPENAI = "openai";

function withMaker(input: WireValue | undefined, maker: string): WireValue | undefined {
  const model = inputString(input, "model");
  if (!isRecord(input) || model === undefined || model.includes("/")) return input;
  return { ...input, model: `${maker}/${model}` };
}

function patchLines(mark: string, words: string | undefined): readonly string[] {
  if (words === undefined || words === "") return [];
  const lines = words.split("\n");
  if (words.endsWith("\n")) lines.pop();
  return lines.map((line) => `${mark}${line}`);
}

function patchOf(path: string, hunk: string, removed: readonly string[], added: readonly string[]) {
  return [`*** Update File: ${path}`, hunk, ...removed, ...added].join("\n");
}

function todoStatus(status: WireValue | undefined): WireValue | undefined {
  return status === "completed" ? AGENT_TODO_STATUS.DONE : status;
}

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

function watched(input: WireValue | undefined): string {
  const socket = isRecord(input) ? input.ws : undefined;
  return inputString(input, "command") ?? inputString(socket, "url") ?? "";
}

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
  [CLAUDE_CODE_TOOL.SCHEDULE_WAKEUP]: (call) => call,
  [CLAUDE_CODE_TOOL.TASK_CREATE]: (call) => call,
  [CLAUDE_CODE_TOOL.TASK_UPDATE]: (call) => call,
  [CLAUDE_CODE_TOOL.TASK_LIST]: (call) => call,
  [CLAUDE_CODE_TOOL.TASK_GET]: (call) => call,
  [CLAUDE_CODE_TOOL.TASK_STOP]: (call) => call,
  [CLAUDE_CODE_TOOL.SEND_MESSAGE]: (call) => call,
  [CLAUDE_CODE_TOOL.AGENT]: (call) => ({ ...call, input: withMaker(call.input, ANTHROPIC) }),
};

function codexTerminalAnswer(output: WireValue | undefined): WireValue | undefined {
  if (!isRecord(output) || !isWireString(output.output)) return output;
  const exitCode = isWireNumber(output.exitCode) ? output.exitCode : 0;
  return { stdout: output.output, stderr: "", exitCode };
}

const CODEX_CHANGE_HEADER: Readonly<Record<string, string>> = {
  add: "Add",
  delete: "Delete",
  update: "Update",
};

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

function codexPatch(input: WireValue | undefined): WireValue | undefined {
  const changes = isRecord(input) ? input.changes : undefined;
  if (!Array.isArray(changes)) return input;
  return { patchText: changes.flatMap(codexFilePatch).join("\n") };
}

function codexStepStatus(status: WireValue | undefined): WireValue | undefined {
  if (status === "inProgress") return AGENT_TODO_STATUS.IN_PROGRESS;
  if (status === "completed") return AGENT_TODO_STATUS.DONE;
  return status;
}

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

const CODEX_SUBAGENT_DOING: Readonly<Record<string, string>> = {
  wait: "Wait for subagents",
  closeAgent: "Close a subagent",
  resumeAgent: "Resume a subagent",
};

const CODEX_SPAWN_AGENT = "spawnAgent";

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

function codexSubagentInput(input: WireValue | undefined): WireValue | undefined {
  if (!isRecord(input)) return input;
  const prompt = inputString(input, "prompt") ?? "";
  const tool = inputString(input, "tool") ?? "";
  return prompt.trim() === ""
    ? { prompt, description: CODEX_SUBAGENT_DOING[tool] ?? tool }
    : { prompt };
}

function codexSubagentAnswer(output: WireValue | undefined): WireValue | undefined {
  const states = isRecord(output) ? output.agentsStates : undefined;
  if (!isRecord(states)) return output;
  const words = Object.values(states).flatMap((state) => {
    const message = inputString(state, "message")?.trim();
    return message === undefined || message === "" ? [] : [message];
  });
  return words.length > 0 ? words.join("\n\n") : (inputString(output, "status") ?? output);
}

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
  [CODEX_TOOL.IMAGE_VIEW]: ({ input, output }) => ({
    tool: AGENT_TOOL.READ_FILE,
    input: { filePath: inputString(input, "path") ?? "" },
    output: wordsUnder(output, "content"),
  }),
  [CODEX_TOOL.TODO_LIST]: ({ input, output }) => ({
    tool: AGENT_TOOL.WRITE_TODOS,
    input: codexTodosInput(input),
    output,
  }),
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

const NATIVE_TOOL_CALLS: ReadonlyMap<string, NativeCallReading> = new Map([
  ...Object.entries(CLAUDE_CODE_CALLS),
  ...Object.entries(CODEX_CALLS),
]);

export function drawnCall(call: DrawnCall): DrawnCall {
  return NATIVE_TOOL_CALLS.get(call.tool)?.(call) ?? call;
}
