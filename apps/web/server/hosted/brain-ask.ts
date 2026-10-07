import {
  Cause,
  Clock,
  Duration,
  Effect,
  type Schema as EffectSchema,
  Exit,
  Fiber,
  Option,
  Result,
} from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { ASK_ORIGIN, type AskOrigin, TURN_STATUS, type TurnStatus } from "../core.js";
import { BRAIN_HOST_TURN, type BrainHostTurn } from "./brain-host/bounds.js";
import {
  EVE_CANCEL_OUTCOME,
  EVE_FIRST_TURN_ID,
  EVE_SEND_OUTCOME,
  type EveSessions,
} from "./brain-host/eve-sessions.js";
import { hostTurnId } from "./brain-host/ids.js";
import { conversationOwnedBy, recordedRuntimeSession } from "./brain-host/recorded-session.js";
import { HOSTED_HTTP_STATUS } from "./http.js";
import { ASK_DISPATCH_REFUSAL, type AskRecord, type AskRow, type AskVoice } from "./store/asks.js";
import type { HostedStore, StoredTurnRecord } from "./store/index.js";
import type { StoreWriter } from "./store/writer.js";

/**
 * The ask door: a spoken question handed to Luke's judgment, admitted before
 * eve is reached — the conversation it names is the caller's and stands, or
 * it is refused as not found, another account's and none at all answering
 * alike — and then handed to the one eve session the conversation runs in,
 * or the session opened for it. eve folds asks that arrive while a turn runs
 * into the next turn and names no turn at accept time, so the ask stands on
 * its own record from the accept, keyed by the client's id, and the standing
 * read answers that record until eve's `turn.started` names the delivery and
 * the record learns its turn. A retry with the same client id finds the
 * record and dispatches again only where the first dispatch never reached
 * eve: one ask, one delivery. A Stop on a turn eve is running is eve's
 * cancel of that turn, named by the eve turn id the relay wrote on its row at
 * the start; a Stop on an ask still waiting is a stamp on the record,
 * honoured when its turn starts. Every id read here is one `ids.ts` mints.
 *
 * The ask and the standing read answer effects over the ambient SQL client,
 * as the record they are handed does: a caller composes them into the one
 * request it is already running, so it holds one client and one transaction
 * scope over these rows and never two.
 */

const TERMINAL_TURN_STATUSES: ReadonlySet<TurnStatus> = new Set([
  TURN_STATUS.SETTLED,
  TURN_STATUS.CANCELLED,
  TURN_STATUS.FAILED,
]);

/** The kind of turn each ask origin opens, as the header eve's door reads names it. */
const HOST_TURN_OF_ASK_ORIGIN = {
  [ASK_ORIGIN.TYPED]: BRAIN_HOST_TURN.TYPED,
  [ASK_ORIGIN.SPOKEN]: BRAIN_HOST_TURN.SPOKEN,
} as const satisfies Record<AskOrigin, BrainHostTurn>;

/** Where an id stands: the ask it named, where it was an ask's id, and the turn eve started for it, where one has started. */
type AskStanding =
  | {
      /** The ask the id named, where it was an ask's id; a turn's own id names no ask. */
      readonly ask: AskRow | undefined;
      readonly turn: StoredTurnRecord;
    }
  | {
      readonly ask: AskRow;
      /** An ask eve has not started a turn for stands on its own record alone. */
      readonly turn: undefined;
    };

/** What the standing read needs: the turn rows, the runner the conversation's standing is read on, and the ask record. */
export interface AskStandingReads {
  readonly store: Pick<HostedStore, "turns">;
  readonly asks: Pick<AskRecord, "named">;
}

/**
 * Where the id stands: a turn row the account holds over a standing
 * conversation, or an ask the account holds whose conversation stands, read
 * through to its turn where one has started. Anything else is not found,
 * another account's and none at all alike. The voice function keys an
 * exchange by the ask's id, so it reads the standing here until the turn's
 * own id is set and projects the turn's events from there.
 */
export const askStanding = /* @__PURE__ */ Effect.fn("web/askStanding")(function* (
  reads: AskStandingReads,
  userId: string,
  id: string,
): Effect.fn.Return<
  AskStanding | undefined,
  SqlError | EffectSchema.SchemaError,
  SqlClient.SqlClient
> {
  const [turn] = yield* reads.store.turns.named(userId, [id]);
  if (turn) return { ask: undefined, turn };
  const ask = yield* reads.asks.named(userId, id);
  if (!ask || !(yield* conversationOwnedBy(userId, ask.conversationId))) {
    return undefined;
  }
  if (ask.turnId !== undefined) {
    const [started] = yield* reads.store.turns.named(userId, [ask.turnId]);
    if (started) return { ask, turn: started };
  }
  return { ask, turn: undefined };
});

