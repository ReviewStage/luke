import {
  LIVE_BRAIN_RUN_END,
  LIVE_BRAIN_RUN_EVENT,
  LIVE_BRAIN_SUBMISSION,
  type LiveBrain,
  type LiveBrainRunEnd,
  type LiveBrainRunEvent,
} from "@sidecar/voice/live-session";
import { Deferred, Duration, Effect, FiberId, Schedule } from "effect";
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
  /** The ask door's seams: the runner, the ask record, eve under the deployment principal for this account, and the clock. */
  readonly asks: AskSeams;
  /** The store the standing and the journal are read from, over the same runner. */
  readonly store: Pick<HostedStore, "turns" | "messages">;
  /** The bounded, redacted roster view the brain's standing context carries, as the composition last read it. */
  readonly rosterView: () => string;
  readonly report: (message: string) => void;
  /** The follow's own bounds, narrowed by a test so a poll is milliseconds and the bound is reached inside a test. */
  readonly bounds?: Partial<FollowBounds>;
}

export interface HostedLiveBrain extends LiveBrain {
  /** Ends every follow under way; nothing is emitted after. */
  stop(): void;
}

export function hostedLiveBrain(options: HostedLiveBrainOptions): HostedLiveBrain {
  const bounds = { ...LIVE_BRAIN_FOLLOW_BOUNDS, ...options.bounds };
  const listeners = new Set<(event: LiveBrainRunEvent) => void>();
  const followed = new Set<string>();
  const stopped = Deferred.unsafeMake<void>(FiberId.none);
  const reads: AskStandingReads = {
    store: options.store,
    run: options.asks.run,
    asks: options.asks.asks,
  };

  function emit(event: LiveBrainRunEvent): void {
    for (const listener of [...listeners]) listener(event);
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
  async function look(askId: string, told: { seq: number }): Promise<boolean> {
    const standing = await askStanding(reads, options.userId, askId);
    if (standing === undefined) {
      emit({ kind: LIVE_BRAIN_RUN_EVENT.ENDED, runId: askId, end: LIVE_BRAIN_RUN_END.FAILED });
      return true;
    }
    const { turn } = standing;
    if (turn === undefined) return false;
    const journal = await options.store.messages.byClientId(
      options.userId,
      turn.conversationId,
      CATALOG_TOOL_SET,
      turn.id,
    );
    if (!journal.ok) {
      options.report("A spoken ask's journal could not be read; its turn is told as failed");
      emit({ kind: LIVE_BRAIN_RUN_EVENT.ENDED, runId: askId, end: LIVE_BRAIN_RUN_END.FAILED });
      return true;
    }
    const events = projectTurnEvents(turn, journal.value[0]?.message);
    for (const event of events.slice(told.seq)) {
      emit(runEventOf(event, askId));
      told.seq = event.seq;
    }
    return events.at(-1)?.kind === TURN_EVENT_KIND.ENDED;
  }

  /**
   * Follows one accepted ask to its turn's end on a schedule, or until the
   * follow bound or the brain's stop. A bound reached with the turn still
   * unended is told as a failed end, so the exchange settles and the voice
   * says the standing note rather than waiting forever on a turn eve never
   * started.
   */
  function follow(askId: string): void {
    if (followed.has(askId)) return;
    followed.add(askId);
    const told = { seq: 0 };
    const cadence = Schedule.spaced(Duration.millis(bounds.POLL_MS)).pipe(
      Schedule.intersect(Schedule.recurUntil((done: boolean) => done)),
      Schedule.upTo(Duration.millis(bounds.FOLLOW_MS)),
    );
    const following = Effect.repeat(
      Effect.promise(() => look(askId, told)),
      cadence,
    ).pipe(
      Effect.map(([, done]) => done),
      Effect.raceFirst(Effect.as(Deferred.await(stopped), undefined)),
    );
    void (async () => {
      try {
        const done = await options.asks.run(following);
        if (done === undefined || done) return;
        options.report("A spoken ask's turn did not end inside the follow bound");
      } catch (error) {
        options.report(
          `Following a spoken ask failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      emit({ kind: LIVE_BRAIN_RUN_EVENT.ENDED, runId: askId, end: LIVE_BRAIN_RUN_END.FAILED });
    })();
  }

  return {
    async submitAsk(ask) {
      const input: AskInput = {
        userId: options.userId,
        question: ask.question,
        origin: ASK_ORIGIN.SPOKEN,
        clientId: ask.submissionId,
      };
      const pinned = options.conversationId;
      const outcome = await acceptAsk(
        options.asks,
        pinned === undefined ? input : { ...input, conversationId: pinned },
      );
      if (!outcome.ok) {
        return {
          outcome: LIVE_BRAIN_SUBMISSION.REFUSED,
          refusal: HOSTED_ASK_REFUSAL_NOTE[outcome.refusal],
        };
      }
      follow(outcome.answer.id);
      return { outcome: LIVE_BRAIN_SUBMISSION.ACCEPTED, runId: outcome.answer.id };
    },
    onRunEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    standingRosterView: () => options.rosterView(),
    stop() {
      Deferred.unsafeDone(stopped, Effect.void);
    },
  };
}
