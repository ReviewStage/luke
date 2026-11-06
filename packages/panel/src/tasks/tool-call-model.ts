import {
  AGENT_TOOL,
  type AgentTool,
  CLAUDE_CODE_TOOL,
  CODEX_TOOL,
  CONNECTION_TOOL,
  EVE_TOOL,
  RETIRED_TOOL,
} from "@repo/features/agent-tools";
import {
  AGENT_TODO_STATUS,
  type AgentTodos,
  agentTodosInputSchema,
} from "@repo/features/agent-wire";
import {
  INBOX_ASK,
  INBOX_BLOCK,
  INBOX_FIELD,
  INBOX_RESPONSE,
  type InboxPost,
  type InboxPostBlock,
  type InboxThreadPostInput,
  inboxPostInputSchema,
  inboxThreadPostInputSchema,
  recommendedLabels,
} from "@repo/features/inbox-wire";
import {
  INTEGRATION_NAME,
  type IntegrationProvider,
  type IntegrationRemoteCall,
  integrationConnectionOf,
  integrationOfRemoteTool,
  integrationRemoteCallSchema,
} from "@repo/features/integration-wire";
import { LINK_PLACE, type LinkPlace, linkOf } from "@repo/features/link-grammar";
import { linkLabels } from "@repo/features/mention-link";
import type { ModelChoice } from "@repo/features/models-wire";
import { descriptionAttachmentOf } from "@repo/features/description-attachment-link";
import type { DescriptionAgentEdit } from "@repo/features/description-notes";
import {
  browserCallWords,
  CALL_KIND,
  type CallKind,
  commandDescription,
  pageName,
} from "@repo/features/turn-rows";
import { skillWord } from "@repo/ui/skill-mention";
import { isRecord, isWireNumber, isWireString, type WireValue } from "@repo/wire";
import { Option, Schema } from "effect";
import { TOOL_BLOCK, type ToolBlock } from "../ai-elements/tool.js";
import { INLINE_SPAN, readInline } from "../description-editor/composer-markdown.js";
import { fileRefText } from "./file-ref-model.js";
import { shortCommit } from "./file-tab-model.js";
import { askHeadWords } from "./inbox-ask-words.js";
import { holderTaskId, type MentionHolder } from "./mention-holder.js";

export interface ToolCallView {
  readonly kind: CallKind;
  readonly subject: string;
  readonly files?: readonly string[];
  readonly page?: string;
  readonly description?: string;
  readonly input: ToolBlock;
  readonly output: ToolBlock | undefined;
  readonly provider?: IntegrationProvider;
  readonly server?: string;
  readonly connection?: string;
}

const ESCAPE = String.fromCharCode(27);

const ANSI_SEQUENCE = new RegExp(
  `${ESCAPE}(?:\\[[0-9;?]*[ -/]*[@-~]|\\][^${String.fromCharCode(7)}${ESCAPE}]*(?:${String.fromCharCode(7)}|${ESCAPE}\\\\))`,
  "gu",
);

function stripAnsi(text: string): string {
  return text.replace(ANSI_SEQUENCE, "");
}

const PATCH_FILE_HEADER = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/u;

const PATCH_MOVE_HEADER = /^\*\*\* Move to: (.+)$/u;

function patchPaths(patchText: string): readonly string[] {
  const paths: string[] = [];
  for (const line of patchText.split("\n")) {
    const moved = PATCH_MOVE_HEADER.exec(line.trimEnd())?.[1];
    if (moved !== undefined && paths.length > 0) paths[paths.length - 1] = moved;
    const named = PATCH_FILE_HEADER.exec(line.trimEnd())?.[1];
    if (named !== undefined) paths.push(named);
  }
  return paths;
}

function asJson(value: WireValue): string {
  return isWireString(value) ? value : JSON.stringify(value, null, 2);
}

function jsonBlock(value: WireValue): ToolBlock {
  return { kind: TOOL_BLOCK.JSON, text: asJson(value) };
}

function textBlock(text: string): ToolBlock {
  return { kind: TOOL_BLOCK.TEXT, text };
}

function pathsSubject(paths: readonly string[]): string {
  const [first, ...rest] = paths;
  if (first === undefined) return "";
  return rest.length === 0 ? first : `${first} +${rest.length}`;
}

function stringAt(value: WireValue | undefined, key: string): string | undefined {
  return isRecord(value) && isWireString(value[key]) ? value[key] : undefined;
}

function filesAt(input: WireValue | undefined): readonly string[] {
  const path = stringAt(input, "filePath");
  return path === undefined || path === "" ? [] : [path];
}

function shownPaths(input: WireValue | undefined): string {
  const images = isRecord(input) && Array.isArray(input.images) ? input.images : [];
  return images
    .flatMap((image) => (isRecord(image) && isWireString(image.path) ? [image.path] : []))
    .join(", ");
}

function isWireArray(value: WireValue): value is readonly WireValue[] {
  return Array.isArray(value);
}

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

const TRUNCATED_NOTE = "(output truncated)";

const TIMED_OUT_NOTE = "(killed at its timeout)";

const MAC_COMMAND_NOT_RUN = "not-run";

const BROWSER_NOT_RUN = "not-run";

function browserActions(input: WireValue | undefined): readonly string[] {
  const actions = isRecord(input) && Array.isArray(input.actions) ? input.actions : [];
  return actions.flatMap((action: WireValue) => {
    const name = stringAt(action, "action");
    return name === undefined ? [] : [name];
  });
}

function browserTabName(
  input: WireValue | undefined,
  output: WireValue | undefined,
): string | undefined {
  const tabs = isRecord(output) && Array.isArray(output.tabs) ? output.tabs : [];
  const last: WireValue | undefined = tabs.at(-1);
  const title = stringAt(last, "title")?.trim();
  if (title !== undefined && title !== "") return title;
  const shown = stringAt(last, "url");
  if (shown !== undefined && shown !== "") return pageName(shown);
  if (output !== undefined) return undefined;
  const actions = isRecord(input) && Array.isArray(input.actions) ? input.actions : [];
  const opened = actions.flatMap((action: WireValue) => stringAt(action, "url") ?? []).at(-1);
  return opened === undefined ? undefined : pageName(opened);
}

function browserOutput(output: WireValue): ToolBlock {
  return stringAt(output, "status") === BROWSER_NOT_RUN
    ? textBlock(stringAt(output, "reason") ?? "")
    : jsonBlock(output);
}

function macCommandOutput(output: WireValue): ToolBlock {
  if (stringAt(output, "status") === MAC_COMMAND_NOT_RUN) {
    return textBlock(stringAt(output, "reason") ?? "");
  }
  const shown = commandOutput(output);
  const timedOut = isRecord(output) && output.timedOut === true;
  if (!timedOut) return shown;
  return textBlock(shown.text === "" ? TIMED_OUT_NOTE : `${shown.text}\n${TIMED_OUT_NOTE}`);
}

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