/**
 * Why an ask was not accepted: the conversation is not the caller's or does
 * not stand; eve did not take the dispatch; or the store could not write the
 * ask down, which is the store's own failure and not the caller's.
 */
export const ASK_REFUSAL = {
  NOT_FOUND: "not_found",
  UPSTREAM: "upstream",
  STORE: "store",
} as const;

/** Why `acceptAsk` did not accept an ask, with eve's status where eve refused it. */
type AskRefused =
  | { readonly refusal: typeof ASK_REFUSAL.NOT_FOUND }
  | { readonly refusal: typeof ASK_REFUSAL.UPSTREAM; readonly status: number };

/** What an accepted ask answers: the id the caller follows this ask by, the conversation it runs in, and when it was taken. */
interface AcceptedAsk {
  readonly id: string;
  readonly conversationId: string;
  readonly queuedAt: number;
}

type AskOutcome = Result.Result<AcceptedAsk, AskRefused>;

/**
 * An ask as a caller that has already resolved the account hands it over:
 * the question, the origin it opens a turn under, the client's own id, which
 * is the idempotency key — the same id on the same conversation is the same
 * ask, answered again and dispatched once — the conversation it lands in,
 * and, for a spoken one, the voice session it came from.
 */
export interface AskInput {
  readonly userId: string;
  readonly question: string;
  readonly origin: AskOrigin;
  readonly clientId: string;
  readonly conversationId: string;
  readonly voice?: AskVoice;
}

/** What accepting an ask needs: the ask record built over the store's runner, and eve as the caller reaches it. */
export interface AskSeams {
  readonly asks: AskRecord;
  /** eve as the voice function reaches it: the deployment acting for the account. */
  readonly eve: EveSessions;
}

/**
 * How long one dispatch may run, eve's answer and the write of it together.
 * eve's accept queues the message and runs no turn, so it answers in well
 * under a second; one that has not answered in thirty is not going to, and a
 * caller that went meanwhile (a voice socket detaching) holds its function
 * open no longer than this, far inside the voice function's 800-second cap.
 */
export const ASK_DISPATCH_DEADLINE = Duration.seconds(30);

/**
 * The dispatch run to its end whoever stops waiting for it, up to the
 * deadline: forked detached and joined inside an uninterruptible region, so
 * a caller interrupted meanwhile waits for the write of what eve answered
 * rather than rolling it back with eve's turn already running, and no ask
 * is ever left unbound to a turn eve took. The deadline interrupts the
 * dispatch itself, which rolls back as an interrupted caller did before:
 * answered as nothing, the ask stands unbound and the caller refuses it.
 */
function dispatchedWithinDeadline<A, E, R>(
  dispatch: Effect.Effect<A, E, R>,
): Effect.Effect<Option.Option<A>, E, R> {
  return Effect.uninterruptible(
    Effect.gen(function* () {
      const running = yield* Effect.forkDetach(dispatch);
      const deadline = yield* Effect.forkDetach(
        Effect.andThen(Effect.sleep(ASK_DISPATCH_DEADLINE), Fiber.interrupt(running)),
      );
      const exit = yield* Fiber.await(running);
      yield* Fiber.interrupt(deadline);
      if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) return Option.none();
      return Option.some(yield* exit);
    }),
  );
}

/** An eve the client never reached reads as a refusal carrying the gateway's own status, since eve named none. */
const unreachableSend = () =>
  Effect.succeed({ outcome: EVE_SEND_OUTCOME.FAILED, status: HOSTED_HTTP_STATUS.BAD_GATEWAY });

/**
 * Accepts one ask over plain arguments: the conversation is the caller's and
 * stands; the ask is recorded once per client id; and where eve has not yet
 * taken it, it is handed to the session the conversation runs in, or the
 * session opened for it. A retry with the same client id finds the record
 * and dispatches again only where the first dispatch never reached eve.
 */
