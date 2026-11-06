import { createHash } from "node:crypto";
import type { StoredTask } from "@repo/database/models/task-store";
import type { DescriptionCommentThread } from "@repo/features/description-comment-wire";
import type { DescriptionRevisionLine } from "@repo/features/task-wire";
import { Schema } from "effect";
import { openThreadsText } from "../../tasks/comment-tools.js";

const TURN_MESSAGE_LEAD = {
  TASK: "The task as it stands as this turn opens, handed to you as data because it is new to you or changed since you last read it:",
  TIME: "The time as this turn opens, handed to you as data:",
} as const;

export const TurnHandedSchema = Schema.Struct({
  task: Schema.optionalKey(Schema.String),
  spoken: Schema.optionalKey(Schema.Boolean),
});

export type TurnHanded = typeof TurnHandedSchema.Type;

export function handedAfterCompaction(handed: TurnHanded): TurnHanded {
  return handed.spoken === true ? { spoken: true } : {};
}

function contentKey(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function taskKey(
  stored: StoredTask,
  comments: readonly DescriptionCommentThread[],
  descriptionsOn = true,
): string {
  const { name } = stored.task;
  const handed = [name, stored.brief ?? null, openThreadsText(comments)];
  return contentKey(JSON.stringify(descriptionsOn ? handed : [...handed, { descriptionsOn }]));
}

const TYPED_AFTER_CALL =
  'This turn is typed (nothing you write is heard), so "This turn is spoken" above no longer holds: your words are read, and a question for the developer goes in a thread.';

export function turnKindWords(handed: TurnHanded): string | undefined {
  return handed.spoken === true ? TYPED_AFTER_CALL : undefined;
}

export function savedByAnotherSince(
  revisions: readonly DescriptionRevisionLine[],
  since: number,
  agentId: string,
): boolean {
  return revisions.some((revision) => revision.lastEdit.at > since && revision.agentId !== agentId);
}

export function taskWithLead(standing: string): string {
  return `${TURN_MESSAGE_LEAD.TASK}\n${standing}`;
}

export function timeWithLead(standing: string): string {
  return `${TURN_MESSAGE_LEAD.TIME}\n${standing}`;
}
