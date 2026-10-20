import { isDeepStrictEqual } from "node:util";
import type { LiveStatement } from "@luke/database/core/live-statement";
import { Database, type DatabaseServices } from "@luke/database/core/query";
import { TURN_ABANDON } from "@luke/database/models/abandoned-turns";
import { childTitlesByCall } from "@luke/database/models/child-titles";
import type { HostedStore } from "@luke/database/models/hosted-store";
import { childConversationId } from "@luke/database/models/ids";
import {
  listJournals,
  type SpokenAskRow,
  type StoredTurnRecord,
} from "@luke/database/models/message-reads";
import type { ConversationTarget, StoreWriter } from "@luke/database/models/writer";
import type { TurnRecord } from "@luke/features/coding-agent-wire";
import { TASK_ACTIVITY_ACTION_MAX_CHARS, type TaskWorkTurn } from "@luke/features/tasks-view";
import {
  LIVE_BRAIN_CANCEL,
  LIVE_BRAIN_RUN_END,
  LIVE_BRAIN_RUN_EVENT,
  LIVE_BRAIN_SUBMISSION,
  type LiveBrain,
  type LiveBrainCancel,
  type LiveBrainJoin,
  type LiveBrainQuestion,
  type LiveBrainRecoveredRun,
  type LiveBrainRecovery,
  type LiveBrainRunEnd,
  type LiveBrainRunEvent,
  type LiveBrainSubmission,
} from "@luke/voice/live-session";
import { Cause, Clock, Duration, Effect, Option, Queue, Result, Schema, Scope } from "effect";
import { SqlClient } from "effect/sql";
import type { BRAIN_HOST_TURN } from "../agents/brain-host/bounds.js";
import { BRAIN_DELEGATION_TOOLS, BRAIN_EXPLORE_ASK } from "../agents/brain-host/brain.js";
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
} from "../agents/brain-host/brain-ask.js";
import { RUN_IN_REPOSITORY_TOOL } from "../agents/repository-shell.js";
import { projectTurnEvents } from "../agents/turn-events.js";
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
import { lookedUntil } from "../http/held-read.js";
import { logStoreFailure } from "../http/store-failure.js";
import { LiveWake } from "../live/live-wake.js";
import { HOSTED_TOOL_SET } from "../tasks/brain-tool-set.js";
import { subagentRecordsByCall } from "../tasks/child-models.js";
import { QUEUE_QUESTION_TOOL, WITHDRAW_QUESTION_TOOL } from "../tasks/queue-question.js";
import {
  callsSendingToEarlierTasks,
  SUBAGENT_JOURNALS,
  type SubagentJournal,
  taskWorkOf,
  workerSessionCallsOf,
} from "../tasks/task-work.js";
import { brainDelegationJournalsOf } from "../tasks/task-work-store.js";
import { VOICE_DETACH_GRACE_MS } from "./orphan-sweep.js";

/**
 * The hosted implementation of the live brain: Luke's judgment reached in
 * process, never over HTTP. The voice function resolved the account at its
 * handshake and dropped the bearer there, so it holds nothing eve's door or
 * this deployment's own routes would take; what it holds is the ask door
 * itself — `acceptAsk` — and the store, so a spoken ask is admitted,
 * recorded, and handed to eve under the eve client the composition built for
 * the account. A turn's events are `projectTurnEvents` over the turn row and
 * its journal, read again each time the task conversation's mark or its workers move over
 * Neon Realtime (`lookedUntil` on `taskConversationLiveStatements`, which
 * the exchange hands in), until the turn ends or the follow bound is
 * reached. The mark is a wake and nothing more: what is told is read from
 * the record, so the projection, its order, and its numbering are the
 * record's whichever woke the read. The bound is the plain one until the journal shows the
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
 * How far each turn was told is written on the ask's row beside the telling,
 * never ahead of it: the events reach the voice first and the write follows
 * on one ordered writer of the socket's scope, so a slow store holds back no
 * reply. A connection that re-attaches to the session on another function
 * instance takes the runs up again from the event after the last one the row
 * says was told (`recoverRuns`); a telling the socket's loss cut between the
 * voice and the write may be said again there, which is the price of a store
 * that cannot delay the voice. Within one connection nothing is told twice,
 * because each turn's told position is kept in memory as it is told.
 *
 * The brain is built in the socket's own scope and every follow an accepted
 * ask starts is a fiber in it, so the socket detaching interrupts each of
 * them and nothing is emitted after; the submission `LiveBrain` declares is
 * an effect of the caller's own fiber, with the `SqlClient` and `Database`
 * the scope was built on provided to it where the ask door asks for them, exactly as
 * `runTool` provides it to the brain's seams.
 */

