import type { DatabaseServices } from "@repo/database/core/query";
import {
  type Agent,
  listWorkspaceAgents,
  readAgent,
  readVisibleAgent,
  taskNamesOf,
} from "@repo/database/models/agent-store";
import { AGENT_BOUNDS } from "@repo/features/agent-wire";
import { type TaskStatus, taskStatusSchema } from "@repo/features/task-wire";
import { describeWire } from "@repo/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import { type UnparsedWireValue, wireUuidSchema } from "../core.js";
import type { StoreFailure } from "../http/store-failure.js";
import { AGENT_TOOL } from "./agent-runtime/tools.js";
import { assigneeIdOf, memberLinkWrittenSchema } from "./task-assignee.js";

export const WORKSPACE_AGENTS_LIST_LIMIT = 50;

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

export interface AgentTask {
  readonly id: string;
  readonly name: string;
}

export interface WorkspaceAgents {
  readonly agents: readonly Agent[];
  readonly taskOf: (agent: Agent) => AgentTask | null;
  readonly nextOffset: number | null;
}

export const AGENT_LIST_STARTER = {
  MINE: "mine",
  MEMBER: "member",
} as const;

export type AgentListStarter =
  | { readonly kind: typeof AGENT_LIST_STARTER.MINE }
  | { readonly kind: typeof AGENT_LIST_STARTER.MEMBER; readonly userId: string }
  | undefined;

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

function storeNarrowingOf(filter: AgentListFilter) {
  const { archived, starter, automation, automationId, taskStatus } = filter;
  return {
    includeArchived: archived !== false,
    ...(archived === true ? { archivedOnly: true } : undefined),
    ...(starter?.kind === AGENT_LIST_STARTER.MINE ? { ownOnly: true } : undefined),
    ...(starter?.kind === AGENT_LIST_STARTER.MEMBER ? { startedBy: starter.userId } : undefined),
    ...(automation === undefined ? undefined : { automation }),
    ...(automationId === undefined ? undefined : { automationId }),
    ...(taskStatus === undefined ? undefined : { taskStatus }),
  };
}

export interface ListedPage<A> {
  readonly page: readonly A[];
  readonly nextOffset: number | null;
}

export function listedPage<A>(listed: readonly A[], offset: number, bound: number): ListedPage<A> {
  return {
    page: listed.slice(0, bound),
    nextOffset: listed.length > bound ? offset + bound : null,
  };
}

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

export const agentTaskOf = (
  userId: string,
  agent: Agent,
): Effect.Effect<AgentTask | null, StoreFailure, DatabaseServices> =>
  Effect.map(taskNamesOf(userId, agent.taskId === null ? [] : [agent.taskId]), (names) => {
    const named = agent.taskId === null ? undefined : names.get(agent.taskId);
    return agent.taskId === null || named === undefined ? null : { id: agent.taskId, ...named };
  });

export interface AgentTaskReading {
  readonly task: AgentTask | null;
  readonly onYourTask: boolean;
}

export function taskReading(task: AgentTask | null, ownTask: string | null): AgentTaskReading {
  return { task, onYourTask: task !== null && task.id === ownTask };
}
