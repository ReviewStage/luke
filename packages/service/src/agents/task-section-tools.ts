import { createHash } from "node:crypto";
import type { DatabaseServices } from "@luke/database/core/query";
import {
  deleteTaskSectionIn,
  listTaskSections,
  writeTaskSections,
} from "@luke/database/models/task-section-store";
import { readTask, updateTask } from "@luke/database/models/task-store";
import {
  TASK_SECTION_BOUNDS,
  TASK_SECTION_ICON_KIND,
  TASK_SECTION_WRITE,
  type TaskSection,
  type TaskSections,
  taskSectionEmojiSchema,
  taskSectionTitleSchema,
} from "@luke/features/task-section-wire";
import { describeWire } from "@luke/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import {
  ACTION_RESULT_STATUS,
  type UnparsedWireValue,
  type WireRecord,
  wireUuidSchema,
} from "../core.js";
import { AGENT_TOOL } from "./agent-runtime/tools.js";
import {
  agentToolRejected,
  CODING_AGENT_TOOL_REFUSAL,
  type CodingAgentCall,
  callerTask,
  callerUserId,
  callerWorkspace,
  orStoreRefusal,
} from "./coding-agent-tools.js";

/**
 * task-section-tools.ts -- the tools every agent keeps the developer's sidebar by: make a section, delete one, move a task into one or out of them, and archive a task.
 *
 * Luke on a call and every coding agent are offered the same
 * `create_section`, `delete_section`, and `move_task`, one implementation
 * each, beside `list_tasks`, which names each task's section and the
 * sections themselves (`coding-agent-tools.ts`). A section is its maker's
 * own, as the sidebar's are (`@luke/features/task-section-wire`), so each
 * call acts on the sections of the member the caller acts for (Luke's member
 * on the call, or the coding agent's starter), in the caller's own
 * workspace, read on that member's standing now; a section of another
 * workspace, or a task of one, is none of the caller's, even where the
 * member is also in it. Every write is the one the sidebar's own drag or
 * menu makes (`PUT /api/task-sections`, `task-section-store.ts`), under the
 * same lock and bound, so the Mac reads the agent's change as it reads its
 * own. A section is made under an id drawn from eve's key for the call, so
 * a call eve runs again makes the one section; a task moved where it
 * already stands moves nothing; and deleting a section puts its tasks back
 * under Tasks and deletes none of them. `archive_task` archives another
 * task of the workspace by the write the task menu's Archive makes (`PATCH
 * /api/plans/:id`, `task-store.ts`'s `updateTask`): an archive is a stamp on
 * the task's row, so it is the workspace's, and any member brings it back
 * from the archived list. The task the caller works on is refused, as an
 * agent archiving itself is. Every answer is data the model reads, never a
 * credential.
 */

/** Why a call changed nothing, in words the model can act on. */
export const TASK_SECTION_TOOL_REFUSAL = {
  UNREADABLE_CREATE:
    `Not made: give a title of at most ${TASK_SECTION_BOUNDS.MAX_TITLE_CHARS} characters, ` +
    "and an emoji as one emoji or none.",
  UNREADABLE_SECTION: `Not run: name the section by the id ${AGENT_TOOL.LIST_TASKS} answered.`,
  UNREADABLE_MOVE:
    `Not moved: name the task by the id ${AGENT_TOOL.LIST_TASKS} answered, and a section by ` +
    "its id or none.",
  FULL:
    "Not made: the developer you work for already keeps the most sections an account may, " +
    `${TASK_SECTION_BOUNDS.MAX_SECTIONS}; delete one first.`,
  NO_SECTION:
    "Not run: the developer you work for keeps no section of this workspace under that id; " +
    `${AGENT_TOOL.LIST_TASKS} names the sections.`,
  NO_TASK: `Not moved: no task of your workspace has that id; ${AGENT_TOOL.LIST_TASKS} names them.`,
  UNREADABLE_ARCHIVE: `Not archived: name the task by the id ${AGENT_TOOL.LIST_TASKS} answered.`,
  NO_TASK_TO_ARCHIVE: `Not archived: no task of your workspace has that id; ${AGENT_TOOL.LIST_TASKS} names them.`,
  OWN_TASK: "Not archived: that is the task you work on; the developer archives it from its menu.",
  UNAVAILABLE: "Not run: the sections could not be written just now. The call may be made again.",
} as const;

