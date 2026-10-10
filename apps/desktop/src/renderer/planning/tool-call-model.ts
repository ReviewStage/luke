import { isRecord, isWireNumber, isWireString, type WireValue } from "@sidecar/wire";
import { TOOL_BLOCK, type ToolBlock } from "../ai-elements/tool";
import { CALL_KIND, type CallKind, pageName } from "./turn-rows";

/**
 * tool-call-model.ts -- what a coding agent's tool call says on its one row, and what its body shows, decided from the part's own input and output.
 *
 * Pure decisions over the tool part the SDK stored: the row's kind and
 * subject are read from the call's input alone, so a row drawn while the
 * call runs does not change shape when its answer lands, and the kind's
 * verb is `turn-rows.ts`'s, the same the Work tab says; the body's two
 * blocks are read from the input and the output in the tool's own terms
 * (a command, a patch, a file's words) where the tool is one eve gives the
 * agent, and as their JSON where it is not. Nothing here draws.
 */

/** The tools eve gives a coding agent, by the names its parts carry. */
const AGENT_TOOL = {
  BASH: "bash",
  READ_FILE: "read_file",
  WRITE_FILE: "write_file",
  APPLY_PATCH: "apply_patch",
  GREP: "grep",
  GLOB: "glob",
  WEB_FETCH: "web_fetch",
  WEB_SEARCH: "web_search",
} as const;

export interface ToolCallView {
  readonly kind: CallKind;
  /** The thing the call was done to, after its kind's verb. */
  readonly subject: string;
  readonly input: ToolBlock;
  /** Nothing while the call has not answered. */
  readonly output: ToolBlock | undefined;
}

/** The escape every terminal colour and cursor sequence starts with. */
const ESCAPE = String.fromCharCode(27);

/** A control sequence (`ESC [ … m`) or an operating-system command (`ESC ] … BEL`), which a terminal would have eaten. */
const ANSI_SEQUENCE = new RegExp(
  `${ESCAPE}(?:\\[[0-9;?]*[ -/]*[@-~]|\\][^${String.fromCharCode(7)}${ESCAPE}]*(?:${String.fromCharCode(7)}|${ESCAPE}\\\\))`,
  "gu",
);

/** The words with every terminal escape taken out. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_SEQUENCE, "");
}

/** A patch header naming a file, as `apply_patch` spells one. */
const PATCH_FILE_HEADER = /^\*\*\* (?:Add|Update|Delete|Move to) File: (.+)$/u;

/** The files a patch touches, in the order its headers name them. */
export function patchPaths(patchText: string): readonly string[] {
  return patchText.split("\n").flatMap((line) => {
    const match = PATCH_FILE_HEADER.exec(line.trimEnd());
    return match?.[1] === undefined ? [] : [match[1]];
  });
}

/** Where a value is drawn as JSON, how it reads: pretty-printed, a string as it is. */
function asJson(value: WireValue): string {
  return isWireString(value) ? value : JSON.stringify(value, null, 2);
}

function jsonBlock(value: WireValue): ToolBlock {
  return { kind: TOOL_BLOCK.JSON, text: asJson(value) };
}

function textBlock(text: string): ToolBlock {
  return { kind: TOOL_BLOCK.TEXT, text };
}

/** A subject with many files: the first, and how many more. */
function pathsSubject(paths: readonly string[]): string {
  const [first, ...rest] = paths;
  if (first === undefined) return "";
  return rest.length === 0 ? first : `${first} +${rest.length}`;
}

/** The string under a key of a record, or nothing where the record has none. */
function stringAt(value: WireValue | undefined, key: string): string | undefined {
  return isRecord(value) && isWireString(value[key]) ? value[key] : undefined;
}

function isWireArray(value: WireValue): value is readonly WireValue[] {
  return Array.isArray(value);
}

/** A command's answer as a terminal would have shown it: its output, then its errors, then a failing exit. */
function commandOutput(output: WireValue): ToolBlock {
  const stdout = stringAt(output, "stdout");
  const stderr = stringAt(output, "stderr");
  if (stdout === undefined || stderr === undefined || !isRecord(output)) return jsonBlock(output);
  const exitCode = isWireNumber(output.exitCode) ? output.exitCode : 0;
  const lines = [stdout.trimEnd(), stderr.trimEnd()].filter((text) => text.length > 0);
  if (exitCode !== 0) lines.push(`exit ${exitCode}`);
  if (output.truncated === true) lines.push(TRUNCATED_NOTE);
  return textBlock(stripAnsi(lines.join("\n")));
}

/** What an answer cut short by its tool says at its end. */
const TRUNCATED_NOTE = "(output truncated)";

