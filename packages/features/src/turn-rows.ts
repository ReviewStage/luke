import { countWords } from "./words.js";

export const CALL_KIND = {
  COMMAND: "command",
  MAC_COMMAND: "mac-command",
  BROWSER: "browser",
  READ_FILE: "read-file",
  WRITE_FILE: "write-file",
  EDIT: "edit",
  SEARCH: "search",
  WEB_SEARCH: "web-search",
  WEB_PAGE: "web-page",
  LOAD_SKILL: "load-skill",
  LOOK_AT_PICTURE: "look-at-picture",
  EDIT_DESCRIPTION: "edit-description",
  TODOS: "todos",
  INBOX_POST: "inbox-post",
  INBOX_CLOSE: "inbox-close",
  INBOX_READ: "inbox-read",
  INBOX_REPLY: "inbox-reply",
  INBOX_WITHDRAW: "inbox-withdraw",
  WORKER: "worker",
  WORKER_WAIT: "worker-wait",
  WORKER_CANCEL: "worker-cancel",
  WORKER_MESSAGE: "worker-message",
  STOP_BACKGROUND: "stop-background",
  LIST_AGENTS: "list-agents",
  READ_AGENT: "read-agent",
  MESSAGE_AGENT: "message-agent",
  START_AGENT: "start-agent",
  ARCHIVE_AGENT: "archive-agent",
  UNARCHIVE_AGENT: "unarchive-agent",
  LIST_MODELS: "list-models",
  STOP_AGENT: "stop-agent",
  UPDATE_AGENT: "update-agent",
  READ_TASK: "read-task",
  CREATE_SECTION: "create-section",
  DELETE_SECTION: "delete-section",
  LIST_AUTOMATIONS: "list-automations",
  CREATE_AUTOMATION: "create-automation",
  UPDATE_AUTOMATION: "update-automation",
  DELETE_AUTOMATION: "delete-automation",
  RUN_AUTOMATION: "run-automation",
  MOVE_TASK: "move-task",
  UPDATE_TASK: "update-task",
  LIST_ISSUES: "list-issues",
  READ_ISSUE: "read-issue",
  CREATE_ISSUE: "create-issue",
  UPDATE_ISSUE: "update-issue",
  CREATE_TASK: "create-task",
  SHOW_PAGE: "show-page",
  READ_PAGE: "read-page",
  SHOW_IMAGE: "show-image",
  OPEN_PULL_REQUEST: "open-pull-request",
  SLEEP: "sleep",
  LIST_TASKS: "list-tasks",
  REMEMBER: "remember",
  RECALL: "recall",
  READ_COMMENTS: "read-comments",
  REPLY_TO_COMMENT: "reply-to-comment",
  RESOLVE_THREAD: "resolve-thread",
  REOPEN_THREAD: "reopen-thread",
  SEARCH_TOOLS: "search-tools",
  MCP_TOOL: "mcp-tool",
  OTHER: "other",
} as const;

export type CallKind = (typeof CALL_KIND)[keyof typeof CALL_KIND];

