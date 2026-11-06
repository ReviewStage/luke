import type { DatabaseServices } from "@repo/database/core/query";
import {
  type Agent,
  readNativeHanded,
  recordNativeHanded,
} from "@repo/database/models/agent-store";
import { turnsBefore } from "@repo/database/models/message-reads";
import { readDescriptionCommentThreads } from "@repo/database/models/description-comments";
import { listRevisions } from "@repo/database/models/description-revisions";
import { readTask } from "@repo/database/models/task-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { Effect, Option, Result, Schema } from "effect";
import { logStoreFailure } from "../../http/store-failure.js";
import { standingContext } from "../agent-runtime/standing-context.js";
import type { EveHostTurn } from "../eve-host/bounds.js";
import type { AdmittedConversation } from "../eve-host/conversation.js";
import { descriptionsOnFor } from "../descriptions-on.js";
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

export interface CoderTurn {
  readonly kind: EveHostTurn | undefined;
  readonly turnId: string | undefined;
}

export interface CoderTurnMessage {
  readonly text: string | undefined;
  readonly handed: TurnHanded;
}

const PREVIOUS_TURN_READ = 2;

const readHanded = Schema.decodeUnknownResult(TurnHandedSchema);
const writeHanded = Schema.encodeUnknownResult(TurnHandedSchema);

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
    const descriptionsOn = yield* descriptionsOnFor(agent.userId, agent.kind);
    const [stored, comments, since] = yield* Effect.all(
      [
        readTask(admitted.caller, taskId),
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
    const unchanged =
      key === handed.task || (!descriptionsOn && taskKey(stored.value, threads) === handed.task);
    if (!saved && (opening || unchanged)) {
      return { key: opening ? handed.task : key, text: undefined };
    }
    const clock = { now, timeZone: admitted.timeZone };
    const text = taskWithLead(standingContext(stored.value, clock, threads, descriptionsOn));
    return { key, text };
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(undefined)),
  );

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

export function compactNativeTurnHanded(
  target: ConversationTarget,
): Effect.Effect<void, never, DatabaseServices> {
  return Effect.flatMap(readNativeTurnHanded(target), (handed) =>
    recordNativeTurnHanded(target, handedAfterCompaction(handed)),
  );
}
