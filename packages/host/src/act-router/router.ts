import type { UnparsedWireValue } from "@luke/wire";
import { Data, Effect, Predicate } from "effect";
import {
  ACT_OUTCOME_STATUS,
  type Act,
  type ActKind,
  type ActOutcome,
  type ActPayload,
  type ActResultFor,
  actDeclarationOf,
} from "../acts.js";

/**
 * Who is asking, as the bridge alone can tell: which window sent the act,
 * and which surface that window is drawing. A renderer cannot claim any of it
 * — the standing is read from the windows the bridge's own side opened.
 * `Sender` is the platform's own handle on that window, which nothing here
 * reads: the desktop's is a `WebContents`, for the rows of its own that post
 * to the window or hang a dialog over it.
 */
export interface ActSender<Sender = unknown> {
  sender: Sender;
  /** A panel: Luke's window, which types asks and presses rows. */
  panel: boolean;
  /** The hidden window the conversation lives in, and the one receiver of replies. */
  voice: boolean;
  /** The floating call window, which sends the call's controls and nothing else. */
  call: boolean;
}

/**
 * A row's own refusal, with the sentence the window that asked will draw. A
 * row raises this where the act is admissible but cannot be carried for a
 * reason worth saying; every other throw is answered with the kind's fixed
 * sentence instead, so nothing an exception happened to carry crosses back.
 */
class ActRefused extends Data.TaggedError("ActRefused")<{ readonly message: string }> {}

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
type ActRow<Kind extends ActKind, Sender> = (
  payload: ActPayload<Kind>,
  sender: ActSender<Sender>,
) =>
  | ActResultFor<Kind>
  | Promise<ActResultFor<Kind>>
  | Effect.Effect<ActResultFor<Kind>, ActRowFailure>;

/**
 * Every kind's row, total by construction: a kind added to the vocabulary
 * with no row does not build, which is the whole reason the dispatch is a
 * table rather than a switch.
 */
export type ActRows<Sender = unknown> = { readonly [Kind in ActKind]: ActRow<Kind, Sender> };

export interface ActRouter<Sender = unknown> {
  performAct<Kind extends ActKind>(
    act: Extract<Act, { kind: Kind }>,
    sender: ActSender<Sender>,
  ): Effect.Effect<ActOutcome<Kind>>;
}

/** One act as the dispatch reads it: its kind's name, and the payload it carried. */
interface ActEnvelope {
  readonly kind: string;
  readonly payload?: UnparsedWireValue;
}

/** What an erased row answers: a value, a promise of one, or an effect ending in one or in its refusal. */
type ErasedAnswer =
  | UnparsedWireValue
  | Promise<UnparsedWireValue>
  | Effect.Effect<UnparsedWireValue, ActRowFailure>;

/** The erased row shape the dispatch below calls; the kind's own types are checked by `ActRows`. */
type ErasedRow<Sender> = (payload: UnparsedWireValue, sender: ActSender<Sender>) => ErasedAnswer;

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
 * bridge read it before the act left, and reading it here is what makes
 * the schema the boundary rather than a courtesy a caller on this side could
 * skip; then that kind's row runs, which is where its trust checks live; then
 * the answer is checked against the kind's own guard; and a row that threw is
 * answered with the kind's fixed sentence. Nothing here refuses on a reason of
 * its own, and nothing dispatches on anything but the kind.
 */
export function createActRouter<Sender>(rows: ActRows<Sender>): ActRouter<Sender> {
  function perform(act: ActEnvelope, sender: ActSender<Sender>): Effect.Effect<ActOutcome> {
    const declared = actDeclarationOf(act.kind);
    if (declared === undefined) {
      return Effect.succeed({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
    }
    const sent = act.payload;
    const read = declared.payload.read(sent);
    if (!read.ok) return Effect.succeed(refused(declared.refusal));
    return Effect.gen(function* () {
      // SAFETY: ActRows types every row by its own kind; the erasure is the
      // union index this dispatch is, and the answer is guarded below.
      const answer = yield* thrown(
        Effect.try({
          try: () =>
            (rows as Readonly<Record<string, ErasedRow<Sender>>>)[act.kind]?.(
              read.value as UnparsedWireValue,
              sender,
            ),
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
      // SAFETY: the kind's own guard admitted this value just above.
      return { status: ACT_OUTCOME_STATUS.DONE, value: value as ActResultFor<ActKind> };
    }).pipe(
      // A defect is a bug of this build, so it is reported before it is
      // worded: the window hears the kind's sentence, and Sentry the defect.
      Effect.withErrorReporting({ defectsOnly: true }),
      Effect.catchTag("ActRefused", (error) => Effect.succeed(refused(error.message))),
      // A host the row could not reach, and a row's effect that died, carry
      // no more to the window than a row that threw: the kind's own sentence,
      // and never what the failure or the defect held.
      Effect.catch(() => Effect.succeed(refused(declared.refusal))),
      Effect.catchDefect(() => Effect.succeed(refused(declared.refusal))),
    );
  }

  return {
    performAct: <Kind extends ActKind>(
      act: Extract<Act, { kind: Kind }>,
      sender: ActSender<Sender>,
    ) =>
      // SAFETY: `perform` answers the outcome of the kind it was handed, which
      // is the kind this call named; the dispatch above erases the union, and
      // an act is the structured-clone envelope its own schema admitted.
      perform(act as ActEnvelope, sender) as Effect.Effect<ActOutcome<Kind>>,
  };
}
