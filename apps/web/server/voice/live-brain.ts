import {
  LIVE_BRAIN_RUN_END,
  LIVE_BRAIN_RUN_EVENT,
  LIVE_BRAIN_SUBMISSION,
  type LiveBrain,
  type LiveBrainRunEnd,
  type LiveBrainRunEvent,
} from "@sidecar/voice/live-session";
import { Cause, Duration, Effect, Schedule, type Scope } from "effect";
import { SqlClient } from "effect/unstable/sql";
import {
  ASK_ORIGIN,
  TURN_END,
  TURN_EVENT_KIND,
  type TurnEnd,
  type TurnEvent,
  type TurnEventKind,
} from "../core.js";
import {
  ASK_REFUSAL,
  type AskInput,
  type AskSeams,
  type AskStandingReads,
  acceptAsk,
  askStanding,
} from "../hosted/brain-ask.js";
import { CATALOG_TOOL_SET } from "../hosted/brain-tool-set.js";
import type { HostedStore } from "../hosted/store/index.js";
import { projectTurnEvents } from "../hosted/turn-event-stream.js";

/**
 * The hosted implementation of the live brain: Luke's judgment reached in
 * process, never over HTTP. The voice function resolved the account at its
 * handshake and dropped the bearer there, so it holds nothing eve's door or
 * this deployment's own routes would take; what it holds is the ask door
 * itself — `acceptAsk`, the same function the ask route is a thin adapter
 * over — and the store, so a spoken ask is admitted, recorded, and handed to
 * eve exactly as a typed one is, under the eve client the composition built
 * for the account. A turn's events are the same projection C7's stream
 * serves, `projectTurnEvents` over the turn row and its journal, read again
 * on a schedule until the turn ends; there is no HTTP hop and so no second
 * function ceiling to re-attach across. The run the service keys an exchange
 * by is the ask's own id, since eve names the turn only once it starts, and
 * every event is translated back to it. On the eve path the reply arrives
 * whole at the turn's end; what the stream carries mid-turn is the slow step
 * and the actions settling, which is what the voice speaks meanwhile.
 *
 * The brain is built in the socket's own scope and every follow an accepted
 * ask starts is a fiber in it, so the socket detaching interrupts each of
 * them and nothing is emitted after; the submission `LiveBrain` declares is
 * an effect of the caller's own fiber, with the `SqlClient` the scope was
 * built on provided to it where the ask door asks for one, exactly as
 * `runTool` provides it to the brain's seams.
 */

const LIVE_BRAIN_FOLLOW_BOUNDS = {
  /** How often the record is read again while an ask's turn runs: the measured step boundary hosted is about 300 ms. */
  POLL_MS: 250,
  /** How long an ask is followed before it is given up as failed: past eve's own turn deadline, with room for one queued turn ahead of it. */
  FOLLOW_MS: 10 * 60_000,
} as const;

type FollowBounds = Readonly<Record<keyof typeof LIVE_BRAIN_FOLLOW_BOUNDS, number>>;

/**
 * What is said aloud for an ask the door refused, fixed by the build and
 * never composed with the ask: the conversation was not the account's or is
 * gone, eve could not be reached, or the store could not open the account's
 * first main.
 */
export const HOSTED_ASK_REFUSAL_NOTE = {
  [ASK_REFUSAL.NOT_FOUND]:
    "I couldn't find the conversation for that ask, so I'm not going to answer it here.",
  [ASK_REFUSAL.UPSTREAM]:
    "I couldn't reach my judgment just now, so I'm not going to answer that here.",
  [ASK_REFUSAL.STORE]: "I couldn't write that ask down, so I'm not going to answer it here.",
} as const satisfies Record<(typeof ASK_REFUSAL)[keyof typeof ASK_REFUSAL], string>;