const CREATE_SECTION_INPUT = Schema.Struct({
  title: describeWire(
    taskSectionTitleSchema,
    `The section's title, as the sidebar shows it, at most ${TASK_SECTION_BOUNDS.MAX_TITLE_CHARS} ` +
      "characters.",
  ),
  emoji: Schema.optionalKey(
    describeWire(
      taskSectionEmojiSchema,
      "One emoji the section wears beside its title; leave it out for none.",
    ),
  ),
});

const SECTION_ID = describeWire(
  wireUuidSchema,
  `The section's id, as ${AGENT_TOOL.LIST_TASKS} or ${AGENT_TOOL.CREATE_SECTION} answered it.`,
);

const DELETE_SECTION_INPUT = Schema.Struct({ sectionId: SECTION_ID });

const MOVE_TASK_INPUT = Schema.Struct({
  taskId: describeWire(
    wireUuidSchema,
    `The task to move, by the id ${AGENT_TOOL.LIST_TASKS} answered.`,
  ),
  sectionId: Schema.optionalKey(
    describeWire(
      wireUuidSchema,
      `The section to move it into, as ${AGENT_TOOL.LIST_TASKS} or ${AGENT_TOOL.CREATE_SECTION} ` +
        "answered it; leave it out to take the task out of its section, back under Tasks.",
    ),
  ),
});

const ARCHIVE_TASK_INPUT = Schema.Struct({
  taskId: describeWire(
    wireUuidSchema,
    `The task to archive, by the id ${AGENT_TOOL.LIST_TASKS} answered.`,
  ),
});

const readCreateAsked = Schema.decodeUnknownResult(CREATE_SECTION_INPUT);
const readDeleteAsked = Schema.decodeUnknownResult(DELETE_SECTION_INPUT);
const readMoveAsked = Schema.decodeUnknownResult(MOVE_TASK_INPUT);
const readArchiveAsked = Schema.decodeUnknownResult(ARCHIVE_TASK_INPUT);

/** The tools as Luke and every coding agent are offered them: each its name, its words, and its input schema. */
export const CREATE_SECTION_TOOL = {
  name: AGENT_TOOL.CREATE_SECTION,
  description:
    "Make a section in your workspace's sidebar, for the developer you work for, to keep tasks " +
    "in: it stands in their sidebar alone, as one they made from the sidebar would, with the " +
    `title and the emoji given, and holds no task until ${AGENT_TOOL.MOVE_TASK} moves one in. ` +
    "Make one when the developer asks for it, never on your own. Answers `accepted` with the " +
    "section's id and title, or `rejected` and why.",
  inputSchema: CREATE_SECTION_INPUT,
} as const;

export const DELETE_SECTION_TOOL = {
  name: AGENT_TOOL.DELETE_SECTION,
  description:
    "Delete a section of your workspace's sidebar that the developer you work for keeps, by " +
    `its id as ${AGENT_TOOL.LIST_TASKS} answered it, as their Delete section would: the tasks ` +
    "in it go back under Tasks, and none of them is deleted. Delete one only when the developer " +
    "asks for it. Answers `accepted` with the section's id and title and how many tasks went " +
    "back under Tasks, or `rejected` and why.",
  inputSchema: DELETE_SECTION_INPUT,
} as const;

