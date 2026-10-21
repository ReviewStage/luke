import { childTitlesByCall } from "@luke/database/models/child-titles";
import { listCodingAgentLines } from "@luke/database/models/coding-agent-store";
import { childConversationId } from "@luke/database/models/ids";
import {
  listJournals,
  listJournalsCalling,
  readMessageByClientId,
  type StoredMessageRecord,
  type StoredTurnRecord,
  spokenAskRowsOf,
  turnsBefore,
} from "@luke/database/models/message-reads";
import { conversationOwnerOf } from "@luke/database/models/recorded-session";
import { readTaskHeader, type TaskStoreEffect } from "@luke/database/models/task-store";
import {
  TASK_WORK_BOUNDS,
  type TaskShownCode,
  type TaskWorkAnswer,
} from "@luke/features/tasks-view";
import type { ToolSet } from "ai";
import { Effect, Option } from "effect";
import { BRAIN_DELEGATION_TOOLS } from "../agents/brain-host/brain.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { isStoredToolPart, storedToolName } from "../core.js";
import { HOSTED_TOOL_SET } from "./brain-tool-set.js";
import { subagentRecordsByCall } from "./child-models.js";
import { SHOW_CODE_TOOL, shownCodeOf } from "./show-code.js";
import {
  callsSendingToEarlierTasks,
  SUBAGENT_JOURNALS,
  type SubagentJournal,
  taskWorkOf,
  workerSessionCallsOf,
} from "./task-work.js";

/**
 * task-work-store.ts -- a task's Work tab read back from the record, a page of turns at a time, and every code Luke and the task's agents showed on it.
 *
 * Every brain turn runs in the conversation the task names, and the
 * relay journals each as eve runs it, so the task's work is that
 * conversation's turns, newest first a page at a time, each projected from
 * its row and its journal exactly as a call tells it live
 * (`tasks/task-work.ts`), a worker's session and its title read from its
 * child conversation beside it, and the spoken lines each took as its ask
 * read from the rows the turn holds. The code is every answered `show_code` call in
 * the conversation's journals, oldest first, read by the same rule that puts
 * a call's code on screen (`show-code.ts`), so nothing the call refused,
 * and no secret file, is read back; beside it, every answered `show_code`
 * call of each agent on the task, archived ones included, read from that
 * agent's own conversation under the member who started it, typed turns
 * and spoken ones alike, each named by its agent. The task is read under the account
 * first, so a task of a workspace the account is not in reads as no task,
 * exactly as in `task-store.ts`; its conversation is then read under the
 * member who opened it, whose conversation it is, so every member reads the
 * same work. Nothing is written here.
 */

/**
 * The conversation's journals that delegate to the worker, under any name a
 * delegation was made under (\`PLANNER_DELEGATION_TOOLS\`), in the order they
 * were written; a name whose journals do not read leaves them out.
 */
export const brainDelegationJournalsOf = Effect.fnUntraced(function* (
  userId: string,
  conversationId: string,
  tools: ToolSet = HOSTED_TOOL_SET,
) {
  const rows = yield* brainDelegationRowsOf(userId, conversationId, tools);
  return rows.map((row) => row.message);
});

/**
 * The rows of the conversation's journals that delegate to the worker, as
 * `brainDelegationJournalsOf` reads them, each with the turn it is the
 * journal of: read under the brain's tools, or under the tools given for a
 * conversation another backend runs, such as an agent's a call speaks into.
 */
export const brainDelegationRowsOf = Effect.fnUntraced(function* (
  userId: string,
  conversationId: string,
  tools: ToolSet = HOSTED_TOOL_SET,
) {
  const reads = yield* Effect.forEach([...BRAIN_DELEGATION_TOOLS], (name) =>
    listJournalsCalling(userId, conversationId, tools, name),
  );
  return reads
    .flatMap((read) => (read.ok ? read.value : []))
    .sort((one, other) => one.seq - other.seq);
});

/** The conversation's journals that call the worker, where a task a later turn sent work to was started; none where they do not read. */
const workerJournalsOf = brainDelegationJournalsOf;

/** One turn's journal and the sessions of the subagents it started or sent work to, with the title of each that has one and what each ran on and spent, or nothing where the turn wrote none or it does not read. */
export const turnJournalOf = Effect.fnUntraced(function* (userId: string, turn: StoredTurnRecord) {
  const read = yield* readMessageByClientId(userId, turn.conversationId, HOSTED_TOOL_SET, turn.id);
  const message = read.ok ? read.value[0]?.message : undefined;
  if (message === undefined) return undefined;
  const earlier =
    callsSendingToEarlierTasks(message).length === 0
      ? []
      : yield* workerJournalsOf(userId, turn.conversationId);
  const children = new Map<string, string>();
  const subagents = new Map<string, readonly SubagentJournal[]>();
  for (const [callId, sessionCallId] of workerSessionCallsOf(message, earlier)) {
    const child = childConversationId(turn.conversationId, sessionCallId);
    children.set(callId, child);
    const session = yield* listJournals(userId, child, HOSTED_TOOL_SET, SUBAGENT_JOURNALS);
    if (session.ok) subagents.set(callId, session.value);
  }
  const parent = { userId, conversationId: turn.conversationId };
  const titles = yield* childTitlesByCall(parent, children);
  const records = yield* subagentRecordsByCall(userId, subagents);
  return { turn, message, subagents, titles, records };
});