/** The stream's four kinds in the service's vocabulary; one word each, held equal by a test. */
const RUN_EVENT_OF_TURN_EVENT = {
  [TURN_EVENT_KIND.SLOW_STEP]: LIVE_BRAIN_RUN_EVENT.SLOW_STEP,
  [TURN_EVENT_KIND.ACTIONS_SETTLED]: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED,
  [TURN_EVENT_KIND.REPLY_SENTENCE]: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
  [TURN_EVENT_KIND.ENDED]: LIVE_BRAIN_RUN_EVENT.ENDED,
} as const satisfies Record<TurnEventKind, LiveBrainRunEvent["kind"]>;

const RUN_END_OF_TURN_END = {
  [TURN_END.COMPLETED]: LIVE_BRAIN_RUN_END.COMPLETED,
  [TURN_END.CANCELLED]: LIVE_BRAIN_RUN_END.CANCELLED,
  [TURN_END.FAILED]: LIVE_BRAIN_RUN_END.FAILED,
} as const satisfies Record<TurnEnd, LiveBrainRunEnd>;

/** The stream's event as the service hears it, under the ask's id rather than the turn's. */
function runEventOf(event: TurnEvent, runId: string): LiveBrainRunEvent {
  switch (event.kind) {
    case TURN_EVENT_KIND.SLOW_STEP:
      return { kind: RUN_EVENT_OF_TURN_EVENT[event.kind], runId, step: event.step };
    case TURN_EVENT_KIND.ACTIONS_SETTLED:
      return { kind: RUN_EVENT_OF_TURN_EVENT[event.kind], runId };
    case TURN_EVENT_KIND.REPLY_SENTENCE:
      return { kind: RUN_EVENT_OF_TURN_EVENT[event.kind], runId, sentence: event.sentence };
    case TURN_EVENT_KIND.ENDED:
      return {
        kind: RUN_EVENT_OF_TURN_EVENT[event.kind],
        runId,
        end: RUN_END_OF_TURN_END[event.end],
      };
  }
}

export interface HostedLiveBrainOptions {
  /** The account the voice session was opened for, resolved at the handshake and written to `voice_sessions`. */
  readonly userId: string;
  /**
   * The conversation every ask lands in, where the composition pins one: the
   * same one its record writes, so an ask and the lines it leaves cannot name
   * two conversations once a Clear has moved the standing main. Unpinned, each
   * ask resolves the standing main at its own instant.
   */
  readonly conversationId?: string;
  /** The ask door's seams: the ask record, eve under the deployment principal for this account, and the clock. */
  readonly asks: AskSeams;
  /** The store the standing and the journal are read from, on the connection the socket's own fiber holds. */
  readonly store: Pick<HostedStore, "turns" | "messages">;
  readonly report: (message: string) => void;
  /** The follow's own bounds, narrowed by a test so a poll is milliseconds and the bound is reached inside a test. */
  readonly bounds?: Partial<FollowBounds>;
}

/**
 * The brain as the exchange holds one, which is `LiveBrain` itself: a follow
 * ends when the scope the brain was built in closes, so there is no stop of
 * its own to declare.
 */
export type HostedLiveBrain = LiveBrain;

