import type { DatabaseServices } from "@luke/database/core/query";
import {
  type Agent,
  listWorkspaceAgents,
  readAgent,
  readVisibleAgent,
  taskNamesOf,
} from "@luke/database/models/agent-store";
import { AGENT_BOUNDS } from "@luke/features/agent-wire";
import { describeWire } from "@luke/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import { type UnparsedWireValue, wireUuidSchema } from "../core.js";
import type { StoreFailure } from "../http/store-failure.js";

/**
 * workspace-agents.ts -- the coding agents of one workspace as an agent's tools read them: on any task or none, by any member, one task's alone where asked, each with its task's name.
 *
 * The agent tools Luke on a call and every coding agent are offered
 * (`agent-tools.ts`) list and find the agents here. A list names the archived
 * agents too, each marked, since an agent may need to know one stands, and
 * names each agent's task by its name, read once
 * for the lot; it is narrowed to one task by the id a listed agent's task
 * answered, or to the caller's own, or searched by words of an agent's
 * title or its task's name. The agents the caller works beside come first,
 * the agent that started it and the agents it started, then those on its
 * task, as the store orders them (`agent-store.ts`'s `around`), and the
 * rest newest first, a page at a time: a list cut at its bound says so with
 * the offset of the next page, so a caller is never left with a silent cut.
 * Every read is on the account's own
 * standing: a workspace it is not in has no agents, and an agent of another
 * workspace, even one the account is also in, is none of these.
 */

/** The most agents a list answers at once, the caller's own first and then the newest started first. */
export const WORKSPACE_AGENTS_LIST_LIMIT = 50;

/** Why a list's filter read as nothing to list by, in words the model can act on. */
export const AGENT_LIST_FILTER_REFUSAL = {
  UNREADABLE:
    "Not run: narrow the list by a taskId, by thisTask, or by words of an agent's title or its " +
    `task's name of at most ${AGENT_BOUNDS.MAX_SEARCH_CHARS} characters, and page it by an offset of 0 or more.`,
  BOTH: "Not run: narrow the list by taskId or by thisTask, not both.",
  NO_OWN_TASK:
    "Not run: you work on no task, so thisTask names none; leave it out to list the whole workspace.",
} as const;

/** The filters a list takes: one task by its id, or the caller's own task, words to search by, and the page to read. */
export const AGENT_LIST_INPUT = Schema.Struct({
  taskId: Schema.optionalKey(
    describeWire(
      wireUuidSchema,
      "Only the agents on this task, by the id a listed agent's task answered; leave it out for the whole workspace.",
    ),
  ),
  thisTask: Schema.optionalKey(
    describeWire(
      Schema.Boolean,
      "true for only the agents on the task you work on; leave it out for the whole workspace.",
    ),
  ),
  words: Schema.optionalKey(
    describeWire(
      Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(AGENT_BOUNDS.MAX_SEARCH_CHARS)),
      "Only the agents whose title or task's name holds each of these words, whatever their " +
        "case, to search the workspace by; leave it out for every agent.",
    ),
  ),
  offset: Schema.optionalKey(
    describeWire(
      Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      "How many of the matching agents to pass over: the nextOffset an earlier list answered, " +
        "to read the next page; leave it out for the first.",
    ),
  ),
});

const readFilter = Schema.decodeUnknownResult(AGENT_LIST_INPUT);

/** An agent's task as a list names it; null for an agent on none, or on a task the reader cannot read. */
export interface AgentTask {
  readonly id: string;
  readonly name: string;
}

/** A page of a workspace's agents, the task each stands on, and the offset of the next page where the list was cut. */
export interface WorkspaceAgents {
  readonly agents: readonly Agent[];
  readonly taskOf: (agent: Agent) => AgentTask | null;
  readonly nextOffset: number | null;
}

/** What a list's input narrows it to: one task where it names one, words to search by, and the page to read. */
export interface AgentListFilter {
  readonly taskId: string | undefined;
  readonly words: string | undefined;
  readonly offset: number;
}

/**
 * What a list's input narrows it to, given the task the caller works on:
 * the whole workspace where it names nothing, or a refusal where the input
 * does not read, names a task both ways, or asks for an own task the caller
 * has not got.
 */
