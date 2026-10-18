import {
  type TaskConversationLiveAnswer,
  taskConversationLiveRowsSchema,
} from "@luke/features/live-wire";
import { Effect, Option, Schema, type Scope, Stream, SubscriptionRef } from "effect";
import { LiveBroken, type LiveClient, liveRows } from "./live-follow.js";

/**
 * conversation-follow.ts -- where a plan's planning conversation stands, held by the host over a Neon Realtime subscription while the plan is open, so its read is asked only once it moved.
 *
 * The service seals the conversation's mark: one row that moves whenever
 * a read past the cursor would answer something new (a journal written, a
 * turn queued or settled, a worker started or ended). The host subscribes
 * to it (`live-follow.ts`) for as long as the read that asked stands, and
 * the read waits on it rather than on a read the service holds open and
 * looks again for on a clock. The sealed statement stays here, beside the
 * account's own bearer.
 */

/** The conversation's mark before its first row, as its row last delivered it, or stopped for good. */
/** Whether two deliveries carry the same rows: decoded JSON under one schema, so their text says it, as the host loads where no `node:` module does. */
function sameRows<Rows>(one: Rows, other: Rows): boolean {
  return JSON.stringify(one) === JSON.stringify(other);
}

export type ConversationMark =
  | { readonly kind: "waiting" }
  | {
      readonly kind: "standing";
      readonly rows: (typeof taskConversationLiveRowsSchema.Type)["mark"];
    }
  | { readonly kind: "broken" };

export interface ConversationMarkDependencies {
  /** The conversation sealed again, for renewing; a failure where the service sealed none. */
  readonly seal: () => Effect.Effect<TaskConversationLiveAnswer | { readonly failure: string }>;
  readonly openLive: (url: string) => LiveClient | PromiseLike<LiveClient>;
  readonly now: () => number;
}

/**
 * The conversation's mark as Realtime delivers it, followed from the first
 * seal for as long as the caller's scope stands; broken for good where the
 * subscription stops or a row does not decode, which the caller answers by
 * holding its read open as before.
 */
export function conversationMark(
  dependencies: ConversationMarkDependencies,
  first: TaskConversationLiveAnswer,
): Effect.Effect<SubscriptionRef.SubscriptionRef<ConversationMark>, never, Scope.Scope> {
  const decode = Schema.decodeUnknownOption(taskConversationLiveRowsSchema);
  return Effect.gen(function* () {
    const mark = yield* SubscriptionRef.make<ConversationMark>({ kind: "waiting" });
    const rows = liveRows(
      { openLive: dependencies.openLive, reseal: dependencies.seal, now: dependencies.now },
      first,
    );
    yield* Effect.forkScoped(
      Stream.runForEach(rows, (read) =>
        Option.match(decode(read), {
          onNone: () => Effect.fail(new LiveBroken({ reason: "a row did not decode" })),
          onSome: (decoded) => SubscriptionRef.set(mark, { kind: "standing", rows: decoded.mark }),
        }),
      ).pipe(Effect.catch(() => SubscriptionRef.set(mark, { kind: "broken" }))),
    );
    return mark;
  });
}

/**
 * The mark once it moves from where it stood as `seen`: a row that differs,
 * or the subscription stopped. A mark seen before its first row is moved
 * by the first, since the read it was seen beside may have missed what that
 * row says.
 */
export function markMoved(
  mark: SubscriptionRef.SubscriptionRef<ConversationMark>,
  seen: ConversationMark,
): Effect.Effect<ConversationMark> {
  return Effect.map(
    SubscriptionRef.changes(mark).pipe(
      Stream.filter(
        (state) =>
          state.kind === "broken" ||
          (state.kind === "standing" &&
            (seen.kind !== "standing" || !sameRows(state.rows, seen.rows))),
      ),
      Stream.runHead,
    ),
    // The changes never end while the ref stands, so the head is always one.
    (moved) => Option.getOrElse(moved, () => seen),
  );
}