export const hostedLiveBrain = /* @__PURE__ */ Effect.fn("hostedLiveBrain")(function* (
  options: HostedLiveBrainOptions,
): Effect.fn.Return<HostedLiveBrain, never, Scope.Scope | SqlClient.SqlClient> {
  const sql = yield* SqlClient.SqlClient;
  const socket = yield* Effect.scope;
  const bounds = { ...LIVE_BRAIN_FOLLOW_BOUNDS, ...options.bounds };
  const listeners = new Set<(event: LiveBrainRunEvent) => void>();
  const followed = new Set<string>();
  const reads: AskStandingReads = { store: options.store, asks: options.asks.asks };

  function emit(event: LiveBrainRunEvent): void {
    for (const listener of [...listeners]) listener(event);
  }

  /** The one end a follow that could not reach the turn's own tells the service. */
  function endFailed(askId: string): void {
    emit({ kind: LIVE_BRAIN_RUN_EVENT.ENDED, runId: askId, end: LIVE_BRAIN_RUN_END.FAILED });
  }

  /**
   * One look at where the ask stands: the events its turn has produced so
   * far, those past the ones already told emitted under the ask's id.
   * Answers whether the turn has ended. An ask the record no longer holds
   * ends as failed, since nothing of it can be told again, and so does a
   * turn whose journal the store cannot read: its sentences are in that
   * journal, so telling the turn's end without them would be a reply the
   * voice says nothing of, and reading again finds the same rows.
   */
  const look = Effect.fnUntraced(function* (askId: string, told: { seq: number }) {
    const standing = yield* askStanding(reads, options.userId, askId);
    if (standing === undefined) {
      endFailed(askId);
      return true;
    }
    const { turn } = standing;
    if (turn === undefined) return false;
    const journal = yield* options.store.messages.byClientId(
      options.userId,
      turn.conversationId,
      CATALOG_TOOL_SET,
      turn.id,
    );
    if (!journal.ok) {
      options.report("A spoken ask's journal could not be read; its turn is told as failed");
      endFailed(askId);
      return true;
    }
    const events = projectTurnEvents(turn, journal.value[0]?.message);
    for (const event of events.slice(told.seq)) {
      emit(runEventOf(event, askId));
      told.seq = event.seq;
    }
    return events.at(-1)?.kind === TURN_EVENT_KIND.ENDED;
  });

  /**
   * Follows one accepted ask to its turn's end on a schedule, on a fiber of
   * the socket's scope, or until the follow bound or that scope's close. A
   * bound reached with the turn still unended is told as a failed end, so
   * the exchange settles and the voice says the standing note rather than
   * waiting forever on a turn eve never started. A follow the scope's close
   * interrupted tells nothing: the session it would have told is gone.
   */
  function follow(askId: string) {
    if (followed.has(askId)) return Effect.void;
    followed.add(askId);
    const told = { seq: 0 };
    const cadence = Schedule.spaced(Duration.millis(bounds.POLL_MS)).pipe(
      Schedule.setInputType<boolean>(),
      Schedule.while(({ input }) => !input),
      Schedule.upTo({ duration: Duration.millis(bounds.FOLLOW_MS) }),
      // Whichever of the two ends the follow — the turn saying it ended or
      // the bound elapsing — the repeat answers with the last look's own
      // word on it rather than the schedule's count.
      Schedule.map(({ input }) => input),
    );
    const following = Effect.repeat(look(askId, told), cadence).pipe(
      Effect.flatMap((done) =>
        done
          ? Effect.void
          : Effect.sync(() => {
              options.report("A spoken ask's turn did not end inside the follow bound");
              endFailed(askId);
            }),
      ),
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.void;
        const failure = Cause.squash(cause);
        return Effect.sync(() => {
          options.report(
            `Following a spoken ask failed: ${failure instanceof Error ? failure.message : String(failure)}`,
          );
          endFailed(askId);
        });
      }),
    );
    return Effect.asVoid(Effect.forkIn(following, socket));
  }

  return {
    submitAsk(ask) {
      const input: AskInput = {
        userId: options.userId,
        question: ask.question,
        origin: ASK_ORIGIN.SPOKEN,
        clientId: ask.submissionId,
      };
      const pinned = options.conversationId;
      return Effect.gen(function* () {
        const outcome = yield* acceptAsk(
          options.asks,
          pinned === undefined ? input : { ...input, conversationId: pinned },
        );
        if (!outcome.ok) {
          return {
            outcome: LIVE_BRAIN_SUBMISSION.REFUSED,
            refusal: HOSTED_ASK_REFUSAL_NOTE[outcome.refusal],
          };
        }
        yield* follow(outcome.answer.id);
        return { outcome: LIVE_BRAIN_SUBMISSION.ACCEPTED, runId: outcome.answer.id };
      }).pipe(Effect.provideService(SqlClient.SqlClient, sql), Effect.orDie);
    },
    onRunEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});
