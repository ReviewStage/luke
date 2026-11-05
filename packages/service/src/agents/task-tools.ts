import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import {
  readTask,
  type TaskAssigneeNotMember,
  type TaskIdTaken,
} from "@repo/database/models/task-store";
import { AGENT_KIND } from "@repo/features/agent-wire";
import { githubRepositoryFullNameSchema } from "@repo/features/github-repositories-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  PLAN_ACTOR,
  TASK_BOUNDS,
  TASK_CREATE_RELATION_KIND,
  TASK_MODE,
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskOrigin,
  taskModeSchema,
  taskPrioritySchema,
  taskStatusSchema,
} from "@repo/features/task-wire";
import { describeWire } from "@repo/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import {
  ACTION_RESULT_STATUS,
  type UnparsedWireValue,
  type WireRecord,
  wireUuidSchema,
} from "../core.js";
import { SERVER_TASK_SOURCE } from "../events/server-events.js";
import type { HostedRefusal } from "../http/http-effect.js";
import {
  createTaskAsked,
  type TaskCreateAsked,
  type TaskCreateRelationRefused,
} from "../tasks/task-create-relation.js";
import { AGENT_TOOL } from "./agent-runtime/tools.js";
import {
  AGENT_TOOL_REFUSAL,
  type AgentCall,
  type AgentReadCall,
  type AgentToolServices,
  agentToolRejected,
  callerAgent,
  callerTask,
  callerUserId,
  callerWorkspace,
  cutOnLine,
  orStoreRefusal,
  repositoryRefusalWords,
  TASK_PRIORITY_WORDS,
  taskStandingOf,
  workedRepository,
} from "./agent-tools.js";
import { calledId } from "./called-id.js";
import { assigneeIdOf, TASK_ASSIGNEE_INPUT } from "./task-assignee.js";
import { taskBlockReadings } from "./task-block-changes.js";
import { workspaceNamingOf, writtenTaskMention } from "./written-mentions.js";

/**
 * task-tools.ts -- the tools every agent reads and makes the workspace's tasks by: read one task's plan and where it stands, and make one.
 *
 * Every coding agent is offered the same `read_task`,
 * one implementation, beside `list_tasks` (`agent-tools.ts`), which
 * names the tasks it reads by id. It reads any task of the caller's
 * workspace, a teammate's included, as the member the
 * caller acts for could open it in the sidebar, read on that member's
 * standing now; a task of another workspace is none of the caller's, even
 * where the member is also in it. It answers the task as its row stands, the
 * brief the developer started it with, the tasks it is blocked by and blocks
 * that the member reaches, and its plan's saved text cut on a
 * line to a bound, so an agent reads another task's plan without its being
 * mentioned.
 *
 * `create_task` makes a task as the member the caller acts for makes one from
 * the sidebar, through the one make every door shares
 * (`tasks/task-create-relation.ts`): in the caller's workspace, on the
 * repository named, the one the caller works in where none is, or none, and
 * with a plan to start from where one is given. Only a pilot may make a task
 * in pilot mode, and only as a child, which is how it gives a part too big
 * for one pull request a pilot of its own. It is made under an id drawn from
 * eve's key for the call (`called-id.ts`), so a call run again answers the
 * task it made and makes no second.
 * Every answer is data the model reads, never a credential.
 */

/** The most characters of a plan a read answers, about ten thousand tokens: the rest is counted, never sent. */
export const PLAN_TEXT_READ_CHARS = 40_000;

/** Why a read answered nothing, in words the model can act on. */
export const READ_TASK_REFUSAL = {
  UNREADABLE: `Not read: name the task by the id ${AGENT_TOOL.LIST_TASKS} answered.`,
  NO_TASK: `Not read: no task of your workspace has that id; ${AGENT_TOOL.LIST_TASKS} names them.`,
} as const;

const READ_TASK_INPUT = Schema.Struct({
  taskId: describeWire(
    wireUuidSchema,
    `The task to read, by the id ${AGENT_TOOL.LIST_TASKS} answered.`,
  ),
});

const readTaskAsked = Schema.decodeUnknownResult(READ_TASK_INPUT);