export const CALL_WORDS = {
  [CALL_KIND.COMMAND]: { verb: "Ran", code: true },
  [CALL_KIND.MAC_COMMAND]: { verb: "Ran", code: true },
  [CALL_KIND.BROWSER]: { verb: "Used the browser", code: false },
  [CALL_KIND.READ_FILE]: { verb: "Read", code: true },
  [CALL_KIND.WRITE_FILE]: { verb: "Wrote", code: true },
  [CALL_KIND.EDIT]: { verb: "Edited", code: true },
  [CALL_KIND.SEARCH]: { verb: "Searched", code: true },
  [CALL_KIND.WEB_SEARCH]: { verb: "Searched the web for", code: false },
  [CALL_KIND.WEB_PAGE]: { verb: "Fetched", code: true },
  [CALL_KIND.LOAD_SKILL]: { verb: "Loaded skill", code: true },
  [CALL_KIND.LOOK_AT_PICTURE]: { verb: "Looked at a picture in the description", code: false },
  [CALL_KIND.EDIT_DESCRIPTION]: { verb: "Updated the description:", code: false },
  [CALL_KIND.TODOS]: { verb: "Updated the to-dos:", code: false },
  [CALL_KIND.INBOX_POST]: { verb: "Posted a thread:", code: false },
  [CALL_KIND.INBOX_CLOSE]: { verb: "Closed a thread:", code: false },
  [CALL_KIND.INBOX_READ]: { verb: "Read your threads", code: false },
  [CALL_KIND.INBOX_REPLY]: { verb: "Replied in a thread:", code: false },
  [CALL_KIND.INBOX_WITHDRAW]: { verb: "Withdrew an ask:", code: false },
  [CALL_KIND.WORKER]: { verb: "Asked the worker", code: false },
  [CALL_KIND.WORKER_WAIT]: { verb: "Waited for the worker", code: false },
  [CALL_KIND.WORKER_CANCEL]: { verb: "Stopped the worker", code: false },
  [CALL_KIND.WORKER_MESSAGE]: { verb: "Messaged the worker", code: false },
  [CALL_KIND.STOP_BACKGROUND]: { verb: "Stopped", code: true },
  [CALL_KIND.LIST_AGENTS]: { verb: "Listed the agents", code: false },
  [CALL_KIND.READ_AGENT]: { verb: "Read the agent", code: false },
  [CALL_KIND.MESSAGE_AGENT]: { verb: "Messaged the agent", code: false },
  [CALL_KIND.START_AGENT]: { verb: "Started an agent", code: false },
  [CALL_KIND.ARCHIVE_AGENT]: { verb: "Archived the agent", code: false },
  [CALL_KIND.UNARCHIVE_AGENT]: { verb: "Unarchived the agent", code: false },
  [CALL_KIND.LIST_MODELS]: { verb: "Listed the models", code: false },
  [CALL_KIND.STOP_AGENT]: { verb: "Stopped the agent", code: false },
  [CALL_KIND.UPDATE_AGENT]: { verb: "Changed the agent", code: false },
  [CALL_KIND.READ_TASK]: { verb: "Read the task", code: false },
  [CALL_KIND.CREATE_SECTION]: { verb: "Made the section", code: false },
  [CALL_KIND.DELETE_SECTION]: { verb: "Deleted the section", code: false },
  [CALL_KIND.LIST_AUTOMATIONS]: { verb: "Listed the automations", code: false },
  [CALL_KIND.CREATE_AUTOMATION]: { verb: "Made the automation", code: false },
  [CALL_KIND.UPDATE_AUTOMATION]: { verb: "Changed the automation", code: false },
  [CALL_KIND.DELETE_AUTOMATION]: { verb: "Deleted the automation", code: false },
  [CALL_KIND.RUN_AUTOMATION]: { verb: "Ran the automation", code: false },
  [CALL_KIND.MOVE_TASK]: { verb: "Moved the task", code: false },
  [CALL_KIND.UPDATE_TASK]: { verb: "Updated the task", code: false },
  [CALL_KIND.LIST_ISSUES]: { verb: "Listed the issues", code: false },
  [CALL_KIND.READ_ISSUE]: { verb: "Read the issue", code: false },
  [CALL_KIND.CREATE_ISSUE]: { verb: "Filed the issue", code: false },
  [CALL_KIND.UPDATE_ISSUE]: { verb: "Updated the issue", code: false },
  [CALL_KIND.CREATE_TASK]: { verb: "Made the task", code: false },
  [CALL_KIND.SHOW_PAGE]: { verb: "Showed a page:", code: false },
  [CALL_KIND.READ_PAGE]: { verb: "Read the page", code: false },
  [CALL_KIND.SHOW_IMAGE]: { verb: "Showed", code: true },
  [CALL_KIND.OPEN_PULL_REQUEST]: { verb: "Opened pull request", code: false },
  [CALL_KIND.SLEEP]: { verb: "Waited", code: false },
  [CALL_KIND.LIST_TASKS]: { verb: "Listed the tasks", code: false },
  [CALL_KIND.REMEMBER]: { verb: "Saved to memory:", code: false },
  [CALL_KIND.RECALL]: { verb: "Searched memory", code: false },
  [CALL_KIND.READ_COMMENTS]: { verb: "Read the comments", code: false },
  [CALL_KIND.REPLY_TO_COMMENT]: { verb: "Replied to a comment:", code: false },
  [CALL_KIND.RESOLVE_THREAD]: { verb: "Resolved a thread", code: false },
  [CALL_KIND.REOPEN_THREAD]: { verb: "Reopened a thread", code: false },
  [CALL_KIND.SEARCH_TOOLS]: { verb: "Searched the tools", code: false },
  [CALL_KIND.MCP_TOOL]: { verb: "Ran", code: true },
  [CALL_KIND.OTHER]: { verb: "Used", code: true },
} as const satisfies Record<CallKind, { verb: string; code: boolean }>;

const ON_YOUR_MAC = "On your Mac";

const IN_THE_BROWSER = "Browser";

