import type { DatabaseServices } from "@luke/database/core/query";
import { recordRevision } from "@luke/database/models/plan-revisions";
import {
  createTaskOnce,
  readEffectiveMergePolicy,
  readEffectiveRunning,
  readTask,
} from "@luke/database/models/task-store";
import { AGENT_KIND } from "@luke/features/agent-wire";
import { githubRepositoryFullNameSchema } from "@luke/features/github-repositories-wire";
import { MENTION_KIND } from "@luke/features/mention-link";
import {
  PLAN_ACTOR,
  TASK_BOUNDS,
  TASK_MODE,
  TASK_PRIORITY,
  TASK_STATUS,
  type Task,
  type TaskOrigin,
  taskModeSchema,
  taskPrioritySchema,
  taskStatusSchema,
} from "@luke/features/task-wire";
import { describeWire } from "@luke/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import { SqlClient } from "effect/sql";
import {
  ACTION_RESULT_STATUS,
  type UnparsedWireValue,
  type WireRecord,
  wireUuidSchema,
} from "../core.js";
import { recordServerEvent, SERVER_EVENT, SERVER_TASK_SOURCE } from "../events/server-events.js";
import { taskParentOf } from "../tasks/task-parent.js";
import { AGENT_TOOL } from "./agent-runtime/tools.js";
import {
  AGENT_TOOL_REFUSAL,
  type AgentCall,
  type AgentToolServices,
  agentToolRejected,
  callerTask,
  callerUserId,
  callerWorkspace,
  cutOnLine,
  orStoreRefusal,
  reachedRepository,
  TASK_PRIORITY_WORDS,
  taskStandingOf,
  workedRepository,
} from "./agent-tools.js";
import { calledId } from "./called-id.js";
import { agentMadeRunsOn } from "./coder-host/agent-runtime-choice.js";
import { assigneeIdOf, TASK_ASSIGNEE_INPUT } from "./task-assignee.js";
import { taskBlockReadings } from "./task-block-changes.js";
import { workspaceNamingOf, writtenMention } from "./written-mentions.js";

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
 * mentioned. It names the merge policy of the task's top task
 * (`topTaskMergePolicy`), which governs the task's whole tree, so an agent
 * reads the one policy its pull requests merge under whatever its depth, and
 * whether the top task is started (`topTaskStarted`, true after Start and false
 * while stopped or before the first Start), which the tree's agents follow, read as
 * false where it is missing.
 *
 * `create_task` makes a task as the member the caller acts for makes one from
 * the sidebar: in the caller's workspace, owned by that member, on the
 * repository named, the one the caller works in where none is, or none,
 * confirmed through the workspace's installation as a task's repository is,
 * with the developer's brief and a plan to start from where they are given,
 * and no agent on it; `start_agent` starts one on it by its id. It runs where the member last ran a task, the device New
 * task last named or the cloud (`agentMadeRunsOn`), even an assignee's
 * other than the member, and is refused by name where that device was
 * removed since, never sent to the cloud instead. Given a parent task of
 * the caller's workspace that the member reaches, it is made that task's
 * child, to any depth, and takes the parent's repository and machine
 * rather than its own, refused where the call names another repository
 * (`tasks/task-parent.ts`). Only a pilot may make a task in pilot mode, and
 * only as a child, which is how it gives a part too big for one pull request
 * a pilot of its own; every other task is worked by its agents. It is made
 * under an id drawn from eve's key for the call (`called-id.ts`), so a call
 * run again answers the task it made and makes no second.
 * Every answer is data the model reads, never a credential.
 */

/** The most characters of a plan a read answers, about ten thousand tokens: the rest is counted, never sent. */
const PLAN_TEXT_READ_CHARS = 40_000;

/** Why a read answered nothing, in words the model can act on. */
export const READ_TASK_REFUSAL = {
  UNREADABLE: `Not read: name the task by the id ${AGENT_TOOL.LIST_TASKS} answered.`,
  NO_TASK: `Not read: no task of your workspace has that id; ${AGENT_TOOL.LIST_TASKS} names them.`,
} as const;