export const READ_TASK_TOOL = {
  name: AGENT_TOOL.READ_TASK,
  description:
    "Read one task of your workspace by its id, a teammate's included: its " +
    "key (such as ACME-42), name, where it stands (its status) and how much it matters (its " +
    "priority), repository, who started it, whether it is the task you " +
    "work on, its mention, the brief the developer started it with (null for none), the tasks " +
    "it is blocked by and the tasks it blocks (each with its id, name, status, and mention), " +
    `and its plan as last saved, cut on a line at ${PLAN_TEXT_READ_CHARS} characters with how many were ` +
    `left out. Read one before you start an agent on it, or to learn what another task is about; ` +
    `${AGENT_TOOL.LIST_AGENTS} with its taskId names the agents on it.`,
  inputSchema: READ_TASK_INPUT,
} as const;

/** One call of `read_task`: a task of the caller's workspace, its plan cut to the bound, or why there is none. */
export function runReadTask(
  call: AgentReadCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  const asked = readTaskAsked(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(READ_TASK_REFUSAL.UNREADABLE));
  }
  const { taskId } = asked.success;
  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(call.caller);
      if (Option.isNone(workspace)) {
        return agentToolRejected(AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      }
      const userId = callerUserId(call.caller);
      const stored = yield* readTask(userId, taskId);
      // A task of another workspace, even one the member is also in, is none of the caller's.
      if (Option.isNone(stored) || stored.value.task.workspaceId !== workspace.value) {
        return agentToolRejected(READ_TASK_REFUSAL.NO_TASK);
      }
      const { task, text, saved, brief } = stored.value;
      const { step, name } = yield* workspaceNamingOf(userId, workspace.value);
      const plan = cutOnLine(text, PLAN_TEXT_READ_CHARS);
      const blocks = yield* taskBlockReadings(userId, task, step);
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        task: {
          id: task.id,
          ...taskStandingOf(task, { step, name }),
          name: task.name,
          repository: task.repository ?? null,
          startedBy: task.createdBy?.name ?? null,
          isYourTask: task.id === callerTask(call.caller),
          mention: writtenTaskMention(task, task.name, step),
          brief: brief ?? null,
          ...blocks,
        },
        plan: { text: plan.text, saved, leftOutChars: plan.leftOutChars },
      };
    }),
  );
}

/** Why a make made nothing, in words the model can act on. */
export const CREATE_TASK_REFUSAL = {
  UNREADABLE:
    `Not made: give a name of at most ${TASK_BOUNDS.MAX_NAME_CHARS} characters, a repository as ` +
    `owner/name, null for none, or none for the one you work in, a brief of at most ` +
    `${TASK_BOUNDS.MAX_BRIEF_CHARS} characters or none, a plan of at most ` +
    `${TASK_BOUNDS.MAX_BODY_CHARS} characters or none, a status ` +
    `(${Object.values(TASK_STATUS).join(", ")}) or none, a priority ` +
    `(${Object.values(TASK_PRIORITY).join(", ")}) or none, an assignee as a member's ` +
    `mention link or none, a parent task by the id ${AGENT_TOOL.LIST_TASKS} answered or none, ` +
    `a relation (${Object.values(TASK_CREATE_RELATION_KIND).join(", ")}) to a task by that id ` +
    `or none, and a mode (${Object.values(TASK_MODE).join(", ")}) or none.`,
  NOT_MEMBER:
    "Not made: that assignee is no member of the workspace, or names no person; name a member by " +
    `the mention link ${AGENT_TOOL.LIST_TASKS} hands you, or leave it out for no one.`,
  NO_PARENT: `Not made: no task of your workspace has that id to be its parent; ${AGENT_TOOL.LIST_TASKS} names them.`,
  PARENT_REPOSITORY:
    "Not made: a child task always works in its parent's repository; leave repository out to " +
    "take the parent's, or make it with no parent to work in another.",
  PARENT_AND_RELATION:
    "Not made: name its parent once, by parentTaskId or by a relation, not both; a relation of " +
    `${TASK_CREATE_RELATION_KIND.SUB_TASK_OF} says what parentTaskId says.`,
  NO_RELATED: `Not made: no task of your workspace has that id to relate it to; ${AGENT_TOOL.LIST_TASKS} names them.`,
  CHILD_REPOSITORY:
    "Not made: a parent task always works in its child's repository; leave repository out to " +
    "take that task's, or relate it another way to work in another.",
  PARENT_HELD:
    "Not made: that task has a parent already, which a new task never takes the place of; make " +
    `it a ${TASK_CREATE_RELATION_KIND.SUB_TASK_OF} of that parent, or relate it another way.`,
  RELATION_CYCLE:
    "Not made: that relation would close a cycle among the workspace's tasks; read_task names " +
    "how they stand, and relate it another way.",
  NOT_PILOT:
    "Not made: only a pilot makes a task in pilot mode; leave mode out to make one its agents " +
    "work, or tell your pilot the task is too big for one pull request.",
  PILOT_NO_PARENT:
    "Not made: a task in pilot mode is a child task of yours; give it a parentTaskId, your own " +
    "task's id where it is a part of your work.",
} as const;

