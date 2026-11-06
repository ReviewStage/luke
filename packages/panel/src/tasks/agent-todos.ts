import { AGENT_TOOL, CLAUDE_CODE_TOOL } from "@repo/features/agent-tools";
import {
  AGENT_TODO_STATUS,
  type AgentTodoStatus,
  type AgentTodos,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import { isRecord, isWireString, type WireValue } from "@repo/wire";
import { TOOL_STATE } from "../ai-elements/tool.js";
import { AGENT_PART, type AgentPart, agentParts, isTaskCall, isTodos } from "./agent-model.js";
import type { DrawnCall } from "./native-tool-calls.js";
import { todosView } from "./tool-call-model.js";

type Todos = AgentTodos["todos"];

interface FoldedTask {
  readonly id: string | undefined;
  readonly content: string;
  readonly status: AgentTodoStatus;
}

export type TaskFold = readonly FoldedTask[];

export const NO_TASKS: TaskFold = [];

const NO_LISTS: ReadonlyMap<string, Todos> = new Map();

const CREATED_ANSWER = /^Task #(\S+) created successfully: ([\s\S]*)$/;

const UPDATED_ANSWER = /^Updated task #\S+/;

const NO_TASKS_ANSWER = "No tasks found";

const LISTED_LINE = /^#(\S+) \[(\w+)\] (.*)$/;

const BLOCKED_BY = / \[blocked by [^\]]*\]$/;

const GOT_HEAD = /^Task #(\S+): (.*)$/;

const GOT_STATUS = /^Status: (\w+)$/m;

const DELETED = "deleted";

const TASK_STATUS: Readonly<Record<string, AgentTodoStatus>> = {
  pending: AGENT_TODO_STATUS.PENDING,
  in_progress: AGENT_TODO_STATUS.IN_PROGRESS,
  completed: AGENT_TODO_STATUS.DONE,
};

function taskStatus(status: WireValue | undefined): AgentTodoStatus | undefined {
  return isWireString(status) ? TASK_STATUS[status] : undefined;
}

function inputString(input: WireValue | undefined, key: string): string | undefined {
  return isRecord(input) && isWireString(input[key]) ? input[key] : undefined;
}

function replaced(fold: TaskFold, at: number, task: FoldedTask): TaskFold {
  const was = fold[at];
  if (was !== undefined && was.content === task.content && was.status === task.status) return fold;
  return fold.map((each, index) => (index === at ? task : each));
}

function unnamedTask(id: string): string {
  return `Task #${id}`;
}

function taskNumber(id: string | undefined): number | undefined {
  return id !== undefined && /^\d+$/.test(id) ? Number(id) : undefined;
}

function inserted(fold: TaskFold, task: FoldedTask): TaskFold {
  const number = taskNumber(task.id);
  const at =
    number === undefined
      ? -1
      : fold.findIndex((each) => {
          const other = taskNumber(each.id);
          return other !== undefined && other > number;
        });
  return at < 0 ? [...fold, task] : [...fold.slice(0, at), task, ...fold.slice(at)];
}

function created(
  fold: TaskFold,
  input: WireValue | undefined,
  words: string | undefined,
): TaskFold {
  const answered = words === undefined ? undefined : CREATED_ANSWER.exec(words);
  if (answered === null) return fold;
  const content = (answered?.[2] ?? inputString(input, "subject") ?? "").trim();
  if (content === "") return fold;
  return [...fold, { id: answered?.[1], content, status: AGENT_TODO_STATUS.PENDING }];
}

function updated(
  fold: TaskFold,
  input: WireValue | undefined,
  words: string | undefined,
): TaskFold {
  if (words !== undefined && !UPDATED_ANSWER.test(words)) return fold;
  const id = inputString(input, "taskId");
  if (id === undefined) return fold;
  const status = inputString(input, "status");
  const subject = inputString(input, "subject")?.trim();
  const at = fold.findIndex((task) => task.id === id);
  if (status === DELETED) return at < 0 ? fold : fold.filter((_, index) => index !== at);
  const moved = taskStatus(status);
  const was = fold[at];
  if (was === undefined) {
    return inserted(fold, {
      id,
      content: subject === undefined || subject === "" ? unnamedTask(id) : subject,
      status: moved ?? AGENT_TODO_STATUS.PENDING,
    });
  }
  return replaced(fold, at, {
    id,
    content: subject === undefined || subject === "" ? was.content : subject,
    status: moved ?? was.status,
  });
}

function listed(fold: TaskFold, words: string | undefined): TaskFold {
  if (words === undefined) return fold;
  if (words.trim() === NO_TASKS_ANSWER) return fold.length === 0 ? fold : NO_TASKS;
  const tasks = new Map(
    words.split("\n").flatMap((line): [string, FoldedTask][] => {
      const read = LISTED_LINE.exec(line);
      const status = taskStatus(read?.[2]);
      if (read === null || status === undefined) return [];
      const id = read[1] ?? "";
      return [[id, { id, content: (read[3] ?? "").replace(BLOCKED_BY, "").trim(), status }]];
    }),
  );
  if (tasks.size === 0) return fold;
  const known = fold.flatMap((task) => {
    const answered = task.id === undefined ? undefined : tasks.get(task.id);
    return answered === undefined ? [] : [answered];
  });
  const seen = new Set(fold.map((task) => task.id));
  const added = [...tasks.values()].filter((task) => !seen.has(task.id));
  const next = [...known, ...added];
  return sameFold(fold, next) ? fold : next;
}

