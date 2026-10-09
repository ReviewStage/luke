import { isDeepStrictEqual } from "node:util";
import { PLAN_ACTIVITY_ACTION_MAX_CHARS, type PlanWorkTurn } from "@sidecar/hosted/planning-view";
import {
  LIVE_BRAIN_CANCEL,
  LIVE_BRAIN_RUN_END,
  LIVE_BRAIN_RUN_EVENT,
  LIVE_BRAIN_SUBMISSION,
  type LiveBrain,
  type LiveBrainCancel,
  type LiveBrainRecoveredRun,
  type LiveBrainRecovery,
  type LiveBrainRunEnd,
  type LiveBrainRunEvent,
} from "@sidecar/voice/live-session";
import { Cause, Clock, Duration, Effect, Result, Schedule, Schema, type Scope } from "effect";
import { SqlClient } from "effect/unstable/sql";
import {
  ASK_ORIGIN,
  isSettledToolPartState,
  isStoredToolPart,
  SLOW_STEP_KIND,
  type StoredUIMessage,
  storedToolName,
  TURN_END,
  TURN_EVENT_KIND,
  TURN_STATUS,
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
  STOP_REFUSAL,
  type StopOutcome,
  stopAsk,
} from "../hosted/brain-ask.js";
import { childConversationId } from "../hosted/brain-host/ids.js";
import { EVE_DELEGATION_TOOL } from "../hosted/brain-host/planning.js";
import { HOSTED_TOOL_SET } from "../hosted/brain-tool-set.js";
import { QUEUE_QUESTION_TOOL } from "../hosted/queue-question.js";
import { RUN_IN_REPOSITORY_TOOL } from "../hosted/repository-shell.js";
import { TURN_ABANDON } from "../hosted/store/abandoned-turns.js";
import type { HostedStore, StoreWriter } from "../hosted/store/index.js";
import { listJournals } from "../hosted/store/message-reads.js";
import { logStoreFailure } from "../hosted/store-failure.js";
import { projectTurnEvents } from "../hosted/turn-events.js";
import { VOICE_DETACH_GRACE_MS } from "./orphan-sweep.js";
import { planWorkOf, workerCallIdsOf } from "./plan-work.js";

/**
 * The hosted implementation of the live brain: Luke's judgment reached in
 * process, never over HTTP. The voice function resolved the account at its
 * handshake and dropped the bearer there, so it holds nothing eve's door or
 * this deployment's own routes would take; what it holds is the ask door
 * itself — `acceptAsk` — and the store, so a spoken ask is admitted,
 * recorded, and handed to eve under the eve client the composition built for
 * the account. A turn's events are `projectTurnEvents` over the turn row and
 * its journal, read again on a schedule until the turn ends or the follow
 * bound is reached; there is no HTTP hop and so no function ceiling to
 * re-attach across. The bound is the plain one until the journal shows the
 * turn handed work to the worker, which eve runs as a task the turn parks
 * on (`turn.waiting`) and resumes from in the same turn, minutes or longer
 * later: from that call on the follow runs under the parked bound instead,
 * so the findings are spoken when they land. The run the
 * service keys an exchange by is the ask's own id, since eve names the turn
 * only once it starts, and every event is translated back to it. A run is
 * cancelled through `stopAsk`, so the voice's stop key stops a turn as eve's
 * cancel of it or a stamp its start honours. What the projection carries
 * mid-turn is the slow step, each queued question, and each sentence of the
 * reply once it has finished forming and every call ahead of it has settled,
 * which is what the voice speaks meanwhile.
 *
 * How far each turn was told is written on the ask's row before it is told,
 * so a connection that re-attaches to the session on another function
 * instance takes the runs up again from the event after the last one told
 * (`recoverRuns`). Written first, a telling the socket's loss cut between
 * the write and the voice is lost rather than said twice.
 *
 * The brain is built in the socket's own scope and every follow an accepted
 * ask starts is a fiber in it, so the socket detaching interrupts each of
 * them and nothing is emitted after; the submission `LiveBrain` declares is
 * an effect of the caller's own fiber, with the `SqlClient` the scope was
 * built on provided to it where the ask door asks for one, exactly as
 * `runTool` provides it to the brain's seams.
 */