const CREATE_TASK_INPUT = Schema.Struct({
  name: describeWire(
    Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(TASK_BOUNDS.MAX_NAME_CHARS)),
    "The task's name, as the developer would name it in the sidebar.",
  ),
  repository: Schema.optionalKey(
    describeWire(
      Schema.NullOr(githubRepositoryFullNameSchema),
      "The GitHub repository its agents work in, as owner/name, which the workspace's GitHub " +
        "installation must reach; null for none, and left out for the one you work in, or the " +
        "parent's where you give a parent.",
    ),
  ),
  brief: Schema.optionalKey(
    describeWire(
      Schema.Trim.check(Schema.isMaxLength(TASK_BOUNDS.MAX_BRIEF_CHARS)),
      `The developer's own words about the task, which ${PRODUCT_NAME} is handed when they open a call on ` +
        "it; their words where they gave them, left out otherwise.",
    ),
  ),
  plan: Schema.optionalKey(
    describeWire(
      Schema.String.check(Schema.isMaxLength(TASK_BOUNDS.MAX_BODY_CHARS)),
      "The plan's body to start it with, as Markdown under its sections' ## headings, without " +
        "the # title, which the task's name is; an agent started on it with no prompt is handed " +
        "it. Left out, it starts empty.",
    ),
  ),
  status: Schema.optionalKey(
    describeWire(
      taskStatusSchema,
      "Where the task stands: backlog for work filed for later; todo where left out.",
    ),
  ),
  priority: Schema.optionalKey(describeWire(taskPrioritySchema, TASK_PRIORITY_WORDS)),
  assignee: Schema.optionalKey(TASK_ASSIGNEE_INPUT),
  parentTaskId: Schema.optionalKey(
    describeWire(
      wireUuidSchema,
      `The task to make it a child of, by the id ${AGENT_TOOL.LIST_TASKS} answered: a part of ` +
        "that task's work, which works in its repository. Left out, it stands at the top.",
    ),
  ),
  relation: Schema.optionalKey(
    describeWire(
      Schema.Struct({
        kind: describeWire(
          Schema.Literals(Object.values(TASK_CREATE_RELATION_KIND)),
          "How the new task stands to the other, from the new task's side: blocked-by, it waits " +
            "on the other's work; blocks, the other waits on its work; sub-task-of, a child of " +
            "the other, as parentTaskId makes one; parent-of, the other's parent, refused where " +
            "the other has a parent already.",
        ),
        taskId: describeWire(
          wireUuidSchema,
          `The other task, of your workspace, by the id ${AGENT_TOOL.LIST_TASKS} answered.`,
        ),
      }),
      "Another task of your workspace the new task starts related to, written with it so both " +
        "land together. A sub-task-of or parent-of takes the other task's repository, so leave " +
        "repository out, and another is refused; a block takes nothing of it. Not beside " +
        "parentTaskId; left out, it starts related to none.",
    ),
  ),
  mode: Schema.optionalKey(
    describeWire(
      taskModeSchema,
      "How it is worked: agent, by the agents started on it, or pilot, by a pilot of its own " +
        "that breaks it into child tasks, for a child too big for one pull request. Only a " +
        "pilot may ask for pilot, and only as a child; left out, agent.",
    ),
  ),
});