function wordsOutput(output: WireValue, key: string): ToolBlock {
  const words = stringAt(output, key);
  if (words === undefined) return jsonBlock(output);
  const truncated = isRecord(output) && output.truncated === true;
  return textBlock(truncated ? `${words.trimEnd()}\n${TRUNCATED_NOTE}` : words);
}

function skillOutput(output: WireValue): ToolBlock {
  return isWireString(output) ? textBlock(output) : jsonBlock(output);
}

export function loadedSkill(input: WireValue | undefined): string | undefined {
  const name = stringAt(input, "skill");
  return name === "" ? undefined : name;
}

const NOTE_VERB = {
  add: "added",
  replace: "corrected",
  remove: "struck",
} as const satisfies Record<DescriptionAgentEdit["notes"][number]["kind"], string>;

function noteKind(note: WireValue): string {
  const kind = stringAt(note, "kind") ?? "";
  const text = stringAt(note, "text");
  return kind === "replace" && text !== undefined && text.trim() === "" ? "remove" : kind;
}

function descriptionEditSummary(input: WireValue | undefined): string {
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

const readTodos = Schema.decodeUnknownOption(agentTodosInputSchema);

export function todosView(input: WireValue | undefined): AgentTodos["todos"] | undefined {
  return Option.getOrUndefined(readTodos(input))?.todos;
}

export function todosCount(todos: AgentTodos["todos"]): { done: number; total: number } {
  const done = todos.filter((todo) => todo.status === AGENT_TODO_STATUS.DONE).length;
  return { done, total: todos.length };
}

export function todosSummary(todos: AgentTodos["todos"]): string {
  const { done, total } = todosCount(todos);
  return `${done} of ${total} done`;
}

export function todoFocus(todos: AgentTodos["todos"]): string | undefined {
  const current =
    todos.find((todo) => todo.status === AGENT_TODO_STATUS.IN_PROGRESS) ??
    todos.find((todo) => todo.status === AGENT_TODO_STATUS.PENDING);
  return current?.content;
}

function todoLine(todo: AgentTodos["todos"][number]): string {
  switch (todo.status) {
    case AGENT_TODO_STATUS.PENDING:
      return `- [ ] ${todo.content}`;
    case AGENT_TODO_STATUS.IN_PROGRESS:
      return `- [ ] ${todo.content} (in progress)`;
    case AGENT_TODO_STATUS.DONE:
      return `- [x] ${todo.content}`;
  }
}

export function todosListView(todos: AgentTodos["todos"]): ToolCallView {
  return {
    kind: CALL_KIND.TODOS,
    subject: todosSummary(todos),
    input: textBlock(todos.map(todoLine).join("\n")),
    output: undefined,
  };
}

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
  return todosListView(todos);
}

const readPost = Schema.decodeUnknownOption(inboxPostInputSchema);

function inboxPostView(input: WireValue | undefined): InboxPost | undefined {
  return Option.getOrUndefined(readPost(input));
}

function askLines(response: InboxPost["response"]): readonly string[] {
  switch (response.type) {
    case INBOX_RESPONSE.CHOICE:
      return response.options.map((option) => {
        const recommended = recommendedLabels(response).includes(option.label)
          ? " (recommended)"
          : "";
        const detail = option.detail === undefined ? "" : ` -- ${option.detail}`;
        return `- ${option.label}${recommended}${detail}`;
      });
    case INBOX_RESPONSE.FORM:
      return response.fields.map((field) => {
        const options =
          field.type === INBOX_FIELD.SELECT
            ? `: ${(field.options ?? [])
                .map((option) =>
                  option === field.recommended ? `${option} (recommended)` : option,
                )
                .join(", ")}`
            : "";
        const required = field.required === true ? ", required" : "";
        return `- ${field.label} (${field.type}${required})${options}`;
      });
    default:
      return [];
  }
}

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

function postLines(post: InboxPost): string {
  const blocks = (post.blocks ?? []).map(blockLine);
  return [...blocks, ...askLines(post.response)].filter((line) => line.trim() !== "").join("\n");
}

const readThreadPost = Schema.decodeUnknownOption(inboxThreadPostInputSchema);

function threadPostView(input: WireValue | undefined): InboxThreadPostInput | undefined {
  return Option.getOrUndefined(readThreadPost(input));
}

function threadAskLines(ask: NonNullable<InboxThreadPostInput["ask"]>): readonly string[] {
  switch (ask.type) {
    case INBOX_ASK.DECIDE:
      return ask.options.map((option) => {
        const recommended = recommendedLabels(ask).includes(option.label) ? " (recommended)" : "";
        const detail = option.detail === undefined ? "" : ` -- ${option.detail}`;
        return `- ${option.label}${recommended}${detail}`;
      });
    case INBOX_ASK.DO:
      return ask.steps.map((step) => `- ${step}`);
    case INBOX_ASK.ANSWER:
      return (ask.fields ?? []).map((field) => {
        const options =
          field.type === INBOX_FIELD.SELECT ? `: ${(field.options ?? []).join(", ")}` : "";
        const required = field.required === true ? ", required" : "";
        return `- ${field.label} (${field.type}${required})${options}`;
      });
  }
}

function threadPostLines(post: InboxThreadPostInput): string {
  const first = post.body.split("\n").find((line) => line.trim() !== "") ?? "";
  const ask =
    post.ask === undefined ? [] : [askHeadWords(post.ask, undefined), ...threadAskLines(post.ask)];
  return [first, ...ask].join("\n");
}

function replyLines(input: WireValue | undefined): string {
  const images = isRecord(input) && Array.isArray(input.images) ? input.images : [];
  const paths = images.flatMap((image) => {
    const path = stringAt(image, "path");
    return path === undefined ? [] : [`Image: ${path}`];
  });
  return [stringAt(input, "text") ?? "", ...paths].filter((line) => line.trim() !== "").join("\n");
}

