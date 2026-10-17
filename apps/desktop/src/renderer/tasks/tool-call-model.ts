import { AGENT_TOOL, type AgentTool, EVE_TOOL, RETIRED_TOOL } from "@luke/features/agent-tools";
import { CHAT_TOOL } from "@luke/features/chat-wire";
import {
  CODING_AGENT_TODO_STATUS,
  type CodingAgentTodos,
  codingAgentTodosInputSchema,
} from "@luke/features/coding-agent-wire";
import {
  INBOX_BLOCK,
  INBOX_FIELD,
  INBOX_RESPONSE,
  type InboxPost,
  type InboxPostBlock,
  inboxPostInputSchema,
} from "@luke/features/inbox-wire";
import {
  type IntegrationProvider,
  type IntegrationRemoteCall,
  integrationOfRemoteTool,
  integrationRemoteCallSchema,
} from "@luke/features/integration-wire";
import { linkLabels } from "@luke/features/mention-link";
import type { ModelChoice } from "@luke/features/models-wire";
import type { PlanAgentEdit } from "@luke/features/plan-template";
import type { CodeRef } from "@luke/features/task-wire";
import { CALL_KIND, type CallKind, commandDescription, pageName } from "@luke/features/turn-rows";
import { skillWord } from "@luke/ui/skill-mention";
import { fileRefText } from "@luke/voice/code-pane-model";
import { isRecord, isWireNumber, isWireString, type WireValue } from "@luke/wire";
import { Option, Schema } from "effect";
import { TOOL_BLOCK, type ToolBlock } from "../ai-elements/tool";
import { shortCommit } from "./file-tab-model";

/**
 * tool-call-model.ts -- what a coding agent's tool call says on its one row, and what its body shows, decided from the part's own input and output.
 *
 * Pure decisions over the tool part the SDK stored: the row's kind and
 * subject are read from the call's input alone, so a row drawn while the
 * call runs does not change shape when its answer lands, and the kind's
 * verb is `turn-rows.ts`'s, the same the Call tab says, but for a command
 * the model said the purpose of, whose line says that instead; the body's two
 * blocks are read from the input and the output in the tool's own terms
 * (a command, a patch, a file's words) where the tool is one eve gives the
 * agent, and as their JSON where it is not. A delegation's row is read the
 * same way from the part S1's `delegate` tool stores: the task, the pair
 * the worker runs on, and its answer once it has one. A to-do write's list
 * is read through the wire's own schema, since its input is the list the
 * row draws item by item, and an item posted to the developer's inbox
 * through it too, its row naming the item the Inbox tab draws. A call
 * about something the window opens elsewhere, a page, the board, an agent,
 * code shown, names it as its target (`toolTarget`), which its row opens.
 * A call of an integration's own MCP tool, stored under its provider's
 * remote name, is drawn as the tool it ran: the provider's mark, the
 * remote tool's own name, and the input it was sent (`remoteCallOf`).
 * Nothing here draws.
 */

export interface ToolCallView {
  readonly kind: CallKind;
  /** The thing the call was done to, after its kind's verb. */
  readonly subject: string;
  /** For a command, the plain words the model said it is for, which its line says in place of the verb and the command; absent where it said none. */
  readonly description?: string;
  readonly input: ToolBlock;
  /** Nothing while the call has not answered. */
  readonly output: ToolBlock | undefined;
  /** For a call of an integration's own tool, the integration, whose mark its row wears in its kind's icon's place. */
  readonly provider?: IntegrationProvider;
}

/** The escape every terminal colour and cursor sequence starts with. */
const ESCAPE = String.fromCharCode(27);

/** A control sequence (`ESC [ … m`) or an operating-system command (`ESC ] … BEL`), which a terminal would have eaten. */
const ANSI_SEQUENCE = new RegExp(
  `${ESCAPE}(?:\\[[0-9;?]*[ -/]*[@-~]|\\][^${String.fromCharCode(7)}${ESCAPE}]*(?:${String.fromCharCode(7)}|${ESCAPE}\\\\))`,
  "gu",
);

/** The words with every terminal escape taken out. */
function stripAnsi(text: string): string {
  return text.replace(ANSI_SEQUENCE, "");
}

/** A patch header naming a file, as `apply_patch` spells one. */
const PATCH_FILE_HEADER = /^\*\*\* (?:Add|Update|Delete|Move to) File: (.+)$/u;

