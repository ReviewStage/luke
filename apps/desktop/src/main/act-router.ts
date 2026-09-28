import type { UnparsedWireValue } from "@sidecar/wire";
import { Data, Effect, Predicate } from "effect";
import type { WebContents } from "electron";
import {
  ACT,
  ACT_OUTCOME_STATUS,
  type Act,
  type ActKind,
  type ActOutcome,
  type ActPayload,
  type ActResultFor,
} from "#shared/messages/acts";

/**
 * Who is asking, as this process alone can tell: which window sent the act,
 * and which surface that window is drawing. A renderer cannot claim any of it
 * — the standing is read from the windows this process opened and what the
 * document says is running in them.
 */
export interface ActSender {
  sender: WebContents;
  /** A panel: the surface beside the housing, which types asks and presses rows. */
  panel: boolean;
  /** The hidden window the conversation lives in, and the one receiver of replies. */
  voice: boolean;
  /**
   * A panel the one-time introduction is holding, which stands before any
   * account exists. The takeover is a fullscreen mode of the panel, so this
   * is `panel` and the introduction's own standing together.
   */
  introduction: boolean;
}

/**
 * A row's own refusal, with the sentence the window that asked will draw. A
 * row raises this where the act is admissible but cannot be carried for a
 * reason worth saying; every other throw is answered with the kind's fixed
 * sentence instead, so nothing an exception happened to carry crosses back.
 */
export class ActRefused extends Data.TaggedError("ActRefused")<{ readonly message: string }> {}

/**
 * The one failure a row's effect may end in: the row's own refusal, worded.
 * Anything else a row ends in is a defect, and answered with the kind's fixed
 * sentence.
 */
type ActRowFailure = ActRefused;

/**
 * What one kind does. The payload is the one its own schema admitted, and the
 * answer is a value, an effect the router runs on the launch's own runtime, or
 * — for the rows that still reach a service answering promises — a promise.
 */
type ActRow<Kind extends ActKind> = (
  payload: ActPayload<Kind>,
  sender: ActSender,
) =>
  | ActResultFor<Kind>
  | Promise<ActResultFor<Kind>>
  | Effect.Effect<ActResultFor<Kind>, ActRowFailure>;

/**
 * Every kind's row, total by construction: a kind added to the vocabulary
 * with no row does not build, which is the whole reason the dispatch is a
 * table rather than a switch.
 */
export type ActRows = { readonly [Kind in ActKind]: ActRow<Kind> };

export interface ActRouter {
  performAct<Kind extends ActKind>(
    act: Extract<Act, { kind: Kind }>,
    sender: ActSender,
  ): Effect.Effect<ActOutcome<Kind>>;
}

/** Any one kind's payload, which is what the union index below hands a row. */
type AnyActPayload = ActPayload<ActKind>;

/** The erased row shape the dispatch below calls; the kind's own types are checked by `ActRows`. */
type ErasedRow = (payload: AnyActPayload, sender: ActSender) => ReturnType<ActRow<ActKind>>;

function refused(reason: string): ActOutcome {
  return { status: ACT_OUTCOME_STATUS.REFUSED, reason };
}

/**
 * A row's throw, or its promise's rejection, sorted: the row's own refusal is
 * a failure the window hears worded, and anything else is the defect it is.
 */
function thrown<Answer>(
  attempt: Effect.Effect<Answer, unknown>,
): Effect.Effect<Answer, ActRefused> {
  return Effect.catch(attempt, (error) =>
    error instanceof ActRefused ? Effect.fail(error) : Effect.die(error),
  );
}

/**
 * The one place a window's act becomes an effect. Four steps, in this order,
 * for every kind alike: the kind's payload schema is read again — the window's
 * preload read it before the invoke left, and reading it here is what makes
 * the schema the boundary rather than a courtesy a main-process caller could
 * skip; then that kind's row runs, which is where its trust checks live; then
 * the answer is checked against the kind's own guard; and a row that threw is
 * answered with the kind's fixed sentence. Nothing here refuses on a reason of
 * its own, and nothing dispatches on anything but the kind.
 */
export function createActRouter(rows: ActRows): ActRouter {
  function perform(act: Act, sender: ActSender): Effect.Effect<ActOutcome> {
    if (!Object.hasOwn(ACT, act.kind)) {
      return Effect.succeed({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
    }
    const declared = ACT[act.kind];
    // SAFETY: an act's payload is the structured-clone value its own schema
    // admitted, which is what reading it again takes.
    const sent = ("payload" in act ? act.payload : undefined) as UnparsedWireValue;
    const read = declared.payload.read(sent);
    if (!read.ok) return Effect.succeed(refused(declared.refusal));
    return Effect.gen(function* () {
      // SAFETY: ActRows types every row by its own kind; the erasure is the
      // union index this dispatch is, and the answer is guarded below.
      const answer = yield* thrown(
        Effect.try({
          try: () => (rows[act.kind] as ErasedRow)(read.value, sender),
          catch: (error) => error,
        }),
      );
      // A row that answered an effect is run here, on the runtime the bridge
      // handed this router; a promise is awaited, and a value is the answer.
      const value = yield* Effect.isEffect(answer)
        ? answer
        : Predicate.isPromiseLike(answer)
          ? thrown(
              Effect.tryPromise({ try: () => Promise.resolve(answer), catch: (error) => error }),
            )
          : Effect.succeed(answer);
      if (declared.result(value) === false) return refused(declared.refusal);
      return { status: ACT_OUTCOME_STATUS.DONE, value };
    }).pipe(
      Effect.catchTag("ActRefused", (error) => Effect.succeed(refused(error.message))),
      // A host the row could not reach, and a row's effect that died, carry
      // no more to the window than a row that threw: the kind's own sentence,
      // and never what the failure or the defect held.
      Effect.catch(() => Effect.succeed(refused(declared.refusal))),
      Effect.catchDefect(() => Effect.succeed(refused(declared.refusal))),
    );
  }

  return {
    performAct: <Kind extends ActKind>(act: Extract<Act, { kind: Kind }>, sender: ActSender) =>
      // SAFETY: `perform` answers the outcome of the kind it was handed, which
      // is the kind this call named; the dispatch above erases the union.
      perform(act, sender) as Effect.Effect<ActOutcome<Kind>>,
  };
}
