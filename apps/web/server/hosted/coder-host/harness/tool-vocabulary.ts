import {
  isRecord,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  type WireValue,
  WireValueSchema,
} from "@sidecar/wire";
import { verbatimJsonSchema } from "@sidecar/wire/effect";
import type { ToolSet } from "ai";
import { Option, Schema } from "effect";
import { wireValidatedTool } from "../../../core.js";
import { CODER_TOOL, CODER_TOOL_SET } from "../tool-set.js";

/**
 * tool-vocabulary.ts -- SPIKE (do not merge): a harness's tool calls in the coding agent's own vocabulary.
 *
 * The agent's tab draws a call by the name its part carries and reads the
 * fields eve's tools take (`tool-call-model.ts`): `bash`'s `command`,
 * `read_file`'s `filePath`, `apply_patch`'s `patchText`. A harness names
 * its calls by the AI SDK's common vocabulary where the adapter maps one
 * (`bash`, `read`, `write`, `edit`, `glob`, `grep`, `webSearch`) and by the
 * runtime's own name everywhere else (`WebFetch`, `TodoWrite`, `Agent`,
 * Codex's `apply_patch`), with the runtime's own input and output shapes.
 * Each call is told again here as the agent's tool of the same kind, its
 * input and output reshaped to the fields the tab reads, so a harness
 * turn draws as an eve turn does. Note what does not survive: Claude
 * Code's `Edit` is an exact string replacement, told as a one-hunk patch
 * so the tab names the file and shows the change; its `Bash` reports a
 * failure flag rather than the exit code, told as exit 1; and a call this
 * build has no kind for (a todo list, a subagent, a notebook edit, Codex's
 * path-only file change) is kept under a spike-only name of its own, which
 * the tab draws as "Used …" with its JSON.
 */

/** The names a harness's calls arrive under, as the adapters emit them (`commonName ?? nativeName`). */
const HARNESS_CALL = {
  BASH: "bash",
  READ: "read",
  WRITE: "write",
  EDIT: "edit",
  GLOB: "glob",
  GREP: "grep",
  WEB_SEARCH: "webSearch",
  WEB_FETCH: "WebFetch",
  APPLY_PATCH: "apply_patch",
  TODO_WRITE: "TodoWrite",
  SUBAGENT: "Agent",
  NOTEBOOK_EDIT: "NotebookEdit",
  VIEW_IMAGE: "view_image",
  FILE_CHANGE: "fileChange",
  COMPACTION: "compaction",
} as const;

/** The spike's own names for the calls the agent's vocabulary has no kind for. */
export const HARNESS_ONLY_TOOL = {
  TODO_LIST: "todo_list",
  SUBAGENT: "subagent",
  NOTEBOOK_EDIT: "notebook_edit",
  VIEW_IMAGE: "view_image",
  FILE_CHANGE: "file_change",
  COMPACTION: "compaction",
  /** Every other call of the runtime's own, its name kept in the input. */
  OTHER: "harness_tool",
} as const;

/** One call as the agent's vocabulary tells it. */
export interface CoderCall {
  readonly name: string;
  readonly input: UnparsedWireValue;
}

const readWire = Schema.decodeUnknownOption(WireValueSchema);

/** A value the runtime handed over, read as wire JSON at the boundary; anything that is not JSON reads as null. */
const asWire = (value: unknown): WireValue => Option.getOrElse(readWire(value), () => null);

function stringAt(value: WireValue, key: string): string | undefined {
  return isRecord(value) && isWireString(value[key]) ? value[key] : undefined;
}

/** A replacement told as the one-hunk patch `apply_patch` spells, so the tab names the file and shows the change. */
function replacementPatch(path: string, before: string, after: string): string {
  const removed = before.split("\n").map((line) => `-${line}`);
  const added = after.split("\n").map((line) => `+${line}`);
  return [
    "*** Begin Patch",
    `*** Update File: ${path}`,
    "@@",
    ...removed,
    ...added,
    "*** End Patch",
  ].join("\n");
}