export const MOVE_TASK_TOOL = {
  name: AGENT_TOOL.MOVE_TASK,
  description:
    "Move a task of your workspace into one of the sidebar sections the developer you work " +
    `for keeps, by the ids ${AGENT_TOOL.LIST_TASKS} answered, as their drag would: it leaves ` +
    "the section it stood in, a task stands in one section at most, and it lands at the top of " +
    "the one named. Leave sectionId out to take it out of its section, back under Tasks. A " +
    "task already where it is asked to go stays as it stands. Move tasks when the developer " +
    "asks you to sort or file them. Answers `accepted` with the task's id and name and the " +
    "section it now stands in (null for none), or `rejected` and why.",
  inputSchema: MOVE_TASK_INPUT,
} as const;

export const ARCHIVE_TASK_TOOL = {
  name: AGENT_TOOL.ARCHIVE_TASK,
  description:
    `Archive another task of your workspace, by its id as ${AGENT_TOOL.LIST_TASKS} answered it, ` +
    "as the developer's Archive would: it leaves the sidebar and every member's task list for " +
    "the archived ones, its plan, agents, and pull requests kept, and any member can unarchive " +
    "it. Archive a task only when the developer asks for it, never on your own, and never the " +
    "task you work on. Answers `accepted` with the task's id and name, also for a task already " +
    "archived, or `rejected` and why.",
  inputSchema: ARCHIVE_TASK_INPUT,
} as const;

/** The UUID's version and variant bits, set as RFC 9562 sets them on a name-based (SHA) id. */
const NAME_BASED_UUID = { VERSION: 0x50, VERSION_MASK: 0x0f, VARIANT: 0x80, VARIANT_MASK: 0x3f };

/**
 * The id a section made by a call is made under: name-based on the member
 * and eve's key for the call, so the call run again names the section it
 * made, and no other account's call names it.
 */
function sectionIdOf(userId: string, clientKey: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([userId, clientKey]))
    .digest();
  digest[6] = ((digest[6] ?? 0) & NAME_BASED_UUID.VERSION_MASK) | NAME_BASED_UUID.VERSION;
  digest[8] = ((digest[8] ?? 0) & NAME_BASED_UUID.VARIANT_MASK) | NAME_BASED_UUID.VARIANT;
  const hex = digest.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/** A section as an answer names it. */
function sectionReading(section: Pick<TaskSection, "id" | "title">) {
  return { id: section.id, title: section.title };
}

/** The member's sections of the workspace, and every entry of theirs that stands in one of them. */
const workspaceSections = (userId: string, workspaceId: string) =>
  Effect.map(listTaskSections(userId), (kept): TaskSections => {
    const sections = kept.sections.filter((section) => section.workspaceId === workspaceId);
    const ids = new Set(sections.map((section) => section.id));
    return { sections, entries: kept.entries.filter((entry) => ids.has(entry.sectionId)) };
  });

/** One call of `create_section`: a section made for the caller's member in the caller's workspace, once under the call's key. */
export function runCreateSection(
  call: CodingAgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  const asked = readCreateAsked(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(TASK_SECTION_TOOL_REFUSAL.UNREADABLE_CREATE));
  }
  const { title, emoji } = asked.success;
  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(call.caller);
      if (Option.isNone(workspace)) {
        return agentToolRejected(CODING_AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      }
      const userId = callerUserId(call.caller);
      const id = sectionIdOf(userId, call.clientKey);
      const written = yield* writeTaskSections(userId, {
        kind: TASK_SECTION_WRITE.CREATE,
        id,
        workspaceId: workspace.value,
        title,
        ...(emoji === undefined
          ? undefined
          : { icon: { kind: TASK_SECTION_ICON_KIND.EMOJI, emoji } }),
      });
      // Note that the member was just read in the workspace, so a create refused is the bound's.
      if (Option.isNone(written)) return agentToolRejected(TASK_SECTION_TOOL_REFUSAL.FULL);
      // A call run again finds the section it made first, which keeps the title it was made with.
      const made = written.value.sections.find((section) => section.id === id);
      if (made === undefined) return agentToolRejected(TASK_SECTION_TOOL_REFUSAL.UNAVAILABLE);
      return { status: ACTION_RESULT_STATUS.ACCEPTED, section: sectionReading(made) };
    }),
  );
}

