/**
 * turn-message.ts -- a coding agent's turn message composed, on either harness: the call's words, the time, and the task where it changed.
 *
 * What a turn opens with after the history is the same whichever native
 * harness answers the agent's conversation: the pieces are
 * `turn-context.ts`'s, and this composes them once, so an agent reads the
 * same words on either harness. A harness's sessions hand it ahead of the
 * developer's line in the message
 * written to the runner (`runner-sessions.ts`), with what the conversation's
 * row has handed (`native_handed`, read and written here).
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  type Agent,
  readNativeHanded,
  recordNativeHanded,
} from "@repo/database/models/agent-store";
import { readDescriptionCommentThreads } from "@repo/database/models/description-comments";
import { listRevisions } from "@repo/database/models/description-revisions";
import { turnsBefore } from "@repo/database/models/message-reads";
import { readTask } from "@repo/database/models/task-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { EXPERIMENT } from "@repo/settings";
import { Effect, Option, Result, Schema } from "effect";
import { logStoreFailure } from "../../http/store-failure.js";
import { standingContext } from "../agent-runtime/standing-context.js";
import type { EveHostTurn } from "../eve-host/bounds.js";
import type { AdmittedConversation } from "../eve-host/conversation.js";
import { experimentOnSinceIn } from "../workspace-experiment-on.js";
import {
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

/** The newest turns read to find the agent's previous one: the turn opening, where the relay queued it already, and the one before. */
const PREVIOUS_TURN_READ = 2;

const readHanded = Schema.decodeUnknownResult(TurnHandedSchema);
const writeHanded = Schema.encodeUnknownResult(TurnHandedSchema);

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
 * whose task is gone. The task is handed where a revision of the description
 * another writer made was saved after the agent's previous turn started,
 * so a save made while that turn ran, which none of its steps may have
 * read, is handed too; or where the rest of it is not what the session
 * last handed; never on a first turn, whose first message the description, or the
 * prompt beside it, already is. Where the agent's workspace has Task descriptions off, no
 * save of the description hands it, and it is handed without the description
 * (`standingContext`). A read that fails is logged and
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
    const descriptionsSince = yield* experimentOnSinceIn(
      agent.organizationId,
      EXPERIMENT.DESCRIPTIONS,
    );
    const descriptionsOn = Option.isSome(descriptionsSince);
    const [stored, comments, since] = yield* Effect.all(
      [
        readTask(admitted.caller, taskId),
        // Note that the description's threads are neither read nor handed where its workspace has Task descriptions off.
        descriptionsOn
          ? readDescriptionCommentThreads(admitted.caller, taskId)
          : Effect.succeedNone,
        previousTurnStart(admitted.target, turn.turnId),
      ],
      { concurrency: "unbounded" },
    );
    if (Option.isNone(stored)) return undefined;
    const threads = Option.getOrElse(comments, () => []);
    const key = taskKey(stored.value, threads, descriptionsOn);
    const opening = since === undefined;
    const saved =
      descriptionsOn &&
      since !== undefined &&
      savedByAnotherSince(
        (yield* listRevisions(admitted.caller, taskId)).revisions,
        since,
        agent.id,
      );
    // Note that Descriptions gone off leaves the words handed as they were but the description, so it hands nothing again, and keeps the key Descriptions going back on is told apart by.
    const unchanged =
      key === handed.task || (!descriptionsOn && taskKey(stored.value, threads) === handed.task);
    if (!saved && (opening || unchanged)) {
      return { key: opening ? handed.task : key, text: undefined };
    }
    const clock = { now, timeZone: admitted.timeZone };
    const text = taskWithLead(
      standingContext(
        stored.value,
        clock,
        threads,
        descriptionsOn,
        Option.getOrUndefined(descriptionsSince),
      ),
    );
    return { key, text };
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(undefined)),
  );

/**
 * The message the agent's turn opens with after the history, and what the
 * session has handed once it is: after a spoken turn, the line saying the
 * call's words no longer hold (`turnKindWords`); the developer's time on
 * every turn; and the task where `taskOf` hands it. A read that fails is logged and
 * leaves its part out, so the turn still opens.
 */
export function coderTurnMessage(
  admitted: AdmittedConversation,
  agent: Agent,
  turn: CoderTurn,
  handed: TurnHanded,
  now: number,
): Effect.Effect<CoderTurnMessage, never, DatabaseServices> {
  return Effect.gen(function* () {
    const task = yield* taskOf(admitted, agent, turn, handed, now);
    const clock = { now, timeZone: admitted.timeZone };
    const standing = task?.text ?? timeWithLead(standingContext(undefined, clock));
    const kind = turnKindWords(handed);
    const taskHanded = task === undefined ? handed.task : task.key;
    const next: TurnHanded = {
      ...(taskHanded === undefined ? undefined : { task: taskHanded }),
    };
    const parts = [...(kind === undefined ? [] : [kind]), standing];
    return { text: parts.join("\n\n"), handed: next };
  });
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
 * words and the task again.
 */
export function compactNativeTurnHanded(
  target: ConversationTarget,
): Effect.Effect<void, never, DatabaseServices> {
  return Effect.flatMap(readNativeTurnHanded(target), (handed) =>
    recordNativeTurnHanded(target, handedAfterCompaction(handed)),
  );
}