const READ_TASK_INPUT = Schema.Struct({
  taskId: describeWire(
    wireUuidSchema,
    `The task to read, by the id ${AGENT_TOOL.LIST_TASKS} answered or a mention of it names.`,
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
    "it is blocked by and the tasks it blocks (each with its id, name, status, and mention), the " +
    "merge policy of its top task, which its pull requests merge under, whether its top task " +
    "is started, which every agent of its tree follows, " +
    `and its plan as last saved, cut on a line at ${PLAN_TEXT_READ_CHARS} characters with how many were ` +
    `left out. Read one before you start an agent on it, or to learn what another task is about; ` +
    `${AGENT_TOOL.LIST_AGENTS} with its taskId names the agents on it.`,
  inputSchema: READ_TASK_INPUT,
} as const;

/** One call of `read_task`: a task of the caller's workspace, its plan cut to the bound, or why there is none. */
export function runReadTask(
  call: AgentCall,
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
      const mergePolicy = yield* readEffectiveMergePolicy(userId, task.id);
      const running = yield* readEffectiveRunning(userId, task.id);
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        task: {
          id: task.id,
          ...taskStandingOf(task, { step, name }),
          name: task.name,
          repository: task.repository ?? null,
          startedBy: task.createdBy?.name ?? null,
          isYourTask: task.id === callerTask(call.caller),
          mention: writtenMention({ kind: MENTION_KIND.TASK, taskId: task.id }, task.name, step),
          brief: brief ?? null,
          ...blocks,
          // Never the task's own column: a child's policy is its top task's.
          topTaskMergePolicy: Option.getOrNull(mergePolicy),
          topTaskStarted: Option.getOrElse(running, () => false),
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
    `and a mode (${Object.values(TASK_MODE).join(", ")}) or none.`,
  NOT_MEMBER:
    "Not made: that assignee is no member of the workspace, or names no person; name a member by " +
    `the mention link ${AGENT_TOOL.LIST_TASKS} hands you, or leave it out for no one.`,
  PICK_REMOVED:
    "Not made: the device the member last chose to run tasks on has been removed, so there is " +
    "nowhere they asked this task to run; ask them to start a task from New task, choosing where " +
    "it runs, and try again.",
  NO_PARENT: `Not made: no task of your workspace has that id to be its parent; ${AGENT_TOOL.LIST_TASKS} names them.`,
  PARENT_REPOSITORY:
    "Not made: a child task always works in its parent's repository; leave repository out to " +
    "take the parent's, or make it with no parent to work in another.",
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
      "The developer's own words about the task, which Luke is handed when they open a call on " +
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
        "that task's work, which works in its repository and runs on its machine. Left out, it " +
        "stands at the top.",
    ),
  ),
  mode: Schema.optionalKey(
    describeWire(
      taskModeSchema,
      "How it is worked: agent, by the agents started on it, or pilot, by a pilot of its own " +
        "that breaks it into child tasks, for a child too big for one pull request. Only a " +
        "pilot may ask for pilot, and only with a parentTaskId; left out, agent.",
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
    "its parent's repository and on its machine, so leave repository out for one. Answers " +
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

/** Who a task's first plan is written by, as its history names them: the calling coding agent. */
function revisionWriterOf(call: AgentCall): RevisionWriter {
  return { actor: PLAN_ACTOR.AGENT, agentId: call.caller.agent.id };
}

/** Who made a task for the caller's member: the coding agent by its id. */
function originOf(call: AgentCall): TaskOrigin {
  return { actor: PLAN_ACTOR.AGENT, agentId: call.caller.agent.id };
}

/** Who a revision is written by, as the history keeps it. */
type RevisionWriter = Parameters<typeof recordRevision>[0]["writer"];

/** The parent a make names, confirmed (`taskParentOf`), or why it makes nothing, in words the model can act on. */
const parentOf = (
  userId: string,
  workspaceId: string,
  parentTaskId: string,
  repository: string | null | undefined,
) =>
  taskParentOf(userId, workspaceId, parentTaskId, repository).pipe(
    Effect.catchTag("TaskParentUnreached", () => Effect.succeed(CREATE_TASK_REFUSAL.NO_PARENT)),
    Effect.catchTag("TaskParentRepositoryDiffers", () =>
      Effect.succeed(CREATE_TASK_REFUSAL.PARENT_REPOSITORY),
    ),
  );

/** One call of `create_task`: a task made in the caller's workspace for its member, once under the call's key. */
export function runCreateTask(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readCreateAsked(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(CREATE_TASK_REFUSAL.UNREADABLE));
  }
  const { name, brief, plan, status, priority, assignee, parentTaskId, mode } = asked.success;
  // Note that a pilot task is only a pilot's to make, as a child, since its first agent is a pilot of its own.
  if (mode === TASK_MODE.PILOT && call.caller.agent.kind !== AGENT_KIND.PILOT) {
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
      const answer = (task: Task) => ({
        status: ACTION_RESULT_STATUS.ACCEPTED,
        task: {
          id: task.id,
          ...taskStandingOf(task, naming),
          name: task.name,
          repository: task.repository ?? null,
          mention: writtenMention(
            { kind: MENTION_KIND.TASK, taskId: task.id },
            task.name,
            naming.step,
          ),
        },
      });
      // The call run again finds the task it made, and makes no second.
      const before = yield* readTask(userId, id);
      if (Option.isSome(before)) return answer(before.value.task);
      const parent =
        parentTaskId === undefined
          ? undefined
          : yield* parentOf(userId, workspace.value, parentTaskId, asked.success.repository);
      if (typeof parent === "string") return agentToolRejected(parent);
      const repositoryAsked =
        asked.success.repository === undefined
          ? yield* workedRepository(call.caller)
          : asked.success.repository;
      const named = parent === undefined ? repositoryAsked : parent.repository;
      const reached = yield* reachedRepository(workspace.value, named, userId);
      if (Result.isFailure(reached)) return agentToolRejected(reached.failure);
      // A child runs where its parent runs; any other task where the member last ran one, and a device since removed makes none.
      const runsOn =
        parent === undefined
          ? yield* agentMadeRunsOn(userId).pipe(
              Effect.map((asked) => ({ asked })),
              Effect.catchTag("RunsOnPickRemoved", () => Effect.succeed(undefined)),
            )
          : { asked: parent.runsOn };
      if (runsOn === undefined) return agentToolRejected(CREATE_TASK_REFUSAL.PICK_REMOVED);
      const text = planTextOf(plan ?? "");
      // The make and its plan's first revision are one write, so a call run again at once makes one task.
      const made = yield* Effect.flatMap(SqlClient.SqlClient, (client) =>
        client.withTransaction(
          Effect.gen(function* () {
            const once = yield* createTaskOnce(userId, {
              id,
              organizationId: workspace.value,
              name,
              repository: reached.success.repository,
              githubAccess: reached.success.githubAccess,
              text,
              ...(brief === undefined ? undefined : { brief }),
              ...(status === undefined ? undefined : { status }),
              ...(priority === undefined ? undefined : { priority }),
              ...(assigneeId === undefined ? undefined : { assigneeId }),
              ...(runsOn.asked === undefined ? undefined : { runsOn: runsOn.asked }),
              ...(parent === undefined ? undefined : { parentTaskId: parent.id }),
              ...(mode === undefined ? undefined : { mode }),
              origin: originOf(call),
            });
            if (Option.isSome(once) && text !== "") {
              yield* recordRevision({
                taskId: id,
                writer: revisionWriterOf(call),
                userId,
                before: "",
                after: text,
                changes: 1,
                savedBefore: Option.none(),
              });
            }
            return once;
          }),
        ),
      ).pipe(
        // An assignee who is no member of the workspace makes no task, nothing written.
        Effect.catchTag("TaskAssigneeNotMember", () => Effect.succeed(undefined)),
      );
      if (made === undefined) return agentToolRejected(CREATE_TASK_REFUSAL.NOT_MEMBER);
      if (Option.isNone(made)) {
        // A run of the same call made it meanwhile, which this one answers.
        const raced = yield* readTask(userId, id);
        if (Option.isNone(raced)) return agentToolRejected(AGENT_TOOL_REFUSAL.STORE);
        return answer(raced.value.task);
      }
      yield* recordServerEvent(SERVER_EVENT.TASK_CREATE, userId, {
        source: SERVER_TASK_SOURCE.AGENT,
      });
      return answer(made.value);
    }),
  );
}
