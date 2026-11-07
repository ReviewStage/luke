import type { DatabaseServices } from "@repo/database/core/query";
import {
  type Agent,
  listWorkspaceAgents,
  readAgent,
  readVisibleAgent,
  taskNamesOf,
} from "@repo/database/models/agent-store";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { AGENT_BOUNDS } from "@repo/features/agent-wire";
import { type TaskStatus, taskStatusSchema } from "@repo/features/task-wire";
import { describeWire } from "@repo/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import { type UnparsedWireValue, wireUuidSchema } from "../core.js";
import type { StoreFailure } from "../http/store-failure.js";
import { assigneeIdOf, memberLinkWrittenSchema } from "./task-assignee.js";

/**
 * workspace-agents.ts -- the coding agents of one workspace as an agent's tools read them: on any task or none, by any member, one task's alone where asked, each with its task's name.
 *
 * The agent tools every coding agent is offered
 * (`agent-tools.ts`) list and find the agents here. A list names the archived
 * agents too, each marked, since an agent may need to know one stands, and
 * names each agent's task by its name, read once
 * for the lot; it is narrowed to one task by the id a listed agent's task
 * answered, or to the caller's own, searched by words of an agent's title
 * or its task's name, and narrowed by whether an agent is archived, who
 * started it, whether an automation (or which) started it, and where its
 * task stands, each in the query so a page is never cut short. The agents the caller works beside come first,
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
    "Not run: narrow the list by a taskId, by thisTask, by words of an agent's title or its " +
    `task's name of at most ${AGENT_BOUNDS.MAX_SEARCH_CHARS} characters, by archived, mine, ` +
    "startedBy, automation, automationId, or a task status, and page it by an offset of 0 or more.",
  BOTH: "Not run: narrow the list by taskId or by thisTask, not both.",
  NO_OWN_TASK:
    "Not run: you work on no task, so thisTask names none; leave it out to list the whole workspace.",
  BOTH_STARTERS: "Not run: narrow the list by mine or by startedBy, not both.",
  NO_MEMBER:
    "Not run: startedBy names no person; name a member by their mention link, " +
    "`[@Name](…/person/<id>)`, or its address alone.",
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
  archived: Schema.optionalKey(
    describeWire(
      Schema.Boolean,
      "true for only the archived agents, false for only those not archived; leave it out for both.",
    ),
  ),
  mine: Schema.optionalKey(
    describeWire(
      Schema.Boolean,
      "true for only the agents the developer you work for started, by hand or through an agent " +
        "or automation of theirs; leave it out for every member's.",
    ),
  ),
  startedBy: Schema.optionalKey(
    describeWire(
      memberLinkWrittenSchema,
      "Only the agents this member started, by their mention link, `[@Name](…/person/<id>)`, " +
        "or its address alone; leave it out for every member's.",
    ),
  ),
  automation: Schema.optionalKey(
    describeWire(
      Schema.Boolean,
      "true for only the agents an automation's run started, false for only those started " +
        "otherwise; leave it out for both.",
    ),
  ),
  automationId: Schema.optionalKey(
    describeWire(
      wireUuidSchema,
      `Only the agents this automation's runs started, by the id ${AGENT_TOOL.LIST_AUTOMATIONS} answered.`,
    ),
  ),
  taskStatus: Schema.optionalKey(
    describeWire(
      taskStatusSchema,
      "Only the agents on a task that stands here, such as done; an agent on no task matches none.",
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

/** The ways a list names whose agents it keeps. */
export const AGENT_LIST_STARTER = {
  MINE: "mine",
  MEMBER: "member",
} as const;

/** Whose agents a list keeps: the caller's developer's own, one member's by their account's id, or every member's. */
export type AgentListStarter =
  | { readonly kind: typeof AGENT_LIST_STARTER.MINE }
  | { readonly kind: typeof AGENT_LIST_STARTER.MEMBER; readonly userId: string }
  | undefined;

/** What a list's input narrows it to: one task where it names one, words to search by, the agents' archive, starter, automation and task's status where named, and the page to read. */
export interface AgentListFilter {
  readonly taskId: string | undefined;
  readonly words: string | undefined;
  readonly archived: boolean | undefined;
  readonly starter: AgentListStarter;
  readonly automation: boolean | undefined;
  readonly automationId: string | undefined;
  readonly taskStatus: TaskStatus | undefined;
  readonly offset: number;
}

/** Whose agents the input keeps, or a refusal where it names a starter both ways or a link that names no person. */
function starterOf(mine: boolean | undefined, startedBy: string | undefined) {
  if (mine === true && startedBy !== undefined) {
    return Result.fail(AGENT_LIST_FILTER_REFUSAL.BOTH_STARTERS);
  }
  if (mine === true) return Result.succeed<AgentListStarter>({ kind: AGENT_LIST_STARTER.MINE });
  if (startedBy === undefined) return Result.succeed<AgentListStarter>(undefined);
  const userId = assigneeIdOf(startedBy);
  return userId === undefined
    ? Result.fail(AGENT_LIST_FILTER_REFUSAL.NO_MEMBER)
    : Result.succeed<AgentListStarter>({ kind: AGENT_LIST_STARTER.MEMBER, userId });
}