/** The call in the agent's vocabulary: its name and the input reshaped to the fields the tab reads. */
export function coderCallOf(harnessName: string, rawInput: unknown): CoderCall {
  const input = asWire(rawInput);
  const path = stringAt(input, "file_path") ?? "";
  switch (harnessName) {
    case HARNESS_CALL.BASH:
      return { name: CODER_TOOL.BASH, input: { command: stringAt(input, "command") ?? "" } };
    case HARNESS_CALL.READ:
      return { name: CODER_TOOL.READ_FILE, input: { filePath: path } };
    case HARNESS_CALL.WRITE:
      return {
        name: CODER_TOOL.WRITE_FILE,
        input: { filePath: path, content: stringAt(input, "content") ?? "" },
      };
    case HARNESS_CALL.EDIT:
      return {
        name: CODER_TOOL.APPLY_PATCH,
        input: {
          patchText: replacementPatch(
            path,
            stringAt(input, "old_string") ?? "",
            stringAt(input, "new_string") ?? "",
          ),
        },
      };
    case HARNESS_CALL.APPLY_PATCH:
      // Codex's patch is its call's whole input, a string, in the same grammar eve's tool reads.
      return {
        name: CODER_TOOL.APPLY_PATCH,
        input: { patchText: isWireString(input) ? input : (stringAt(input, "input") ?? "") },
      };
    case HARNESS_CALL.GLOB:
    case HARNESS_CALL.GREP:
      return {
        name: harnessName === HARNESS_CALL.GLOB ? CODER_TOOL.GLOB : CODER_TOOL.GREP,
        input: { pattern: stringAt(input, "pattern") ?? "", path: stringAt(input, "path") ?? "." },
      };
    case HARNESS_CALL.WEB_SEARCH:
      return { name: CODER_TOOL.WEB_SEARCH, input: { query: stringAt(input, "query") ?? "" } };
    case HARNESS_CALL.WEB_FETCH:
      return { name: CODER_TOOL.WEB_FETCH, input: { url: stringAt(input, "url") ?? "" } };
    case CODER_TOOL.EDIT_PLAN:
      return { name: CODER_TOOL.EDIT_PLAN, input };
    case HARNESS_CALL.TODO_WRITE:
      return { name: HARNESS_ONLY_TOOL.TODO_LIST, input };
    case HARNESS_CALL.SUBAGENT:
      return { name: HARNESS_ONLY_TOOL.SUBAGENT, input };
    case HARNESS_CALL.NOTEBOOK_EDIT:
      return { name: HARNESS_ONLY_TOOL.NOTEBOOK_EDIT, input };
    case HARNESS_CALL.VIEW_IMAGE:
      return { name: HARNESS_ONLY_TOOL.VIEW_IMAGE, input };
    case HARNESS_CALL.FILE_CHANGE:
      return { name: HARNESS_ONLY_TOOL.FILE_CHANGE, input };
    case HARNESS_CALL.COMPACTION:
      return { name: HARNESS_ONLY_TOOL.COMPACTION, input: {} };
    default:
      return { name: HARNESS_ONLY_TOOL.OTHER, input: { name: harnessName, input } };
  }
}

/**
 * A call's answer in the shape the tab reads for its kind: a command's
 * output and exit, a file's words, the files a patch changed; anything
 * else as the runtime gave it. Claude Code answers with its own
 * `tool_use_result`, Codex with its app-server item, so each kind reads
 * either.
 */
export function coderOutputOf(coderName: string, rawOutput: unknown): UnparsedWireValue {
  const output = asWire(rawOutput);
  if (!isRecord(output)) return output;
  switch (coderName) {
    case CODER_TOOL.BASH: {
      const stdout = stringAt(output, "stdout") ?? stringAt(output, "output") ?? "";
      const exitCode = isWireNumber(output.exitCode) ? output.exitCode : 0;
      return { status: "completed", exitCode, stdout, stderr: stringAt(output, "stderr") ?? "" };
    }
    case CODER_TOOL.READ_FILE: {
      const file = output.file;
      const content = isRecord(file) ? stringAt(file, "content") : stringAt(output, "content");
      return content === undefined ? output : { content };
    }
    case CODER_TOOL.WRITE_FILE:
      return { path: stringAt(output, "filePath") ?? "" };
    case CODER_TOOL.APPLY_PATCH: {
      const path = stringAt(output, "filePath");
      return path === undefined ? output : { files: [{ operation: "update", path }] };
    }
    case CODER_TOOL.GLOB:
    case CODER_TOOL.GREP: {
      const filenames = output.filenames;
      const listed = Array.isArray(filenames)
        ? filenames.filter(isWireString).join("\n")
        : undefined;
      return { content: stringAt(output, "content") ?? listed ?? "" };
    }
    case CODER_TOOL.WEB_FETCH:
      return { content: stringAt(output, "result") ?? stringAt(output, "content") ?? "" };
    default:
      return output;
  }
}

const TOOL_INPUT = verbatimJsonSchema(WireValueSchema, {
  type: "object",
  additionalProperties: true,
});

/** The coding agent's tool set with the spike's own names beside it, as stored rows of a harness turn are held to it. */
export const HARNESS_TOOL_SET: ToolSet = {
  ...CODER_TOOL_SET,
  ...Object.fromEntries(
    Object.values(HARNESS_ONLY_TOOL).map((name) => [
      name,
      wireValidatedTool(`a harness's ${name}`, TOOL_INPUT),
    ]),
  ),
};