const BROWSER_ACTION_WORDS: Readonly<Record<string, string>> = {
  list: "listed the tabs",
  open: "opened",
  navigate: "went to a page",
  back: "went back",
  forward: "went forward",
  click: "clicked",
  type: "typed",
  key: "pressed a key",
  scroll: "scrolled",
  wait: "waited",
  screenshot: "took a screenshot",
  snapshot: "read the page",
  console: "read the console",
  close: "closed",
  record: "started recording",
  stop_recording: "stopped recording",
};

export function browserCallWords(
  actions: readonly string[],
  tabNamed: boolean,
): string | undefined {
  const said = [...new Set(actions.flatMap((action) => BROWSER_ACTION_WORDS[action] ?? []))].join(
    ", ",
  );
  if (said === "") return undefined;
  const line = `${said.charAt(0).toUpperCase()}${said.slice(1)}`;
  return tabNamed ? `${line} in` : line;
}

const AGENT_CALL_WORDS = {
  [CALL_KIND.READ_AGENT]: { verb: "Read", subject: false },
  [CALL_KIND.MESSAGE_AGENT]: { verb: "Messaged", subject: true },
  [CALL_KIND.START_AGENT]: { verb: "Started", subject: true },
  [CALL_KIND.ARCHIVE_AGENT]: { verb: "Archived", subject: false },
  [CALL_KIND.UNARCHIVE_AGENT]: { verb: "Unarchived", subject: false },
  [CALL_KIND.STOP_AGENT]: { verb: "Stopped", subject: false },
  [CALL_KIND.UPDATE_AGENT]: { verb: "Changed", subject: false },
} as const satisfies Partial<Record<CallKind, { verb: string; subject: boolean }>>;

type AgentCallKind = keyof typeof AGENT_CALL_WORDS;

export function isAgentCallKind(kind: CallKind): kind is AgentCallKind {
  return Object.hasOwn(AGENT_CALL_WORDS, kind);
}

export function agentCallLine(kind: AgentCallKind, subject: string | undefined): CallLine {
  const words = AGENT_CALL_WORDS[kind];
  return { verb: words.verb, subject: words.subject ? subject : undefined, code: false };
}

const MADE_CALL_WORDS = {
  [CALL_KIND.SHOW_PAGE]: "Showed",
  [CALL_KIND.READ_PAGE]: "Read",
  [CALL_KIND.EDIT_DESCRIPTION]: "Updated",
  [CALL_KIND.LOOK_AT_PICTURE]: "Looked at a picture in",
  [CALL_KIND.READ_COMMENTS]: "Read the comments on",
  [CALL_KIND.REPLY_TO_COMMENT]: "Replied to a comment on",
  [CALL_KIND.RESOLVE_THREAD]: "Resolved a thread on",
  [CALL_KIND.REOPEN_THREAD]: "Reopened a thread on",
  [CALL_KIND.INBOX_POST]: "Posted",
  [CALL_KIND.INBOX_WITHDRAW]: "Withdrew an ask on",
  [CALL_KIND.CREATE_TASK]: "Made",
  [CALL_KIND.READ_TASK]: "Read",
  [CALL_KIND.UPDATE_TASK]: "Updated",
  [CALL_KIND.OPEN_PULL_REQUEST]: "Opened",
} as const satisfies Partial<Record<CallKind, string>>;

export type MadeCallKind = keyof typeof MADE_CALL_WORDS;

export function isMadeCallKind(kind: CallKind): kind is MadeCallKind {
  return Object.hasOwn(MADE_CALL_WORDS, kind);
}

export function madeCallLine(kind: MadeCallKind): CallLine {
  return { verb: MADE_CALL_WORDS[kind], subject: undefined, code: false };
}

export function isCommandKind(kind: CallKind): boolean {
  return kind === CALL_KIND.COMMAND || kind === CALL_KIND.MAC_COMMAND;
}

export function callPlace(kind: CallKind, server?: string): string | undefined {
  if (kind === CALL_KIND.MCP_TOOL || kind === CALL_KIND.SEARCH_TOOLS) return server;
  if (kind === CALL_KIND.MAC_COMMAND) return ON_YOUR_MAC;
  return kind === CALL_KIND.BROWSER ? IN_THE_BROWSER : undefined;
}

export interface CallLine {
  readonly verb: string;
  readonly subject: string | undefined;
  readonly code: boolean;
}

export function callLine(
  kind: CallKind,
  subject: string | undefined,
  description: string | undefined,
): CallLine {
  const words = CALL_WORDS[kind];
  if (description === undefined) return { verb: words.verb, subject, code: words.code };
  if (kind === CALL_KIND.BROWSER || kind === CALL_KIND.OPEN_PULL_REQUEST) {
    return { verb: description, subject, code: false };
  }
  return {
    verb: description,
    subject: subject === undefined ? undefined : firstLine(subject),
    code: true,
  };
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .find((line) => line.trim() !== "")
      ?.trim() ?? ""
  );
}