/** How long an ask is followed before it is given up as failed: past eve's own turn deadline, with room for one queued turn ahead of it. */
const FOLLOW = Duration.minutes(10);

const LIVE_BRAIN_FOLLOW_BOUNDS = {
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
const HOSTED_ASK_REFUSAL_NOTE = {
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
  [TURN_EVENT_KIND.QUESTION_WITHDRAWN]: LIVE_BRAIN_RUN_EVENT.QUESTION_WITHDRAWN,
  [TURN_EVENT_KIND.CODE_SHOWN]: LIVE_BRAIN_RUN_EVENT.CODE_SHOWN,
  [TURN_EVENT_KIND.CALL_ENDING]: LIVE_BRAIN_RUN_EVENT.CALL_ENDING,
  [TURN_EVENT_KIND.ACTIONS_SETTLED]: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED,
  [TURN_EVENT_KIND.REPLY_SENTENCE]: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
  [TURN_EVENT_KIND.ENDED]: LIVE_BRAIN_RUN_EVENT.ENDED,
} as const satisfies Record<TurnEventKind, LiveBrainRunEvent["kind"]>;

const RUN_END_OF_TURN_END = {
  [TURN_END.COMPLETED]: LIVE_BRAIN_RUN_END.COMPLETED,
  [TURN_END.CANCELLED]: LIVE_BRAIN_RUN_END.CANCELLED,
  [TURN_END.FAILED]: LIVE_BRAIN_RUN_END.FAILED,
} as const satisfies Record<TurnEnd, LiveBrainRunEnd>;

/**
 * The stream's event as the service hears it, under the ask's id rather than
 * the turn's; code is told with its call, its turn, and `shownAt`, when the
 * turn began, as the task's work reads them back.
 */
function runEventOf(event: TurnEvent, runId: string, shownAt: number): LiveBrainRunEvent {
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
    case TURN_EVENT_KIND.QUESTION_WITHDRAWN:
      return { kind: RUN_EVENT_OF_TURN_EVENT[event.kind], runId, question: event.question };
    case TURN_EVENT_KIND.CODE_SHOWN:
      return {
        kind: RUN_EVENT_OF_TURN_EVENT[event.kind],
        runId,
        callId: event.callId,
        turnId: event.turnId,
        shownAt,
        code: event.code,
      };
    case TURN_EVENT_KIND.CALL_ENDING:
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
  work: TaskWorkTurn | undefined;
  /** The `worker` calls the last look found on the journal, each with the call whose child conversation the next look reads its subagent's session from. */
  workers: ReadonlyMap<string, string>;
  /** Whether one of those calls sends work to a task an earlier turn started whose start no look has found yet, which the next look looks for. */
  seeking: boolean;
  /** The spoken lines of the asks that opened the turn, read again on every look, since a line may be taken into the turn after the look that first found it. */
  asked: readonly SpokenAskRow[];
}

/** Whether a look found where a worker call's session is recorded other than under the call itself: the start of the task it steered. */
function found(workers: ReadonlyMap<string, string>, callId: string): boolean {
  return (workers.get(callId) ?? callId) !== callId;
}

/**
 * The journal's `worker` calls, each with the call its session is read from
 * (`workerSessionCallsOf`), a start found in `earlier` or by an earlier look
 * kept. A start not recorded yet leaves the call its own until a later look
 * finds it.
 */
function workerSessionsOf(
  message: StoredUIMessage | undefined,
  earlier: readonly StoredUIMessage[],
  placed: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const sessions = workerSessionCallsOf(message, earlier);
  return new Map(
    [...sessions].map(([callId, session]) => [
      callId,
      found(sessions, callId) ? session : (placed.get(callId) ?? session),
    ]),
  );
}

/** What one look answers the follow: the turn still runs, it ended, or it ran past the bound that applies to it. */
const FOLLOW_LOOK = {
  RUNNING: "running",
  ENDED: "ended",
  OVERDUE: "overdue",
} as const;

type FollowLook = (typeof FOLLOW_LOOK)[keyof typeof FOLLOW_LOOK];

/**
 * How much of what Luke said with no call up a call back is handed, the
 * newest kept: a catch-up the voice says in a sentence or two, never a
 * replay of every reply.
 */
const MISSED_MAX_CHARS = 1_200;

/** A join that found nothing to take up and set nothing off. */
function nothingJoined(joined: boolean): LiveBrainJoin {
  return { joined, runs: [], missed: undefined, questions: [], follow: Effect.void };
}

/** The questions queued past the position given and not taken back since, oldest first. */
function questionsOf(events: readonly TurnEvent[], heard: number): LiveBrainQuestion[] {
  const queued: LiveBrainQuestion[] = [];
  for (const event of events) {
    if (event.seq <= heard) continue;
    if (event.kind === TURN_EVENT_KIND.QUESTION_QUEUED) {
      queued.push({ question: event.question, recommendation: event.recommendation });
    } else if (event.kind === TURN_EVENT_KIND.QUESTION_WITHDRAWN) {
      const at = queued.findIndex((held) => held.question === event.question);
      if (at >= 0) queued.splice(at, 1);
    }
  }
  return queued;
}

/** The newest of the sentences that fit the bound, oldest first; one too long alone is cut from its start. */
function missedOf(sentences: readonly string[]): string | undefined {
  const kept: string[] = [];
  let length = 0;
  for (const sentence of [...sentences].reverse()) {
    if (length + sentence.length + 1 > MISSED_MAX_CHARS) break;
    kept.unshift(sentence);
    length += sentence.length + 1;
  }
  const newest = sentences.at(-1);
  if (kept.length === 0 && newest !== undefined) return `…${newest.slice(-MISSED_MAX_CHARS)}`;
  return kept.length === 0 ? undefined : kept.join(" ");
}

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
  if (action.length <= TASK_ACTIVITY_ACTION_MAX_CHARS) return action;
  return `${action.slice(0, TASK_ACTIVITY_ACTION_MAX_CHARS - 1)}…`;
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
    .some((part) => BRAIN_DELEGATION_TOOLS.has(storedToolName(part)));
}