/** The most of a subagent's turns one look reads, the newest: a worker's task is a turn, and each follow-up it was handed another. */
const SUBAGENT_JOURNALS = 10;

/** How long an ask is followed before it is given up as failed: past eve's own turn deadline, with room for one queued turn ahead of it. */
const FOLLOW = Duration.minutes(10);

export const LIVE_BRAIN_FOLLOW_BOUNDS = {
  /** How often the record is read again while an ask's turn runs: the measured step boundary hosted is about 300 ms. */
  POLL: Duration.millis(250),
  FOLLOW,
  /**
   * How long an ask whose turn handed work to a task is followed instead.
   * The record does not say when the task settles — the relay tells nothing
   * for the park, and the findings reach the journal as the steps after
   * them — so the bound covers the turn from its delegation to the latest
   * end the record can give it: the plain bound, which is the room the turn
   * had to start, and past that the sweep's own abandon bound, at which a
   * turn still running is settled as failed on the record and the follow
   * hears that end. Following longer could hear nothing more.
   */
  PARKED_FOLLOW: Duration.sum(FOLLOW, Duration.millis(TURN_ABANDON.AFTER_MS)),
} as const;

type FollowBounds = Readonly<Record<keyof typeof LIVE_BRAIN_FOLLOW_BOUNDS, Duration.Duration>>;

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