export const acceptAsk = /* @__PURE__ */ Effect.fn("web/acceptAsk")(function* (
  seams: AskSeams,
  input: AskInput,
): Effect.fn.Return<AskOutcome, SqlError | EffectSchema.SchemaError, SqlClient.SqlClient> {
  const { userId, question, origin, clientId, conversationId } = input;
  const now = new Date(yield* Clock.currentTimeMillis);
  if (!(yield* conversationOwnedBy(userId, conversationId))) {
    return Result.fail({ refusal: ASK_REFUSAL.NOT_FOUND });
  }

  const ask = yield* seams.asks.record({
    userId,
    conversationId,
    clientId,
    origin,
    createdAt: now,
    ...(input.voice === undefined ? undefined : { voice: input.voice }),
  });
  const accepted: AskOutcome = Result.succeed({
    id: ask.id,
    conversationId,
    queuedAt: ask.createdAt.getTime(),
  });
  if (ask.sessionId !== undefined) return accepted;
  const message = { conversationId, turn: HOST_TURN_OF_ASK_ORIGIN[origin], message: question };

  // The dispatch runs under the conversation's lock, so one dispatch at a time runs in a
  // conversation: of two retries for one client id the second finds the session written and
  // hands eve nothing, and of two first asks the second reads the session the first opened and
  // sends into it rather than opening a second the forward-only claim would lose. A Clear that
  // lands between the admission above and this lock finds no conversation to dispatch in, and the
  // ask is refused as not found rather than dispatched into a conversation the account has cleared.
  // An eve that could not be reached is the same refusal as one that answered outside its shape,
  // with the gateway's own status for the operator: the row is left standing for a retry, and the
  // transaction the dispatch runs in commits nothing for it, as it commits nothing for a refusal.
  // Note that the dispatch cannot be interrupted, because eve takes the message before the row
  // records what eve answered: a caller that went in between (a voice socket detaching) would roll
  // the record back with eve's turn already running, and no turn would ever be bound to the ask.
  // A dispatch past its deadline is refused as an eve that could not be reached is, the row left
  // standing for a retry.
  let failed: AskOutcome | undefined;
  const dispatch = seams.asks.dispatchOnce(
    { userId, conversationId },
    ask.id,
    Effect.fnUntraced(function* (sessionId) {
      if (sessionId !== undefined) {
        const sent = yield* seams.eve
          .send(sessionId, message)
          .pipe(Effect.catchTag("EveUnreachable", unreachableSend));
        if (sent.outcome === EVE_SEND_OUTCOME.ACCEPTED) {
          return { sessionId: sent.sessionId, deliveryId: sent.deliveryId };
        }
        if (sent.outcome === EVE_SEND_OUTCOME.FAILED) {
          failed = Result.fail({ refusal: ASK_REFUSAL.UPSTREAM, status: sent.status });
          return undefined;
        }
      }
      const opened = yield* seams.eve
        .open(message)
        .pipe(Effect.catchTag("EveUnreachable", unreachableSend));
      if (opened.outcome === EVE_SEND_OUTCOME.FAILED) {
        failed = Result.fail({ refusal: ASK_REFUSAL.UPSTREAM, status: opened.status });
        return undefined;
      }
      return {
        sessionId: opened.sessionId,
        turnId: hostTurnId(opened.sessionId, EVE_FIRST_TURN_ID),
      };
    }),
  );
  const within = yield* dispatchedWithinDeadline(dispatch);
  if (Option.isNone(within)) {
    return Result.fail({ refusal: ASK_REFUSAL.UPSTREAM, status: HOSTED_HTTP_STATUS.BAD_GATEWAY });
  }
  const dispatched = within.value;
  if (dispatched === ASK_DISPATCH_REFUSAL.NO_CONVERSATION) {
    return Result.fail({ refusal: ASK_REFUSAL.NOT_FOUND });
  }
  return failed ?? accepted;
});

/** Why a Stop was not carried: nothing of the caller's stands under the id, no session runs the turn, or eve did not take the cancel. */
export const STOP_REFUSAL = {
  NOT_FOUND: "not_found",
  NOT_RUNNING: "not_running",
  UPSTREAM: "upstream",
} as const;

/** Why a Stop did not land, with eve's status where eve refused it. */
type StopRefused =
  | { readonly refusal: typeof STOP_REFUSAL.NOT_FOUND }
  | { readonly refusal: typeof STOP_REFUSAL.NOT_RUNNING }
  | { readonly refusal: typeof STOP_REFUSAL.UPSTREAM; readonly status: number };

/** Where a Stop left the turn: its status, and when its cancel was asked where one stands. */
interface StopAnswer {
  readonly status: TurnStatus;
  readonly cancelRequestedAt?: number;
}

export type StopOutcome = Result.Result<StopAnswer, StopRefused>;