export function commandDescription(description: string | undefined): string | undefined {
  const words = description?.replace(/\s+/gu, " ").trim();
  return words === undefined || words === "" ? undefined : words;
}

export function pageName(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export const ROW_PART = {
  WORDS: "words",
  CALL: "call",
  LONE_CALL: "lone-call",
  SUBAGENT: "subagent",
  AGENT: "agent",
  NOTE: "note",
  ARRIVED: "arrived",
} as const;

type RowPart = (typeof ROW_PART)[keyof typeof ROW_PART];

export interface RowReading<B> {
  readonly key: (block: B, index: number) => string;
  readonly part: (block: B) => RowPart;
  readonly running: (block: B) => boolean;
  readonly kept?: (block: B) => boolean;
}

export const TURN_ROW = {
  BLOCK: "block",
  GROUP: "group",
  FOLDED: "folded",
} as const;

export type TurnRow<B> =
  | { readonly kind: typeof TURN_ROW.BLOCK; readonly key: string; readonly block: B }
  | {
      readonly kind: typeof TURN_ROW.GROUP;
      readonly key: string;
      readonly blocks: readonly B[];
      readonly summary: string;
      readonly open: boolean;
      readonly running: boolean;
    }
  | {
      readonly kind: typeof TURN_ROW.FOLDED;
      readonly key: string;
      readonly summary: string;
      readonly rows: readonly TurnRow<B>[];
    };

function isRecordValue(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sameShape(a: unknown, b: unknown, depth: number): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, at) => sameShape(item, b[at], depth))
    );
  }
  if (depth <= 0 || !isRecordValue(a) || !isRecordValue(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameShape(a[key], b[key], depth - 1))
  );
}

export function sameFieldsBy<T extends object>(
  a: T,
  b: T,
  by: { readonly [K in keyof T]?: (ours: T[K], theirs: T[K]) => boolean },
): boolean {
  const keys = Object.keys(a) as (keyof T)[];
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => {
      const read = by[key];
      return (
        Object.hasOwn(b, key) &&
        (read === undefined ? Object.is(a[key], b[key]) : read(a[key], b[key]))
      );
    })
  );
}

export const TURN_ROW_DEPTH = 3;

export function sameTurnRow<B>(a: TurnRow<B>, b: TurnRow<B>): boolean {
  return sameShape(a, b, TURN_ROW_DEPTH);
}

interface Held {
  readonly calls: number;
  readonly subagents: number;
  readonly startedAgents: number;
  readonly messages: number;
}

function foldedSummary({ calls, subagents, startedAgents, messages }: Held): string {
  const line = [
    ...(calls > 0 ? [countWords(calls, { one: "tool call", many: "tool calls" })] : []),
    ...(subagents > 0 ? [countWords(subagents, { one: "subagent", many: "subagents" })] : []),
    ...(startedAgents > 0
      ? [`started ${countWords(startedAgents, { one: "agent", many: "agents" })}`]
      : []),
    ...(messages > 0 ? [countWords(messages, { one: "message", many: "messages" })] : []),
  ];
  return line.join(", ");
}

function groupSummary({ calls, subagents, startedAgents }: Held): string {
  const tools = calls + startedAgents;
  const said = [
    ...(tools > 0 ? [countWords(tools, { one: "tool call", many: "tool calls" })] : []),
    ...(subagents > 0 ? [countWords(subagents, { one: "subagent", many: "subagents" })] : []),
  ];
  return said.join(", ");
}

function isWork(part: RowPart): boolean {
  return part === ROW_PART.CALL || part === ROW_PART.SUBAGENT || part === ROW_PART.AGENT;
}

function runsWithCalls(part: RowPart): boolean {
  return isWork(part) || part === ROW_PART.NOTE;
}

interface Keyed<B> {
  readonly key: string;
  readonly block: B;
}