/** The stream's kinds in the service's vocabulary, one word each; the live brain's own activity is none of them, and a test holds the rest equal. */
const RUN_EVENT_OF_TURN_EVENT = {
  [TURN_EVENT_KIND.SLOW_STEP]: LIVE_BRAIN_RUN_EVENT.SLOW_STEP,
  [TURN_EVENT_KIND.QUESTION_QUEUED]: LIVE_BRAIN_RUN_EVENT.QUESTION_QUEUED,
  [TURN_EVENT_KIND.CODE_SHOWN]: LIVE_BRAIN_RUN_EVENT.CODE_SHOWN,
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
    case TURN_EVENT_KIND.QUESTION_QUEUED:
      return {
        kind: RUN_EVENT_OF_TURN_EVENT[event.kind],
        runId,
        question: event.question,
        recommendation: event.recommendation,
      };
    case TURN_EVENT_KIND.CODE_SHOWN:
      return { kind: RUN_EVENT_OF_TURN_EVENT[event.kind], runId, code: event.code };
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

/** What a follow has told of its turn so far: the activity last said, how many of its calls were told settled, whether the turn handed work to a task, and its work as last shown. */
interface FollowTold {
  action: string | undefined;
  settled: number;
  delegated: boolean;
  work: PlanWorkTurn | undefined;
  /** The `worker` calls the last look found on the journal, whose subagents' sessions the next look reads. */
  workers: readonly string[];
}

/** What one look answers the follow: the turn still runs, it ended, or it ran past the bound that applies to it. */
const FOLLOW_LOOK = {
  RUNNING: "running",
  ENDED: "ended",
  OVERDUE: "overdue",
} as const;

type FollowLook = (typeof FOLLOW_LOOK)[keyof typeof FOLLOW_LOOK];

/** No recovered run: the session's revisions start from nothing, and nothing is followed. */
const NO_RECOVERY: LiveBrainRecovery = { revision: 0, runs: [], follow: Effect.void };

/** What has been told of one turn, whichever follow told it: its teller, the last event's number, and whether its actions settled. */
interface TurnTold {
  teller: string;
  seq: number;
  settled: boolean;
}

const isRepositoryCommand = Schema.is(RUN_IN_REPOSITORY_TOOL.inputSchema);

/**
 * What the turn is doing now, read off its journal: the latest call not yet
 * answered, as its command where it is a repository command and as its
 * tool's name otherwise, cut to what a `plan.activity` frame carries; nothing
 * while every call is answered. Note that we read the call's input and never
 * its output, because the line is shown on the developer's Mac and a
 * command's output is the repository's own text.
 */
function pendingActionOf(journal: StoredUIMessage | undefined): string | undefined {
  const pending = journal?.parts
    .filter(isStoredToolPart)
    .findLast((part) => !isSettledToolPartState(part.state));
  if (pending === undefined) return undefined;
  const action = isRepositoryCommand(pending.input)
    ? pending.input.command
    : storedToolName(pending);
  if (action.length <= PLAN_ACTIVITY_ACTION_MAX_CHARS) return action;
  return `${action.slice(0, PLAN_ACTIVITY_ACTION_MAX_CHARS - 1)}…`;
}

/**
 * Whether the turn handed work to the worker, which eve runs as a task the
 * turn parks on: its call is on the journal, settled the moment the task
 * starts with the receipt as its result, so a settled call says nothing of
 * whether the task has. Note that we read which tool was called and nothing
 * of its input, so the delegation tells the voice no word of the job.
 */
function delegatedOf(journal: StoredUIMessage | undefined): boolean {
  return (journal?.parts ?? [])
    .filter(isStoredToolPart)
    .some((part) => storedToolName(part) === EVE_DELEGATION_TOOL.WORKER);
}

/**
 * The turn's settled calls, oldest first, as the kind of step each was: a
 * repository command as a repository read, and every other call as no named
 * kind. A queued question is the plan's next question and no step of the
 * work, so it is not counted. Note that we read which tool was called and
 * nothing of its input or output, so a settled step tells the voice no
 * command and no line the repository holds.
 */
function settledStepsOf(journal: StoredUIMessage | undefined): readonly (string | undefined)[] {
  return (journal?.parts ?? [])
    .filter(isStoredToolPart)
    .filter((part) => isSettledToolPartState(part.state))
    .filter((part) => storedToolName(part) !== QUEUE_QUESTION_TOOL.name)
    .map((part) =>
      storedToolName(part) === RUN_IN_REPOSITORY_TOOL.name
        ? SLOW_STEP_KIND.REPOSITORY_READ
        : undefined,
    );
}

/**
 * What a Stop came to, as the service hears a cancel: a turn ended as
 * cancelled, or one still to end that carries a stamp, is a cancel taken,
 * since eve took it or the start will honour it; a turn that ended any other
 * way had nothing left to cancel.
 */
function cancelOf(outcome: StopOutcome): LiveBrainCancel {
  if (Result.isSuccess(outcome)) {
    const { status, cancelRequestedAt } = outcome.success;
    const taken =
      status === TURN_STATUS.CANCELLED ||
      (status !== TURN_STATUS.SETTLED &&
        status !== TURN_STATUS.FAILED &&
        cancelRequestedAt !== undefined);
    return taken ? LIVE_BRAIN_CANCEL.CANCELLED : LIVE_BRAIN_CANCEL.NOT_RUNNING;
  }
  return outcome.failure.refusal === STOP_REFUSAL.UPSTREAM
    ? LIVE_BRAIN_CANCEL.FAILED
    : LIVE_BRAIN_CANCEL.NOT_RUNNING;
}

export interface HostedLiveBrainOptions {
  /** The account the voice session was opened for, resolved at the handshake and written to `voice_sessions`. */
  readonly userId: string;
  /** The conversation every ask lands in: the plan's, the same one its record writes. */
  readonly conversationId: string;
  /** The ask door's seams: the ask record, eve under the deployment principal for this account, and the clock. */
  readonly asks: AskSeams;
  /** The store the standing and the journal are read from, on the connection the socket's own fiber holds. */
  readonly store: Pick<HostedStore, "turns" | "messages">;
  /** The writer a cancelled run's turn is stamped through, as every Stop stamps it. */
  readonly writer: Pick<StoreWriter, "requestTurnCancel">;
  readonly report: (message: string) => void;
  /** The follow's own bounds, narrowed by a test so a poll is milliseconds and the bound is reached inside a test. */
  readonly bounds?: Partial<FollowBounds>;
}

/**
 * The brain as the exchange holds one: `LiveBrain`, and the work of each
 * turn it follows as that changes, for the Work tab, which no voice hears.
 * A follow ends when the scope the brain was built in closes, so there is
 * no stop of its own to declare.
 */
export interface HostedLiveBrain extends LiveBrain {
  /** Hears each followed turn's work whenever it changes, its last as the turn ended; answers the unsubscribe. */
  onWork(listener: (work: PlanWorkTurn) => void): () => void;
}

export const hostedLiveBrain = /* @__PURE__ */ Effect.fn("web/hostedLiveBrain")(function* (
  options: HostedLiveBrainOptions,
): Effect.fn.Return<HostedLiveBrain, never, Scope.Scope | SqlClient.SqlClient> {
  const sql = yield* SqlClient.SqlClient;
  const socket = yield* Effect.scope;
  const bounds = { ...LIVE_BRAIN_FOLLOW_BOUNDS, ...options.bounds };
  const listeners = new Set<(event: LiveBrainRunEvent) => void>();
  const workListeners = new Set<(work: PlanWorkTurn) => void>();
  /** Each followed ask by its task revision, so the newest of several is known. */
  const followed = new Map<string, number>();
  /** How far each turn a recovered run is on was told by the connection before, as the record holds it. */
  const recoveredSeq = new Map<string, number>();
  /** The turn each followed ask was last seen bound to. */
  const boundTurn = new Map<string, string>();
  // Note that eve folds asks that waited together into one turn, so several
  // follows can project one turn. The newest ask tells it, because the
  // service speaks the newest request's reply alone; the rest tell only its
  // end, because each sentence told per ask was said per ask.
  const toldOfTurn = new Map<string, TurnTold>();
  const reads: AskStandingReads = { store: options.store, asks: options.asks.asks };

  function emit(event: LiveBrainRunEvent): void {
    for (const listener of [...listeners]) listener(event);
  }

  /** The one end a follow that could not reach the turn's own tells the service. */
  function endFailed(askId: string): void {
    emit({ kind: LIVE_BRAIN_RUN_EVENT.ENDED, runId: askId, end: LIVE_BRAIN_RUN_END.FAILED });
  }

  /**
   * The newest followed ask bound to the turn, as a turn is first reached:
   * every later ask whose binding no follow has seen yet is read once here,
   * because eve binds the asks it folded into one turn in a single write and
   * the follow that reaches the turn first may be any of theirs.
   */
  const newestOn = Effect.fnUntraced(function* (askId: string, turnId: string) {
    const order = followed.get(askId) ?? 0;
    for (const [later, laterOrder] of followed) {
      if (laterOrder <= order || boundTurn.has(later)) continue;
      const standing = yield* askStanding(reads, options.userId, later);
      if (standing?.turn !== undefined) boundTurn.set(later, standing.turn.id);
    }
    let newest = askId;
    for (const [candidate, candidateOrder] of followed) {
      if (boundTurn.get(candidate) === turnId && candidateOrder > (followed.get(newest) ?? 0)) {
        newest = candidate;
      }
    }
    return newest;
  });

  /**
   * Who tells the turn as this ask reaches it: the newest ask bound to it.
   * A later ask that reaches a turn an earlier one is already telling takes
   * it over from the next event on, told first that the actions settled
   * where they already had, so its reply is not held back for a mark it
   * never heard. A turn a connection before this one told part of is told
   * from where it stopped, and where that part carried the settle, its
   * teller hears the settle again first, since the exchange this connection
   * stood for it never did and would hold the rest of the reply back.
   */
  const tellerOf = Effect.fnUntraced(function* (
    askId: string,
    turnId: string,
    events: readonly TurnEvent[],
  ) {
    const standing = toldOfTurn.get(turnId);
    if (standing === undefined) {
      const seq = recoveredSeq.get(turnId) ?? 0;
      const told: TurnTold = {
        teller: yield* newestOn(askId, turnId),
        seq,
        settled: events.some(
          (event) => event.seq <= seq && event.kind === TURN_EVENT_KIND.ACTIONS_SETTLED,
        ),
      };
      toldOfTurn.set(turnId, told);
      if (told.settled) emit({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: told.teller });
      return told;
    }
    if ((followed.get(askId) ?? 0) > (followed.get(standing.teller) ?? 0)) {
      standing.teller = askId;
      if (standing.settled) emit({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: askId });
    }
    return standing;
  });

  /**
   * Tells events under the ask, its row first moved past them, as one step
   * the socket's close cannot cut: a telling is written down before it is
   * told, so a connection that takes the run up again never tells it twice.
   * A row the store could not move is reported and the events told all the
   * same, since leaving the reply unsaid now is worse than a re-attach that
   * might say it again.
   */
  const tell = Effect.fnUntraced(function* (
    askId: string,
    told: { readonly seq: number; readonly ended: boolean },
    events: readonly LiveBrainRunEvent[],
  ) {
    if (events.length === 0) return;
    const at = told.ended ? new Date(yield* Clock.currentTimeMillis) : undefined;
    yield* Effect.uninterruptible(
      options.asks.asks
        .told(askId, at === undefined ? { seq: told.seq } : { seq: told.seq, endAt: at })
        .pipe(
          Effect.tapError(logStoreFailure),
          Effect.catch(() =>
            Effect.sync(() => options.report("How far a spoken ask was told could not be written")),
          ),
          Effect.andThen(
            Effect.sync(() => {
              for (const event of events) emit(event);
            }),
          ),
        ),
    );
  });

  /**
   * The journals of each subagent the calls named started, by call, read from
   * the call's child conversation. A subagent whose journals could not be
   * read is left out, so its call is drawn without its session rather than
   * ending the ask.
   */
  const subagentJournalsOf = Effect.fnUntraced(function* (
    conversationId: string,
    callIds: readonly string[],
  ) {
    const journals = new Map<string, readonly StoredUIMessage[]>();
    for (const callId of callIds) {
      const read = yield* listJournals(
        options.userId,
        childConversationId(conversationId, callId),
        HOSTED_TOOL_SET,
        SUBAGENT_JOURNALS,
      ).pipe(
        Effect.tapError(logStoreFailure),
        Effect.orElseSucceed(() => undefined),
      );
      if (read?.ok)
        journals.set(
          callId,
          read.value.map((row) => row.message),
        );
    }
    return journals;
  });

  /**
   * A turn still under way, as the look answers it: running inside the
   * bound that applies to it, or overdue past that bound. A turn that handed
   * work to a task is followed under the parked bound; any other under the
   * plain one, since a turn eve never started has nothing to wait on.
   */
  const standingLook = Effect.fnUntraced(function* (told: FollowTold, since: number) {
    const bound = told.delegated ? bounds.PARKED_FOLLOW : bounds.FOLLOW;
    const elapsed = (yield* Clock.currentTimeMillis) - since;
    return elapsed >= Duration.toMillis(bound) ? FOLLOW_LOOK.OVERDUE : FOLLOW_LOOK.RUNNING;
  });

  /**
   * One look at where the ask stands: the events its turn has produced so
   * far, those past the ones already told emitted under the ask's id, and
   * what it is doing now where that differs from what was last told.
   * Answers whether the turn still runs, has ended, or has run past its
   * bound: the plain one, or the parked one from the look that finds the
   * worker's call on the journal. An ask the record no longer holds
   * ends as failed, since nothing of it can be told again, and so does a
   * turn whose journal the store cannot read: its sentences are in that
   * journal, so telling the turn's end without them would be a reply the
   * voice says nothing of, and reading again finds the same rows. A turn
   * another ask was folded into is told by the newest of them; the others
   * hear only the end, so their exchanges still settle.
   */
  const look = Effect.fnUntraced(function* (askId: string, told: FollowTold, since: number) {
    const standing = yield* askStanding(reads, options.userId, askId);
    if (standing === undefined) {
      endFailed(askId);
      return FOLLOW_LOOK.ENDED;
    }
    const { turn } = standing;
    if (turn === undefined) return yield* standingLook(told, since);
    boundTurn.set(askId, turn.id);
    // Note that the subagents' sessions are read for the calls the last look found, ahead of
    // the journal, so the journal stays each look's last read and a subagent's work shows one
    // poll behind the call that started it.
    const subagents = yield* subagentJournalsOf(turn.conversationId, told.workers);
    // A planning call's turns call the planning tools, so the journal is read
    // under every tool a hosted conversation's rows may name.
    const journal = yield* options.store.messages.byClientId(
      options.userId,
      turn.conversationId,
      HOSTED_TOOL_SET,
      turn.id,
    );
    if (!journal.ok) {
      options.report("A spoken ask's journal could not be read; its turn is told as failed");
      endFailed(askId);
      return FOLLOW_LOOK.ENDED;
    }
    const message = journal.value[0]?.message;
    told.delegated ||= delegatedOf(message);
    const events = projectTurnEvents(turn, message);
    const turnTold = yield* tellerOf(askId, turn.id, events);
    const telling = turnTold.teller === askId;
    // The activity goes ahead of the events, so a call answered in the turn's last step is told before its end.
    const action = telling ? pendingActionOf(message) : undefined;
    if (action !== told.action) {
      told.action = action;
      emit({ kind: LIVE_BRAIN_RUN_EVENT.ACTIVITY, runId: askId, action });
    }
    // The work is shown by the turn's teller alone, so a turn several asks were folded into is shown once.
    told.workers = telling ? workerCallIdsOf(message) : [];
    const work = telling ? planWorkOf(turn, message, subagents) : undefined;
    if (work !== undefined && !isDeepStrictEqual(work, told.work)) {
      told.work = work;
      for (const listener of [...workListeners]) listener(work);
    }
    const last = events.at(-1);
    const ended = last?.kind === TURN_EVENT_KIND.ENDED;
    // Calls settled since the last look are told as one step event, while the turn runs and only by its teller.
    const steps = telling && !ended ? settledStepsOf(message) : [];
    if (steps.length > told.settled) {
      told.settled = steps.length;
      emit({
        kind: LIVE_BRAIN_RUN_EVENT.STEP_SETTLED,
        runId: askId,
        step: steps.at(-1),
        settled: steps.length,
      });
    }
    if (!telling) {
      if (ended) yield* tell(askId, { seq: 0, ended }, [runEventOf(last, askId)]);
      return ended ? FOLLOW_LOOK.ENDED : yield* standingLook(told, since);
    }
    const fresh = events.filter((event) => event.seq > turnTold.seq);
    // A turn told to its end under another ask still ends this one's run, so its exchange settles.
    const toTell = ended && fresh.length === 0 ? [last] : fresh;
    // The row keeps the last event told short of the end, whose own number is no position the
    // record needs: `end_told_at` says the end was told.
    let stored = 0;
    for (const event of fresh) {
      if (event.kind === TURN_EVENT_KIND.ACTIONS_SETTLED) turnTold.settled = true;
      if (event.kind !== TURN_EVENT_KIND.ENDED) stored = event.seq;
      turnTold.seq = event.seq;
    }
    yield* tell(
      askId,
      { seq: stored, ended },
      toTell.map((event) => runEventOf(event, askId)),
    );
    return ended ? FOLLOW_LOOK.ENDED : yield* standingLook(told, since);
  });

  /**
   * Follows one accepted ask to its turn's end on a schedule, on a fiber of
   * the socket's scope, or until the follow bound or that scope's close. The
   * bound is kept by the look rather than the schedule, because which bound
   * applies is read off the journal: the plain one, or the parked one once
   * the turn has handed work to a task. A bound reached with the turn still
   * unended is told as a failed end, so the exchange settles and the voice
   * says the standing note rather than waiting forever on a turn eve never
   * started. A follow the scope's close interrupted tells nothing: the
   * session it would have told is gone.
   */
  function follow(askId: string, revision: number) {
    if (followed.has(askId)) return Effect.void;
    followed.set(askId, revision);
    const told: FollowTold = {
      action: undefined,
      settled: 0,
      delegated: false,
      work: undefined,
      workers: [],
    };
    const cadence = Schedule.spaced(bounds.POLL).pipe(
      Schedule.setInputType<FollowLook>(),
      Schedule.while(({ input }) => input === FOLLOW_LOOK.RUNNING),
      // Whichever ends the follow — the turn saying it ended or its bound
      // elapsing — the repeat answers with the last look's own word on it
      // rather than the schedule's count.
      Schedule.map(({ input }) => input),
    );
    const following = Effect.flatMap(Clock.currentTimeMillis, (since) =>
      Effect.repeat(look(askId, told, since), cadence),
    ).pipe(
      Effect.flatMap((last) =>
        last === FOLLOW_LOOK.ENDED
          ? Effect.void
          : Effect.sync(() => {
              options.report("A spoken ask's turn did not end inside the follow bound");
              endFailed(askId);
            }),
      ),
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.void;
        return Effect.sync(() => {
          options.report(`Following a spoken ask failed: ${Cause.pretty(cause)}`);
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
        conversationId: options.conversationId,
        voice: { sessionId: ask.sessionId, revision: ask.revision },
      };
      return Effect.gen(function* () {
        const outcome = yield* acceptAsk(options.asks, input);
        if (Result.isFailure(outcome)) {
          return {
            outcome: LIVE_BRAIN_SUBMISSION.REFUSED,
            refusal: HOSTED_ASK_REFUSAL_NOTE[outcome.failure.refusal],
          };
        }
        yield* follow(outcome.success.id, ask.revision);
        return { outcome: LIVE_BRAIN_SUBMISSION.ACCEPTED, runId: outcome.success.id };
      }).pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
        // The ask's rows could not be read or written: the refusal is the
        // store's own standing sentence, the failure is written down where
        // its cause is known, and the session goes on.
        Effect.tapError(logStoreFailure),
        Effect.catch(() =>
          Effect.sync(() => {
            options.report("A spoken ask could not be written down; it is refused");
            return {
              outcome: LIVE_BRAIN_SUBMISSION.REFUSED,
              refusal: HOSTED_ASK_REFUSAL_NOTE[ASK_REFUSAL.STORE],
            };
          }),
        ),
      );
    },
    cancelRun(runId) {
      return stopAsk(
        {
          store: options.store,
          asks: options.asks.asks,
          writer: options.writer,
          eve: options.asks.eve,
        },
        options.userId,
        runId,
      ).pipe(
        Effect.map(cancelOf),
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.tapError(logStoreFailure),
        Effect.catch(() =>
          Effect.sync(() => {
            options.report("A spoken ask's Stop could not be written down");
            return LIVE_BRAIN_CANCEL.FAILED;
          }),
        ),
      );
    },
    recoverRuns(sessionId) {
      return Effect.gen(function* () {
        const asked = yield* options.asks.asks.spokenIn(options.userId, sessionId);
        const now = yield* Clock.currentTimeMillis;
        for (const ask of asked) {
          if (ask.turnId === undefined) continue;
          recoveredSeq.set(ask.turnId, Math.max(recoveredSeq.get(ask.turnId) ?? 0, ask.toldSeq));
        }
        const runs: LiveBrainRecoveredRun[] = [];
        for (const ask of asked) {
          if (ask.endToldAt !== undefined) continue;
          const standing = yield* askStanding(reads, options.userId, ask.id);
          if (standing === undefined) continue;
          const { turn } = standing;
          const settledAt = turn?.settledAt?.getTime();
          runs.push({
            runId: ask.id,
            delegationId: ask.clientId,
            revision: ask.revision,
            stopped: ask.cancelRequestedAt !== undefined || Boolean(turn?.cancelRequestedAt),
            // A reply that settled longer ago than a detached session is kept for its device is no longer news.
            stale: settledAt !== undefined && now - settledAt > VOICE_DETACH_GRACE_MS,
          });
        }
        const recovery: LiveBrainRecovery = {
          revision: Math.max(0, ...asked.map((ask) => ask.revision)),
          runs,
          follow: Effect.provideService(
            Effect.forEach(runs, (run) => follow(run.runId, run.revision), { discard: true }),
            SqlClient.SqlClient,
            sql,
          ),
        };
        return recovery;
      }).pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.tapError(logStoreFailure),
        Effect.catch(() =>
          Effect.sync(() => {
            options.report("A re-attached session's spoken asks could not be read back");
            return NO_RECOVERY;
          }),
        ),
      );
    },
    onRunEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onWork(listener) {
      workListeners.add(listener);
      return () => {
        workListeners.delete(listener);
      };
    },
  };
});
