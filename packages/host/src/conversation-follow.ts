import { isDeepStrictEqual } from "node:util";
import {
  type PlanConversationLiveAnswer,
  planConversationLiveRowsSchema,
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

/** Every part's rows as Realtime last delivered them: the conversation's mark and the plan's record beside it. */
type PlanLiveRows = typeof planConversationLiveRowsSchema.Type;

/** A part of the plan's record the panel reads again once it moves. */
export type RecordPart = Exclude<keyof PlanLiveRows, "mark">;

const RECORD_PARTS: readonly RecordPart[] = ["calls", "board", "pages"];

/** The conversation's mark and the plan's record before their first rows, as their rows last delivered them, or stopped for good. */
export type ConversationMark =
  | { readonly kind: "waiting" }
  | { readonly kind: "standing"; readonly rows: PlanLiveRows }
  | { readonly kind: "broken" };

export interface ConversationMarkDependencies {
  /** The conversation sealed again, for renewing; a failure where the service sealed none. */
  readonly seal: () => Effect.Effect<PlanConversationLiveAnswer | { readonly failure: string }>;
  readonly openLive: (url: string) => LiveClient;
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
  first: PlanConversationLiveAnswer,
): Effect.Effect<SubscriptionRef.SubscriptionRef<ConversationMark>, never, Scope.Scope> {
  const decode = Schema.decodeUnknownOption(planConversationLiveRowsSchema);
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
          onSome: (decoded) => SubscriptionRef.set(mark, { kind: "standing", rows: decoded }),
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
            (seen.kind !== "standing" || !isDeepStrictEqual(state.rows.mark, seen.rows.mark))),
      ),
      Stream.runHead,
    ),
    // The changes never end while the ref stands, so the head is always one.
    (moved) => Option.getOrElse(moved, () => seen),
  );
}

/** Whether a call about the plan still stands as the rows say: one not closed yet, whose words are the call's own to report. */
export function callStands(rows: PlanLiveRows): boolean {
  return rows.calls.some((call) => call.closedAt === null);
}

/**
 * Each part of the plan's record as it moves, with every part's rows as
 * they then stand: every part at the first rows, since the reads the plan
 * opened with may have missed what they say, and after that each part whose
 * rows differ from the rows before.
 */
export function recordMoves(
  mark: SubscriptionRef.SubscriptionRef<ConversationMark>,
): Stream.Stream<{ readonly part: RecordPart; readonly rows: PlanLiveRows }> {
  return SubscriptionRef.changes(mark).pipe(
    Stream.filter(
      (state): state is Extract<ConversationMark, { readonly kind: "standing" }> =>
        state.kind === "standing",
    ),
    Stream.map((state) => state.rows),
    Stream.mapAccum(
      (): PlanLiveRows | undefined => undefined,
      (before: PlanLiveRows | undefined, rows: PlanLiveRows) =>
        [
          rows,
          RECORD_PARTS.filter(
            (part) => before === undefined || !isDeepStrictEqual(before[part], rows[part]),
          ).map((part) => ({ part, rows })),
        ] as const,
    ),
  );
}
