import { AGENT_TOOL, CLAUDE_CODE_TOOL } from "@luke/features/agent-tools";
import {
  CODING_AGENT_TODO_STATUS,
  type CodingAgentMessage,
  type CodingAgentTodoStatus,
  type CodingAgentTodos,
} from "@luke/features/coding-agent-wire";
import { isRecord, isWireString, type WireValue } from "@luke/wire";
import { TOOL_STATE } from "../ai-elements/tool.js";
import {
  AGENT_PART,
  type AgentPart,
  agentParts,
  isTaskCall,
  isTodos,
} from "./coding-agent-model.js";
import type { DrawnCall } from "./native-tool-calls.js";
import { todosView } from "./tool-call-model.js";

/**
 * agent-todos.ts -- the agent's to-do lists as its tab reads them: the list each call carries, the newest standing, and the one docked while it is worked.
 *
 * A call of eve's `write_todos`, Claude Code's `TodoWrite`, or Codex's plan
 * carries the whole list as its input (`native-tool-calls.ts`), so each is
 * read on its own. Claude Code's task list is kept one task at a time
 * instead: `TaskCreate` adds one, whose id only the CLI's answer names,
 * `TaskUpdate` moves one by that id, `TaskList` answers every task, and
 * `TaskGet` answers one. No one call carries the list, so the calls are
 * folded in the order they were made (`foldTaskCall`), into the list as it
 * stood after each call, in creation order, which is then drawn as a whole
 * list's call: in the transcript as a row of its own, the newest open, and
 * docked above the composer while it is worked (`taskTodos`), and in a
 * replay's card as the same call's row (`replay-card-model.ts`). The CLI's
 * own answer is the text the model read (`claude-code-moments.ts`), so each
 * is read by the words CLI 2.1.304 spells it in.
 *
 * The transcript's fold is kept by message, since every page keeps the
 * messages it did not touch (`keepIdentity`): a message whose fold began
 * from the same list keeps the lists it read, and a list that folds the
 * same as before keeps the value it was, so the rows drawn from them stand
 * as they were drawn while a running turn's page touches its end alone.
 */

type Todos = CodingAgentTodos["todos"];

/** One task of Claude Code's list as the fold holds it: its id once the CLI answered the call that created it, its words, and where it stands. */
interface FoldedTask {
  readonly id: string | undefined;
  readonly content: string;
  readonly status: CodingAgentTodoStatus;
}

/** The task list as it stood at some point, in creation order. */
export type TaskFold = readonly FoldedTask[];

/** The list before any task call: empty. */
export const NO_TASKS: TaskFold = [];

const NO_LISTS: ReadonlyMap<string, Todos> = new Map();

/** How the CLI answers a task created: its id and its subject. */
const CREATED_ANSWER = /^Task #(\S+) created successfully: ([\s\S]*)$/;

/** How the CLI answers a task updated; any other answer, such as a task not found, moved nothing. */
const UPDATED_ANSWER = /^Updated task #\S+/;

/** One line of the CLI's answer to a list: the task's id, its status, and its subject, with its owner and what blocks it after. */
const LISTED_LINE = /^#(\S+) \[(\w+)\] (.*)$/;

/** What a listed line ends with where other tasks block the task. */
const BLOCKED_BY = / \[blocked by [^\]]*\]$/;

/** The first line of the CLI's answer to a read of one task: its id and its subject. */
const GOT_HEAD = /^Task #(\S+): (.*)$/;

/** The line of that answer saying where the task stands. */
const GOT_STATUS = /^Status: (\w+)$/m;

/** The status a `TaskUpdate` deletes a task with. */
const DELETED = "deleted";

/** A task's status as the wire spells a to-do's: the CLI's `completed` is done, and the rest are spelled alike; nothing for a word that is none of them. */
const TASK_STATUS: Readonly<Record<string, CodingAgentTodoStatus>> = {
  pending: CODING_AGENT_TODO_STATUS.PENDING,
  in_progress: CODING_AGENT_TODO_STATUS.IN_PROGRESS,
  completed: CODING_AGENT_TODO_STATUS.DONE,
};

function taskStatus(status: WireValue | undefined): CodingAgentTodoStatus | undefined {
  return isWireString(status) ? TASK_STATUS[status] : undefined;
}

/** The string under a key of the input, or nothing where it holds none. */
function inputString(input: WireValue | undefined, key: string): string | undefined {
  return isRecord(input) && isWireString(input[key]) ? input[key] : undefined;
}

/** The task at a place of the list replaced; the list as it is where the task reads the same. */
function replaced(fold: TaskFold, at: number, task: FoldedTask): TaskFold {
  const was = fold[at];
  if (was !== undefined && was.content === task.content && was.status === task.status) return fold;
  return fold.map((each, index) => (index === at ? task : each));
}

/** A task created: added at the end, pending, by the subject the CLI answered or, while the call runs, the one asked; nothing where the call answered otherwise or named no subject yet. */
function created(
  fold: TaskFold,
  input: WireValue | undefined,
  words: string | undefined,
): TaskFold {
  const answered = words === undefined ? undefined : CREATED_ANSWER.exec(words);
  if (answered === null) return fold;
  const content = (answered?.[2] ?? inputString(input, "subject") ?? "").trim();
  if (content === "") return fold;
  return [...fold, { id: answered?.[1], content, status: CODING_AGENT_TODO_STATUS.PENDING }];
}

/**
 * A task updated: its subject and status as the call asked, or taken out
 * where it asked `deleted`; nothing where the CLI answered that it moved
 * nothing. A task the fold never saw created, as one a subagent of the
 * session made, is added where the update names its subject, and passed
 * over otherwise, since the list could not name it.
 */
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
    if (subject === undefined || subject === "") return fold;
    return [...fold, { id, content: subject, status: moved ?? CODING_AGENT_TODO_STATUS.PENDING }];
  }
  return replaced(fold, at, {
    id,
    content: subject === undefined || subject === "" ? was.content : subject,
    status: moved ?? was.status,
  });
}