function inboxToolView(
  tool: string,
  input: WireValue | undefined,
  output: WireValue | undefined,
): ToolCallView {
  const refused = inboxRefusal(output);
  if (tool === AGENT_TOOL.POST_THREAD || tool === RETIRED_TOOL.POST_TO_INBOX) {
    const message = threadPostView(input);
    if (message !== undefined) {
      return {
        kind: CALL_KIND.INBOX_POST,
        subject: message.title === undefined ? message.key : cardTitle(message.title),
        input: textBlock(threadPostLines(message)),
        output: refused,
      };
    }
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
  if (tool === AGENT_TOOL.WITHDRAW_ASK) {
    return {
      kind: CALL_KIND.INBOX_WITHDRAW,
      subject: stringAt(input, "key") ?? "",
      input: textBlock(stringAt(input, "reason") ?? ""),
      output: refused,
    };
  }
  if (tool === RETIRED_TOOL.REPLY_INBOX) {
    return {
      kind: CALL_KIND.INBOX_REPLY,
      subject: stringAt(input, "key") ?? "",
      input: textBlock(replyLines(input)),
      output: refused,
    };
  }
  if (tool === RETIRED_TOOL.CLOSE_INBOX_ITEM) {
    return {
      kind: CALL_KIND.INBOX_CLOSE,
      subject: stringAt(input, "key") ?? "",
      input: textBlock(stringAt(input, "reason") ?? ""),
      output: refused,
    };
  }
  return { kind: CALL_KIND.INBOX_READ, subject: "", input: textBlock(""), output: refused };
}

const INBOX_CALL_REJECTED = "rejected";

function inboxRefusal(output: WireValue | undefined): ToolBlock | undefined {
  if (stringAt(output, "status") !== INBOX_CALL_REJECTED) return undefined;
  return textBlock(stringAt(output, "reason") ?? "");
}

const SPAN_UNITS = [
  [3_600, "hour"],
  [60, "minute"],
  [1, "second"],
] as const;

function spanText(seconds: number): string {
  const rounded = Math.max(1, Math.round(seconds));
  const parts = SPAN_UNITS.flatMap(([span, word], index) => {
    const count = Math.floor((rounded % (SPAN_UNITS[index - 1]?.[0] ?? Infinity)) / span);
    return count === 0 ? [] : [`${count} ${word}${count === 1 ? "" : "s"}`];
  });
  return parts.slice(0, 2).join(" ");
}

function sleepOutput(output: WireValue): ToolBlock {
  if (isRecord(output) && output.interrupted === true) {
    return textBlock("Stopped early: a message arrived.");
  }
  const waited =
    isRecord(output) && isWireNumber(output.waitedSeconds) ? output.waitedSeconds : undefined;
  return waited === undefined ? jsonBlock(output) : textBlock(`Waited ${spanText(waited)}.`);
}

function subagentCallView(
  input: WireValue | undefined,
  output: WireValue | undefined,
): ToolCallView {
  const task = stringAt(input, "prompt") ?? "";
  const named = stringAt(input, "description")?.trim();
  return {
    kind: CALL_KIND.WORKER,
    subject: named === undefined || named === "" ? cardTitle(task) : named,
    input: textBlock(task),
    output:
      output === undefined
        ? undefined
        : isWireString(output)
          ? textBlock(output)
          : jsonBlock(output),
  };
}

const PULL_REQUEST_REFUSED = "Could not open pull request";

function pullRequestAnswer(
  output: WireValue | undefined,
  reason: string | undefined,
): ToolBlock | undefined {
  if (output === undefined) return undefined;
  return reason === undefined ? jsonBlock(output) : textBlock(reason);
}

function openedPullRequestView(
  input: WireValue | undefined,
  output: WireValue | undefined,
): ToolCallView {
  const title = stringAt(input, "title") ?? "";
  const reason = stringAt(output, "reason");
  const number = isRecord(output) && isWireNumber(output.number) ? output.number : undefined;
  return {
    kind: CALL_KIND.OPEN_PULL_REQUEST,
    subject: number === undefined ? title : `#${number} ${title}`,
    ...(reason === undefined ? undefined : { description: PULL_REQUEST_REFUSED }),
    input: input === undefined ? textBlock("") : jsonBlock(input),
    output: pullRequestAnswer(output, reason),
  };
}

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

function answeredAgentCall(
  kind: CallKind,
  input: WireValue | undefined,
  output: WireValue | undefined,
): ToolCallView {
  const agent = isRecord(output) ? output.agent : undefined;
  return { ...namedCall(kind, input, output, undefined), subject: stringAt(agent, "title") ?? "" };
}

function answeredCall(
  kind: CallKind,
  input: WireValue | undefined,
  output: WireValue | undefined,
  answered: string,
  field: string,
): ToolCallView {
  const named = isRecord(output) ? output[answered] : undefined;
  return { ...namedCall(kind, input, output, undefined), subject: stringAt(named, field) ?? "" };
}

function issueCall(
  kind: CallKind,
  input: WireValue | undefined,
  output: WireValue | undefined,
): ToolCallView {
  const issue = isRecord(output) ? output.issue : undefined;
  const identifier = stringAt(issue, "identifier");
  const title = stringAt(issue, "title");
  const answered =
    identifier === undefined || title === undefined ? undefined : `${identifier} ${title}`;
  const asked = stringAt(input, "issue") ?? stringAt(input, "title") ?? "";
  return { ...namedCall(kind, input, output, undefined), subject: answered ?? asked };
}

function commentUpdateKind(input: WireValue | undefined): CallKind {
  const resolved = isRecord(input) ? input.resolved : undefined;
  return resolved === false ? CALL_KIND.REOPEN_THREAD : CALL_KIND.RESOLVE_THREAD;
}

function agentUpdateKind(input: WireValue | undefined): CallKind {
  const archived = isRecord(input) ? input.archived : undefined;
  if (archived === true) return CALL_KIND.ARCHIVE_AGENT;
  return archived === false ? CALL_KIND.UNARCHIVE_AGENT : CALL_KIND.UPDATE_AGENT;
}

export interface SentWords {
  readonly words: string | undefined;
  readonly note: string | undefined;
}

function messageWords(input: WireValue | undefined): string | undefined {
  return stringAt(input, "text") ?? stringAt(input, "message");
}

export function sentWords(tool: string, input: WireValue | undefined): SentWords | undefined {
  const words =
    tool === AGENT_TOOL.MESSAGE_AGENT || tool === RETIRED_TOOL.MESSAGE_CODING_AGENT
      ? messageWords(input)
      : tool === AGENT_TOOL.START_AGENT || tool === RETIRED_TOOL.START_CODING_AGENT
        ? (stringAt(input, "prompt") ?? stringAt(input, "task"))
        : undefined;
  const isStart = tool === AGENT_TOOL.START_AGENT || tool === RETIRED_TOOL.START_CODING_AGENT;
  const note = isStart ? stringAt(input, "note") : undefined;
  if (words === undefined && note === undefined) return undefined;
  return { words, note };
}

export type WorkerJobs = ReadonlyMap<string, string>;

function stoppedTask(input: WireValue | undefined, jobs: WorkerJobs | undefined): string {
  const task = stringAt(input, "taskId");
  return (task === undefined ? undefined : jobs?.get(task)) ?? task ?? "";
}

const readRemoteCall = Schema.decodeUnknownOption(integrationRemoteCallSchema);

export function remoteCallOf(
  tool: string,
  input: WireValue | undefined,
): { readonly provider: IntegrationProvider; readonly call: IntegrationRemoteCall } | undefined {
  const provider = integrationOfRemoteTool(tool);
  if (provider === undefined) return undefined;
  const call = readRemoteCall(input);
  return Option.isSome(call) ? { provider, call: call.value } : undefined;
}

function connectionName(connection: string): string {
  const account = integrationConnectionOf(connection);
  if (account === undefined) return connection;
  const name = INTEGRATION_NAME[account.provider];
  return account.place === 1 ? name : `${name} ${account.place}`;
}

function remoteToolView(
  tool: string,
  input: WireValue | undefined,
  output: WireValue | undefined,
): ToolCallView | undefined {
  const remote = remoteCallOf(tool, input);
  if (remote === undefined) return undefined;
  return {
    kind: CALL_KIND.MCP_TOOL,
    subject: remote.call.remoteTool,
    server: connectionName(remote.call.connection ?? remote.provider),
    connection: remote.call.connection ?? remote.provider,
    provider: remote.provider,
    input: jsonBlock(remote.call.input),
    output: output === undefined ? undefined : jsonBlock(output),
  };
}

const CLAUDE_CODE_MCP = /^mcp__(.+?)__(.+)$/u;

const CODEX_MCP = /^([^.]+)\.(.+)$/u;

function nativeMcpCall(
  tool: string,
): { readonly server: string; readonly connection: string; readonly name: string } | undefined {
  const match = CLAUDE_CODE_MCP.exec(tool) ?? CODEX_MCP.exec(tool);
  const [, connection, name] = match ?? [];
  return connection === undefined || name === undefined
    ? undefined
    : { server: connectionName(connection), connection, name };
}

export function isServerCallTool(tool: string): boolean {
  return (
    integrationOfRemoteTool(tool) !== undefined ||
    tool === CONNECTION_TOOL.SEARCH ||
    tool === CONNECTION_TOOL.EXECUTE ||
    nativeMcpCall(tool) !== undefined
  );
}

function nativeMcpView(
  tool: string,
  input: WireValue | undefined,
  output: WireValue | undefined,
): ToolCallView | undefined {
  const call = nativeMcpCall(tool);
  if (call === undefined) return undefined;
  return {
    kind: CALL_KIND.MCP_TOOL,
    subject: call.name,
    server: call.server,
    connection: call.connection,
    input: input === undefined ? textBlock("") : jsonBlock(input),
    output: output === undefined ? undefined : jsonBlock(output),
  };
}

function connectionCall(
  kind: CallKind,
  field: string,
  input: WireValue | undefined,
  output: WireValue | undefined,
): ToolCallView {
  const connection = stringAt(input, "connection");
  return {
    ...namedCall(kind, input, output, field),
    ...(connection === undefined ? undefined : { server: connectionName(connection), connection }),
  };
}

interface ToolRead {
  readonly tool: string;
  readonly input: WireValue | undefined;
  readonly output: WireValue | undefined;
  readonly jobs: WorkerJobs | undefined;
}

type ToolReader = (call: ToolRead) => ToolCallView;

function delegateView({ input, output }: ToolRead): ToolCallView {
  const view = delegationView({ input, output }, undefined);
  return {
    kind: CALL_KIND.WORKER,
    subject: view.title ?? cardTitle(view.task),
    input: textBlock(view.task),
    output: view.result === undefined ? undefined : textBlock(view.result),
  };
}

const READ_SEARCH: ToolReader = ({ input, output }) => ({
  kind: CALL_KIND.SEARCH,
  subject: stringAt(input, "pattern") ?? "",
  input: input === undefined ? textBlock("") : jsonBlock(input),
  output: output === undefined ? undefined : wordsOutput(output, "content"),
});

const READ_WEB_SEARCH: ToolReader = ({ input, output }) => ({
  kind: CALL_KIND.WEB_SEARCH,
  subject: stringAt(input, "query") ?? "",
  input: textBlock(stringAt(input, "query") ?? ""),
  output: output === undefined ? undefined : jsonBlock(output),
});

const READ_INBOX_CALL: ToolReader = ({ tool, input, output }) => inboxToolView(tool, input, output);

const SAVE_MEMORY_CALL: ToolReader = ({ input, output }) => ({
  ...namedCall(CALL_KIND.REMEMBER, input, output, undefined),
  subject: cardTitle(stringAt(input, "text") ?? ""),
});

const SEARCH_MEMORY_CALL: ToolReader = ({ input, output }) =>
  namedCall(CALL_KIND.RECALL, input, output, "query");

const AGENT_TOOL_VIEWS = {
  [AGENT_TOOL.LOOK_AT_PICTURE]: ({ input, output }) =>
    namedCall(CALL_KIND.LOOK_AT_PICTURE, input, output, undefined),
  [AGENT_TOOL.LIST_AGENTS]: ({ input, output }) =>
    namedCall(CALL_KIND.LIST_AGENTS, input, output, undefined),
  [AGENT_TOOL.READ_AGENT]: ({ input, output }) =>
    namedCall(CALL_KIND.READ_AGENT, input, output, "agentId"),
  [AGENT_TOOL.MESSAGE_AGENT]: ({ input, output }) => ({
    ...namedCall(CALL_KIND.MESSAGE_AGENT, input, output, undefined),
    subject: messageWords(input) ?? "",
  }),
  [AGENT_TOOL.START_AGENT]: ({ input, output }) =>
    namedCall(
      CALL_KIND.START_AGENT,
      input,
      output,
      stringAt(input, "prompt") === undefined ? "task" : "prompt",
    ),
  [AGENT_TOOL.STOP_AGENT]: ({ input, output }) =>
    answeredAgentCall(CALL_KIND.STOP_AGENT, input, output),
  [AGENT_TOOL.UPDATE_AGENT]: ({ input, output }) =>
    answeredAgentCall(agentUpdateKind(input), input, output),
  [AGENT_TOOL.LIST_TASKS]: ({ input, output }) =>
    namedCall(CALL_KIND.LIST_TASKS, input, output, undefined),
  [AGENT_TOOL.READ_TASK]: ({ input, output }) =>
    answeredCall(CALL_KIND.READ_TASK, input, output, "task", "name"),
  [AGENT_TOOL.CREATE_TASK]: ({ input, output }) =>
    namedCall(CALL_KIND.CREATE_TASK, input, output, "name"),
  [AGENT_TOOL.CREATE_SECTION]: ({ input, output }) =>
    namedCall(CALL_KIND.CREATE_SECTION, input, output, "title"),
  [AGENT_TOOL.DELETE_SECTION]: ({ input, output }) =>
    answeredCall(CALL_KIND.DELETE_SECTION, input, output, "section", "title"),
  [AGENT_TOOL.UPDATE_TASK]: ({ input, output }) =>
    answeredCall(CALL_KIND.UPDATE_TASK, input, output, "task", "name"),
  [AGENT_TOOL.LIST_AUTOMATIONS]: ({ input, output }) =>
    namedCall(CALL_KIND.LIST_AUTOMATIONS, input, output, undefined),
  [AGENT_TOOL.CREATE_AUTOMATION]: ({ input, output }) =>
    namedCall(CALL_KIND.CREATE_AUTOMATION, input, output, "name"),
  [AGENT_TOOL.UPDATE_AUTOMATION]: ({ input, output }) =>
    answeredCall(CALL_KIND.UPDATE_AUTOMATION, input, output, "automation", "name"),
  [AGENT_TOOL.DELETE_AUTOMATION]: ({ input, output }) =>
    answeredCall(CALL_KIND.DELETE_AUTOMATION, input, output, "automation", "name"),
  [AGENT_TOOL.RUN_AUTOMATION]: ({ input, output }) =>
    answeredCall(CALL_KIND.RUN_AUTOMATION, input, output, "automation", "name"),
  [AGENT_TOOL.LIST_MODELS]: ({ input, output }) =>
    namedCall(CALL_KIND.LIST_MODELS, input, output, undefined),
  [AGENT_TOOL.SAVE_MEMORY]: SAVE_MEMORY_CALL,
  [AGENT_TOOL.SEARCH_MEMORY]: SEARCH_MEMORY_CALL,
  [AGENT_TOOL.WEB_SEARCH]: READ_WEB_SEARCH,
  [AGENT_TOOL.READ_WEB_PAGE]: ({ input, output }) => ({
    kind: CALL_KIND.WEB_PAGE,
    subject: pageName(stringAt(input, "url") ?? ""),
    page: stringAt(input, "url") ?? "",
    input: textBlock(stringAt(input, "url") ?? ""),
    output: output === undefined ? undefined : wordsOutput(output, "text"),
  }),
  [AGENT_TOOL.RUN_ON_MAC]: ({ input, output }) => {
    const command = stringAt(input, "command") ?? "";
    const description = commandDescription(stringAt(input, "description"));
    return {
      kind: CALL_KIND.MAC_COMMAND,
      subject: command,
      ...(description === undefined ? undefined : { description }),
      input: { kind: TOOL_BLOCK.COMMAND, text: command },
      output: output === undefined ? undefined : macCommandOutput(output),
    };
  },
  [AGENT_TOOL.BROWSER]: ({ input, output }) => {
    const tab = browserTabName(input, output);
    const words = browserCallWords(browserActions(input), tab !== undefined);
    return {
      kind: CALL_KIND.BROWSER,
      subject: words === undefined ? "" : (tab ?? ""),
      ...(words === undefined ? undefined : { description: words }),
      input: input === undefined ? textBlock("") : jsonBlock(input),
      output: output === undefined ? undefined : browserOutput(output),
    };
  },
  [AGENT_TOOL.BASH]: ({ input, output }) => {
    const command = stringAt(input, "command") ?? "";
    const description = commandDescription(stringAt(input, "description"));
    return {
      kind: CALL_KIND.COMMAND,
      subject: command,
      ...(description === undefined ? undefined : { description }),
      input: { kind: TOOL_BLOCK.COMMAND, text: command },
      output: output === undefined ? undefined : commandOutput(output),
    };
  },
  [AGENT_TOOL.READ_FILE]: ({ input, output }) => ({
    kind: CALL_KIND.READ_FILE,
    subject: stringAt(input, "filePath") ?? "",
    files: filesAt(input),
    input: textBlock(stringAt(input, "filePath") ?? ""),
    output: output === undefined ? undefined : wordsOutput(output, "content"),
  }),
  [AGENT_TOOL.WRITE_FILE]: ({ input, output }) => ({
    kind: CALL_KIND.WRITE_FILE,
    subject: stringAt(input, "filePath") ?? "",
    files: filesAt(input),
    input: textBlock(stringAt(input, "content") ?? ""),
    output: output === undefined ? undefined : wordsOutput(output, "path"),
  }),
  [AGENT_TOOL.GLOB]: READ_SEARCH,
  [AGENT_TOOL.GREP]: READ_SEARCH,
  [AGENT_TOOL.APPLY_PATCH]: ({ input, output }) => {
    const patchText = stringAt(input, "patchText") ?? "";
    const paths = patchPaths(patchText);
    return {
      kind: CALL_KIND.EDIT,
      subject: pathsSubject(paths),
      files: stringAt(input, "root") === undefined ? paths : [],
      input: { kind: TOOL_BLOCK.PATCH, text: patchText },
      output: output === undefined ? undefined : patchOutput(output),
    };
  },
  [AGENT_TOOL.DELEGATE]: delegateView,
  [AGENT_TOOL.EDIT_DESCRIPTION]: ({ input, output }) => ({
    kind: CALL_KIND.EDIT_DESCRIPTION,
    subject: descriptionEditSummary(input),
    input: input === undefined ? textBlock("") : jsonBlock(input),
    output: output === undefined ? undefined : jsonBlock(output),
  }),
  [AGENT_TOOL.WRITE_TODOS]: ({ input }) => todosToolView(input),
  [AGENT_TOOL.POST_THREAD]: READ_INBOX_CALL,
  [AGENT_TOOL.WITHDRAW_ASK]: READ_INBOX_CALL,
  [AGENT_TOOL.READ_THREADS]: READ_INBOX_CALL,
  [AGENT_TOOL.OPEN_PULL_REQUEST]: ({ input, output }) => openedPullRequestView(input, output),
  [AGENT_TOOL.LOAD_SKILL]: ({ input, output }) => {
    const skillName = loadedSkill(input);
    return {
      kind: CALL_KIND.LOAD_SKILL,
      subject: skillName === undefined ? "" : skillWord(skillName),
      input: textBlock(skillName ?? ""),
      output: output === undefined ? undefined : skillOutput(output),
    };
  },
  [AGENT_TOOL.SHOW_PAGE]: ({ input, output }) => ({
    kind: CALL_KIND.SHOW_PAGE,
    subject: stringAt(input, "title") ?? "",
    input: textBlock(stringAt(input, "path") ?? stringAt(input, "html") ?? ""),
    output: output === undefined ? undefined : jsonBlock(output),
  }),
  [AGENT_TOOL.READ_COMMENTS]: ({ input, output }) =>
    namedCall(CALL_KIND.READ_COMMENTS, input, output, undefined),
  [AGENT_TOOL.REPLY_TO_COMMENT]: ({ input, output }) => ({
    ...namedCall(CALL_KIND.REPLY_TO_COMMENT, input, output, undefined),
    subject: cardTitle(stringAt(input, "text") ?? ""),
  }),
  [AGENT_TOOL.UPDATE_COMMENT]: ({ input, output }) =>
    namedCall(commentUpdateKind(input), input, output, undefined),
  [AGENT_TOOL.READ_PAGE]: ({ input, output }) => ({
    kind: CALL_KIND.READ_PAGE,
    subject: stringAt(isRecord(output) ? output.page : undefined, "title") ?? "",
    input: input === undefined ? textBlock("") : jsonBlock(input),
    output: output === undefined ? undefined : jsonBlock(output),
  }),
  [AGENT_TOOL.SHOW_IMAGE]: ({ input, output }) => ({
    kind: CALL_KIND.SHOW_IMAGE,
    subject: shownPaths(input),
    input: input === undefined ? textBlock("") : jsonBlock(input),
    output: output === undefined ? undefined : jsonBlock(output),
  }),
  [AGENT_TOOL.SLEEP]: ({ input, output }) => {
    const seconds = isRecord(input) && isWireNumber(input.seconds) ? input.seconds : undefined;
    return {
      kind: CALL_KIND.SLEEP,
      subject: seconds === undefined ? "" : spanText(seconds),
      input: input === undefined ? textBlock("") : jsonBlock(input),
      output: output === undefined ? undefined : sleepOutput(output),
    };
  },
} as const satisfies Record<AgentTool, ToolReader>;

type RetiredTool = Exclude<
  (typeof RETIRED_TOOL)[keyof typeof RETIRED_TOOL],
  | typeof RETIRED_TOOL.POST_CHAT
  | typeof RETIRED_TOOL.READ_CHAT
  | typeof RETIRED_TOOL.RESOLVE_ASK
  | typeof RETIRED_TOOL.EDIT_CHANNEL
  | typeof RETIRED_TOOL.CREATE_CHANNEL
  | typeof RETIRED_TOOL.UPDATE_CHANNEL
  | typeof RETIRED_TOOL.MOVE_THREAD
  | typeof RETIRED_TOOL.SHOW_CODE
  | typeof RETIRED_TOOL.DRAW_ON_BOARD
  | typeof RETIRED_TOOL.LOOK_AT_BOARD
  | typeof RETIRED_TOOL.QUEUE_QUESTION
  | typeof RETIRED_TOOL.WITHDRAW_QUESTION
  | typeof RETIRED_TOOL.END_CALL
>;

const RETIRED_TOOL_VIEWS = {
  [RETIRED_TOOL.WEB_FETCH]: ({ input, output }) => ({
    kind: CALL_KIND.WEB_PAGE,
    subject: pageName(stringAt(input, "url") ?? ""),
    page: stringAt(input, "url") ?? "",
    input: textBlock(stringAt(input, "url") ?? ""),
    output: output === undefined ? undefined : wordsOutput(output, "content"),
  }),
  [RETIRED_TOOL.SEARCH_WEB]: READ_WEB_SEARCH,
  [RETIRED_TOOL.LIST_CODING_AGENTS]: ({ input, output }) =>
    namedCall(CALL_KIND.LIST_AGENTS, input, output, undefined),
  [RETIRED_TOOL.EDIT_PLAN]: AGENT_TOOL_VIEWS[AGENT_TOOL.EDIT_DESCRIPTION],
  [RETIRED_TOOL.READ_CODING_AGENT]: ({ input, output }) =>
    namedCall(CALL_KIND.READ_AGENT, input, output, "agentId"),
  [RETIRED_TOOL.MESSAGE_CODING_AGENT]: ({ input, output }) =>
    namedCall(CALL_KIND.MESSAGE_AGENT, input, output, "text"),
  [RETIRED_TOOL.START_CODING_AGENT]: ({ input, output }) =>
    namedCall(
      CALL_KIND.START_AGENT,
      input,
      output,
      stringAt(input, "prompt") === undefined ? "task" : "prompt",
    ),
  [RETIRED_TOOL.ARCHIVE_AGENT]: ({ input, output }) =>
    answeredAgentCall(CALL_KIND.ARCHIVE_AGENT, input, output),
  [RETIRED_TOOL.UNARCHIVE_AGENT]: ({ input, output }) =>
    answeredAgentCall(CALL_KIND.UNARCHIVE_AGENT, input, output),
  [RETIRED_TOOL.MOVE_TASK]: ({ input, output }) =>
    answeredCall(CALL_KIND.MOVE_TASK, input, output, "task", "name"),
  [RETIRED_TOOL.CLOSE_INBOX_ITEM]: READ_INBOX_CALL,
  [RETIRED_TOOL.REPLY_INBOX]: READ_INBOX_CALL,
  [RETIRED_TOOL.POST_TO_INBOX]: READ_INBOX_CALL,
  [RETIRED_TOOL.READ_INBOX]: READ_INBOX_CALL,
  [RETIRED_TOOL.LIST_ISSUES]: ({ input, output }) =>
    namedCall(CALL_KIND.LIST_ISSUES, input, output, undefined),
  [RETIRED_TOOL.READ_ISSUE]: ({ input, output }) => issueCall(CALL_KIND.READ_ISSUE, input, output),
  [RETIRED_TOOL.CREATE_ISSUE]: ({ input, output }) =>
    issueCall(CALL_KIND.CREATE_ISSUE, input, output),
  [RETIRED_TOOL.UPDATE_ISSUE]: ({ input, output }) =>
    issueCall(CALL_KIND.UPDATE_ISSUE, input, output),
  [RETIRED_TOOL.REMEMBER]: SAVE_MEMORY_CALL,
  [RETIRED_TOOL.RECALL]: SEARCH_MEMORY_CALL,
  [RETIRED_TOOL.RESOLVE_THREAD]: ({ input, output }) =>
    namedCall(CALL_KIND.RESOLVE_THREAD, input, output, undefined),
  [RETIRED_TOOL.REOPEN_THREAD]: ({ input, output }) =>
    namedCall(CALL_KIND.REOPEN_THREAD, input, output, undefined),
} as const satisfies Record<RetiredTool, ToolReader>;

const OTHER_TOOL_VIEWS: Readonly<Record<string, ToolReader>> = {
  [CLAUDE_CODE_TOOL.AGENT]: ({ input, output }) => subagentCallView(input, output),
  [CODEX_TOOL.SUBAGENT]: ({ input, output }) => subagentCallView(input, output),
  [CLAUDE_CODE_TOOL.SEND_MESSAGE]: ({ input, output }) =>
    namedCall(CALL_KIND.WORKER_MESSAGE, input, output, "to"),
  [CLAUDE_CODE_TOOL.TASK_STOP]: ({ input, output }) =>
    namedCall(
      CALL_KIND.STOP_BACKGROUND,
      input,
      output,
      stringAt(input, "task_id") === undefined ? "shell_id" : "task_id",
    ),
  [EVE_TOOL.TASK_WAIT]: ({ input, output }) =>
    namedCall(CALL_KIND.WORKER_WAIT, input, output, undefined),
  [EVE_TOOL.TASK_CANCEL]: ({ input, output, jobs }) => ({
    ...namedCall(CALL_KIND.WORKER_CANCEL, input, output, undefined),
    subject: stoppedTask(input, jobs),
  }),
  [CONNECTION_TOOL.SEARCH]: ({ input, output }) =>
    connectionCall(CALL_KIND.SEARCH_TOOLS, "query", input, output),
  [CONNECTION_TOOL.EXECUTE]: ({ input, output }) =>
    connectionCall(CALL_KIND.MCP_TOOL, "tool", input, output),
};

const TOOL_VIEWS: ReadonlyMap<string, ToolReader> = new Map(
  Object.entries({ ...AGENT_TOOL_VIEWS, ...RETIRED_TOOL_VIEWS, ...OTHER_TOOL_VIEWS }),
);

export function toolCallView(input: {
  readonly tool: string;
  readonly input: WireValue | undefined;
  readonly output: WireValue | undefined;
  readonly jobs?: WorkerJobs | undefined;
}): ToolCallView {
  const call = { ...input, jobs: input.jobs };
  return (
    TOOL_VIEWS.get(input.tool)?.(call) ??
    remoteToolView(input.tool, input.input, input.output) ??
    nativeMcpView(input.tool, input.input, input.output) ?? {
      kind: CALL_KIND.OTHER,
      subject: input.tool,
      input: input.input === undefined ? textBlock("") : jsonBlock(input.input),
      output: input.output === undefined ? undefined : jsonBlock(input.output),
    }
  );
}

export const TOOL_TARGET = {
  AGENT: "agent",
  PAGE: "page",
  DESCRIPTION: "description",
  INBOX: "inbox",
  TASK: "task",
  PULL_REQUEST: "pull-request",
} as const;

export type ToolTarget =
  | { readonly kind: typeof TOOL_TARGET.AGENT; readonly agent: string }
  | { readonly kind: typeof TOOL_TARGET.PAGE; readonly page: string }
  | { readonly kind: typeof TOOL_TARGET.DESCRIPTION }
  | {
      readonly kind: typeof TOOL_TARGET.INBOX;
      readonly key?: string;
      readonly item?: string;
    }
  | {
      readonly kind: typeof TOOL_TARGET.TASK;
      readonly task: string;
      readonly agent?: string;
    }
  | { readonly kind: typeof TOOL_TARGET.PULL_REQUEST; readonly url: string };

export function placeOfTaskTarget(
  target: Extract<ToolTarget, { readonly kind: typeof TOOL_TARGET.TASK }>,
): LinkPlace {
  return target.agent === undefined
    ? { kind: LINK_PLACE.TASK, planId: target.task }
    : { kind: LINK_PLACE.AGENT, planId: target.task, agentId: target.agent };
}

export const TARGET_HINT = {
  [TOOL_TARGET.AGENT]: "Open the agent",
  [TOOL_TARGET.PAGE]: "Open the page",
  [TOOL_TARGET.DESCRIPTION]: "Open the description",
  [TOOL_TARGET.INBOX]: "Open the Inbox",
  [TOOL_TARGET.TASK]: "Open the task",
  [TOOL_TARGET.PULL_REQUEST]: "Open the pull request",
} as const satisfies Record<ToolTarget["kind"], string>;

interface TargetedCall {
  readonly tool: string;
  readonly callId: string;
  readonly input: WireValue | undefined;
  readonly output: WireValue | undefined;
}

const TASK_TARGET: ToolTarget = { kind: TOOL_TARGET.DESCRIPTION };
const INBOX_TARGET: ToolTarget = { kind: TOOL_TARGET.INBOX };

function namedThread(call: TargetedCall): ToolTarget {
  const key = stringAt(call.input, "key");
  if (key === undefined || key === "") return INBOX_TARGET;
  const threads =
    isRecord(call.output) && Array.isArray(call.output.inbox) ? call.output.inbox : [];
  const item = stringAt(
    threads.find((thread) => stringAt(thread, "key") === key),
    "id",
  );
  return item === undefined
    ? { kind: TOOL_TARGET.INBOX, key }
    : { kind: TOOL_TARGET.INBOX, key, item };
}

function namedAgent(call: TargetedCall): ToolTarget | undefined {
  const agent = stringAt(call.input, "agentId");
  if (agent === undefined || onAnotherTask(call)) return undefined;
  return { kind: TOOL_TARGET.AGENT, agent };
}

function onAnotherTask(call: TargetedCall): boolean {
  const answer = isRecord(call.output) ? call.output.agent : undefined;
  return isRecord(answer) && answer.onYourTask === false;
}

function startedAgent(call: TargetedCall): ToolTarget | undefined {
  const answer = isRecord(call.output) ? call.output.agent : undefined;
  const agent = stringAt(answer, "id");
  if (agent === undefined || onAnotherTask(call)) return undefined;
  return { kind: TOOL_TARGET.AGENT, agent };
}

function changedAgent(call: TargetedCall): ToolTarget | undefined {
  return agentUpdateKind(call.input) === CALL_KIND.ARCHIVE_AGENT ? undefined : namedAgent(call);
}

function planOf(task: string | undefined): ToolTarget {
  return task === undefined ? TASK_TARGET : { kind: TOOL_TARGET.TASK, task };
}

function namedDescription(call: TargetedCall): ToolTarget {
  return planOf(stringAt(call.input, "taskId"));
}

function lookedDescription(call: TargetedCall): ToolTarget {
  const address = stringAt(call.input, "address");
  return planOf(
    address === undefined ? undefined : descriptionAttachmentOf(address.trim())?.taskId,
  );
}

function answeredTask(call: TargetedCall): ToolTarget | undefined {
  const answer = isRecord(call.output) ? call.output.task : undefined;
  const task = stringAt(answer, "id");
  return task === undefined ? undefined : { kind: TOOL_TARGET.TASK, task };
}

function shownPage(call: TargetedCall): ToolTarget | undefined {
  const answer = isRecord(call.output) ? call.output.page : undefined;
  const page = stringAt(answer, "id");
  return page === undefined ? undefined : { kind: TOOL_TARGET.PAGE, page };
}

export function shownPageVersion(
  call: TargetedCall,
): { readonly page: string; readonly version: number } | undefined {
  if (call.tool !== AGENT_TOOL.SHOW_PAGE || call.output === undefined || refused(call.output)) {
    return undefined;
  }
  const answer = isRecord(call.output) ? call.output.page : undefined;
  const page = stringAt(answer, "id");
  const version = isRecord(answer) ? answer.version : undefined;
  return page === undefined || typeof version !== "number" ? undefined : { page, version };
}

function readPage(call: TargetedCall): ToolTarget | undefined {
  const answer = isRecord(call.output) ? call.output.page : undefined;
  const own = isRecord(answer) && (answer.isYourTask === true || answer.isYours === true);
  return own ? shownPage(call) : undefined;
}

function openedPullRequest(call: TargetedCall): ToolTarget | undefined {
  const url = stringAt(call.output, "url");
  return url === undefined ? undefined : { kind: TOOL_TARGET.PULL_REQUEST, url };
}

const TOOL_TARGETS: ReadonlyMap<string, (call: TargetedCall) => ToolTarget | undefined> = new Map<
  AgentTool | (typeof RETIRED_TOOL)[keyof typeof RETIRED_TOOL],
  (call: TargetedCall) => ToolTarget | undefined
>([
  [AGENT_TOOL.SHOW_PAGE, shownPage],
  [AGENT_TOOL.READ_PAGE, readPage],
  [AGENT_TOOL.READ_AGENT, namedAgent],
  [AGENT_TOOL.MESSAGE_AGENT, namedAgent],
  [AGENT_TOOL.START_AGENT, startedAgent],
  [RETIRED_TOOL.UNARCHIVE_AGENT, namedAgent],
  [AGENT_TOOL.STOP_AGENT, namedAgent],
  [AGENT_TOOL.UPDATE_TASK, answeredTask],
  [AGENT_TOOL.CREATE_TASK, answeredTask],
  [AGENT_TOOL.READ_TASK, answeredTask],
  [AGENT_TOOL.UPDATE_AGENT, changedAgent],
  [RETIRED_TOOL.READ_CODING_AGENT, namedAgent],
  [RETIRED_TOOL.MESSAGE_CODING_AGENT, namedAgent],
  [RETIRED_TOOL.START_CODING_AGENT, startedAgent],
  [AGENT_TOOL.EDIT_DESCRIPTION, namedDescription],
  [RETIRED_TOOL.EDIT_PLAN, namedDescription],
  [AGENT_TOOL.LOOK_AT_PICTURE, lookedDescription],
  [AGENT_TOOL.READ_COMMENTS, namedDescription],
  [AGENT_TOOL.REPLY_TO_COMMENT, namedDescription],
  [AGENT_TOOL.UPDATE_COMMENT, namedDescription],
  [RETIRED_TOOL.RESOLVE_THREAD, namedDescription],
  [RETIRED_TOOL.REOPEN_THREAD, namedDescription],
  [AGENT_TOOL.OPEN_PULL_REQUEST, openedPullRequest],
  [AGENT_TOOL.POST_THREAD, namedThread],
  [RETIRED_TOOL.POST_TO_INBOX, namedThread],
  [AGENT_TOOL.WITHDRAW_ASK, namedThread],
  [RETIRED_TOOL.CLOSE_INBOX_ITEM, () => INBOX_TARGET],
  [AGENT_TOOL.READ_THREADS, () => INBOX_TARGET],
  [RETIRED_TOOL.READ_INBOX, () => INBOX_TARGET],
  [RETIRED_TOOL.REPLY_INBOX, () => INBOX_TARGET],
]);

function refused(output: WireValue | undefined): boolean {
  return stringAt(output, "reason") !== undefined;
}

export function toolTarget(call: TargetedCall): ToolTarget | undefined {
  if (call.output === undefined || refused(call.output)) return undefined;
  return TOOL_TARGETS.get(call.tool)?.(call);
}

export interface TargetPlace {
  readonly workspace: string;
  readonly holder: MentionHolder | undefined;
  readonly agentId: string | undefined;
}

export function targetLink(target: ToolTarget, place: TargetPlace): string | undefined {
  if (target.kind === TOOL_TARGET.PULL_REQUEST) return target.url;
  if (place.workspace === "") return undefined;
  const linked = (at: LinkPlace) => linkOf(at, place.workspace);
  switch (target.kind) {
    case TOOL_TARGET.TASK:
      return linked({ kind: LINK_PLACE.TASK, planId: target.task });
    case TOOL_TARGET.DESCRIPTION: {
      const taskId = holderTaskId(place.holder);
      return taskId === undefined ? undefined : linked({ kind: LINK_PLACE.TASK, planId: taskId });
    }
    case TOOL_TARGET.PAGE: {
      const holder = place.holder;
      if (holder === undefined) return undefined;
      return "taskId" in holder
        ? linked({ kind: LINK_PLACE.PAGE, planId: holder.taskId, pageId: target.page })
        : linked({ kind: LINK_PLACE.PAGE, agentId: holder.agentId, pageId: target.page });
    }
    case TOOL_TARGET.INBOX:
      return target.item === undefined || place.agentId === undefined
        ? undefined
        : linked({ kind: LINK_PLACE.INBOX_ITEM, agentId: place.agentId, itemId: target.item });
    case TOOL_TARGET.AGENT:
      return undefined;
  }
}

const AGENT_CALL_TOOLS: ReadonlySet<string> = new Set([
  AGENT_TOOL.READ_AGENT,
  AGENT_TOOL.MESSAGE_AGENT,
  AGENT_TOOL.START_AGENT,
  RETIRED_TOOL.ARCHIVE_AGENT,
  RETIRED_TOOL.UNARCHIVE_AGENT,
  AGENT_TOOL.STOP_AGENT,
  AGENT_TOOL.UPDATE_AGENT,
  RETIRED_TOOL.READ_CODING_AGENT,
  RETIRED_TOOL.MESSAGE_CODING_AGENT,
  RETIRED_TOOL.START_CODING_AGENT,
]);

export interface CalledAgent {
  readonly id: string | undefined;
  readonly title: string | undefined;
  readonly model?: string | undefined;
}

export function calledAgent(call: Omit<TargetedCall, "callId">): CalledAgent | undefined {
  if (!AGENT_CALL_TOOLS.has(call.tool)) return undefined;
  const answer = isRecord(call.output) ? call.output.agent : undefined;
  const id = stringAt(answer, "id") ?? stringAt(call.input, "agentId");
  const title = stringAt(answer, "title");
  const model = stringAt(answer, "model");
  if (id === undefined && title === undefined) return undefined;
  return model === undefined ? { id, title } : { id, title, model };
}

const DELEGATION_FIELD = {
  TASK: "task",
  MESSAGE: "message",
  MODEL: "model",
  EFFORT: "effort",
  RESULT: "result",
  PROMPT: "prompt",
  DESCRIPTION: "description",
} as const;

export interface DelegationView {
  readonly task: string;
  readonly title?: string;
  readonly choice: ModelChoice | undefined;
  readonly result: string | undefined;
}

export function delegationView(
  part: {
    readonly input: WireValue | undefined;
    readonly output: WireValue | undefined;
  },
  own: ModelChoice | undefined,
): DelegationView {
  const settled =
    stringAt(part.output, DELEGATION_FIELD.MODEL) !== undefined &&
    stringAt(part.output, DELEGATION_FIELD.EFFORT) !== undefined;
  const model = settled
    ? stringAt(part.output, DELEGATION_FIELD.MODEL)
    : (stringAt(part.input, DELEGATION_FIELD.MODEL) ?? own?.model);
  const effort = settled
    ? stringAt(part.output, DELEGATION_FIELD.EFFORT)
    : (stringAt(part.input, DELEGATION_FIELD.EFFORT) ?? own?.effort);
  const title = stringAt(part.input, DELEGATION_FIELD.DESCRIPTION)?.trim();
  return {
    task:
      stringAt(part.input, DELEGATION_FIELD.TASK) ??
      stringAt(part.input, DELEGATION_FIELD.MESSAGE) ??
      stringAt(part.input, DELEGATION_FIELD.PROMPT) ??
      "",
    ...(title === undefined || title === "" ? undefined : { title }),
    choice: model !== undefined && effort !== undefined ? { model, effort } : undefined,
    result:
      stringAt(part.output, DELEGATION_FIELD.RESULT) ??
      (isWireString(part.output) ? part.output : undefined),
  };
}

const LINE_MARKS = /^(?:#{1,6}|>|[-*+]|\d+[.)])\s+/u;

const STRAY_MARKS = /\*\*|`/gu;

const FENCE_LINE = /^\s*(?:```|~~~)/u;

export function cardTitle(text: string): string {
  const first = text.split("\n").find((line) => line.trim().length > 0 && !FENCE_LINE.test(line));
  return first === undefined ? "" : plainLine(first);
}

function plainLine(line: string): string {
  const words = linkLabels(line.trim().replace(LINE_MARKS, ""));
  return readInline(words, [])
    .map((span) => {
      const said = words.slice(span.from, span.to);
      const marked = span.kind === INLINE_SPAN.WORDS && span.marks.length > 0;
      return marked ? said : said.replace(STRAY_MARKS, "");
    })
    .join("")
    .trim();
}

export function plainWords(text: string): string {
  return text
    .split("\n")
    .filter((line) => !FENCE_LINE.test(line))
    .map(plainLine)
    .filter((line) => line.length > 0)
    .join(" ");
}