const readCreateAsked = Schema.decodeUnknownResult(CREATE_TASK_INPUT);

export const CREATE_TASK_TOOL = {
  name: AGENT_TOOL.CREATE_TASK,
  description:
    "Make a task in your workspace for the developer you work for, as the sidebar's New task " +
    "would: owned by them, on the repository named or the one you work in, with their brief " +
    "and a plan to start from where given, and no agent on it. Make one for a separate piece of work that should stand as a task of its own, " +
    "where the developer asked for it or you " +
    `work on no task; then start an agent on it with ${AGENT_TOOL.START_AGENT}'s taskId. ` +
    "Give it a status, a priority, and an assignee where the developer said them. Give it a " +
    "parentTaskId to make it a child task of another, to any depth: a child always works in " +
    "its parent's repository, so leave repository out for one. Give it a " +
    "relation instead to make it blocked by, blocking, a sub-task of, or the parent of another " +
    "task of your workspace in the same call. Answers " +
    "`accepted` with the task's id, key, name, status, priority, assignee, repository, and " +
    "mention, or `rejected` and why.",
  inputSchema: CREATE_TASK_INPUT,
} as const;

/** A # title at a plan's head, as Markdown spells one: at most three spaces in, and a space, a tab, or the line's end after the #, so `#define` or a code line is no title. */
const TITLE_HEADING = /^(?:[ \t]*\r?\n)*[ ]{0,3}#(?:[ \t][^\r\n]*)?\r?(?:\n|$)/u;

/** A plan's body as a task keeps it: without a # title at its head, which the task's name is, and its ends trimmed. */
function planTextOf(plan: string): string {
  return plan.replace(TITLE_HEADING, "").trim();
}

/** Who a task's first plan is written by, as its history names them: the calling coding agent, or the member calling, as the developer. */
function revisionWriterOf(call: AgentCall): NonNullable<TaskCreateAsked["writer"]> {
  const agent = callerAgent(call.caller);
  return agent === undefined
    ? { actor: PLAN_ACTOR.DEVELOPER }
    : { actor: PLAN_ACTOR.AGENT, agentId: agent.id };
}

/** Who made a task for the caller's member: the coding agent by its id; none for the member calling, as for one they make by hand. */
function originOf(call: AgentCall): { readonly origin?: TaskOrigin } {
  const agent = callerAgent(call.caller);
  return agent === undefined ? {} : { origin: { actor: PLAN_ACTOR.AGENT, agentId: agent.id } };
}

/**
 * Why the make made nothing (`createTaskAsked`), in words the model can act
 * on; a store failure is left to `orStoreRefusal`. Note that a call naming a
 * parent names no other relation, so the parent's refusals are told apart
 * from a relation's by whether the call named one.
 */
const madeRefusal =
  (parentNamed: boolean) =>
  (
    failure:
      | HostedRefusal
      | TaskAssigneeNotMember
      | TaskIdTaken
      | TaskCreateRelationRefused
      | StoreFailure,
  ): Effect.Effect<string, StoreFailure> => {
    if (!("_tag" in failure)) return Effect.succeed(repositoryRefusalWords(failure));
    switch (failure._tag) {
      case "TaskAssigneeNotMember":
        return Effect.succeed(CREATE_TASK_REFUSAL.NOT_MEMBER);
      case "TaskParentHeld":
        return Effect.succeed(CREATE_TASK_REFUSAL.PARENT_HELD);
      case "TaskParentRepositoryDiffers":
        return Effect.succeed(
          parentNamed
            ? CREATE_TASK_REFUSAL.PARENT_REPOSITORY
            : CREATE_TASK_REFUSAL.CHILD_REPOSITORY,
        );
      case "TaskParentCycle":
      case "TaskBlockCycle":
        return Effect.succeed(CREATE_TASK_REFUSAL.RELATION_CYCLE);
      case "TaskParentUnreached":
        return Effect.succeed(
          parentNamed ? CREATE_TASK_REFUSAL.NO_PARENT : CREATE_TASK_REFUSAL.NO_RELATED,
        );
      // The other task gone out of reach since it was read, and the store's own holds, read as none to relate to.
      case "TaskRelationUnreached":
      case "TaskBlockSelf":
      case "TaskBlockAcrossWorkspaces":
        return Effect.succeed(CREATE_TASK_REFUSAL.NO_RELATED);
      // The id is drawn from the member's own key, so a task another holds under it is the store breaking.
      case "TaskIdTaken":
        return Effect.succeed(AGENT_TOOL_REFUSAL.STORE);
      default:
        return Effect.fail(failure);
    }
  };