/**
 * The list as the CLI answered it, which is the list as the CLI holds it:
 * each task the fold knows moved to where the answer says it stands, in
 * the order it was created, one the fold never saw added after them, and
 * one the answer no longer lists taken out; the fold's where the answer
 * lists none it can read.
 */
function listed(fold: TaskFold, words: string | undefined): TaskFold {
  if (words === undefined) return fold;
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

/** One task as the CLI answered it, replacing the fold's by its id, or added where the fold never saw it; nothing where the answer names none. */
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
      : [...fold, { id, content, status: status ?? CODING_AGENT_TODO_STATUS.PENDING }];
  }
  return replaced(fold, at, {
    id,
    content: content === "" ? was.content : content,
    status: status ?? was.status,
  });
}

/** One of Claude Code's task calls as the fold reads it: the call, and whether it ended in an error, which moves nothing. */
type TaskCall = DrawnCall & { readonly failed: boolean };

/** The list after one of Claude Code's task calls: as it was where the call failed, and moved as the call says otherwise. */
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

/** Whether two lists hold the same items, by their words and where each stands. */
function sameTodos(a: readonly FoldedTask[] | Todos, b: readonly FoldedTask[] | Todos): boolean {
  return (
    a.length === b.length &&
    a.every((todo, index) => {
      const other = b[index];
      return other !== undefined && todo.content === other.content && todo.status === other.status;
    })
  );
}

/** Whether two folds hold the same tasks, by their ids too, since an id is what a later update finds a task by. */
function sameFold(a: TaskFold, b: TaskFold): boolean {
  return sameTodos(a, b) && a.every((task, index) => task.id === b[index]?.id);
}

/** A fold as a to-do list, which is what a whole list's call carries. */
export function todosOf(fold: TaskFold): Todos {
  return fold.map(({ content, status }) => ({ content, status }));
}

/** A task call's part as the fold reads it. */
function taskCallOf(part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>): TaskCall {
  return {
    tool: part.tool,
    input: part.input,
    output: part.output,
    failed: part.state === TOOL_STATE.OUTPUT_ERROR,
  };
}

/** One message's task calls folded: the list it began from, the one it ended on, and the list as it stood after each call, by the call. */
interface MessageFold {
  readonly message: CodingAgentMessage;
  readonly from: TaskFold;
  readonly to: TaskFold;
  readonly lists: ReadonlyMap<string, Todos>;
}

/**
 * A message's task calls folded from the list before it, read anew only
 * for a message a page touched or whose list before it moved; each list
 * that folds the same as before keeps the value it was.
 */
function foldMessage(
  message: CodingAgentMessage,
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
  // Note that the list it ended on is kept as it was where it folds the same, so the message after it reads from the same list and keeps its own.
  const to = previous !== undefined && sameFold(previous.to, fold) ? previous.to : fold;
  return { message, from, to, lists };
}

/** One transcript's fold: each message's, by the message, and every call's list in one map. */
interface TranscriptFold {
  readonly byMessage: ReadonlyMap<string, MessageFold>;
  readonly lists: ReadonlyMap<string, Todos>;
}

/** Whether two maps hold the same values under the same keys. */
function sameEntries<V>(a: ReadonlyMap<string, V>, b: ReadonlyMap<string, V>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (!b.has(key) || !Object.is(b.get(key), value)) return false;
  return true;
}

/** Each transcript's fold as last read, by its first message, which every page of the transcript keeps as it was. */
const transcriptFolds = new WeakMap<CodingAgentMessage, TranscriptFold>();

/**
 * The to-do list as it stood after each of Claude Code's task calls in the
 * transcript, by the call, folded from every call before it across every
 * page held; an empty map for a transcript that holds none. The map is
 * the one read before while every call's list is the one it was, so a page
 * that moves no list leaves the rows drawn from it standing.
 */
export function taskTodos(messages: readonly CodingAgentMessage[]): ReadonlyMap<string, Todos> {
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

/** The list a to-do part carries: a whole list's input, or the fold after a task call; nothing where neither reads. */
export function todosOfPart(
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>,
  lists: ReadonlyMap<string, Todos>,
): Todos | undefined {
  return part.tool === AGENT_TOOL.WRITE_TODOS ? todosView(part.input) : lists.get(part.callId);
}

/** The agent's newest to-do list, and the call that wrote it. */
export interface StandingTodos {
  readonly callId: string;
  readonly todos: Todos;
}

/**
 * The agent's newest to-do list, which its tab keeps out of a finished
 * turn's fold and draws open, or docks above the composer while it is
 * worked (`dockedTodos`); nothing before the first. Note that a write whose
 * input does not yet read as a list is passed over, because while it
 * streams the list before it is still the one standing.
 */
export function newestTodos(
  messages: readonly CodingAgentMessage[],
  lists: ReadonlyMap<string, Todos>,
): StandingTodos | undefined {
  // Note that the messages are read from the newest back, so a page is read only as far as its newest list.
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

/**
 * The list docked above the composer: the newest, while the agent may
 * still write and an item of it is not done, as Claude Code keeps its list
 * over the prompt; nothing otherwise, when the transcript's own row is
 * where it is read.
 */
export function dockedTodos(
  standing: StandingTodos | undefined,
  working: boolean,
): StandingTodos | undefined {
  if (!working || standing === undefined) return undefined;
  const open = standing.todos.some((todo) => todo.status !== CODING_AGENT_TODO_STATUS.DONE);
  return open ? standing : undefined;
}