function groupedRows<B>(
  blocks: readonly Keyed<B>[],
  read: RowReading<B>,
  moving: boolean,
  grouped: boolean,
): TurnRow<B>[] {
  const rows: TurnRow<B>[] = [];
  let group: Keyed<B>[] = [];
  const flush = (trailing: boolean) => {
    const held = counted(group, read);
    const work = held.calls + held.subagents + held.startedAgents;
    const [first] = group;
    if (first === undefined) return;
    const open = trailing && moving;
    if (grouped && work > 0 && (group.length > 1 || open)) {
      rows.push({
        kind: TURN_ROW.GROUP,
        key: first.key,
        blocks: group.map((each) => each.block),
        summary: groupSummary(held),
        open,
        running: group.some((each) => read.running(each.block)),
      });
    } else {
      rows.push(
        ...group.map((each) => ({ kind: TURN_ROW.BLOCK, key: each.key, block: each.block })),
      );
    }
    group = [];
  };
  for (const each of blocks) {
    if (runsWithCalls(read.part(each.block))) {
      group.push(each);
      continue;
    }
    flush(false);
    rows.push({ kind: TURN_ROW.BLOCK, key: each.key, block: each.block });
  }
  flush(true);
  return rows;
}

function counted<B>(blocks: readonly Keyed<B>[], read: RowReading<B>): Held {
  let calls = 0;
  let subagents = 0;
  let startedAgents = 0;
  let messages = 0;
  for (const { block } of blocks) {
    const part = read.part(block);
    if (part === ROW_PART.CALL || part === ROW_PART.LONE_CALL) calls += 1;
    if (part === ROW_PART.SUBAGENT) subagents += 1;
    if (part === ROW_PART.AGENT) startedAgents += 1;
    if (part === ROW_PART.WORDS) messages += 1;
  }
  return { calls, subagents, startedAgents, messages };
}

export function turnRows<B>(
  blocks: readonly B[],
  read: RowReading<B>,
  turn: {
    readonly key: string;
    readonly moving: boolean;
    readonly done: boolean;
  },
): readonly TurnRow<B>[] {
  const keyed = blocks.map((block, index) => ({ key: read.key(block, index), block }));
  const words = blocks.findLastIndex((block) => read.part(block) === ROW_PART.WORDS);
  const keepsOne = keyed.some((each) => read.kept?.(each.block) === true);
  const last = words < 0 && turn.done && keepsOne ? blocks.length : words;
  if (!turn.done || last < 1) return groupedRows(keyed, read, turn.moving, true);
  const kept = keyed.slice(0, last).filter((each) => read.kept?.(each.block) === true);
  const lead = keyed.slice(0, last).filter((each) => !kept.includes(each));
  const held = counted(lead, read);
  const rest = groupedRows([...kept, ...keyed.slice(last)], read, turn.moving, true);
  if (foldable(held) === 0) {
    if (kept.length === 0) return groupedRows(keyed, read, turn.moving, true);
    return [...groupedRows(lead, read, turn.moving, true), ...rest];
  }
  return [...foldedLead(lead, read, turn.key), ...rest];
}

function foldedLead<B>(
  lead: readonly Keyed<B>[],
  read: RowReading<B>,
  turnKey: string,
): TurnRow<B>[] {
  const rows: TurnRow<B>[] = [];
  let folds = 0;
  for (const run of splitAtArrivals(lead, read)) {
    if (run.arrived !== undefined) {
      rows.push(run.arrived);
      continue;
    }
    const [first] = run.blocks;
    if (first === undefined) continue;
    const held = counted(run.blocks, read);
    if (foldable(held) === 0) {
      rows.push(...groupedRows(run.blocks, read, false, true));
      continue;
    }
    if (run.blocks.length === 1 && held.messages === 0) {
      rows.push({ kind: TURN_ROW.BLOCK, key: first.key, block: first.block });
      continue;
    }
    rows.push({
      kind: TURN_ROW.FOLDED,
      key: folds === 0 ? `${turnKey}-folded` : first.key,
      summary: foldedSummary(held),
      rows: groupedRows(run.blocks, read, false, false),
    });
    folds += 1;
  }
  return rows;
}

function foldable(held: Held): number {
  return held.calls + held.subagents + held.startedAgents;
}

type LeadRun<B> =
  | { readonly arrived: TurnRow<B>; readonly blocks?: undefined }
  | { readonly arrived?: undefined; readonly blocks: readonly Keyed<B>[] };

function splitAtArrivals<B>(lead: readonly Keyed<B>[], read: RowReading<B>): readonly LeadRun<B>[] {
  const runs: LeadRun<B>[] = [];
  let blocks: Keyed<B>[] = [];
  for (const each of lead) {
    if (read.part(each.block) !== ROW_PART.ARRIVED) {
      blocks.push(each);
      continue;
    }
    if (blocks.length > 0) runs.push({ blocks });
    blocks = [];
    runs.push({ arrived: { kind: TURN_ROW.BLOCK, key: each.key, block: each.block } });
  }
  if (blocks.length > 0) runs.push({ blocks });
  return runs;
}