/** A patch's answer: the files it changed, one a line, then every problem it reported. */
function patchOutput(output: WireValue): ToolBlock {
  const files = isRecord(output) ? output.files : undefined;
  if (files === undefined || !isWireArray(files)) return jsonBlock(output);
  const lines = files.flatMap((file) => {
    const operation = stringAt(file, "operation");
    const path = stringAt(file, "path");
    return operation === undefined || path === undefined ? [] : [`${operation} ${path}`];
  });
  const diagnostics = isRecord(output) ? output.diagnostics : undefined;
  if (diagnostics !== undefined && isWireArray(diagnostics)) {
    for (const diagnostic of diagnostics) lines.push(asJson(diagnostic));
  }
  return textBlock(lines.join("\n"));
}

/** An answer that is words under one key, as they are, with a note where the tool cut them short; anything else as its JSON. */
function wordsOutput(output: WireValue, key: string): ToolBlock {
  const words = stringAt(output, key);
  if (words === undefined) return jsonBlock(output);
  const truncated = isRecord(output) && output.truncated === true;
  return textBlock(truncated ? `${words.trimEnd()}\n${TRUNCATED_NOTE}` : words);
}

/** The row and body for one of eve's tools, or nothing where the tool is not one this build knows. */
function knownToolView(
  tool: string,
  input: WireValue | undefined,
  output: WireValue | undefined,
): ToolCallView | undefined {
  switch (tool) {
    case AGENT_TOOL.BASH: {
      const command = stringAt(input, "command") ?? "";
      return {
        kind: CALL_KIND.COMMAND,
        subject: command,
        input: { kind: TOOL_BLOCK.COMMAND, text: command },
        output: output === undefined ? undefined : commandOutput(output),
      };
    }
    case AGENT_TOOL.READ_FILE:
      return {
        kind: CALL_KIND.READ_FILE,
        subject: stringAt(input, "filePath") ?? "",
        input: textBlock(stringAt(input, "filePath") ?? ""),
        output: output === undefined ? undefined : wordsOutput(output, "content"),
      };
    case AGENT_TOOL.WRITE_FILE:
      return {
        kind: CALL_KIND.WRITE_FILE,
        subject: stringAt(input, "filePath") ?? "",
        input: textBlock(stringAt(input, "content") ?? ""),
        output: output === undefined ? undefined : wordsOutput(output, "path"),
      };
    case AGENT_TOOL.APPLY_PATCH: {
      const patchText = stringAt(input, "patchText") ?? "";
      return {
        kind: CALL_KIND.EDIT,
        subject: pathsSubject(patchPaths(patchText)),
        input: { kind: TOOL_BLOCK.PATCH, text: patchText },
        output: output === undefined ? undefined : patchOutput(output),
      };
    }
    case AGENT_TOOL.GREP:
    case AGENT_TOOL.GLOB:
      return {
        kind: CALL_KIND.SEARCH,
        subject: stringAt(input, "pattern") ?? "",
        input: input === undefined ? textBlock("") : jsonBlock(input),
        output: output === undefined ? undefined : wordsOutput(output, "content"),
      };
    case AGENT_TOOL.WEB_FETCH:
      return {
        kind: CALL_KIND.WEB_PAGE,
        subject: pageName(stringAt(input, "url") ?? ""),
        input: textBlock(stringAt(input, "url") ?? ""),
        output: output === undefined ? undefined : wordsOutput(output, "content"),
      };
    case AGENT_TOOL.WEB_SEARCH:
      return {
        kind: CALL_KIND.WEB_SEARCH,
        subject: stringAt(input, "query") ?? "",
        input: textBlock(stringAt(input, "query") ?? ""),
        output: output === undefined ? undefined : jsonBlock(output),
      };
    default:
      return undefined;
  }
}

/** How one tool call is drawn: its row and its body, from the part's input and output. */
export function toolCallView(input: {
  readonly tool: string;
  readonly input: WireValue | undefined;
  readonly output: WireValue | undefined;
}): ToolCallView {
  return (
    knownToolView(input.tool, input.input, input.output) ?? {
      kind: CALL_KIND.OTHER,
      subject: input.tool,
      input: input.input === undefined ? textBlock("") : jsonBlock(input.input),
      output: input.output === undefined ? undefined : jsonBlock(input.output),
    }
  );
}

/** A markdown heading's marks, which a plan's first line usually opens on. */
const HEADING_MARKS = /^#{1,6}\s+/u;

/** How a plan is named on its card: its first heading, or its first line of words. */
export function planCardTitle(text: string): string {
  const first = text.split("\n").find((line) => line.trim().length > 0);
  return first === undefined ? "" : first.trim().replace(HEADING_MARKS, "");
}