export function listedFilter(
  input: UnparsedWireValue,
  ownTask: string | null,
): Result.Result<AgentListFilter, string> {
  const read = readFilter(input);
  if (Result.isFailure(read)) return Result.fail(AGENT_LIST_FILTER_REFUSAL.UNREADABLE);
  const { taskId, thisTask, words, offset } = read.success;
  if (taskId !== undefined && thisTask === true) {
    return Result.fail(AGENT_LIST_FILTER_REFUSAL.BOTH);
  }
  if (thisTask === true && ownTask === null) {
    return Result.fail(AGENT_LIST_FILTER_REFUSAL.NO_OWN_TASK);
  }
  return Result.succeed({
    taskId: thisTask === true ? (ownTask ?? undefined) : taskId,
    words,
    offset: offset ?? 0,
  });
}

/**
 * A page of the workspace's agents, archived ones among them, narrowed as
 * the filter asks, the caller left out: the caller's starter and the agents
 * it started first, then those on its task, then the rest, each newest
 * first, at most the list's bound from the filter's offset, and the next
 * page's offset where more stand.
 */
export const workspaceAgentsOf = (
  userId: string,
  workspaceId: string,
  caller: Agent,
  filter: AgentListFilter,
): Effect.Effect<WorkspaceAgents, StoreFailure, DatabaseServices> =>
  Effect.gen(function* () {
    const listed = yield* listWorkspaceAgents(userId, workspaceId, {
      ...(filter.taskId === undefined ? undefined : { taskId: filter.taskId }),
      ...(filter.words === undefined ? undefined : { words: filter.words }),
      includeArchived: true,
      except: caller.id,
      around: {
        agentId: caller.id,
        taskId: caller.taskId,
        startedByAgentId: caller.startedByAgentId,
      },
      offset: filter.offset,
      // One past the bound tells whether a next page stands, without a count of its own.
      limit: WORKSPACE_AGENTS_LIST_LIMIT + 1,
    });
    const agents = listed.slice(0, WORKSPACE_AGENTS_LIST_LIMIT);
    const nextOffset =
      listed.length > WORKSPACE_AGENTS_LIST_LIMIT
        ? filter.offset + WORKSPACE_AGENTS_LIST_LIMIT
        : null;
    const names = yield* taskNamesOf(
      userId,
      agents.flatMap((agent) => agent.taskId ?? []),
    );
    const taskOf = (agent: Agent): AgentTask | null => {
      const named = agent.taskId === null ? undefined : names.get(agent.taskId);
      return agent.taskId === null || named === undefined ? null : { id: agent.taskId, ...named };
    };
    return { agents, taskOf, nextOffset };
  });

/**
 * The agent under the id where it is one of the workspace's, archived or
 * not, as the calling agent's tools name it; nothing for an agent of another
 * workspace or none. Another agent is read as a member may read it
 * (`readVisibleAgent`), and the caller itself as it reads itself
 * (`readAgent`), so its own tools never lose it when its starter
 * loses sight of its task.
 */
export const workspaceAgent = (
  userId: string,
  workspaceId: string,
  agentId: string,
  callerId: string,
): Effect.Effect<Option.Option<Agent>, StoreFailure, DatabaseServices> =>
  Effect.map(
    agentId === callerId ? readAgent(userId, agentId) : readVisibleAgent(userId, agentId),
    (found) => Option.filter(found, (agent) => agent.organizationId === workspaceId),
  );

/** The task one agent stands on, read as the account; null for an agent on none or on one the account cannot read. */
export const agentTaskOf = (
  userId: string,
  agent: Agent,
): Effect.Effect<AgentTask | null, StoreFailure, DatabaseServices> =>
  Effect.map(taskNamesOf(userId, agent.taskId === null ? [] : [agent.taskId]), (names) => {
    const named = agent.taskId === null ? undefined : names.get(agent.taskId);
    return agent.taskId === null || named === undefined ? null : { id: agent.taskId, ...named };
  });

/** One agent's task as the model reads it, and whether it is the task of whoever is asking. */
export interface AgentTaskReading {
  readonly task: AgentTask | null;
  readonly onYourTask: boolean;
}

/** One agent's task as the model reads it, beside the task of whoever is asking. */
export function taskReading(task: AgentTask | null, ownTask: string | null): AgentTaskReading {
  return { task, onYourTask: task !== null && task.id === ownTask };
}
