import { LINK_ORIGIN } from "@repo/features/link-home";
import { MENTION_KIND, memberMentionOf } from "@repo/features/mention-link";
import type { TaskSummary } from "@repo/features/task-wire";
import { describeWire } from "@repo/wire/effect";
import { Schema } from "effect";
import { AGENT_TOOL } from "./agent-runtime/tools.js";
import { writtenMention } from "./written-mentions.js";

const MAX_ASSIGNEE_CHARS = 2_000;

const TASK_ASSIGNEE_WORDS =
  "The member the task is assigned to, who is on it now, by their mention link as " +
  `${AGENT_TOOL.LIST_TASKS} or another read names them, ` +
  `\`[@Name](${LINK_ORIGIN}/<workspace>/person/<id>)\`, or its ` +
  "address alone; a member of the task's workspace. null for no one.";

export const memberLinkWrittenSchema = Schema.Trim.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(MAX_ASSIGNEE_CHARS),
);

export const taskAssigneeWrittenSchema = Schema.NullOr(memberLinkWrittenSchema);

export const TASK_ASSIGNEE_INPUT = describeWire(taskAssigneeWrittenSchema, TASK_ASSIGNEE_WORDS);

export function assigneeIdOf(written: string): string | undefined {
  const mention = memberMentionOf(written);
  return mention?.kind === MENTION_KIND.PERSON ? mention.userId : undefined;
}

export function assigneeMentionOf(
  task: Pick<TaskSummary, "assignee">,
  step: string,
): string | null {
  const { assignee } = task;
  if (assignee === undefined) return null;
  return writtenMention(
    { kind: MENTION_KIND.PERSON, userId: assignee.userId },
    assignee.name,
    step,
  );
}