/** The files a patch touches, in the order its headers name them. */
function patchPaths(patchText: string): readonly string[] {
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

/** The files a `show_image` call named, in order, as its row's subject. */
function shownPaths(input: WireValue | undefined): string {
  const images = isRecord(input) && Array.isArray(input.images) ? input.images : [];
  return images
    .flatMap((image) => (isRecord(image) && isWireString(image.path) ? [image.path] : []))
    .join(", ");
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

/** What a command the Mac killed at its timeout says at its end. */
const TIMED_OUT_NOTE = "(killed at its timeout)";

/** The status `run_on_mac` answers with when the Mac ran nothing. */
const MAC_COMMAND_NOT_RUN = "not-run";

/** A command the Mac ran: as a terminal would have shown it, its timeout said where it was killed; or why it was not run. */
function macCommandOutput(output: WireValue): ToolBlock {
  if (stringAt(output, "status") === MAC_COMMAND_NOT_RUN) {
    return textBlock(stringAt(output, "reason") ?? "");
  }
  const shown = commandOutput(output);
  const timedOut = isRecord(output) && output.timedOut === true;
  if (!timedOut) return shown;
  return textBlock(shown.text === "" ? TIMED_OUT_NOTE : `${shown.text}\n${TIMED_OUT_NOTE}`);
}

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

/** A loaded skill's answer, which is its instructions as words; anything else as its JSON. */
function skillOutput(output: WireValue): ToolBlock {
  return isWireString(output) ? textBlock(output) : jsonBlock(output);
}

/** The name of the skill a skill load asked for; nothing while its input has not said it. */
export function loadedSkill(input: WireValue | undefined): string | undefined {
  const name = stringAt(input, "skill");
  return name === "" ? undefined : name;
}

/**
 * What a plan note of each kind did, in the row's words, keyed by the kinds
 * the agents' journal keeps, a deletion among them as a strike. Note that the
 * keys are held to the template's type and not read from its module, because
 * the template reaches Effect's Schema, which the renderer bundle does not
 * carry for one table of words.
 */
const NOTE_VERB = {
  add: "added",
  replace: "corrected",
  remove: "struck",
} as const satisfies Record<PlanAgentEdit["notes"][number]["kind"], string>;

/** What one note of a call's input did, by its kind: a replacement with no words is a strike. */
function noteKind(note: WireValue): string {
  const kind = stringAt(note, "kind") ?? "";
  const text = stringAt(note, "text");
  return kind === "replace" && text !== undefined && text.trim() === "" ? "remove" : kind;
}

/** The notes a plan edit took, summed by what each did, and the pictures it added: "2 added, 1 corrected, 1 picture added". */
function planEditSummary(input: WireValue | undefined): string {
  const notes = isRecord(input) ? input.notes : undefined;
  if (notes === undefined || !isWireArray(notes)) return "";
  const pictured = isRecord(input) ? input.pictures : undefined;
  const pictures = pictured !== undefined && isWireArray(pictured) ? pictured.length : 0;
  return Object.entries(NOTE_VERB)
    .flatMap(([kind, verb]) => {
      const count = notes.filter((note) => noteKind(note) === kind).length;
      return count === 0 ? [] : [`${count} ${verb}`];
    })
    .concat(pictures === 0 ? [] : [`${pictures} ${pictures === 1 ? "picture" : "pictures"} added`])
    .join(", ");
}

const readTodos = Schema.decodeUnknownOption(codingAgentTodosInputSchema);

/** The list a to-do write carries, or nothing where its input does not read as one, as while it streams. */
export function todosView(input: WireValue | undefined): CodingAgentTodos["todos"] | undefined {
  return Option.getOrUndefined(readTodos(input))?.todos;
}

/** How far a list has got: "2 of 5 done". */
export function todosSummary(todos: CodingAgentTodos["todos"]): string {
  const done = todos.filter((todo) => todo.status === CODING_AGENT_TODO_STATUS.DONE).length;
  return `${done} of ${todos.length} done`;
}

/** The item a list is at: the one in progress, else the first still pending; nothing once every item is done. */
export function todoFocus(todos: CodingAgentTodos["todos"]): string | undefined {
  const current =
    todos.find((todo) => todo.status === CODING_AGENT_TODO_STATUS.IN_PROGRESS) ??
    todos.find((todo) => todo.status === CODING_AGENT_TODO_STATUS.PENDING);
  return current?.content;
}

/** One item of a list as words, where the list is copied or drawn as a call's input: a markdown checkbox, the item in progress saying so. */
function todoLine(todo: CodingAgentTodos["todos"][number]): string {
  switch (todo.status) {
    case CODING_AGENT_TODO_STATUS.PENDING:
      return `- [ ] ${todo.content}`;
    case CODING_AGENT_TODO_STATUS.IN_PROGRESS:
      return `- [ ] ${todo.content} (in progress)`;
    case CODING_AGENT_TODO_STATUS.DONE:
      return `- [x] ${todo.content}`;
  }
}

/** A to-do write's row: how far the list has got, and the list as checkboxes, or its JSON where it does not read. Its answer only says the list was taken, so none is shown. */
function todosToolView(input: WireValue | undefined): ToolCallView {
  const todos = todosView(input);
  if (todos === undefined) {
    return {
      kind: CALL_KIND.TODOS,
      subject: "",
      input: input === undefined ? textBlock("") : jsonBlock(input),
      output: undefined,
    };
  }
  return {
    kind: CALL_KIND.TODOS,
    subject: todosSummary(todos),
    input: textBlock(todos.map(todoLine).join("\n")),
    output: undefined,
  };
}

const readPost = Schema.decodeUnknownOption(inboxPostInputSchema);

/** The item a post carries, or nothing where its input does not read as one, as while it streams. */
function inboxPostView(input: WireValue | undefined): InboxPost | undefined {
  return Option.getOrUndefined(readPost(input));
}

/** What a post asks, as the row's body lists it: a choice's options, the recommended one saying so, or a form's fields with their types. */
function askLines(response: InboxPost["response"]): readonly string[] {
  switch (response.type) {
    case INBOX_RESPONSE.CHOICE:
      return response.options.map((option) => {
        const recommended = response.recommended === option.label ? " (recommended)" : "";
        const detail = option.detail === undefined ? "" : ` -- ${option.detail}`;
        return `- ${option.label}${recommended}${detail}`;
      });
    case INBOX_RESPONSE.FORM:
      return response.fields.map((field) => {
        const options =
          field.type === INBOX_FIELD.SELECT ? `: ${(field.options ?? []).join(", ")}` : "";
        const required = field.required === true ? ", required" : "";
        return `- ${field.label} (${field.type}${required})${options}`;
      });
    default:
      return [];
  }
}

/** One block of a post as the row's body lists it: Markdown as written, a link as its label and address, code as its path, lines, and commit, and an image as its words and the path it was posted from. */
function blockLine(block: InboxPostBlock): string {
  switch (block.type) {
    case INBOX_BLOCK.MARKDOWN:
      return block.text;
    case INBOX_BLOCK.LINK:
      return `${block.label}: ${block.url}`;
    case INBOX_BLOCK.CODE:
      return `${fileRefText(block)} at ${shortCommit(block.sha)}`;
    case INBOX_BLOCK.IMAGE:
      return `Image: ${block.alt} (${block.path})`;
  }
}

/** A post's context and what it asks as the row's body lists them: each block in turn, then the options or the fields. */
function postLines(post: InboxPost): string {
  const blocks = (post.blocks ?? []).map(blockLine);
  return [...blocks, ...askLines(post.response)].filter((line) => line.trim() !== "").join("\n");
}

/**
 * An inbox call's row: a post names its item's title and lists what it
 * asks, a close names the item's key and says why, and a read names
 * nothing. An answer that did what was asked is the agent's whole inbox,
 * which the Inbox tab draws as it stands, so none is shown here; one that
 * did nothing shows why, so a refused post never reads as posted.
 */
function inboxToolView(
  tool: string,
  input: WireValue | undefined,
  output: WireValue | undefined,
): ToolCallView {
  const refused = inboxRefusal(output);
  if (tool === AGENT_TOOL.POST_TO_INBOX) {
    const post = inboxPostView(input);
    return {
      kind: CALL_KIND.INBOX_POST,
      subject: post === undefined ? "" : cardTitle(post.title),
      input:
        post === undefined
          ? input === undefined
            ? textBlock("")
            : jsonBlock(input)
          : textBlock(postLines(post)),
      output: refused,
    };
  }
  if (tool === AGENT_TOOL.CLOSE_INBOX_ITEM) {
    return {
      kind: CALL_KIND.INBOX_CLOSE,
      subject: stringAt(input, "key") ?? "",
      input: textBlock(stringAt(input, "reason") ?? ""),
      output: refused,
    };
  }
  return { kind: CALL_KIND.INBOX_READ, subject: "", input: textBlock(""), output: refused };
}

/** The status an inbox call answers with when it did nothing, by the word its answer spells. */
const INBOX_CALL_REJECTED = "rejected";

/** Why an inbox call did nothing, as the row's answer shows it; nothing where it did what it was asked, whose answer is the inbox the Inbox tab draws. */
function inboxRefusal(output: WireValue | undefined): ToolBlock | undefined {
  if (stringAt(output, "status") !== INBOX_CALL_REJECTED) return undefined;
  return textBlock(stringAt(output, "reason") ?? "");
}

/** The units a pause is said in, longest first, each by its seconds and its word. */
const SPAN_UNITS = [
  [3_600, "hour"],
  [60, "minute"],
  [1, "second"],
] as const;

/** A count of seconds as a row says it, in its largest whole unit or two: "45 seconds", "5 minutes", "1 hour 30 minutes". */
function spanText(seconds: number): string {
  const rounded = Math.max(1, Math.round(seconds));
  const parts = SPAN_UNITS.flatMap(([span, word], index) => {
    const count = Math.floor((rounded % (SPAN_UNITS[index - 1]?.[0] ?? Infinity)) / span);
    return count === 0 ? [] : [`${count} ${word}${count === 1 ? "" : "s"}`];
  });
  return parts.slice(0, 2).join(" ");
}

/** How a pause ended: how long it waited, or that a message ended it early. */
function sleepOutput(output: WireValue): ToolBlock {
  if (isRecord(output) && output.interrupted === true) {
    return textBlock("Stopped early: a message arrived.");
  }
  const waited =
    isRecord(output) && isWireNumber(output.waitedSeconds) ? output.waitedSeconds : undefined;
  return waited === undefined ? jsonBlock(output) : textBlock(`Waited ${spanText(waited)}.`);
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
      const description = commandDescription(stringAt(input, "description"));
      return {
        kind: CALL_KIND.COMMAND,
        subject: command,
        ...(description === undefined ? undefined : { description }),
        input: { kind: TOOL_BLOCK.COMMAND, text: command },
        output: output === undefined ? undefined : commandOutput(output),
      };
    }
    case AGENT_TOOL.RUN_ON_MAC: {
      const command = stringAt(input, "command") ?? "";
      const description = commandDescription(stringAt(input, "description"));
      return {
        kind: CALL_KIND.MAC_COMMAND,
        subject: command,
        ...(description === undefined ? undefined : { description }),
        input: { kind: TOOL_BLOCK.COMMAND, text: command },
        output: output === undefined ? undefined : macCommandOutput(output),
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
    case RETIRED_TOOL.WEB_FETCH:
      return {
        kind: CALL_KIND.WEB_PAGE,
        subject: pageName(stringAt(input, "url") ?? ""),
        input: textBlock(stringAt(input, "url") ?? ""),
        output: output === undefined ? undefined : wordsOutput(output, "content"),
      };
    case AGENT_TOOL.READ_WEB_PAGE:
      return {
        kind: CALL_KIND.WEB_PAGE,
        subject: pageName(stringAt(input, "url") ?? ""),
        input: textBlock(stringAt(input, "url") ?? ""),
        output: output === undefined ? undefined : wordsOutput(output, "text"),
      };
    case AGENT_TOOL.SEARCH_WEB:
    case RETIRED_TOOL.WEB_SEARCH:
      return {
        kind: CALL_KIND.WEB_SEARCH,
        subject: stringAt(input, "query") ?? "",
        input: textBlock(stringAt(input, "query") ?? ""),
        output: output === undefined ? undefined : jsonBlock(output),
      };
    case AGENT_TOOL.LOAD_SKILL: {
      const skillName = loadedSkill(input);
      return {
        kind: CALL_KIND.LOAD_SKILL,
        // A skill is named as the words that load it wherever it is drawn (`skill-ref.tsx`).
        subject: skillName === undefined ? "" : skillWord(skillName),
        input: textBlock(skillName ?? ""),
        output: output === undefined ? undefined : skillOutput(output),
      };
    }
    case AGENT_TOOL.EDIT_PLAN:
      return {
        kind: CALL_KIND.EDIT_PLAN,
        subject: planEditSummary(input),
        input: input === undefined ? textBlock("") : jsonBlock(input),
        output: output === undefined ? undefined : jsonBlock(output),
      };
    case AGENT_TOOL.WRITE_TODOS:
      return todosToolView(input);
    case AGENT_TOOL.SHOW_PAGE:
      return {
        kind: CALL_KIND.SHOW_PAGE,
        subject: stringAt(input, "title") ?? "",
        input: textBlock(stringAt(input, "path") ?? stringAt(input, "html") ?? ""),
        output: output === undefined ? undefined : jsonBlock(output),
      };
    // A page read is named by the title its answer gives, the id alone being all the call holds.
    case AGENT_TOOL.READ_PAGE:
      return {
        kind: CALL_KIND.READ_PAGE,
        subject: stringAt(isRecord(output) ? output.page : undefined, "title") ?? "",
        input: input === undefined ? textBlock("") : jsonBlock(input),
        output: output === undefined ? undefined : jsonBlock(output),
      };
    case AGENT_TOOL.SHOW_IMAGE:
      return {
        kind: CALL_KIND.SHOW_IMAGE,
        subject: shownPaths(input),
        input: input === undefined ? textBlock("") : jsonBlock(input),
        output: output === undefined ? undefined : jsonBlock(output),
      };
    case AGENT_TOOL.POST_TO_INBOX:
    case AGENT_TOOL.CLOSE_INBOX_ITEM:
    case AGENT_TOOL.READ_INBOX:
      return inboxToolView(tool, input, output);
    case AGENT_TOOL.SLEEP: {
      const seconds = isRecord(input) && isWireNumber(input.seconds) ? input.seconds : undefined;
      return {
        kind: CALL_KIND.SLEEP,
        subject: seconds === undefined ? "" : spanText(seconds),
        input: input === undefined ? textBlock("") : jsonBlock(input),
        output: output === undefined ? undefined : sleepOutput(output),
      };
    }
    default:
      return undefined;
  }
}

/** A repository command's answer as the brain's tool journals it: the command's own output, or why it ran nothing, in the words the service said it, which say it was not run. */
function repositoryOutput(output: WireValue): ToolBlock {
  const reason = stringAt(output, "reason");
  if (stringAt(output, "status") === "not-run" && reason !== undefined) return textBlock(reason);
  return commandOutput(output);
}

/** The lines `show_code` put on screen, as its row names them: the file, and the lines where it named any, said as a code card says them. */
function shownLines(input: WireValue | undefined): string {
  const path = stringAt(input, "path") ?? "";
  const startLine = isRecord(input) && isWireNumber(input.startLine) ? input.startLine : undefined;
  const endLine = isRecord(input) && isWireNumber(input.endLine) ? input.endLine : startLine;
  return fileRefText({ path, startLine, endLine });
}

/** A brain call whose input is one field the row names it by, its answer as its JSON. */
function namedCall(
  kind: CallKind,
  input: WireValue | undefined,
  output: WireValue | undefined,
  field: string | undefined,
): ToolCallView {
  return {
    kind,
    subject: field === undefined ? "" : (stringAt(input, field) ?? ""),
    input: input === undefined ? textBlock("") : jsonBlock(input),
    output: output === undefined ? undefined : jsonBlock(output),
  };
}

/** A call about one agent named by the agent's title its answer gives, as the agent's tab names it; nothing before the answer, whose input holds only an id. */
function answeredAgentCall(
  kind: CallKind,
  input: WireValue | undefined,
  output: WireValue | undefined,
): ToolCallView {
  const agent = isRecord(output) ? output.agent : undefined;
  return { ...namedCall(kind, input, output, undefined), subject: stringAt(agent, "title") ?? "" };
}

/** The job of each worker, by eve's id for its task, which a stop names in the task's place. */
export type WorkerJobs = ReadonlyMap<string, string>;

/** What a stop names: the job of the worker it stopped where it is known, and the task's id otherwise. */
function stoppedTask(input: WireValue | undefined, jobs: WorkerJobs | undefined): string {
  const task = stringAt(input, "taskId");
  return (task === undefined ? undefined : jobs?.get(task)) ?? task ?? "";
}

/**
 * A call of one of the brain's own tools, or one eve gives a
 * brain session, drawn from its part as a coding agent's call is: its
 * kind and the one input a reader looks for first. A look at the board
 * answers with an image of it, which is nothing to read, so it shows none;
 * a look at one of the plan's pictures is kept as whether it looked alone,
 * and shows that.
 */
function tasksToolView(
  tool: string,
  input: WireValue | undefined,
  output: WireValue | undefined,
  jobs: WorkerJobs | undefined,
): ToolCallView | undefined {
  switch (tool) {
    case AGENT_TOOL.RUN_IN_REPOSITORY: {
      const command = stringAt(input, "command") ?? "";
      const description = commandDescription(stringAt(input, "description"));
      return {
        kind: CALL_KIND.COMMAND,
        subject: command,
        ...(description === undefined ? undefined : { description }),
        input: { kind: TOOL_BLOCK.COMMAND, text: command },
        output: output === undefined ? undefined : repositoryOutput(output),
      };
    }
    case AGENT_TOOL.SHOW_CODE:
      return {
        ...namedCall(CALL_KIND.SHOW_CODE, input, output, undefined),
        subject: shownLines(input),
      };
    case AGENT_TOOL.DRAW_ON_BOARD:
      return namedCall(CALL_KIND.DRAW_ON_BOARD, input, output, undefined);
    case AGENT_TOOL.LOOK_AT_BOARD:
      return namedCall(CALL_KIND.LOOK_AT_BOARD, input, undefined, undefined);
    case AGENT_TOOL.LOOK_AT_PICTURE:
      return namedCall(CALL_KIND.LOOK_AT_PICTURE, input, output, undefined);
    case AGENT_TOOL.QUEUE_QUESTION:
      return namedCall(CALL_KIND.QUEUE_QUESTION, input, output, "question");
    case AGENT_TOOL.WITHDRAW_QUESTION:
      return namedCall(CALL_KIND.WITHDRAW_QUESTION, input, output, "question");
    // An agent tool is read alike under its name and the one it had on Luke's calls before every agent was offered it.
    case AGENT_TOOL.LIST_AGENTS:
    case RETIRED_TOOL.LIST_CODING_AGENTS:
      return namedCall(CALL_KIND.LIST_AGENTS, input, output, undefined);
    case AGENT_TOOL.READ_AGENT:
    case RETIRED_TOOL.READ_CODING_AGENT:
      return namedCall(CALL_KIND.READ_AGENT, input, output, "agentId");
    case AGENT_TOOL.MESSAGE_AGENT:
    case RETIRED_TOOL.MESSAGE_CODING_AGENT:
      return namedCall(CALL_KIND.MESSAGE_AGENT, input, output, "text");
    case AGENT_TOOL.START_AGENT:
    case RETIRED_TOOL.START_CODING_AGENT:
      // Note that a start journaled before the prompt had its name carries it as `task`.
      return namedCall(
        CALL_KIND.START_AGENT,
        input,
        output,
        stringAt(input, "prompt") === undefined ? "task" : "prompt",
      );
    case AGENT_TOOL.ARCHIVE_AGENT:
      return answeredAgentCall(CALL_KIND.ARCHIVE_AGENT, input, output);
    case AGENT_TOOL.UNARCHIVE_AGENT:
      return answeredAgentCall(CALL_KIND.UNARCHIVE_AGENT, input, output);
    case AGENT_TOOL.END_CALL:
      return namedCall(CALL_KIND.END_CALL, input, output, undefined);
    case EVE_TOOL.TASK_WAIT:
      return namedCall(CALL_KIND.WORKER_WAIT, input, output, undefined);
    case EVE_TOOL.TASK_CANCEL:
      return {
        ...namedCall(CALL_KIND.WORKER_CANCEL, input, output, undefined),
        subject: stoppedTask(input, jobs),
      };
    default:
      return undefined;
  }
}

const readRemoteCall = Schema.decodeUnknownOption(integrationRemoteCallSchema);

/** A call of an integration's own tool, as its stored part names it: the integration, and the envelope the call is kept in; nothing for any other call, or an envelope that does not read. */
export function remoteCallOf(
  tool: string,
  input: WireValue | undefined,
): { readonly provider: IntegrationProvider; readonly call: IntegrationRemoteCall } | undefined {
  const provider = integrationOfRemoteTool(tool);
  if (provider === undefined) return undefined;
  const call = readRemoteCall(input);
  return Option.isSome(call) ? { provider, call: call.value } : undefined;
}

/** A call of an integration's own tool, drawn as the tool it ran: the integration's mark, the tool's own name, and the input the tool was sent. */
function remoteToolView(
  tool: string,
  input: WireValue | undefined,
  output: WireValue | undefined,
): ToolCallView | undefined {
  const remote = remoteCallOf(tool, input);
  if (remote === undefined) return undefined;
  return {
    kind: CALL_KIND.OTHER,
    subject: remote.call.remoteTool,
    provider: remote.provider,
    input: jsonBlock(remote.call.input),
    output: output === undefined ? undefined : jsonBlock(output),
  };
}

/** How one tool call is drawn: its row and its body, from the part's input and output, a stop naming the worker it stopped by its job where `jobs` knows it. */
export function toolCallView(input: {
  readonly tool: string;
  readonly input: WireValue | undefined;
  readonly output: WireValue | undefined;
  readonly jobs?: WorkerJobs | undefined;
}): ToolCallView {
  return (
    knownToolView(input.tool, input.input, input.output) ??
    tasksToolView(input.tool, input.input, input.output, input.jobs) ??
    remoteToolView(input.tool, input.input, input.output) ?? {
      kind: CALL_KIND.OTHER,
      subject: input.tool,
      input: input.input === undefined ? textBlock("") : jsonBlock(input.input),
      output: input.output === undefined ? undefined : jsonBlock(input.output),
    }
  );
}

/** The tools a member talks in chat with, by name. */
type ChatTool = (typeof CHAT_TOOL)[keyof typeof CHAT_TOOL];

/** What a call's row may open: something the window already draws in a tab of its own. */
export const TOOL_TARGET = {
  /** A coding agent's tab in the task's column. */
  AGENT: "agent",
  /** A page's tab in the side panel. */
  PAGE: "page",
  /** The side panel's Board tab. */
  BOARD: "board",
  /** The task's own tab, its document. */
  PLAN: "plan",
  /** The File tab of a file Luke showed, its lines lit as the call showed them. */
  SHOWN_CODE: "shown-code",
  /** The task's Inbox tab. */
  INBOX: "inbox",
  /** The plan's Chat tab, its channel of the workspace's chat. */
  CHAT: "chat",
} as const;

export type ToolTarget =
  | { readonly kind: typeof TOOL_TARGET.AGENT; readonly agent: string }
  | { readonly kind: typeof TOOL_TARGET.PAGE; readonly page: string }
  | { readonly kind: typeof TOOL_TARGET.BOARD }
  | { readonly kind: typeof TOOL_TARGET.PLAN }
  | { readonly kind: typeof TOOL_TARGET.SHOWN_CODE; readonly call: string; readonly ref: CodeRef }
  | { readonly kind: typeof TOOL_TARGET.INBOX }
  | { readonly kind: typeof TOOL_TARGET.CHAT };

/** What the hover over a row says it opens, by its target's kind. */
export const TARGET_HINT = {
  [TOOL_TARGET.AGENT]: "Open the agent",
  [TOOL_TARGET.PAGE]: "Open the page",
  [TOOL_TARGET.BOARD]: "Open the Board",
  [TOOL_TARGET.PLAN]: "Open the plan",
  [TOOL_TARGET.SHOWN_CODE]: "Open the file",
  [TOOL_TARGET.INBOX]: "Open the Inbox",
  [TOOL_TARGET.CHAT]: "Open the plan's chat",
} as const satisfies Record<ToolTarget["kind"], string>;

/** A call as its target is read from it: the tool, the call's id, and its input and answer. */
interface TargetedCall {
  readonly tool: string;
  readonly callId: string;
  readonly input: WireValue | undefined;
  readonly output: WireValue | undefined;
}

const BOARD_TARGET: ToolTarget = { kind: TOOL_TARGET.BOARD };
const TASK_TARGET: ToolTarget = { kind: TOOL_TARGET.PLAN };
const INBOX_TARGET: ToolTarget = { kind: TOOL_TARGET.INBOX };
const CHAT_TARGET: ToolTarget = { kind: TOOL_TARGET.CHAT };

/**
 * A post into the poster's plan channel, where its plan's Chat tab shows it:
 * one naming neither a `to` nor a message it replies to. Note that a post
 * elsewhere, a read, and a resolve open nothing and fold open instead,
 * because the channel each reaches is named in words the window cannot
 * place on a channel, or not named at all.
 */
function plansOwnPost(call: TargetedCall): ToolTarget | undefined {
  if (!isRecord(call.input) || "to" in call.input || "replyTo" in call.input) return undefined;
  return CHAT_TARGET;
}

/** The agent a call names in its input, as a read of or a message to one does. */
function namedAgent(call: TargetedCall): ToolTarget | undefined {
  const agent = stringAt(call.input, "agentId");
  if (agent === undefined || onAnotherTask(call)) return undefined;
  return { kind: TOOL_TARGET.AGENT, agent };
}

/**
 * Whether a call's answer says its agent is on another task than the one
 * the call was made on, which opens nothing here: a task's column draws
 * its own agents' tabs alone, so such an agent's row folds open in place.
 * An answer from before the service said so is read as this task's.
 */
function onAnotherTask(call: TargetedCall): boolean {
  const answer = isRecord(call.output) ? call.output.agent : undefined;
  return isRecord(answer) && answer.onYourTask === false;
}

/** The agent a start began, which its answer names once it has. */
function startedAgent(call: TargetedCall): ToolTarget | undefined {
  const answer = isRecord(call.output) ? call.output.agent : undefined;
  const agent = stringAt(answer, "id");
  if (agent === undefined || onAnotherTask(call)) return undefined;
  return { kind: TOOL_TARGET.AGENT, agent };
}

/** The page a write made or moved on, which its answer names once it has. */
function shownPage(call: TargetedCall): ToolTarget | undefined {
  const answer = isRecord(call.output) ? call.output.page : undefined;
  const page = stringAt(answer, "id");
  return page === undefined ? undefined : { kind: TOOL_TARGET.PAGE, page };
}

/** The page a read answered, which opens its tab where it is on the call's own task; one of another task opens nothing here. */
function readPage(call: TargetedCall): ToolTarget | undefined {
  const answer = isRecord(call.output) ? call.output.page : undefined;
  return isRecord(answer) && answer.isYourTask === true ? shownPage(call) : undefined;
}

/** The lines `show_code` put on screen, as a reference a File tab lights. */
function shownCode(call: TargetedCall): ToolTarget | undefined {
  const path = stringAt(call.input, "path");
  if (path === undefined || path === "" || !isRecord(call.input)) return undefined;
  const { startLine, endLine } = call.input;
  const ref: CodeRef = {
    path,
    ...(isWireNumber(startLine) ? { startLine } : undefined),
    ...(isWireNumber(endLine) ? { endLine } : undefined),
  };
  return { kind: TOOL_TARGET.SHOWN_CODE, call: call.callId, ref };
}

/**
 * What each tool's call opens, read from the call alone; a tool not listed
 * opens nothing, and its row folds its input and answer open in place. A
 * worker's own delegation and a loaded skill open their tabs through their
 * own rows (`DelegationRow`, `LoadedSkillView`), and a command, a search, or
 * a file's read, write, or patch, or a web read is read in its row's body,
 * so none is listed. A chat tool's call opens the plan's Chat tab, where
 * what it posted or read stands. Note that a coding agent's file calls stay in their
 * bodies, because a File tab and the Changes tab read the repository and
 * the pull request on GitHub rather than the agent's checkout, so what the
 * agent read or wrote and has not pushed would open on nothing.
 */
const TOOL_TARGETS: ReadonlyMap<string, (call: TargetedCall) => ToolTarget | undefined> = new Map<
  AgentTool | (typeof RETIRED_TOOL)[keyof typeof RETIRED_TOOL] | ChatTool,
  (call: TargetedCall) => ToolTarget | undefined
>([
  [AGENT_TOOL.SHOW_PAGE, shownPage],
  [AGENT_TOOL.READ_PAGE, readPage],
  [AGENT_TOOL.DRAW_ON_BOARD, () => BOARD_TARGET],
  [AGENT_TOOL.LOOK_AT_BOARD, () => BOARD_TARGET],
  [AGENT_TOOL.READ_AGENT, namedAgent],
  [AGENT_TOOL.MESSAGE_AGENT, namedAgent],
  [AGENT_TOOL.START_AGENT, startedAgent],
  [AGENT_TOOL.UNARCHIVE_AGENT, namedAgent],
  [RETIRED_TOOL.READ_CODING_AGENT, namedAgent],
  [RETIRED_TOOL.MESSAGE_CODING_AGENT, namedAgent],
  [RETIRED_TOOL.START_CODING_AGENT, startedAgent],
  [AGENT_TOOL.EDIT_PLAN, () => TASK_TARGET],
  [AGENT_TOOL.LOOK_AT_PICTURE, () => TASK_TARGET],
  [AGENT_TOOL.SHOW_CODE, shownCode],
  [AGENT_TOOL.POST_TO_INBOX, () => INBOX_TARGET],
  [AGENT_TOOL.CLOSE_INBOX_ITEM, () => INBOX_TARGET],
  [AGENT_TOOL.READ_INBOX, () => INBOX_TARGET],
  [CHAT_TOOL.POST, plansOwnPost],
]);

/**
 * Whether a call's answer says it did nothing. Note that it is told by the
 * reason it answers beside its status rather than by the status's word,
 * because every refusal among these tools answers why (`rejected`, the
 * board's `not-drawn` and `not-looked`), each tool in words of its own the
 * renderer cannot reach, and no answer that did what was asked carries one.
 */
function refused(output: WireValue | undefined): boolean {
  return stringAt(output, "reason") !== undefined;
}

/**
 * What a call's row opens, or nothing where it opens nothing. Note that a
 * call opens nothing until it has answered, because until then what it is
 * about has not changed, and its row's body is where its input is read; nor
 * does one its tool refused, whose body is where the refusal is read.
 */
export function toolTarget(call: TargetedCall): ToolTarget | undefined {
  if (call.output === undefined || refused(call.output)) return undefined;
  return TOOL_TARGETS.get(call.tool)?.(call);
}

/** The tools whose call is about one coding agent, under every name one was made under, which a row names by the agent's chip. */
const AGENT_CALL_TOOLS: ReadonlySet<string> = new Set([
  AGENT_TOOL.READ_AGENT,
  AGENT_TOOL.MESSAGE_AGENT,
  AGENT_TOOL.START_AGENT,
  AGENT_TOOL.ARCHIVE_AGENT,
  AGENT_TOOL.UNARCHIVE_AGENT,
  RETIRED_TOOL.READ_CODING_AGENT,
  RETIRED_TOOL.MESSAGE_CODING_AGENT,
  RETIRED_TOOL.START_CODING_AGENT,
]);

/** The agent a call about one names: its id, and the title its answer gives it, either missing where neither the call nor its answer says it. */
export interface CalledAgent {
  readonly id: string | undefined;
  readonly title: string | undefined;
}

/**
 * The agent a call about one names, which its row draws as the agent's
 * chip: the id its answer names, else the one its input does, and the
 * title its answer gives; nothing for any other call, or for one that
 * names no agent yet, as a start does until it has answered. Note that a
 * refused call still names the agent its input asked for, because the row
 * still says what it tried.
 */
export function calledAgent(call: Omit<TargetedCall, "callId">): CalledAgent | undefined {
  if (!AGENT_CALL_TOOLS.has(call.tool)) return undefined;
  const answer = isRecord(call.output) ? call.output.agent : undefined;
  const id = stringAt(answer, "id") ?? stringAt(call.input, "agentId");
  const title = stringAt(answer, "title");
  return id === undefined && title === undefined ? undefined : { id, title };
}

/** The fields a delegation's part carries, in the wire's words (`codingAgentDelegationInputSchema`, `codingAgentDelegationOutputSchema`), and the message the brain's worker is handed in the task's place. */
const DELEGATION_FIELD = {
  TASK: "task",
  MESSAGE: "message",
  MODEL: "model",
  EFFORT: "effort",
  RESULT: "result",
} as const;

/** What a delegation's row says and holds: the task, the pair the worker runs on, and its answer once it has one. */
export interface DelegationView {
  readonly task: string;
  /** The pair the worker runs on: the one it ran on once settled, else the one the agent chose, each half the agent's own where it chose none; nothing where no pair is known. */
  readonly choice: ModelChoice | undefined;
  readonly result: string | undefined;
}

/**
 * How one delegation is drawn, from the part's input and output. The settled
 * output names the pair the worker ran on, which is the one to say; before it
 * lands, the agent's choice stands, each half it left open filled from the
 * agent's own pair, since that is what the service fills it from.
 */
export function delegationView(
  part: {
    readonly input: WireValue | undefined;
    readonly output: WireValue | undefined;
  },
  own: ModelChoice | undefined,
): DelegationView {
  // Note that the output is read whole or not at all, because a half pair names no run.
  const settled =
    stringAt(part.output, DELEGATION_FIELD.MODEL) !== undefined &&
    stringAt(part.output, DELEGATION_FIELD.EFFORT) !== undefined;
  const model = settled
    ? stringAt(part.output, DELEGATION_FIELD.MODEL)
    : (stringAt(part.input, DELEGATION_FIELD.MODEL) ?? own?.model);
  const effort = settled
    ? stringAt(part.output, DELEGATION_FIELD.EFFORT)
    : (stringAt(part.input, DELEGATION_FIELD.EFFORT) ?? own?.effort);
  return {
    task:
      stringAt(part.input, DELEGATION_FIELD.TASK) ??
      stringAt(part.input, DELEGATION_FIELD.MESSAGE) ??
      "",
    choice: model !== undefined && effort !== undefined ? { model, effort } : undefined,
    result: stringAt(part.output, DELEGATION_FIELD.RESULT),
  };
}

/** The marks a markdown line opens on: a heading's, a quote's, or a list item's, which a plan's or a task's first line may carry. */
const LINE_MARKS = /^(?:#{1,6}|>|[-*+]|\d+[.)])\s+/u;

/**
 * The marks of strong emphasis and code inside a line, which a title drawn
 * as plain words leaves out. Note that `__` stays, because it is more often
 * a name's own (`__init__`) than emphasis.
 */
const INLINE_MARKS = /\*\*|`/gu;

/** A markdown fence's opening or closing line, which plain words leave out. */
const FENCE_LINE = /^\s*(?:```|~~~)/u;

/**
 * How a plan, a worker's task, or a thought is named on its card, its line,
 * and its tab: its first line of words, as plain words, since the line is
 * drawn as text and the markdown is the opened card's. A fence's line is
 * passed over, since its language tag is no words of the text's.
 */
export function cardTitle(text: string): string {
  const first = text.split("\n").find((line) => line.trim().length > 0 && !FENCE_LINE.test(line));
  return first === undefined ? "" : plainLine(first);
}

function plainLine(line: string): string {
  // A link is said by its name, as its chip names it, never its destination (`linkLabels`).
  return linkLabels(line.trim().replace(LINE_MARKS, "")).replace(INLINE_MARKS, "").trim();
}

/**
 * The whole of a message's markdown as plain words on one line, as a
 * preview too short to draw markdown reads it: each line as a title reads
 * its first, fences left out, joined by spaces.
 */
export function plainWords(text: string): string {
  return text
    .split("\n")
    .filter((line) => !FENCE_LINE.test(line))
    .map(plainLine)
    .filter((line) => line.length > 0)
    .join(" ");
}