/** The calls about the task's questions rather than its work. */
const QUESTION_TOOL_NAMES: ReadonlySet<string> = new Set([
  QUEUE_QUESTION_TOOL.name,
  WITHDRAW_QUESTION_TOOL.name,
]);

/**
 * The turn's settled calls, oldest first, as the kind of step each was: a
 * repository command as a repository read, and every other call as no named
 * kind. A queued or withdrawn question is the task's next question and no
 * step of the work, so it is not counted. Note that we read which tool was called and
 * nothing of its input or output, so a settled step tells the voice no
 * command and no line the repository holds.
 */
function settledStepsOf(journal: StoredUIMessage | undefined): readonly (string | undefined)[] {
  return (journal?.parts ?? [])
    .filter(isStoredToolPart)
    .filter((part) => isSettledToolPartState(part.state))
    .filter((part) => !QUESTION_TOOL_NAMES.has(storedToolName(part)))
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
  /** The account the voice session was opened for, resolved at the handshake: every ask is admitted as theirs. */
  readonly accountId: string;
  /** The conversation every ask lands in: the task's, the same one its record writes, under the member who opened it. */
  readonly conversation: ConversationTarget;
  /** The developer's time zone, handed with every ask so the turn reads the day in it; none reads UTC. */
  readonly timeZone?: string | undefined;
  /** The ask door's seams: the ask record, and eve under the deployment principal for this account, which sends a spoken ask and nothing else. */
  readonly asks: AskSeams<typeof BRAIN_HOST_TURN.SPOKEN>;
  /** The store the standing and the journal are read from, on the connection the socket's own fiber holds. */
  readonly store: Pick<HostedStore, "turns" | "messages">;
  /** The writer a cancelled run's turn is stamped through, as every Stop stamps it. */
  readonly writer: Pick<StoreWriter, "requestTurnCancel">;
  readonly report: (message: string) => void;
  /** The statements a followed turn's record is read again on as they move over Neon Realtime: the task conversation's mark and its running workers (`taskConversationLiveStatements`). */
  readonly live: readonly LiveStatement[];
  /** The follow's own bounds, narrowed by a test so the bound is reached inside a test. */
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
  onWork(listener: (work: TaskWorkTurn) => void): () => void;
}

