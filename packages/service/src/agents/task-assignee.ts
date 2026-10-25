import { MENTION_KIND, memberMentionOf } from "@luke/features/mention-link";
import type { TaskSummary } from "@luke/features/task-wire";
import { describeWire } from "@luke/wire/effect";
import { Schema } from "effect";
import { AGENT_TOOL } from "./agent-runtime/tools.js";
import { writtenMention } from "./written-mentions.js";

/**
 * task-assignee.ts -- a task's assignee as the agent tools read and write it: a member of the workspace by their mention link, as every other tool names a person.
 *
 * A call names the member a task is assigned to as the reads hand them, by
 * their person link, `[@Ada Lovelace](…/person/<userId>)`,
 * written whole or as its bare address, or null for no one; and every task
 * tool answers the assignee the same way, under the workspace's step as the
 * calling member reads it, so the link a read hands back is the one a call
 * may name.
 */

/** The bound on what a call may write for an assignee: a person's mention link, which is far shorter. */
const MAX_ASSIGNEE_CHARS = 2_000;

/** What a tool tells the model of the assignee it may name. */
const TASK_ASSIGNEE_WORDS =
  "The member the task is assigned to, who is on it now, by their mention link as " +
  `${AGENT_TOOL.LIST_TASKS} or another read names them, ` +
  "`[@Name](https://tryluke.dev/<workspace>/person/<id>)`, or its " +
  "address alone; a member of the task's workspace. null for no one.";

/** An assignee as a call writes one: a person's mention link, or null for no one. */
export const taskAssigneeWrittenSchema = Schema.NullOr(
  Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(MAX_ASSIGNEE_CHARS)),
);

/** An assignee as a change or a make names one, described for the model. */
export const TASK_ASSIGNEE_INPUT = describeWire(taskAssigneeWrittenSchema, TASK_ASSIGNEE_WORDS);

/** The account a call's assignee names: the person a mention link, whole or bare, is of; nothing for words that name no person. */
export function assigneeIdOf(written: string): string | undefined {
  const mention = memberMentionOf(written);
  return mention?.kind === MENTION_KIND.PERSON ? mention.userId : undefined;
}

/** A task's assignee as a tool answers it: their mention link under the workspace's step, or null for no one. */
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