/** What a Stop needs: the standing reads, the record's stamp, the writer's stamp, and eve as the caller reaches it. */
interface StopSeams extends AskStandingReads {
  readonly asks: Pick<AskRecord, "named" | "cancelRequested">;
  readonly writer: Pick<StoreWriter, "requestTurnCancel">;
  readonly eve: EveSessions;
}

/** A turn as a Stop answers it: its status, and the stamp it carries where one stands. */
function turnStop(turn: StoredTurnRecord): StopAnswer {
  return {
    status: turn.status,
    ...(turn.cancelRequestedAt
      ? { cancelRequestedAt: turn.cancelRequestedAt.getTime() }
      : undefined),
  };
}

/**
 * Stops one ask over plain arguments. A turn already settled is answered as
 * it stands and nothing is asked of eve. An ask eve has not yet started a
 * turn for takes the stamp on its record, for the start that names its
 * delivery to honour. A turn under way is eve's cancel scoped to that turn,
 * by the eve turn id its row carries, and then the stamp on the row; a
 * conversation that records no session has nothing running to stop and is
 * refused as such. A row that names no eve turn was written ahead of eve's
 * start: eve runs nothing this build can name under it, so the Stop is the
 * stamp alone and eve is asked nothing.
 */
export const stopAsk = /* @__PURE__ */ Effect.fn("web/stopAsk")(function* (
  seams: StopSeams,
  userId: string,
  id: string,
): Effect.fn.Return<StopOutcome, SqlError | EffectSchema.SchemaError, SqlClient.SqlClient> {
  const standing = yield* askStanding(seams, userId, id);
  if (standing === undefined) return Result.fail({ refusal: STOP_REFUSAL.NOT_FOUND });
  const at = new Date(yield* Clock.currentTimeMillis);
  let turn: StoredTurnRecord;
  if (standing.turn === undefined) {
    yield* seams.asks.cancelRequested(standing.ask.id, at);
    // The stamp and the start's binding are two writes with no lock between them, so the ask is
    // read again once the stamp stands: a start that bound it meanwhile has read the row before
    // the stamp and carries nothing, and the Stop is then eve's cancel of that turn from here. A
    // start that binds it after this read finds the stamp and carries it. Either order stops the
    // turn once; neither leaves a turn running that its client was told is stopped.
    const stampedAt = standing.ask.cancelRequestedAt ?? at;
    const stampedAnswer: StopOutcome = Result.succeed({
      status: TURN_STATUS.QUEUED,
      cancelRequestedAt: stampedAt.getTime(),
    });
    const bound = yield* seams.asks.named(userId, standing.ask.id);
    if (bound?.turnId === undefined) return stampedAnswer;
    const [started] = yield* seams.store.turns.named(userId, [bound.turnId]);
    if (started === undefined) return stampedAnswer;
    turn = started;
  } else {
    turn = standing.turn;
  }
  // A turn already settled, or already carrying a Stop (the start's honour, or an earlier Stop),
  // is answered as it stands: a stamp that stands is the one cancel this turn gets.
  if (TERMINAL_TURN_STATUSES.has(turn.status) || turn.cancelRequestedAt) {
    return Result.succeed(turnStop(turn));
  }
  const target = { userId, conversationId: turn.conversationId };
  const sessionId = yield* recordedRuntimeSession(target);
  if (sessionId === undefined) return Result.fail({ refusal: STOP_REFUSAL.NOT_RUNNING });
  // The cancel names the turn the row was written for and never the session's turn under way:
  // a turn that ends between the read above and eve's answer is answered `no_active_turn`, and
  // the turn queued after it, now the one under way, is left running.
  if (turn.eveTurnId !== null) {
    const eveTurnId = turn.eveTurnId;
    const cancelled = yield* seams.eve.cancel(sessionId, eveTurnId).pipe(
      Effect.catchTag("EveUnreachable", () =>
        Effect.succeed({
          outcome: EVE_CANCEL_OUTCOME.FAILED,
          status: HOSTED_HTTP_STATUS.BAD_GATEWAY,
        }),
      ),
    );
    if (cancelled.outcome === EVE_CANCEL_OUTCOME.FAILED) {
      return Result.fail({ refusal: STOP_REFUSAL.UPSTREAM, status: cancelled.status });
    }
  }
  const stamped = yield* seams.writer.requestTurnCancel(target, { turnId: turn.id, at });
  if (Result.isFailure(stamped)) return Result.fail({ refusal: STOP_REFUSAL.NOT_FOUND });
  return Result.succeed({ status: turn.status, cancelRequestedAt: at.getTime() });
});
