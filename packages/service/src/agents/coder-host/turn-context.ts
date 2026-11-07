/**
 * turn-context.ts -- what a coding agent's turn opens with as a message of its own: the time, and the task where it changed.
 *
 * The session's prompt (`instructions.ts`) is composed once, as the session
 * starts, and stands for its life, and every tool is offered on every turn,
 * so the system message and the tools that lead every request are the same
 * whatever kind of turn it is. What does
 * change from turn to turn rides as a user-role message of the turn's own,
 * which the harness appends to the history after what came before, ahead
 * of the developer's line (`turn-message.ts`): the provider's prompt cache
 * then holds the system prompt, the tools, and the whole history from one
 * turn to the next.
 *
 * A turn opens with the task as it stands
 * (`../agent-runtime/standing-context.ts`): the developer's time on every
 * turn, and the rest of the task only where it changed since the session
 * last handed it, so the history grows by what is new rather than by the
 * same words every turn.
 */

import { createHash } from "node:crypto";
import type { StoredTask } from "@repo/database/models/task-store";
import type { DescriptionCommentThread } from "@repo/features/description-comment-wire";
import type { DescriptionRevisionLine } from "@repo/features/task-wire";
import { Schema } from "effect";
import { openThreadsText } from "../../tasks/comment-tools.js";

/** The line a turn's message rides behind, by whether it holds the task or the time alone. */
const TURN_MESSAGE_LEAD = {
  TASK: "The task as it stands as this turn opens, handed to you as data because it is new to you or changed since you last read it:",
  TIME: "The time as this turn opens, handed to you as data:",
} as const;

/**
 * What a session has handed its agent in its turns' messages, as content
 * addresses: the task, by the parts of it no save of the description changes
 * (`taskKey`), and whether its last turn was spoken. Kept on the
 * conversation's row (`native_handed`, which `runner-sessions.ts` reads and
 * writes around each message). Nothing yet for a session whose turns handed
 * none, or whose history was compacted since.
 */
export const TurnHandedSchema = Schema.Struct({
  task: Schema.optionalKey(Schema.String),
  /** Whether the session's last turn was spoken, on a call of a build that still took calls, which a compaction leaves standing, so the next turn says the call's words no longer hold. */
  spoken: Schema.optionalKey(Schema.Boolean),
  /** The workspace's experiments the session's instructions and tools were composed on as it opened, which a message arriving after they changed opens a fresh session for (`runner-sessions.ts`); none for a session opened before they were kept, which takes up the ones standing. */
  experiments: Schema.optionalKey(
    Schema.Struct({
      descriptionsOn: Schema.Boolean,
      pilotOn: Schema.Boolean,
      memoryOn: Schema.Boolean,
    }),
  ),
});

export type TurnHanded = typeof TurnHandedSchema.Type;

/** What a session has handed once its history was compacted: only the last turn's kind, since a summary may have dropped the rest, and the experiments it opened on, which a compaction leaves its instructions on. */
export function handedAfterCompaction(handed: TurnHanded): TurnHanded {
  return {
    ...(handed.spoken === true ? { spoken: true } : undefined),
    ...(handed.experiments === undefined ? undefined : { experiments: handed.experiments }),
  };
}

/** A content address: the same text always answers the same key. */
function contentKey(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * The address of what a turn hands of the task beyond its description, as the
 * model reads it: its name, brief, and open comment threads
 * (`openThreadsText`), so a change the model would not see, a resolved
 * thread's own fields, hands the task again no sooner. Note that the saved
 * document and the agents' notes are left out, because every save of the description
 * changes them, the agent's own among them; whether someone
 * else saved is read from the description's revisions (`savedByAnotherSince`). A key
 * handed with Descriptions off is its own, so Descriptions turned on hands the task, its
 * description among it, on the next turn.
 */
export function taskKey(
  stored: StoredTask,
  comments: readonly DescriptionCommentThread[],
  descriptionsOn = true,
): string {
  const { name } = stored.task;
  const handed = [name, stored.brief ?? null, openThreadsText(comments)];
  // Note that a key with Descriptions on reads as it did before Descriptions was gated, so no session hands its task again for it.
  return contentKey(JSON.stringify(descriptionsOn ? handed : [...handed, { descriptionsOn }]));
}

/** The line a turn opens with after a spoken one, whose call's words still stand in the history. */
const TYPED_AFTER_CALL =
  'This turn is typed (nothing you write is heard), so "This turn is spoken" above no longer holds: your words are read, and a question for the developer goes in a thread.';

/**
 * What a turn opens with of its kind: where the session's last turn was
 * spoken, a line saying the call's words in its history no longer hold, and
 * nothing otherwise, since every turn now is typed.
 */
export function turnKindWords(handed: TurnHanded): string | undefined {
  return handed.spoken === true ? TYPED_AFTER_CALL : undefined;
}

/**
 * Whether a revision of the description someone other than the agent wrote was
 * saved after the instant given, the start of the agent's previous turn:
 * a member's, the app's, or another agent's. Note that each revision is read,
 * not who last wrote each section, because the agent writing over a
 * section another just changed leaves the agent its last writer though it
 * never read the change; and that a revision of the agent's own is left
 * out, because it wrote what it saved. The history is read newest first, a
 * page of it, which holds every revision since a turn began unless more than
 * a page of them were saved during it.
 */
export function savedByAnotherSince(
  revisions: readonly DescriptionRevisionLine[],
  since: number,
  agentId: string,
): boolean {
  return revisions.some((revision) => revision.lastEdit.at > since && revision.agentId !== agentId);
}

/** The task as it stands, behind the line saying it is new or changed. */
export function taskWithLead(standing: string): string {
  return `${TURN_MESSAGE_LEAD.TASK}\n${standing}`;
}

/** The time as the turn opens alone, where nothing of the task is new. */
export function timeWithLead(standing: string): string {
  return `${TURN_MESSAGE_LEAD.TIME}\n${standing}`;
}