/** One call of `create_task`: a task made in the caller's workspace for its member, once under the call's key. */
export function runCreateTask(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readCreateAsked(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(CREATE_TASK_REFUSAL.UNREADABLE));
  }
  const { name, brief, plan, status, priority, assignee, relation, mode } = asked.success;
  if (asked.success.parentTaskId !== undefined && relation !== undefined) {
    return Effect.succeed(agentToolRejected(CREATE_TASK_REFUSAL.PARENT_AND_RELATION));
  }
  // A sub-task of another is a child of it, which parentTaskId names as well.
  const parentTaskId =
    relation?.kind === TASK_CREATE_RELATION_KIND.SUB_TASK_OF
      ? relation.taskId
      : asked.success.parentTaskId;
  // Note that a pilot task is only a pilot's to make, as a child, since its first agent is a pilot of its own.
  if (mode === TASK_MODE.PILOT && callerAgent(call.caller)?.kind !== AGENT_KIND.PILOT) {
    return Effect.succeed(agentToolRejected(CREATE_TASK_REFUSAL.NOT_PILOT));
  }
  if (mode === TASK_MODE.PILOT && parentTaskId === undefined) {
    return Effect.succeed(agentToolRejected(CREATE_TASK_REFUSAL.PILOT_NO_PARENT));
  }
  const assigneeId =
    assignee === undefined || assignee === null ? undefined : assigneeIdOf(assignee);
  if (assignee !== undefined && assignee !== null && assigneeId === undefined) {
    return Effect.succeed(agentToolRejected(CREATE_TASK_REFUSAL.NOT_MEMBER));
  }
  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(call.caller);
      if (Option.isNone(workspace)) {
        return agentToolRejected(AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      }
      const userId = callerUserId(call.caller);
      const id = calledId(userId, call.clientKey);
      const naming = yield* workspaceNamingOf(userId, workspace.value);
      // Left out, the repository is the one the caller works in, unless the task joins a tree, whose it takes.
      const inTree =
        parentTaskId !== undefined || relation?.kind === TASK_CREATE_RELATION_KIND.PARENT_OF;
      const repository =
        asked.success.repository !== undefined || inTree
          ? asked.success.repository
          : yield* workedRepository(call.caller);
      // The call run again finds the task it made, and makes no second.
      const before = yield* readTask(userId, id);
      const made = Option.isSome(before)
        ? before.value.task
        : yield* createTaskAsked(
            userId,
            {
              id,
              organizationId: workspace.value,
              name,
              ...(repository === undefined ? undefined : { repository }),
              ...(brief === undefined ? undefined : { brief }),
              ...(status === undefined ? undefined : { status }),
              ...(priority === undefined ? undefined : { priority }),
              ...(assignee === undefined ? undefined : { assigneeId: assigneeId ?? null }),
              ...(parentTaskId === undefined ? undefined : { parentTaskId }),
              ...(mode === undefined ? undefined : { mode }),
              ...originOf(call),
              text: planTextOf(plan ?? ""),
              writer: revisionWriterOf(call),
              relations: relation === undefined ? [] : [relation],
            },
            SERVER_TASK_SOURCE.AGENT,
          ).pipe(
            Effect.map((created) => created.task.task),
            Effect.catch(madeRefusal(parentTaskId !== undefined)),
          );
      if (typeof made === "string") return agentToolRejected(made);
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        task: {
          id: made.id,
          ...taskStandingOf(made, naming),
          name: made.name,
          repository: made.repository ?? null,
          mention: writtenTaskMention(made, made.name, naming.step),
        },
      };
    }),
  );
}
