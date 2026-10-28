/**
 * turn-context.ts -- what a coding agent's turn opens with as a message of its own: the time, and the task where it changed.
 *
 * The session's prompt (`instructions.ts`) is composed once, as the session
 * starts, and stands for its life, and every tool is offered on every turn,
 * so the system message and the tools that lead every request are the same
 * whatever kind of turn it is. What does
 * change from turn to turn rides as a user-role message of the turn's own,
 * which eve appends to the history after what came before
 * (`apps/dev/instructions/turn-message.ts`): the provider's prompt cache
 * then holds the system prompt, the tools, and the whole history from one
 * turn to the next.
 *
 * A turn opens with the task as it stands
 * (`../agent-runtime/standing-context.ts`): the developer's time on every
 * turn, and the rest of the task only where it changed since the session
 * last handed it, so the history grows by what is new rather than by the
 * same words every turn. An operator whose history nears eve's compaction is told once, at the next turn's open, to
 * keep what is durable before the summary folds it (`flushDue`), since eve
 * gives the model no step of its own ahead of a compaction.
 */

import { createHash } from "node:crypto";
import type { CodingAgentContextRow } from "@luke/database/models/coding-agent-store";
import type { StoredTask } from "@luke/database/models/task-store";
import type { PlanCommentThread } from "@luke/features/plan-comment-wire";
import type { PlanRevisionLine } from "@luke/features/task-wire";
import { Schema } from "effect";
import { openThreadsText } from "../../tasks/comment-tools.js";
import { CODER } from "./bounds.js";
import { CODER_TOOL } from "./tool-set.js";

/** The line a turn's message rides behind, by whether it holds the task or the time alone. */
const TURN_MESSAGE_LEAD = {
  TASK: "The task as it stands as this turn opens, handed to you as data because it is new to you or changed since you last read it:",
  TIME: "The time as this turn opens, handed to you as data:",
} as const;

/**
 * What a session has handed its agent in its turns' messages, as content
 * addresses: the task, by the parts of it no save of the plan changes
 * (`taskKey`), an operator's desk, and whether its last turn was spoken.
 * Kept in eve's durable session state for an eve session, and on the
 * conversation's row for a native harness's (`native_handed`, which
 * `runner-sessions.ts` reads and writes around each message). Nothing yet
 * for a session whose turns handed none, or whose history was compacted
 * since.
 */
export const TurnHandedSchema = Schema.Struct({
  task: Schema.optionalKey(Schema.String),
  /** The operator's desk as last handed (`../operator-desk.ts`), so one unchanged is not handed again. */
  desk: Schema.optionalKey(Schema.String),
  /** Whether the session's last turn was spoken, on a call of a build that still took calls, which a compaction leaves standing, so the next turn says the call's words no longer hold. */
  spoken: Schema.optionalKey(Schema.Boolean),
  /** Whether a turn of the session has opened since it started or its history was last compacted, so the newest step its row holds was read against this history. */
  opened: Schema.optionalKey(Schema.Boolean),
  /** Whether an operator was told since the last compaction that its history will soon be summarised (`FLUSH_LINE`), so it is told once. */
  flushTold: Schema.optionalKey(Schema.Boolean),
});

export type TurnHanded = typeof TurnHandedSchema.Type;

/** What a session has handed once its history was compacted: only the last turn's kind, since a summary may have dropped the rest. */
export function handedAfterCompaction(handed: TurnHanded): TurnHanded {
  return handed.spoken === true ? { spoken: true } : {};
}

/**
 * What an operator's turn opens with once its history nears eve's
 * compaction: one step to keep what is durable before the summary folds it.
 */
export const FLUSH_LINE = `Your history is nearly full, and soon it will be summarised, which keeps the gist and loses the detail. Before anything else this turn, call \`${CODER_TOOL.REMEMBER}\` for each settled fact or convention this history holds that the workspace's later work needs and that is not kept yet; leave out what \`${CODER_TOOL.RECALL}\` answered, which is kept already. Then go on with the turn.`;

/**
 * Whether an operator's turn opens with `FLUSH_LINE`: the newest step its
 * row holds, read against this session's history since its start or eve's
 * last compaction (`TurnHanded`'s `opened`), ended past the flush mark of
 * the window (`CODER.FLUSH_THRESHOLD_SHARE`), and it has not been told since
 * that compaction. Note that a step older than the row's compaction is
 * none, because it measured the history the summary replaced.
 */
export function flushDue(
  context: CodingAgentContextRow,
  windowTokens: number,
  handed: TurnHanded,
): boolean {
  const step = context.lastStep;
  if (step === null || handed.opened !== true || handed.flushTold === true) return false;
  if (context.compactedAt !== null && context.compactedAt.getTime() >= step.at) return false;
  return step.inputTokens + step.outputTokens >= windowTokens * CODER.FLUSH_THRESHOLD_SHARE;
}

/** A content address: the same text always answers the same key. */
export function contentKey(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * The address of what a turn hands of the task beyond its plan, as the
 * model reads it: its name, brief, and open comment threads
 * (`openThreadsText`), so a change the model would not see, a resolved
 * thread's own fields, hands the task again no sooner. Note that the saved
 * document, the agents' notes, and the sections the developer wrote are left
 * out, because every save of the plan changes them, the agent's own among
 * them; whether someone else saved is read from the plan's revisions
 * (`savedByAnotherSince`).
 */
export function taskKey(stored: StoredTask, comments: readonly PlanCommentThread[]): string {
  const { name } = stored.task;
  return contentKey(JSON.stringify([name, stored.brief ?? null, openThreadsText(comments)]));
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
 * Whether a revision of the plan someone other than the agent wrote was
 * saved after the instant given, the start of the agent's previous turn:
 * a member's, Luke's, or another agent's. Note that each revision is read,
 * not who last wrote each section, because the agent writing over a
 * section another just changed leaves the agent its last writer though it
 * never read the change; and that a revision of the agent's own is left
 * out, because it wrote what it saved. The history is read newest first, a
 * page of it, which holds every revision since a turn began unless more than
 * a page of them were saved during it.
 */
export function savedByAnotherSince(
  revisions: readonly PlanRevisionLine[],
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