export const hostedLiveBrain = /* @__PURE__ */ Effect.fn("web/hostedLiveBrain")(function* (
  options: HostedLiveBrainOptions,
): Effect.fn.Return<HostedLiveBrain, never, Scope.Scope | DatabaseServices> {
  const sql = yield* SqlClient.SqlClient;
  const database = yield* Database;
  const socket = yield* Effect.scope;
  // Note that the wake is taken here, where the socket's runtime provides it, since a follow runs on a fiber of the socket's scope.
  const wake = yield* LiveWake;
  const bounds = { ...LIVE_BRAIN_FOLLOW_BOUNDS, ...options.bounds };
  const listeners = new Set<(event: LiveBrainRunEvent) => void>();
  const workListeners = new Set<(work: TaskWorkTurn) => void>();
  /** Each followed ask by its ask revision, so the newest of several is known. */
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
  /**
   * The told positions still to be written, oldest first, run one at a time
   * by the writer below so the row moves in the order the voice was told.
   * The socket's close lets the write in hand finish and then writes what is
   * left, so a detach loses no position it had already told.
   */
  const checkpoints = yield* Queue.unbounded<Effect.Effect<void, never, DatabaseServices>>();
  yield* Scope.addFinalizer(
    socket,
    Effect.flatMap(Queue.clear(checkpoints), (left) => Effect.forEach(left, (write) => write)).pipe(
      Effect.provideService(SqlClient.SqlClient, sql),
      Effect.provideService(Database, database),
    ),
  );
  yield* Effect.forkIn(
    Effect.withErrorReporting(
      Effect.forever(Effect.flatMap(Queue.take(checkpoints), Effect.uninterruptible)),
    ),
    socket,
  );
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
      const standing = yield* askStanding(reads, options.conversation.userId, later);
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
   * Tells events under the ask and then hands the writer the row's move past
   * them, so the voice hears them without waiting on the store. A row the
   * store could not move is reported; the telling stands, since leaving the
   * reply unsaid is worse than a re-attach that might say it again.
   */
  const tell = Effect.fnUntraced(function* (
    askId: string,
    told: { readonly seq: number; readonly ended: boolean },
    events: readonly LiveBrainRunEvent[],
  ) {
    if (events.length === 0) return;
    const at = told.ended ? new Date(yield* Clock.currentTimeMillis) : undefined;
    for (const event of events) emit(event);
    Queue.offerUnsafe(
      checkpoints,
      options.asks.asks
        .told(askId, at === undefined ? { seq: told.seq } : { seq: told.seq, endAt: at })
        .pipe(
          Effect.tapError(logStoreFailure),
          Effect.catch(() =>
            Effect.sync(() => options.report("How far a spoken ask was told could not be written")),
          ),
        ),
    );
  });

  /**
   * The journals of each subagent the calls named started or sent work to,
   * by call, read from the child conversation each call's session is
   * recorded in, with the title of each that has one and what each ran on
   * and spent. A subagent whose journals could not be read is left out, so
   * its call is drawn without its session rather than ending the ask, and
   * titles or records that could not be read leave every session without
   * them.
   */
  const subagentJournalsOf = Effect.fnUntraced(function* (
    conversationId: string,
    sessions: ReadonlyMap<string, string>,
  ) {
    const children = new Map<string, string>();
    const journals = new Map<string, readonly SubagentJournal[]>();
    for (const [callId, sessionCallId] of sessions) {
      const child = childConversationId(conversationId, sessionCallId);
      children.set(callId, child);
      const read = yield* listJournals(
        options.conversation.userId,
        child,
        HOSTED_TOOL_SET,
        SUBAGENT_JOURNALS,
      ).pipe(
        Effect.tapError(logStoreFailure),
        Effect.orElseSucceed(() => undefined),
      );
      if (read?.ok) journals.set(callId, read.value);
    }
    const titles = yield* childTitlesByCall(
      { userId: options.conversation.userId, conversationId },
      children,
    ).pipe(
      Effect.tapError(logStoreFailure),
      Effect.orElseSucceed((): ReadonlyMap<string, string> => new Map()),
    );
    const records = yield* subagentRecordsByCall(options.conversation.userId, journals).pipe(
      Effect.tapError(logStoreFailure),
      Effect.orElseSucceed((): ReadonlyMap<string, TurnRecord> => new Map()),
    );
    return { journals, titles, records };
  });

  /**
   * The conversation's journals that call the worker, where a task an
   * earlier turn started was started; none where they could not be read.
   */
  const workerJournalsOf = (conversationId: string) =>
    brainDelegationJournalsOf(options.conversation.userId, conversationId).pipe(
      Effect.tapError(logStoreFailure),
      Effect.orElseSucceed((): StoredUIMessage[] => []),
    );

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
    const standing = yield* askStanding(reads, options.conversation.userId, askId);
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
    const {
      journals: subagents,
      titles,
      records,
    } = yield* subagentJournalsOf(turn.conversationId, told.workers);
    // The start of a task the last look's calls steered is looked for ahead of the journal too.
    const earlier = told.seeking ? yield* workerJournalsOf(turn.conversationId) : [];
    // So are the lines the turn has taken as its ask.
    const asked = yield* options.store.messages.spokenAskRows(
      options.conversation.userId,
      turn.conversationId,
      [turn.id],
    );
    told.asked = asked.get(turn.id) ?? [];
    // A task call's turns call the brain's tools, so the journal is read
    // under every tool a hosted conversation's rows may name.
    const journal = yield* options.store.messages.byClientId(
      options.conversation.userId,
      turn.conversationId,
      HOSTED_TOOL_SET,
      turn.id,
    );
    if (!journal.ok) {
      options.report("A spoken ask's journal could not be read; its turn is told as failed");
      endFailed(askId);
      return FOLLOW_LOOK.ENDED;
    }
    const record = journal.value[0];
    const message = record?.message;
    // Note that the time a call's code is told under is its journal's, which is what the task's work reads back.
    const shownAt = (record?.createdAt ?? turn.startedAt ?? turn.queuedAt).getTime();
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
    told.workers = telling ? workerSessionsOf(message, earlier, told.workers) : new Map();
    told.seeking = callsSendingToEarlierTasks(message).some(
      (callId) => !found(told.workers, callId),
    );
    const work = telling
      ? taskWorkOf(turn, message, subagents, titles, records, told.asked)
      : undefined;
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
      if (ended) yield* tell(askId, { seq: 0, ended }, [runEventOf(last, askId, shownAt)]);
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
      toTell.map((event) => runEventOf(event, askId, shownAt)),
    );
    return ended ? FOLLOW_LOOK.ENDED : yield* standingLook(told, since);
  });

  /**
   * Follows one accepted ask to its turn's end as its record moves, on a fiber of
   * the socket's scope, or until the follow bound or that scope's close. The
   * bound is kept by the look rather than the wait, because which bound
   * applies is read off the journal: the plain one, or the parked one once
   * the turn has handed work to a task. A bound reached with the turn still
   * unended is told as a failed end, so the exchange settles and the voice
   * says the standing note rather than waiting forever on a turn eve never
   * started. A follow the scope's close interrupted tells nothing: the
   * session it would have told is gone. A follow that failed or died is
   * reported to Sentry besides being told failed, since no request is there
   * to carry it; its interruption is not.
   */
  function follow(askId: string, revision: number) {
    if (followed.has(askId)) return Effect.void;
    followed.set(askId, revision);
    const told: FollowTold = {
      action: undefined,
      settled: 0,
      delegated: false,
      work: undefined,
      workers: new Map(),
      seeking: false,
      asked: [],
    };
    // Note that the follow reads the record at once, then again each time the conversation's
    // mark moves over Neon Realtime, because the mark says only that something moved and the record says what.
    const ended = (since: number) =>
      Effect.map(look(askId, told, since), (last) =>
        last === FOLLOW_LOOK.RUNNING ? Option.none<FollowLook>() : Option.some(last),
      );
    const looking = Effect.gen(function* () {
      const since = yield* Clock.currentTimeMillis;
      // Note that the hold is the widest bound, since the look itself says which bound the turn is past.
      const last = yield* lookedUntil(ended(since), bounds.PARKED_FOLLOW, options.live);
      return Option.getOrElse(last, () => FOLLOW_LOOK.OVERDUE);
    }).pipe(Effect.provideService(LiveWake, wake));
    const following = looking.pipe(
      Effect.withErrorReporting,
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
    return Effect.asVoid(Effect.forkIn(Effect.withErrorReporting(following), socket));
  }

  /**
   * What of one earlier call's turn nobody heard: the sentences past the last
   * event told, which the call back is handed as its catch-up, the questions
   * queued since and not taken back, which it asks in turn, and the
   * position everything the turn holds now is to count as told from, so its
   * follow says nothing of it again, a goodbye's end of the call included.
   * None where the turn's journal cannot be read.
   */
  const unheardOf = Effect.fnUntraced(function* (turn: StoredTurnRecord, heard: number) {
    const journal = yield* options.store.messages.byClientId(
      options.conversation.userId,
      turn.conversationId,
      HOSTED_TOOL_SET,
      turn.id,
    );
    if (!journal.ok) return undefined;
    const events = projectTurnEvents(turn, journal.value[0]?.message);
    const held = events.filter((event) => event.kind !== TURN_EVENT_KIND.ENDED);
    return {
      seq: Math.max(heard, ...held.map((event) => event.seq)),
      ended: events.at(-1)?.kind === TURN_EVENT_KIND.ENDED,
      sentences: held.flatMap((event) =>
        event.kind === TURN_EVENT_KIND.REPLY_SENTENCE && event.seq > heard ? [event.sentence] : [],
      ),
      questions: questionsOf(events, heard),
    };
  });

  /**
   * A call back takes up the work earlier calls left: each spoken ask of the
   * conversation not yet told to its end nor stopped, made inside the
   * window a follow could still hear its turn end in. What its turn said
   * unheard becomes the catch-up, and the questions it queued are handed on;
   * this call's follow starts past all of it, and the follow the caller runs
   * once it has handed them over counts them told on the row, so the next
   * call says none of it again, while a call that went before then leaves
   * them for the next. A turn already over is done with there, and one still
   * running, or an ask eve has not started, is followed from there under
   * revision zero, below any ask this call makes. Note that this reads and writes through the
   * same standing reads the asks are followed by, so an ask the account no
   * longer reaches is passed over as the follow would pass it.
   */
  const takeUp = Effect.fnUntraced(function* () {
    const now = yield* Clock.currentTimeMillis;
    const since = new Date(now - Duration.toMillis(bounds.PARKED_FOLLOW));
    const unended = yield* options.asks.asks.unendedSpoken(
      options.conversation.userId,
      options.conversation.conversationId,
      since,
    );
    const runs: string[] = [];
    const missed: string[] = [];
    const questions: LiveBrainQuestion[] = [];
    const heardAll: ReturnType<typeof options.asks.asks.told>[] = [];
    const turns = new Map<string, { readonly seq: number; readonly ended: boolean }>();
    for (const ask of unended) {
      const standing = yield* askStanding(reads, options.conversation.userId, ask.id);
      if (standing === undefined) continue;
      const { turn } = standing;
      if (turn === undefined) {
        runs.push(ask.id);
        continue;
      }
      if (turn.cancelRequestedAt !== null) continue;
      let read = turns.get(turn.id);
      if (read === undefined) {
        const heard = Math.max(
          0,
          ...unended.filter((other) => other.turnId === turn.id).map((other) => other.toldSeq),
        );
        const unheard = yield* unheardOf(turn, heard);
        if (unheard === undefined) {
          options.report("An earlier call's turn could not be read; the call back leaves it");
          continue;
        }
        missed.push(...unheard.sentences);
        questions.push(...unheard.questions);
        recoveredSeq.set(turn.id, Math.max(recoveredSeq.get(turn.id) ?? 0, unheard.seq));
        read = unheard;
        turns.set(turn.id, read);
      }
      heardAll.push(
        options.asks.asks.told(
          ask.id,
          read.ended ? { seq: read.seq, endAt: new Date(now) } : { seq: read.seq },
        ),
      );
      if (!read.ended) runs.push(ask.id);
    }
    // A position that could not be written leaves the catch-up for the next call to hand again.
    const heard = Effect.all(heardAll, { discard: true }).pipe(
      Effect.tapError(logStoreFailure),
      Effect.catch(() =>
        Effect.sync(() => options.report("How far a call back caught up could not be written")),
      ),
    );
    return {
      joined: true,
      runs,
      missed: missedOf(missed),
      questions,
      follow: Effect.andThen(
        heard,
        Effect.forEach(runs, (runId) => follow(runId, 0), { discard: true }),
      ).pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.provideService(Database, database),
      ),
    } satisfies LiveBrainJoin;
  });

  /** Accepts one ask through the door and follows it under the revision given. */
  function submit(
    input: AskInput<typeof ASK_ORIGIN.SPOKEN>,
    revision: number,
  ): Effect.Effect<LiveBrainSubmission> {
    return Effect.gen(function* () {
      const outcome = yield* acceptAsk(options.asks, input);
      if (Result.isFailure(outcome)) {
        return {
          outcome: LIVE_BRAIN_SUBMISSION.REFUSED,
          refusal: HOSTED_ASK_REFUSAL_NOTE[outcome.failure.refusal],
        } as const;
      }
      yield* follow(outcome.success.id, revision);
      return { outcome: LIVE_BRAIN_SUBMISSION.ACCEPTED, runId: outcome.success.id } as const;
    }).pipe(
      Effect.provideService(SqlClient.SqlClient, sql),
      Effect.provideService(Database, database),
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
          } as const;
        }),
      ),
    );
  }

  return {
    submitAsk(ask) {
      return submit(
        {
          accountId: options.accountId,
          userId: options.conversation.userId,
          question: ask.question,
          origin: ASK_ORIGIN.SPOKEN,
          clientId: ask.submissionId,
          conversationId: options.conversation.conversationId,
          voice: { sessionId: ask.sessionId, revision: ask.revision },
          timeZone: options.timeZone,
        },
        ask.revision,
      );
    },
    // Note that the plan's first call is the one whose conversation no ask
    // has yet reached eve in: it explores, under the session's id as the
    // ask's client id, because one session starts once, so a second start
    // explores nothing twice; the ask names no voice session, because it
    // answers no delegation a re-attached connection could take up, and it
    // is followed under revision zero, below every spoken ask's, so the
    // developer's first ask tells a turn the two share. Every later call
    // takes up what earlier calls left instead, and asks eve nothing.
    join(sessionId) {
      return Effect.gen(function* () {
        const latest = yield* options.asks.asks.latestSession(
          options.conversation.userId,
          options.conversation.conversationId,
        );
        if (latest !== undefined) return yield* takeUp();
        const explored = yield* submit(
          {
            accountId: options.accountId,
            userId: options.conversation.userId,
            question: BRAIN_EXPLORE_ASK,
            origin: ASK_ORIGIN.SPOKEN,
            clientId: sessionId,
            conversationId: options.conversation.conversationId,
            timeZone: options.timeZone,
          },
          0,
        );
        if (explored.outcome === LIVE_BRAIN_SUBMISSION.REFUSED) return nothingJoined(false);
        return { ...nothingJoined(false), runs: [explored.runId] };
      }).pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.provideService(Database, database),
        // The record could not be read: the call starts with nothing taken up
        // and nothing set off, rather than exploring a plan it may have explored.
        Effect.tapError(logStoreFailure),
        Effect.catch(() =>
          Effect.sync(() => {
            options.report("A fresh call could not read the plan's earlier work");
            return nothingJoined(false);
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
        options.conversation.userId,
        runId,
      ).pipe(
        Effect.map(cancelOf),
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.provideService(Database, database),
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
        const asked = yield* options.asks.asks.spokenIn(options.conversation.userId, sessionId);
        const now = yield* Clock.currentTimeMillis;
        for (const ask of asked) {
          if (ask.turnId === undefined) continue;
          recoveredSeq.set(ask.turnId, Math.max(recoveredSeq.get(ask.turnId) ?? 0, ask.toldSeq));
        }
        const runs: LiveBrainRecoveredRun[] = [];
        for (const ask of asked) {
          if (ask.endToldAt !== undefined) continue;
          const standing = yield* askStanding(reads, options.conversation.userId, ask.id);
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
          follow: Effect.forEach(runs, (run) => follow(run.runId, run.revision), {
            discard: true,
          }).pipe(
            Effect.provideService(SqlClient.SqlClient, sql),
            Effect.provideService(Database, database),
          ),
        };
        return recovery;
      }).pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.provideService(Database, database),
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
