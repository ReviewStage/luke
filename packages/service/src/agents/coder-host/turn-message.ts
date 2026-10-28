/**
 * turn-message.ts -- a coding agent's turn message composed, on either runtime: the call's words, the time, the task where it changed, and an operator's desk.
 *
 * What a turn opens with after the history is the same whatever answers the
 * agent's conversation, eve or a native harness: the pieces are
 * `turn-context.ts`'s, and this composes them once, so an agent reads the
 * same words on either runtime. eve's host hands it on at each turn's start
 * (`host.ts`'s `turnMessage`, from the eve app's `turn-message.ts`
 * instructions), with what eve's durable session state has handed; a native
 * harness's sessions hand it ahead of the developer's line in the message
 * written to the runner (`runner-sessions.ts`), with what the conversation's
 * row has handed (`native_handed`, read and written here).
 */

import type { DatabaseServices } from "@luke/database/core/query";
import {
  type Agent,
  readNativeHanded,
  recordNativeHanded,
} from "@luke/database/models/agent-store";
import { turnsBefore } from "@luke/database/models/message-reads";
import { readPlanCommentThreads } from "@luke/database/models/plan-comments";
import { listRevisions } from "@luke/database/models/plan-revisions";
import { readTask } from "@luke/database/models/task-store";
import type { ConversationTarget } from "@luke/database/models/writer";
import { Effect, Option, Result, Schema } from "effect";
import { logStoreFailure } from "../../http/store-failure.js";
import { standingContext } from "../agent-runtime/standing-context.js";
import type { EveHostTurn } from "../eve-host/bounds.js";
import type { AdmittedConversation } from "../eve-host/conversation.js";
import { markDeskNoticesRead, type OperatorDesk, readOperatorDesk } from "../operator-desk.js";
import { isOperator } from "../steward.js";
import {
  contentKey,
  FLUSH_LINE,
  handedAfterCompaction,
  savedByAnotherSince,
  type TurnHanded,
  TurnHandedSchema,
  taskKey,
  taskWithLead,
  timeWithLead,
  turnKindWords,
} from "./turn-context.js";

/** The turn opening: its kind, as its request named it, and its store id. */
export interface CoderTurn {
  readonly kind: EveHostTurn | undefined;
  readonly turnId: string | undefined;
}

/** A turn's own message, where there is one to hand, and what the session has handed once it is. */
export interface CoderTurnMessage {
  readonly text: string | undefined;
  readonly handed: TurnHanded;
}

/** A turn's message composed, with the desk it hands, whose notices are marked read once the message is delivered (`deskHandedRead`). */
export interface ComposedTurnMessage extends CoderTurnMessage {
  readonly desk: OperatorDesk | undefined;
}

/** The newest turns read to find the agent's previous one: the turn opening, where the relay queued it already, and the one before. */
const PREVIOUS_TURN_READ = 2;

const readHanded = Schema.decodeUnknownResult(TurnHandedSchema);
const writeHanded = Schema.encodeUnknownResult(TurnHandedSchema);

/**
 * The operator's desk as its turn opens (`../operator-desk.ts`), its
 * member's open work as it stands; nothing for any other agent, or where
 * a read failed, which is logged, so the turn still opens.
 */
const deskOf = (agent: Agent): Effect.Effect<OperatorDesk | undefined, never, DatabaseServices> =>
  isOperator(agent)
    ? readOperatorDesk(agent).pipe(
        Effect.tapError(logStoreFailure),
        Effect.orElseSucceed(() => undefined),
      )
    : Effect.succeed(undefined);

/**
 * When the agent's turn before the one opening started, or nothing for its
 * first turn: the newest of the conversation's turns but the one named,
 * which the relay may have queued already as this one opens.
 */
const previousTurnStart = (target: ConversationTarget, turnId: string | undefined) =>
  Effect.map(
    turnsBefore(target.userId, target.conversationId, PREVIOUS_TURN_READ, undefined),
    (page) => {
      const previous = page.turns.findLast((turn) => turn.id !== turnId);
      return previous === undefined
        ? undefined
        : (previous.startedAt ?? previous.queuedAt).getTime();
    },
  );

/**
 * The agent's task as the turn's message hands it (`turn-context.ts`), read
 * as the member whose turn this is, and what the session has handed of it
 * once this turn is (`taskKey`), or nothing for an agent on no task or one
 * whose task is gone. The task is handed where a revision of the plan
 * another writer made was saved after the agent's previous turn started,
 * so a save made while that turn ran, which none of its steps may have
 * read, is handed too; or where the rest of it is not what the session
 * last handed; never on a typed first turn, whose first message the plan,
 * or the prompt beside it, already is. A read that fails is logged and
 * hands nothing.
 */
const taskOf = (
  admitted: AdmittedConversation,
  agent: Agent,
  turn: CoderTurn,
  handed: TurnHanded,
  now: number,
) =>
  Effect.gen(function* () {
    const { taskId } = agent;
    if (taskId === null) return undefined;
    const [stored, comments, since] = yield* Effect.all(
      [
        readTask(admitted.caller, taskId),
        readPlanCommentThreads(admitted.caller, taskId),
        previousTurnStart(admitted.target, turn.turnId),
      ],
      { concurrency: "unbounded" },
    );
    if (Option.isNone(stored)) return undefined;
    const threads = Option.getOrElse(comments, () => []);
    const key = taskKey(stored.value, threads);
    const opening = since === undefined;
    const saved =
      since !== undefined &&
      savedByAnotherSince(
        (yield* listRevisions(admitted.caller, taskId)).revisions,
        since,
        agent.id,
      );
    if (!saved && (opening || key === handed.task)) return { key: handed.task, text: undefined };
    const clock = { now, timeZone: admitted.timeZone };
    const text = taskWithLead(standingContext(stored.value, clock, threads));
    return { key, text };
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(undefined)),
  );