/**
 * What a list's input narrows it to, given the task the caller works on:
 * the whole workspace where it names nothing, or a refusal where the input
 * does not read, names a task or a starter both ways, asks for an own task
 * the caller has not got, or names a starter by a link that is no person's.
 */
export function listedFilter(
  input: UnparsedWireValue,
  ownTask: string | null,
): Result.Result<AgentListFilter, string> {
  const read = readFilter(input);
  if (Result.isFailure(read)) return Result.fail(AGENT_LIST_FILTER_REFUSAL.UNREADABLE);
  const { taskId, thisTask, words, offset, mine, startedBy, ...narrowed } = read.success;
  if (taskId !== undefined && thisTask === true) {
    return Result.fail(AGENT_LIST_FILTER_REFUSAL.BOTH);
  }
  if (thisTask === true && ownTask === null) {
    return Result.fail(AGENT_LIST_FILTER_REFUSAL.NO_OWN_TASK);
  }
  const starter = starterOf(mine, startedBy);
  if (Result.isFailure(starter)) return Result.fail(starter.failure);
  return Result.succeed({
    taskId: thisTask === true ? (ownTask ?? undefined) : taskId,
    words,
    archived: narrowed.archived,
    starter: starter.success,
    automation: narrowed.automation,
    automationId: narrowed.automationId,
    taskStatus: narrowed.taskStatus,
    offset: offset ?? 0,
  });
}

/** The store's narrowing for a list's archive, starter, automation and task's status, each left out where the filter names none. */
function storeNarrowingOf(filter: AgentListFilter) {
  const { archived, starter, automation, automationId, taskStatus } = filter;
  return {
    // An archived agent is listed unless the filter asks for only those not archived.
    includeArchived: archived !== false,
    ...(archived === true ? { archivedOnly: true } : undefined),
    ...(starter?.kind === AGENT_LIST_STARTER.MINE ? { ownOnly: true } : undefined),
    ...(starter?.kind === AGENT_LIST_STARTER.MEMBER ? { startedBy: starter.userId } : undefined),
    ...(automation === undefined ? undefined : { automation }),
    ...(automationId === undefined ? undefined : { automationId }),
    ...(taskStatus === undefined ? undefined : { taskStatus }),
  };
}

/** A page cut from a list read one past its bound, and the next page's offset where that one past stood; null where the list ended. */
export interface ListedPage<A> {
  readonly page: readonly A[];
  readonly nextOffset: number | null;
}

/**
 * A page of a list the store read from `offset` at one past `bound`, so a
 * next page is known to stand without a count of its own: the agent tools'
 * list and the hosted list (`agents-procedures.ts`) cut their pages here.
 */
export function listedPage<A>(listed: readonly A[], offset: number, bound: number): ListedPage<A> {
  return {
    page: listed.slice(0, bound),
    nextOffset: listed.length > bound ? offset + bound : null,
  };
}

/**
 * A page of the workspace's agents, archived ones among them unless the
 * filter leaves them out, narrowed as the filter asks, the calling agent left out: its starter and the agents
 * it started first, then those on its task, then the rest, each newest
 * first, at most the list's bound from the filter's offset, and the next
 * page's offset where more stand. A caller that is no agent, a member,
 * leaves no one out and reads the whole list newest first.
 */
export const workspaceAgentsOf = (
  userId: string,
  workspaceId: string,
  caller: Agent | undefined,
  filter: AgentListFilter,
): Effect.Effect<WorkspaceAgents, StoreFailure, DatabaseServices> =>
  Effect.gen(function* () {
    const listed = yield* listWorkspaceAgents(userId, workspaceId, {
      ...(filter.taskId === undefined ? undefined : { taskId: filter.taskId }),
      ...(filter.words === undefined ? undefined : { words: filter.words }),
      ...storeNarrowingOf(filter),
      ...(caller === undefined
        ? undefined
        : {
            except: caller.id,
            around: {
              agentId: caller.id,
              taskId: caller.taskId,
              startedByAgentId: caller.startedByAgentId,
            },
          }),
      offset: filter.offset,
      // One past the bound tells whether a next page stands, without a count of its own.
      limit: WORKSPACE_AGENTS_LIST_LIMIT + 1,
    });
    const { page: agents, nextOffset } = listedPage(
      listed,
      filter.offset,
      WORKSPACE_AGENTS_LIST_LIMIT,
    );
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
 * not, as the caller's tools name it; nothing for an agent of another
 * workspace or none. Another agent is read as a member may read it
 * (`readVisibleAgent`), and a calling agent itself as it reads itself
 * (`readAgent`), so its own tools never lose it when its starter
 * loses sight of its task; a caller that is no agent, a member, names no
 * `callerId`.
 */
export const workspaceAgent = (
  userId: string,
  workspaceId: string,
  agentId: string,
  callerId: string | undefined,
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