/** Every code the journals' answered `show_code` calls put on screen, in the order the calls were made, the journals oldest first, each under the agent named where an agent's journals are read. */
function shownCodeIn(journals: readonly StoredMessageRecord[], agentId?: string): TaskShownCode[] {
  return journals.flatMap((journal) =>
    journal.message.parts.filter(isStoredToolPart).flatMap((part) => {
      const code = storedToolName(part) === SHOW_CODE_TOOL.name ? shownCodeOf(part) : undefined;
      return code === undefined
        ? []
        : [
            {
              callId: part.toolCallId,
              turnId: journal.clientId,
              shownAt: journal.createdAt.getTime(),
              ...(agentId === undefined ? undefined : { agentId }),
              code,
            },
          ];
    }),
  );
}

/** Every code shown in the conversation; none where a journal holding a call of it does not read. */
const brainShownCode = Effect.fnUntraced(function* (userId: string, conversationId: string) {
  const read = yield* listJournalsCalling(
    userId,
    conversationId,
    HOSTED_TOOL_SET,
    SHOW_CODE_TOOL.name,
  );
  return read.ok ? shownCodeIn(read.value) : [];
});

/**
 * Every code the task's agents showed, archived agents' included, each read
 * from the agent's own conversation under the member who started it; an
 * agent whose journals do not read shows none. The agents are listed under
 * the account, so a task the account does not reach has none.
 */
const agentsShownCode = Effect.fnUntraced(function* (userId: string, taskId: string) {
  const agents = yield* listCodingAgentLines(userId, taskId, { includeArchived: true });
  const read = yield* Effect.forEach(agents, (agent) =>
    Effect.map(
      listJournalsCalling(agent.userId, agent.conversationId, CODER_TOOL_SET, SHOW_CODE_TOOL.name),
      (journals) => (journals.ok ? shownCodeIn(journals.value, agent.id) : []),
    ),
  );
  return read.flat();
});

/**
 * Every code shown on the task, oldest first: Luke's in the task's own
 * conversation, read under `opener` where one was opened, and every agent's.
 * Note that the sort is stable, so the calls of one turn keep their order.
 */
const allShownCode = Effect.fnUntraced(function* (
  userId: string,
  taskId: string,
  brain: { readonly opener: string; readonly conversationId: string } | undefined,
) {
  const luke = brain === undefined ? [] : yield* brainShownCode(brain.opener, brain.conversationId);
  const agents = yield* agentsShownCode(userId, taskId);
  return [...luke, ...agents].sort((one, other) => one.shownAt - other.shownAt);
});

/**
 * A page of the task's work as the Work and Code tabs draw it: the newest
 * turns queued before the turn `before` names, or the newest of all, those
 * that wrote anything, oldest first, with the turn the next older page is
 * read before where one stands; and on the newest page, every code shown on
 * the task. No turn for a task whose brain never ran, and nothing
 * where the account reaches no such task. A journal this build cannot read
 * leaves its turn out rather than the whole page.
 */
export function readTaskWork(
  userId: string,
  taskId: string,
  before: string | undefined,
): TaskStoreEffect<Option.Option<TaskWorkAnswer>> {
  return Effect.gen(function* () {
    const task = yield* readTaskHeader(userId, taskId);
    if (Option.isNone(task)) return Option.none();
    const { conversationId } = task.value;
    const newest = before === undefined;
    const owner =
      conversationId === undefined ? Option.none() : yield* conversationOwnerOf(conversationId);
    if (conversationId === undefined || Option.isNone(owner)) {
      const code = newest ? yield* allShownCode(userId, taskId, undefined) : undefined;
      return Option.some({ turns: [], ...(code === undefined ? undefined : { code }) });
    }
    const opener = owner.value;
    const page = yield* turnsBefore(opener, conversationId, TASK_WORK_BOUNDS.TURNS, before);
    const read = yield* Effect.forEach(page.turns, (turn) => turnJournalOf(opener, turn));
    const journaled = read.filter((each) => each !== undefined);
    const asked = yield* spokenAskRowsOf(
      opener,
      conversationId,
      journaled.map((each) => each.turn.id),
    );
    const code = newest
      ? yield* allShownCode(userId, taskId, { opener, conversationId })
      : undefined;
    const oldest = page.turns[0];
    return Option.some({
      turns: journaled.map((each) =>
        taskWorkOf(
          each.turn,
          each.message,
          each.subagents,
          each.titles,
          each.records,
          asked.get(each.turn.id),
        ),
      ),
      ...(page.earlier && oldest !== undefined ? { earlier: oldest.id } : undefined),
      ...(code === undefined ? undefined : { code }),
    });
  });
}

/** Every code shown on the task, oldest first, as the Code tab draws it: Luke's, read under the member who opened the task's conversation, and every agent's on the task; nothing where the account reaches no such task. */
export function readTaskCode(
  userId: string,
  taskId: string,
): TaskStoreEffect<Option.Option<{ readonly code: readonly TaskShownCode[] }>> {
  return Effect.gen(function* () {
    const task = yield* readTaskHeader(userId, taskId);
    if (Option.isNone(task)) return Option.none();
    const { conversationId } = task.value;
    const owner =
      conversationId === undefined ? Option.none() : yield* conversationOwnerOf(conversationId);
    const brain =
      conversationId === undefined || Option.isNone(owner)
        ? undefined
        : { opener: owner.value, conversationId };
    return Option.some({ code: yield* allShownCode(userId, taskId, brain) });
  });
}