/**
 * The message the agent's turn opens with after the history, and what the
 * session has handed once it is: after a spoken turn, the line saying the
 * call's words no longer hold (`turnKindWords`); the
 * developer's time on every turn; the task as it stands where someone other
 * than the agent saved the plan since its previous turn started, or the rest
 * of it is not what the session last handed (`handed`); an operator's desk,
 * its member's open work (`../operator-desk.ts`), where its standing work is
 * not what was last handed or it carries notices of what its member's agents
 * did since, which the caller marks read once the message is delivered
 * (`deskHandedRead`), so a message a runner never took leaves them for the
 * next; and, where the caller says so (`flush`), the line telling an
 * operator to keep what is durable before its history is summarised. A
 * read that fails is logged and leaves its part out, so the turn still
 * opens.
 */
export function coderTurnMessage<R>(
  admitted: AdmittedConversation,
  agent: Agent,
  turn: CoderTurn,
  handed: TurnHanded,
  now: number,
  flush: Effect.Effect<boolean, never, R>,
): Effect.Effect<ComposedTurnMessage, never, DatabaseServices | R> {
  return Effect.gen(function* () {
    const [task, desk, flushed] = yield* Effect.all(
      [taskOf(admitted, agent, turn, handed, now), deskOf(agent), flush],
      { concurrency: "unbounded" },
    );
    const clock = { now, timeZone: admitted.timeZone };
    const standing = task?.text ?? timeWithLead(standingContext(undefined, clock));
    // An operator's desk is handed again only where its standing work changed since the session
    // last handed it, or where it carries notices, which are marked read once delivered.
    const deskKey = desk === undefined ? handed.desk : contentKey(desk.standing);
    const fresh = desk !== undefined && (desk.notices.length > 0 || deskKey !== handed.desk);
    const desked = fresh ? [desk.text] : [];
    const kind = turnKindWords(handed);
    const taskHanded = task === undefined ? handed.task : task.key;
    const next: TurnHanded = {
      ...(taskHanded === undefined ? undefined : { task: taskHanded }),
      ...(deskKey === undefined ? undefined : { desk: deskKey }),
      opened: true,
      ...(flushed || handed.flushTold === true ? { flushTold: true } : undefined),
    };
    const flushLine = flushed ? [FLUSH_LINE] : [];
    const parts = [...(kind === undefined ? [] : [kind]), ...flushLine, standing, ...desked];
    return { text: parts.join("\n\n"), handed: next, desk: fresh ? desk : undefined };
  });
}

/**
 * The notices the message's desk showed marked read, once the message is
 * delivered: as eve's turn starts, or once a native runner took the line.
 * Nothing where the message handed no desk or it showed none; a write that
 * fails is logged, and the notices are handed again on the next turn.
 */
export function deskHandedRead(
  agent: Agent,
  message: ComposedTurnMessage,
): Effect.Effect<void, never, DatabaseServices> {
  const { desk } = message;
  if (desk === undefined || desk.notices.length === 0) return Effect.void;
  return markDeskNoticesRead(agent, desk).pipe(
    Effect.tapError(logStoreFailure),
    Effect.orElseSucceed(() => undefined),
  );
}

/**
 * What a native harness's session has handed, as its conversation's row
 * keeps it (`readNativeHanded`); nothing yet where the row holds none or
 * holds what the schema refuses, and where a read failed, which is logged,
 * since handing the words again costs a repeat and never a turn.
 */
export function readNativeTurnHanded(
  target: ConversationTarget,
): Effect.Effect<TurnHanded, never, DatabaseServices> {
  return readNativeHanded(target).pipe(
    Effect.map((kept) => {
      if (kept === null) return {};
      const read = readHanded(kept);
      return Result.isSuccess(read) ? read.success : {};
    }),
    Effect.tapError(logStoreFailure),
    Effect.orElseSucceed((): TurnHanded => ({})),
  );
}

/**
 * What a native harness's session has handed once a turn's message is,
 * written on its conversation's row for the next message to read. A write
 * that fails is logged, since the message stands, and the next hands the
 * words again.
 */
export function recordNativeTurnHanded(
  target: ConversationTarget,
  handed: TurnHanded,
): Effect.Effect<void, never, DatabaseServices> {
  const written = writeHanded(handed);
  if (Result.isFailure(written)) return Effect.void;
  return recordNativeHanded(target, written.success).pipe(
    Effect.tapError(logStoreFailure),
    Effect.orElseSucceed(() => undefined),
  );
}

/**
 * What a native harness's session has handed once its harness compacted its
 * history (`handedAfterCompaction`), so the next message hands the call's
 * words, the task, and the desk again, as eve's store hook does on eve's
 * compaction.
 */
export function compactNativeTurnHanded(
  target: ConversationTarget,
): Effect.Effect<void, never, DatabaseServices> {
  return Effect.flatMap(readNativeTurnHanded(target), (handed) =>
    recordNativeTurnHanded(target, handedAfterCompaction(handed)),
  );
}
