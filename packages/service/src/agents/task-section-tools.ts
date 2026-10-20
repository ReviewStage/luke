import type { DatabaseServices } from "@luke/database/core/query";
import { deleteTaskSectionIn, writeTaskSections } from "@luke/database/models/task-section-store";
import {
  TASK_SECTION_BOUNDS,
  TASK_SECTION_ICON_KIND,
  TASK_SECTION_WRITE,
  type TaskSection,
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
import { calledId } from "./called-id.js";
import {
  agentToolRejected,
  CODING_AGENT_TOOL_REFUSAL,
  type CodingAgentCall,
  callerUserId,
  callerWorkspace,
  orStoreRefusal,
} from "./coding-agent-tools.js";

/**
 * task-section-tools.ts -- the tools every agent keeps the developer's sidebar sections by: make one, and delete one.
 *
 * Luke on a call and every coding agent are offered the same
 * `create_section` and `delete_section`, one implementation each, beside
 * `list_tasks`, which names each task's section and the sections themselves,
 * and `update_task`, whose `sectionId` moves a task into one or out of them
 * (`coding-agent-tools.ts`). A section is its maker's
 * own, as the sidebar's are (`@luke/features/task-section-wire`), so each
 * call acts on the sections of the member the caller acts for (Luke's member
 * on the call, or the coding agent's starter), in the caller's own
 * workspace, read on that member's standing now; a section of another
 * workspace is none of the caller's, even where the member is also in it. Every write is the one the sidebar's own drag or
 * menu makes (`PUT /api/task-sections`, `task-section-store.ts`), under the
 * same lock and bound, so the Mac reads the agent's change as it reads its
 * own. A section is made under an id drawn from eve's key for the call, so
 * a call eve runs again makes the one section; and deleting a section puts its tasks back
 * under Tasks and deletes none of them. Every answer is data the model
 * reads, never a credential.
 */

/** Why a call changed nothing, in words the model can act on. */
export const TASK_SECTION_TOOL_REFUSAL = {
  UNREADABLE_CREATE:
    `Not made: give a title of at most ${TASK_SECTION_BOUNDS.MAX_TITLE_CHARS} characters, ` +
    "and an emoji as one emoji or none.",
  UNREADABLE_SECTION: `Not run: name the section by the id ${AGENT_TOOL.LIST_TASKS} answered.`,
  FULL:
    "Not made: the developer you work for already keeps the most sections an account may, " +
    `${TASK_SECTION_BOUNDS.MAX_SECTIONS}; delete one first.`,
  NO_SECTION:
    "Not run: the developer you work for keeps no section of this workspace under that id; " +
    `${AGENT_TOOL.LIST_TASKS} names the sections.`,
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

const readCreateAsked = Schema.decodeUnknownResult(CREATE_SECTION_INPUT);
const readDeleteAsked = Schema.decodeUnknownResult(DELETE_SECTION_INPUT);

/** The tools as Luke and every coding agent are offered them: each its name, its words, and its input schema. */
export const CREATE_SECTION_TOOL = {
  name: AGENT_TOOL.CREATE_SECTION,
  description:
    "Make a section in your workspace's sidebar, for the developer you work for, to keep tasks " +
    "in: it stands in their sidebar alone, as one they made from the sidebar would, with the " +
    `title and the emoji given, and holds no task until ${AGENT_TOOL.UPDATE_TASK}'s sectionId moves one in. ` +
    "Make one when the developer asks for it, or to keep together the tasks you make for one " +
    "piece of work that stands apart from yours; never otherwise on your own. Answers `accepted` with the " +
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

/** A section as an answer names it. */
function sectionReading(section: Pick<TaskSection, "id" | "title">) {
  return { id: section.id, title: section.title };
}

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
      const id = calledId(userId, call.clientKey);
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