function got(fold: TaskFold, words: string | undefined): TaskFold {
  if (words === undefined) return fold;
  const head = GOT_HEAD.exec(words.split("\n")[0] ?? "");
  if (head === null) return fold;
  const id = head[1] ?? "";
  const content = (head[2] ?? "").trim();
  const status = taskStatus(GOT_STATUS.exec(words)?.[1]);
  const at = fold.findIndex((task) => task.id === id);
  const was = fold[at];
  if (was === undefined) {
    return content === ""
      ? fold
      : inserted(fold, { id, content, status: status ?? AGENT_TODO_STATUS.PENDING });
  }
  return replaced(fold, at, {
    id,
    content: content === "" ? was.content : content,
    status: status ?? was.status,
  });
}

type TaskCall = DrawnCall & { readonly failed: boolean };

export function foldTaskCall(fold: TaskFold, call: TaskCall): TaskFold {
  if (call.failed) return fold;
  const words = isWireString(call.output) ? call.output : undefined;
  switch (call.tool) {
    case CLAUDE_CODE_TOOL.TASK_CREATE:
      return created(fold, call.input, words);
    case CLAUDE_CODE_TOOL.TASK_UPDATE:
      return updated(fold, call.input, words);
    case CLAUDE_CODE_TOOL.TASK_LIST:
      return listed(fold, words);
    case CLAUDE_CODE_TOOL.TASK_GET:
      return got(fold, words);
    default:
      return fold;
  }
}

function sameTodos(a: readonly FoldedTask[] | Todos, b: readonly FoldedTask[] | Todos): boolean {
  return (
    a.length === b.length &&
    a.every((todo, index) => {
      const other = b[index];
      return other !== undefined && todo.content === other.content && todo.status === other.status;
    })
  );
}

function sameFold(a: TaskFold, b: TaskFold): boolean {
  return sameTodos(a, b) && a.every((task, index) => task.id === b[index]?.id);
}

export function todosOf(fold: TaskFold): Todos {
  return fold.map(({ content, status }) => ({ content, status }));
}

function taskCallOf(part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>): TaskCall {
  return {
    tool: part.tool,
    input: part.input,
    output: part.output,
    failed: part.state === TOOL_STATE.OUTPUT_ERROR,
  };
}

interface MessageFold {
  readonly message: AgentTranscriptMessage;
  readonly from: TaskFold;
  readonly to: TaskFold;
  readonly lists: ReadonlyMap<string, Todos>;
}

function foldMessage(
  message: AgentTranscriptMessage,
  from: TaskFold,
  previous: MessageFold | undefined,
): MessageFold {
  if (previous !== undefined && previous.message === message && previous.from === from) {
    return previous;
  }
  let fold = from;
  const lists = new Map<string, Todos>();
  for (const part of agentParts(message)) {
    if (part.kind !== AGENT_PART.TOOL || !isTaskCall(part.tool)) continue;
    fold = foldTaskCall(fold, taskCallOf(part));
    const was = previous?.lists.get(part.callId);
    lists.set(part.callId, was !== undefined && sameTodos(was, fold) ? was : todosOf(fold));
  }
  const to = previous !== undefined && sameFold(previous.to, fold) ? previous.to : fold;
  return { message, from, to, lists };
}

interface TranscriptFold {
  readonly byMessage: ReadonlyMap<string, MessageFold>;
  readonly lists: ReadonlyMap<string, Todos>;
}

function sameEntries<V>(a: ReadonlyMap<string, V>, b: ReadonlyMap<string, V>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (!b.has(key) || !Object.is(b.get(key), value)) return false;
  return true;
}

const transcriptFolds = new WeakMap<AgentTranscriptMessage, TranscriptFold>();

export function taskTodos(messages: readonly AgentTranscriptMessage[]): ReadonlyMap<string, Todos> {
  const first = messages[0];
  if (first === undefined) return NO_LISTS;
  const held = transcriptFolds.get(first);
  const byMessage = new Map<string, MessageFold>();
  let fold = NO_TASKS;
  for (const message of messages) {
    const read = foldMessage(message, fold, held?.byMessage.get(message.id));
    byMessage.set(message.id, read);
    fold = read.to;
  }
  const lists = new Map<string, Todos>();
  for (const read of byMessage.values())
    for (const [callId, todos] of read.lists) lists.set(callId, todos);
  const kept = held !== undefined && sameEntries(held.lists, lists) ? held.lists : lists;
  transcriptFolds.set(first, { byMessage, lists: kept });
  return kept;
}

export function todosOfPart(
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>,
  lists: ReadonlyMap<string, Todos>,
): Todos | undefined {
  return part.tool === AGENT_TOOL.WRITE_TODOS ? todosView(part.input) : lists.get(part.callId);
}

export interface StandingTodos {
  readonly callId: string;
  readonly todos: Todos;
}

export function newestTodos(
  messages: readonly AgentTranscriptMessage[],
  lists: ReadonlyMap<string, Todos>,
): StandingTodos | undefined {
  for (let at = messages.length - 1; at >= 0; at -= 1) {
    const message = messages[at];
    const parts = message === undefined ? [] : agentParts(message);
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const part = parts[index];
      if (part === undefined || !isTodos(part)) continue;
      const todos = todosOfPart(part, lists);
      if (todos !== undefined) return { callId: part.callId, todos };
    }
  }
  return undefined;
}

export function dockedTodos(
  standing: StandingTodos | undefined,
  working: boolean,
): StandingTodos | undefined {
  if (!working || standing === undefined) return undefined;
  const open = standing.todos.some((todo) => todo.status !== AGENT_TODO_STATUS.DONE);
  return open ? standing : undefined;
}
