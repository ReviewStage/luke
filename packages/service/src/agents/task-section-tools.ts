import type { DatabaseServices } from "@repo/database/core/query";
import { deleteTaskSectionIn, writeTaskSections } from "@repo/database/models/task-section-store";
import {
  TASK_SECTION_BOUNDS,
  TASK_SECTION_ICON_KIND,
  TASK_SECTION_WRITE,
  type TaskSection,
  taskSectionEmojiSchema,
  taskSectionTitleSchema,
} from "@repo/features/task-section-wire";
import { describeWire } from "@repo/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import {
  ACTION_RESULT_STATUS,
  type UnparsedWireValue,
  type WireRecord,
  wireUuidSchema,
} from "../core.js";
import { AGENT_TOOL } from "./agent-runtime/tools.js";
import {
  AGENT_TOOL_REFUSAL,
  type AgentCall,
  agentToolRejected,
  callerUserId,
  callerWorkspace,
  orStoreRefusal,
} from "./agent-tools.js";
import { calledId } from "./called-id.js";

export const TASK_SECTION_TOOL_REFUSAL = {
  UNREADABLE_CREATE:
    `Not made: give a title of at most ${TASK_SECTION_BOUNDS.MAX_TITLE_CHARS} characters, ` +
    "and an emoji as one emoji or none.",
  UNREADABLE_SECTION: `Not run: name the section by the id ${AGENT_TOOL.LIST_TASKS} answered.`,
  FULL:
    "Not made: the developer you work for already keeps the most sections an account may, " +
    `${TASK_SECTION_BOUNDS.MAX_SECTIONS}; delete one first.`,
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
    "back under Tasks, with section null where no such section stands, as one already " +
    "deleted, or `rejected` and why.",
  inputSchema: DELETE_SECTION_INPUT,
} as const;

function sectionReading(section: Pick<TaskSection, "id" | "title">) {
  return { id: section.id, title: section.title };
}

export function runCreateSection(
  call: AgentCall,
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
        return agentToolRejected(AGENT_TOOL_REFUSAL.NO_WORKSPACE);
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
      if (Option.isNone(written)) return agentToolRejected(TASK_SECTION_TOOL_REFUSAL.FULL);
      const made = written.value.sections.find((section) => section.id === id);
      if (made === undefined) return agentToolRejected(TASK_SECTION_TOOL_REFUSAL.UNAVAILABLE);
      return { status: ACTION_RESULT_STATUS.ACCEPTED, section: sectionReading(made) };
    }),
  );
}

export const NO_SECTION_DELETED = {
  status: ACTION_RESULT_STATUS.ACCEPTED,
  section: null,
  tasksBackUnderTasks: 0,
} as const;

export function runDeleteSection(
  call: AgentCall,
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
        return agentToolRejected(AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      }
      const userId = callerUserId(call.caller);
      const deleted = yield* deleteTaskSectionIn(userId, workspace.value, sectionId);
      if (Option.isNone(deleted)) return { ...NO_SECTION_DELETED };
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        section: sectionReading(deleted.value.section),
        tasksBackUnderTasks: deleted.value.returnedTasks,
      };
    }),
  );
}