/** One call of `delete_section`: one of the member's sections of the caller's workspace deleted, its tasks back under Tasks. */
export function runDeleteSection(
  call: CodingAgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  const asked = readDeleteAsked(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(TASK_SECTION_TOOL_REFUSAL.UNREADABLE_SECTION));
  }
  const { sectionId } = asked.success;
  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(call.caller);
      if (Option.isNone(workspace)) {
        return agentToolRejected(CODING_AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      }
      const userId = callerUserId(call.caller);
      // Note that the read, the count, and the delete are one write under the account's lock, so the answer is what this call took.
      const deleted = yield* deleteTaskSectionIn(userId, workspace.value, sectionId);
      if (Option.isNone(deleted)) return agentToolRejected(TASK_SECTION_TOOL_REFUSAL.NO_SECTION);
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        section: sectionReading(deleted.value.section),
        tasksBackUnderTasks: deleted.value.returnedTasks,
      };
    }),
  );
}

/** One call of `move_task`: a task of the caller's workspace put in one of the member's sections there, or in none. */
export function runMoveTask(
  call: CodingAgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  const asked = readMoveAsked(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(TASK_SECTION_TOOL_REFUSAL.UNREADABLE_MOVE));
  }
  const { taskId, sectionId } = asked.success;
  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(call.caller);
      if (Option.isNone(workspace)) {
        return agentToolRejected(CODING_AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      }
      const userId = callerUserId(call.caller);
      const stored = yield* readTask(userId, taskId);
      // A task of another workspace, even one the member is also in, is none of the caller's.
      if (Option.isNone(stored) || stored.value.task.workspaceId !== workspace.value) {
        return agentToolRejected(TASK_SECTION_TOOL_REFUSAL.NO_TASK);
      }
      const kept = yield* workspaceSections(userId, workspace.value);
      const section =
        sectionId === undefined ? undefined : kept.sections.find((each) => each.id === sectionId);
      if (sectionId !== undefined && section === undefined) {
        return agentToolRejected(TASK_SECTION_TOOL_REFUSAL.NO_SECTION);
      }
      const written = yield* writeTaskSections(userId, {
        kind: TASK_SECTION_WRITE.PLACE,
        taskId,
        sectionId: sectionId ?? null,
      });
      if (Option.isNone(written)) return agentToolRejected(TASK_SECTION_TOOL_REFUSAL.UNAVAILABLE);
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        task: { id: taskId, name: stored.value.task.name },
        section: section === undefined ? null : sectionReading(section),
      };
    }),
  );
}

/** One call of `archive_task`: a task of the caller's workspace, other than its own, archived for every member. */
export function runArchiveTask(
  call: CodingAgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  const asked = readArchiveAsked(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(TASK_SECTION_TOOL_REFUSAL.UNREADABLE_ARCHIVE));
  }
  const { taskId } = asked.success;
  if (taskId === callerTask(call.caller)) {
    return Effect.succeed(agentToolRejected(TASK_SECTION_TOOL_REFUSAL.OWN_TASK));
  }
  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(call.caller);
      if (Option.isNone(workspace)) {
        return agentToolRejected(CODING_AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      }
      const userId = callerUserId(call.caller);
      const stored = yield* readTask(userId, taskId);
      // A task of another workspace, even one the member is also in, is none of the caller's.
      if (Option.isNone(stored) || stored.value.task.workspaceId !== workspace.value) {
        return agentToolRejected(TASK_SECTION_TOOL_REFUSAL.NO_TASK_TO_ARCHIVE);
      }
      const archived = yield* updateTask(userId, taskId, { archived: true }).pipe(
        // Note that a change naming only the archive is never refused as archived, so one that is breaks the store's contract.
        Effect.catchTag("TaskArchived", (refused) => Effect.die(refused)),
      );
      if (Option.isNone(archived)) {
        return agentToolRejected(TASK_SECTION_TOOL_REFUSAL.NO_TASK_TO_ARCHIVE);
      }
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        task: { id: taskId, name: archived.value.name },
      };
    }),
  );
}
