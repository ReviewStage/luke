import type { DatabaseServices } from "@luke/database/core/query";
import {
  type CodingAgent,
  listWorkspaceCodingAgents,
  readCodingAgent,
  taskNamesOf,
} from "@luke/database/models/coding-agent-store";
import { describeWire } from "@luke/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import { type UnparsedWireValue, wireUuidSchema } from "../core.js";
import type { StoreFailure } from "../http/store-failure.js";

/**
 * workspace-agents.ts -- the coding agents of one workspace as an agent's tools read them: on any task or none, by any member, one task's alone where asked, each with its task's name.
 *
 * The agent tools Luke on a call and every coding agent are offered
 * (`coding-agent-tools.ts`) list and find the agents here. A list names the archived
 * agents too, each marked, since an agent may need to know one stands, and
 * names each agent's task by its name and whether it is archived, read once
 * for the lot; it is narrowed to one task by the id a listed agent's task
 * answered, or to the caller's own. Every read is on the account's own
 * standing: a workspace it is not in has no agents, and an agent of another
 * workspace, even one the account is also in, is none of these.
 */

/** The most agents a list answers, the newest started first. */
export const WORKSPACE_AGENTS_LIST_LIMIT = 50;

/** Why a list's filter read as nothing to list by, in words the model can act on. */
export const AGENT_LIST_FILTER_REFUSAL = {
  BOTH: "Not run: narrow the list by taskId or by thisTask, not both.",
  NO_OWN_TASK:
    "Not run: you work on no task, so thisTask names none; leave it out to list the whole workspace.",
} as const;

/** The filters a list takes: one task by its id, or the caller's own task. */
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
});

const readFilter = Schema.decodeUnknownResult(AGENT_LIST_INPUT);

/** An agent's task as a list names it; null for an agent on none, or on a task the reader cannot read. */
export interface AgentTask {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
}

/** A list of a workspace's agents, and the task each stands on. */
export interface WorkspaceAgents {
  readonly agents: readonly CodingAgent[];
  readonly taskOf: (agent: CodingAgent) => AgentTask | null;
}

/**
 * The task a list's input narrows it to, given the task the caller works
 * on: none for the whole workspace, or a refusal where the input does not
 * read, names both, or asks for an own task the caller has not got.
 */
export function listedTask(
  input: UnparsedWireValue,
  ownTask: string | null,
): Result.Result<string | undefined, string | undefined> {
  const read = readFilter(input);
  if (Result.isFailure(read)) return Result.fail(undefined);
  const { taskId, thisTask } = read.success;
  if (taskId !== undefined && thisTask === true) {
    return Result.fail(AGENT_LIST_FILTER_REFUSAL.BOTH);
  }
  if (thisTask !== true) return Result.succeed(taskId);
  return ownTask === null
    ? Result.fail(AGENT_LIST_FILTER_REFUSAL.NO_OWN_TASK)
    : Result.succeed(ownTask);
}

/** The workspace's agents, archived ones among them, on the task named alone where one is, newest first and at most the list's bound, the one left out where `except` names one. */
export const workspaceAgentsOf = (
  userId: string,
  workspaceId: string,
  options: { readonly taskId?: string | undefined; readonly except?: string | undefined },
): Effect.Effect<WorkspaceAgents, StoreFailure, DatabaseServices> =>
  Effect.gen(function* () {
    const listed = yield* listWorkspaceCodingAgents(userId, workspaceId, {
      ...(options.taskId === undefined ? undefined : { planId: options.taskId }),
      includeArchived: true,
      limit: WORKSPACE_AGENTS_LIST_LIMIT + 1,
    });
    const agents = listed
      .filter((agent) => agent.id !== options.except)
      .slice(0, WORKSPACE_AGENTS_LIST_LIMIT);
    const names = yield* taskNamesOf(
      userId,
      agents.flatMap((agent) => agent.taskId ?? []),
    );
    const taskOf = (agent: CodingAgent): AgentTask | null => {
      const named = agent.taskId === null ? undefined : names.get(agent.taskId);
      return agent.taskId === null || named === undefined ? null : { id: agent.taskId, ...named };
    };
    return { agents, taskOf };
  });

/** The agent under the id where it is one of the workspace's, archived or not; nothing for an agent of another workspace or none. */
export const workspaceAgent = (
  userId: string,
  workspaceId: string,
  agentId: string,
): Effect.Effect<Option.Option<CodingAgent>, StoreFailure, DatabaseServices> =>
  Effect.map(readCodingAgent(userId, agentId), (found) =>
    Option.filter(found, (agent) => agent.organizationId === workspaceId),
  );

/** The task one agent stands on, read as the account; null for an agent on none or on one the account cannot read. */
export const agentTaskOf = (
  userId: string,
  agent: CodingAgent,
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
