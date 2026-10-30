import {
  AGENT_CALL_FAILURE,
  type AgentMessagesAnswerView,
  type AgentTranscriptPage,
} from "@luke/features/agent-view";
import {
  AGENT_BOUNDS,
  AGENT_CURSOR_START,
  AGENT_STATUS,
  type AgentNewestAnswer,
  type AgentTranscriptMessage,
  applyMessagesPage,
} from "@luke/features/agent-wire";
import { FAILURE_FACT, type FailureFacts } from "@luke/features/failure-facts";
import {
  type AgentTranscriptLiveAnswer,
  agentTranscriptLiveRowsSchema,
  LIVE_SIGNED_OUT,
  type SealedLiveQueryWire,
  type TranscriptNowAnswer,
} from "@luke/features/live-wire";
import { joinedWindowRows, windowMessagesOf } from "@luke/features/transcript-window";
import { MESSAGE_ROLE } from "@luke/wire";
import {
  Data,
  Duration,
  Effect,
  Fiber,
  Option,
  RcMap,
  Schedule,
  type Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import { decodedLiveRows, LIVE_STATE, type SealedRead } from "./live-follow.js";

/**
 * transcript-follow.ts -- a coding agent's transcript, or one of its workers', followed here over the service's held poll for the windows that draw it, each page told as it is read.
 *
 * A follow opens with the window this host last told of the transcript,
 * where it holds one (`transcript-held.ts`), before it asks the service
 * anything, and reads on from its cursor; otherwise with the transcript's
 * newest page, read beside the live read rather than after it, so the
 * window draws the end of the transcript after one request. The older pages
 * are the window's to ask for. Once the statements the pages are read from
 * (`transcript-live.ts` on the service) are followed, the follow reads past
 * the newest page's cursor, which
 * misses nothing written meanwhile, then the next page at once while the
 * last came back full. A page with fewer than a page's most is caught up.
 * From then on the newest messages are the statements' own rows (`window`,
 * `windowParts`), which the follow draws (`windowMessagesOf`) and tells as
 * they change, with no page read again. The live read answers those rows
 * only past the cursor it last named, so the follow joins each answer onto
 * the rows it holds by message id (`joinedWindowRows`), and takes an answer whole
 * where it names no cursor of the follow's, as after a rewind; a page is
 * read again only when the
 * turns, the titles, or the workers move, since what it carries beside its
 * messages, the agent's status, its usage priced from the model catalog,
 * its context and its workers, is still the service's.
 * Where the service says the clock alone may move the page in so long, as
 * an agent passing the grace its first turn had to land in or the window of
 * a title it waits on closing, which no row says, the page is read again
 * then too.
 *
 * The live read is let go a while after the last follow let go of it. A
 * first read the service did not answer is asked for again every `RESEAL`,
 * at most `RESEALS` times, and then the follow is told the transcript could
 * not be read, which the window offers to try again, as it is where the
 * live read stops for good. One the account does not reach is told not
 * found.
 */

/** How long a live read no follow holds is kept, so the window's next read finds it standing. */
const IDLE = Duration.seconds(30);
/** How long after a read the service did not answer the transcript is read again. */
const RESEAL = Duration.seconds(1);
/** How many times in a row a read the service did not answer is asked for again before the follow says the transcript could not be read. */
const RESEALS = 30;

/** The service did not answer the transcript's live read, asked `RESEALS` times over: the last failure it answered, and what failed beneath it where the client said. */
class SealUnanswered extends Data.TaggedError("SealUnanswered")<{
  readonly failure: string;
  readonly cause?: FailureFacts;
}> {}

/** Which transcript: an agent's own, or one of its workers' by the delegation call that started it. A task's planning workers are keyed by their composer's own key, on the same terms. */
export class TranscriptKey extends Data.Class<{
  readonly agentId: string;
  readonly callId: string | undefined;
}> {}

/** The newest messages as the rows last drew them, and the lowest and highest sequence among them. */
interface Drawn {
  readonly messages: readonly AgentTranscriptMessage[];
  readonly lowest: number;
  readonly highest: number;
  /** The conversation's journal revision as delivered beside them, which every change to a message past it counts up; none before the conversation's row lands. */
  readonly revision: number | undefined;
  /** The developer's lines among them that no turn has taken yet, by id, each of which puts the agent to work. */
  readonly awaiting: ReadonlySet<string>;
}

/** What the statements last delivered: what a page beside the messages is read by, as one digest any change to it moves, and the newest messages drawn. */
type LiveState =
  | { readonly kind: typeof LIVE_STATE.WAITING }
  | { readonly kind: typeof LIVE_STATE.STANDING; readonly digest: string; readonly drawn: Drawn }
  | { readonly kind: typeof LIVE_STATE.BROKEN; readonly cause: FailureFacts };

/** What a transcript's read is answered from. */
type Standing =
  | {
      readonly kind: typeof LIVE_STATE.LIVE;
      readonly state: SubscriptionRef.SubscriptionRef<LiveState>;
    }
  | { readonly kind: typeof LIVE_STATE.REFUSED };

/** A failure as the service answered one, with what failed beneath it where the client said. */
interface Failed {
  readonly failure: string;
  readonly cause?: FailureFacts;
}

export interface TranscriptFollowDependencies<Key = TranscriptKey> {
  /** The transcript's live read, its rows inline, held past `after` where it names one, its newest messages past `cursor`; not found, or a failure where the service answered none. */
  readonly seal: (
    key: Key,
    poll: boolean,
    userId: string,
    after?: string,
    cursor?: string,
  ) => Effect.Effect<AgentTranscriptLiveAnswer | Failed>;
  /** The account signed in now, which a follow is read for from its first read on; none where nobody is. */
  readonly accountId: () => string | undefined;
}

/** The live reads the windows' follows share, each held while followed and a while after. */
export type TranscriptFollows<Key = TranscriptKey> = RcMap.RcMap<Key, Standing, SealUnanswered>;

/**
 * The rows a page beside the messages is read by as one text, in no order of
 * Postgres's, so only a change to one moves it: the turns, the titles, the
 * workers, the queue's revision, and the developer's lines still awaiting a
 * turn. Note that the messages and the journal's revision are left out,
 * because the window's own rows carry the messages; and that a line awaiting
 * its turn is in, because whoever wrote it, a queue's hand-off or another
 * member, the agent's status moves with it, which only a page says. Held
 * here alone, so it needs no hash, and the host loads where no `node:`
 * module does.
 */
function digestOf(rows: typeof agentTranscriptLiveRowsSchema.Type): string {
  const parts = {
    turns: rows.turns,
    conversation: rows.conversation.map(({ id, title }) => ({ id, title })),
    agent: rows.agent,
    workers: rows.workers,
    queue: rows.queueRevision ?? [],
    awaiting: rows.window
      .filter((row) => row.role === MESSAGE_ROLE.USER && row.turnStatus === null)
      .map(({ id }) => ({ id })),
  };
  return JSON.stringify(
    Object.entries(parts).map(
      ([part, list]) => [part, list.map((row) => JSON.stringify(row)).toSorted()] as const,
    ),
  );
}

/** A value as JSON with every object's keys in order, so two messages alike read alike whichever read built them. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, held: unknown) =>
    held !== null && typeof held === "object" && !Array.isArray(held)
      ? Object.fromEntries(
          Object.entries(held).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : held,
  );
}

/** The window's messages as the rows draw them, with the sequences they span. */
function drawnOf(rows: typeof agentTranscriptLiveRowsSchema.Type): Drawn {
  const seqs = rows.window.map((row) => row.seq);
  const revisions = rows.conversation.map((row) => row.revision);
  return {
    messages: windowMessagesOf(rows.window, rows.windowParts),
    lowest: seqs.length === 0 ? 0 : Math.min(...seqs),
    highest: seqs.length === 0 ? 0 : Math.max(...seqs),
    revision: revisions.length === 0 ? undefined : Math.max(...revisions),
    awaiting: new Set(
      rows.window
        .filter((row) => row.role === MESSAGE_ROLE.USER && row.turnStatus === null)
        .map((row) => row.id),
    ),
  };
}

/** A cursor's highest message sequence, and the journal revision it was read at. */
function cursorParts(cursor: string): { readonly seq: number; readonly revision: string } {
  const [seq = "0", revision = "0"] = cursor.split(":");
  return { seq: Number(seq), revision };
}

/**
 * The read as the host follows it: every statement the service answered but
 * the count of its messages, which released desktops wake on and this host
 * needs no longer, since the window's own rows carry the messages.
 */
function followedRead(sealed: AgentTranscriptLiveAnswer): SealedRead<string> {
  const { messages: _messages, ...queries } = sealed.queries;
  // Note that a part an older service does not answer, the queue's, is left out rather than followed as nothing.
  const answered: Record<string, SealedLiveQueryWire> = {};
  for (const [part, query] of Object.entries(queries)) {
    if (query !== undefined) answered[part] = query;
  }
  return { url: sealed.url, queries: answered };
}

/** A read's answer as the host follows it: the read without the count of its messages, or the failure as answered. */
function followedAnswer<Failure extends Failed>(answer: AgentTranscriptLiveAnswer | Failure) {
  return "failure" in answer ? answer : followedRead(answer);
}

/** The transcript's first read, its newest messages past the start, asked again every `RESEAL` up to `RESEALS` times while the service does not answer; none where the account does not reach it. */
function sealedOf(
  seal: (
    poll: boolean,
    after?: string,
    cursor?: string,
  ) => Effect.Effect<AgentTranscriptLiveAnswer | Failed>,
): Effect.Effect<Option.Option<AgentTranscriptLiveAnswer>, SealUnanswered> {
  return seal(false, undefined, AGENT_CURSOR_START).pipe(
    Effect.flatMap((answer) => {
      if (!("failure" in answer)) return Effect.succeed(Option.some(answer));
      if (
        answer.failure === AGENT_CALL_FAILURE.NOT_FOUND ||
        answer.failure === LIVE_SIGNED_OUT.failure
      ) {
        return Effect.succeed(Option.none());
      }
      const { failure, cause } = answer;
      return Effect.fail(
        new SealUnanswered(cause === undefined ? { failure } : { failure, cause }),
      );
    }),
    Effect.retry({ schedule: Schedule.spaced(RESEAL), times: RESEALS }),
  );
}

/** The map a composer holds for as long as it stands. */
export function transcriptFollows<Key = TranscriptKey>(
  dependencies: TranscriptFollowDependencies<Key>,
): Effect.Effect<TranscriptFollows<Key>, never, Scope.Scope> {
  return RcMap.make({
    idleTimeToLive: IDLE,
    lookup: (key: Key) =>
      Effect.gen(function* () {
        // The account the follow starts for, which every poll names, so one under another's session is refused as signed out.
        const userId = dependencies.accountId();
        const seal = (
          poll: boolean,
          after?: string,
          cursor?: string,
        ): Effect.Effect<AgentTranscriptLiveAnswer | Failed> =>
          userId === undefined
            ? Effect.succeed(LIVE_SIGNED_OUT)
            : dependencies.seal(key, poll, userId, after, cursor);
        const first = yield* sealedOf(seal);
        if (Option.isNone(first)) return { kind: LIVE_STATE.REFUSED } as const;
        const state = yield* SubscriptionRef.make<LiveState>({ kind: LIVE_STATE.WAITING });
        // A live read that stops for good, signed out or a row that does not decode, marks the state broken.
        yield* Effect.forkScoped(
          Stream.runForEach(
            decodedLiveRows(
              { poll: (after, cursor) => Effect.map(seal(true, after, cursor), followedAnswer) },
              followedRead(first.value),
              agentTranscriptLiveRowsSchema,
              joinedWindowRows,
            ),
            (decoded) =>
              SubscriptionRef.set(state, {
                kind: LIVE_STATE.STANDING,
                digest: digestOf(decoded),
                drawn: drawnOf(decoded),
              }),
          ).pipe(
            Effect.catch((broken) =>
              SubscriptionRef.set(state, {
                kind: LIVE_STATE.BROKEN,
                cause: { _tag: FAILURE_FACT.LIVE_BROKEN, reason: broken.reason },
              }),
            ),
          ),
        );
        return { kind: LIVE_STATE.LIVE, state } as const;
      }),
  });
}

/** The page as the window reads it: the service's word on whether it would have held left here. */
export function windowsPage(
  answer: TranscriptNowAnswer | AgentMessagesAnswerView,
): AgentMessagesAnswerView {
  if (!("holds" in answer)) return answer;
  const { holds: _holds, ...page } = answer;
  return page;
}

/** A page past a cursor as the follow tells it: caught up where it came back short of a page's most. */
function toldPage(answer: TranscriptNowAnswer | AgentMessagesAnswerView): AgentTranscriptPage {
  const page = windowsPage(answer);
  if ("failure" in page) return page;
  return { ...page, caughtUp: page.messages.length < AGENT_BOUNDS.MESSAGES_PAGE };
}

/** Whether a state is another than the one a page was read at. */
function movedFrom(was: LiveState): (state: LiveState) => boolean {
  return (state) =>
    state.kind !== was.kind ||
    (state.kind === LIVE_STATE.STANDING &&
      was.kind === LIVE_STATE.STANDING &&
      state.digest !== was.digest);
}

/** A page the service did not answer, which is read again after `RESEAL`; not found is the service's last word. */
function unanswered(answer: { readonly failure: string } | object): boolean {
  return "failure" in answer && answer.failure !== AGENT_CALL_FAILURE.NOT_FOUND;
}

/** A page that could not be read, as the window draws it, with what failed beneath it, which the window reports. */
function unansweredPage(cause: FailureFacts): AgentTranscriptPage {
  return { failure: AGENT_CALL_FAILURE.UNANSWERED, cause };
}

/** What a first read the service kept not answering says of itself: the failure it last answered as its code, and what failed beneath that. */
function sealFacts({ failure, cause }: SealUnanswered): FailureFacts {
  return {
    _tag: FAILURE_FACT.SEAL_UNANSWERED,
    code: failure,
    ...(cause === undefined ? undefined : { cause }),
  };
}

/** How one followed transcript is read at once: its newest page, which the follow opens with, and the page past a cursor, with whether the service's held read would have held on it. */
export interface TranscriptReads {
  readonly newest: () => Effect.Effect<
    AgentNewestAnswer | Extract<AgentMessagesAnswerView, { failure: unknown }>
  >;
  readonly after: (after: string) => Effect.Effect<TranscriptNowAnswer | AgentMessagesAnswerView>;
}

/** What this host holds of one followed transcript (`transcript-held.ts`): its window as last told, recalled as a follow opens, kept as each page is told, and forgotten where the transcript is gone. */
export interface TranscriptMemory {
  readonly recall: Effect.Effect<Option.Option<AgentNewestAnswer>>;
  readonly keep: (window: AgentNewestAnswer) => Effect.Effect<void>;
  readonly forget: Effect.Effect<void>;
}

/** The window held, with a page past its cursor joined on by id: the page's word on the agent, its cursor, and the held window's `before`. */
function joinedWindow(
  window: AgentNewestAnswer,
  answer: TranscriptNowAnswer | AgentMessagesAnswerView,
): AgentNewestAnswer {
  const page = windowsPage(answer);
  if ("failure" in page) return window;
  const { wakeIn: _wakeIn, ...read } = page as typeof page & { readonly wakeIn?: number };
  return {
    ...read,
    messages: applyMessagesPage(window.messages, read.messages),
    ...(window.before === undefined ? undefined : { before: window.before }),
  };
}

/**
 * The transcript followed until interrupted, each page told as it is read:
 * the window this host held of it at once where it holds one, and
 * otherwise the newest page, read beside the transcript's live read; then
 * the page past that one's cursor once the live read stands, the next at
 * once while the last came back full, and otherwise once the turns,
 * titles, or workers move, or the clock reaches the edge the service named; meanwhile each message the
 * window's rows draw anew is told at once, beside what the last page said
 * of the agent, as caught up. A held cursor the service refuses is let go
 * for the newest page, as a follow holding nothing opens with. One the
 * account does not reach is told not found, which ends the follow and lets
 * go of what was held of it, as does a live read the service stopped
 * answering or that stopped for good, told as a page that could not be read
 * and let go, so a follow after it reads anew; a page the service did not
 * answer is told as such and read
 * again after `RESEAL`. Every page told is kept in `memory`.
 */
export function followTranscript<Key>(
  follows: TranscriptFollows<Key>,
  key: Key,
  reads: TranscriptReads,
  memory: TranscriptMemory,
  tell: (page: AgentTranscriptPage) => Effect.Effect<void>,
): Effect.Effect<void> {
  return Effect.scoped(
    Effect.gen(function* () {
      let toldNotFound = false;
      const readNewest = reads.newest().pipe(
        Effect.tap((answer) => {
          if (!("failure" in answer)) {
            return Effect.andThen(
              memory.keep(answer),
              tell({ ...answer, newest: true, caughtUp: false }),
            );
          }
          toldNotFound = answer.failure === AGENT_CALL_FAILURE.NOT_FOUND;
          return Effect.andThen(toldNotFound ? memory.forget : Effect.void, tell(answer));
        }),
        // Note that a newest page the service keeps not answering is asked for `RESEALS` times, as the live read is, and then ends the follow on the failure told, so the window offers Try again.
        Effect.repeat({
          schedule: Schedule.spaced(RESEAL),
          times: RESEALS,
          until: (answer) => !unanswered(answer),
        }),
      );
      // Note that a window held is told before the service is asked anything, so the window draws it with no round trip; one holding nothing reads the newest page beside the live read, not after it, its cursor what makes following on from it safe.
      const held = yield* memory.recall;
      if (Option.isSome(held)) {
        yield* tell({ ...held.value, newest: true, held: true, caughtUp: false });
      }
      const opening = Option.isSome(held) ? undefined : yield* Effect.forkScoped(readNewest);
      const sealed = yield* Effect.result(RcMap.get(follows, key));
      if (sealed._tag === "Failure" || sealed.success.kind === LIVE_STATE.REFUSED) {
        if (opening !== undefined) yield* Fiber.interrupt(opening);
        if (sealed._tag === "Failure") {
          yield* RcMap.invalidate(follows, key);
          return yield* tell(unansweredPage(sealFacts(sealed.failure)));
        }
        yield* memory.forget;
        if (toldNotFound) return;
        return yield* tell({ failure: AGENT_CALL_FAILURE.NOT_FOUND });
      }
      const { state } = sealed.success;
      const opened =
        opening === undefined
          ? held
          : yield* Effect.map(Fiber.join(opening), (newest) =>
              "failure" in newest ? Option.none() : Option.some(newest),
            );
      if (Option.isNone(opened)) return;
      /** What the window was told, as one newest page: its cursor is where the next read follows on from. */
      let window = opened.value;
      // Whether the next read is the first past a held cursor, which falls back to the newest page where it is refused.
      let fromHeld = Option.isSome(held);
      /**
       * Each message told: as it was told, the journal revision that copy is
       * known to stand at or past, none where unknown, and whether a page or
       * the rows told it. Note that the journal revision is what orders a
       * page against the rows, because a page and the rows beside it may
       * each have read a message the other has not, and every change to a
       * message past a revision counts the revision up: a page is at least as
       * new as its cursor's revision, and the rows as the revision delivered
       * beside them.
       */
      const told = new Map<
        string,
        { readonly said: string; readonly at: number | undefined; readonly paged: boolean }
      >();
      /** A page's messages to tell, read at its cursor's revision: every one but those the rows drew at a later revision. */
      const heardPaged = (messages: readonly AgentTranscriptMessage[], cursor: string) => {
        const at = Number(cursorParts(cursor).revision);
        return messages.filter((message) => {
          const was = told.get(message.id);
          if (was !== undefined && !was.paged && was.at !== undefined && was.at > at) return false;
          told.set(message.id, { said: canonical(message), at, paged: true });
          return true;
        });
      };
      /** The rows' messages to tell: every one drawn otherwise than it was told, but those a page told at the rows' revision or later. */
      const heardDrawn = ({ messages, revision }: Drawn) =>
        messages.filter((message) => {
          const said = canonical(message);
          const was = told.get(message.id);
          if (was?.said === said) return false;
          const pagedLater =
            was?.paged === true &&
            was.at !== undefined &&
            revision !== undefined &&
            was.at >= revision;
          if (pagedLater) return false;
          told.set(message.id, { said, at: revision, paged: false });
          return true;
        });
      heardPaged(window.messages, window.cursor);
      /** The rows' messages not yet told, beside what the last page said of the agent; the cursor moves past them where they follow on from it. */
      const tellDrawn = (page: AgentTranscriptPage, state: LiveState) =>
        Effect.gen(function* () {
          if (state.kind !== LIVE_STATE.STANDING || "failure" in page) return;
          const fresh = heardDrawn(state.drawn);
          if (fresh.length === 0) return;
          const { seq, revision } = cursorParts(window.cursor);
          // Note that the cursor moves only where the window holds every message past it, so a read past it misses none.
          const cursor =
            state.drawn.lowest <= seq + 1 && state.drawn.highest > seq
              ? `${state.drawn.highest}:${revision}`
              : window.cursor;
          // Note that a line of the developer's no turn has taken yet puts the agent to work, as the service reads
          // it (`agentStatusAt`), so it is told running rather than under the last page's word for a turn
          // it follows, which would draw that turn's end beneath it.
          const opens = fresh.some((message) => state.drawn.awaiting.has(message.id));
          yield* tell({
            ...page,
            ...(opens ? { status: AGENT_STATUS.RUNNING } : undefined),
            messages: fresh,
            caughtUp: true,
          });
          window = { ...window, messages: applyMessagesPage(window.messages, fresh), cursor };
          yield* memory.keep(window);
        });
      // Note that the newest page may have been read before the live read stood, so the page past it is read once its first rows land.
      let wake: Effect.Effect<unknown> = SubscriptionRef.changes(state).pipe(
        Stream.filter(movedFrom({ kind: LIVE_STATE.WAITING })),
        Stream.runHead,
      );
      /** The last page told, whose word on the agent the rows drawn beside the next read are told with; none before the first. */
      let last: AgentTranscriptPage | undefined;
      while (true) {
        yield* wake;
        const was = yield* SubscriptionRef.get(state);
        if (was.kind === LIVE_STATE.BROKEN) {
          yield* RcMap.invalidate(follows, key);
          return yield* tell(unansweredPage(was.cause));
        }
        // Note that the rows drawn while the page is read go on being told beside it, because a
        // turn that starts moves the turns and the reply's first words land with it; the page
        // then tells only what it read at least as new as they drew (`heardPaged`).
        const lastTold = last;
        const besideRead =
          lastTold === undefined
            ? Effect.void
            : SubscriptionRef.changes(state).pipe(
                Stream.runForEach((now) => tellDrawn(lastTold, now)),
              );
        const answer = yield* Effect.scoped(
          Effect.andThen(Effect.forkScoped(besideRead), reads.after(window.cursor)),
        );
        // Note that a held cursor the service refuses, gone or stale, is let go untold, and the follow opens on the newest page as one holding nothing does; the window joins it or takes it in place of what it drew.
        if (fromHeld && unanswered(answer)) {
          yield* memory.forget;
          const newest = yield* readNewest;
          if ("failure" in newest) {
            if (newest.failure === AGENT_CALL_FAILURE.NOT_FOUND) return;
            // Note that a service that answers neither read is down rather than refusing the cursor, so the follow stays and tries both again, as any page it did not answer is read again.
            wake = Effect.sleep(RESEAL);
            continue;
          }
          fromHeld = false;
          window = newest;
          heardPaged(newest.messages, newest.cursor);
          wake = Effect.void;
          continue;
        }
        // Note that a page read at another rewind than the window's says messages the window holds were dropped, which a join would keep, so the newest page is read in its place.
        if (!("failure" in answer) && (answer.rewound ?? 0) !== (window.rewound ?? 0)) {
          fromHeld = false;
          const newest = yield* readNewest;
          if ("failure" in newest) {
            if (newest.failure === AGENT_CALL_FAILURE.NOT_FOUND) return yield* memory.forget;
            wake = Effect.sleep(RESEAL);
            continue;
          }
          window = newest;
          told.clear();
          heardPaged(newest.messages, newest.cursor);
          wake = Effect.void;
          continue;
        }
        fromHeld = false;
        // Note that whether the page is caught up is the whole page's word, before what it read older than the rows is left out.
        const whole = toldPage(answer);
        const fresh = "failure" in answer ? [] : heardPaged(answer.messages, answer.cursor);
        const shown = "failure" in answer ? answer : { ...answer, messages: fresh };
        const page = "failure" in whole ? whole : { ...whole, messages: fresh };
        yield* tell(page);
        last = page;
        if ("failure" in answer) {
          if (answer.failure === AGENT_CALL_FAILURE.NOT_FOUND) return yield* memory.forget;
          wake = Effect.sleep(RESEAL);
          continue;
        }
        window = joinedWindow(window, shown);
        yield* memory.keep(window);
        // Note that a full page is followed by the next at once, and a short one is caught up, with no empty page read to say so.
        if (answer.messages.length >= AGENT_BOUNDS.MESSAGES_PAGE) {
          wake = Effect.void;
          continue;
        }
        const moved = SubscriptionRef.changes(state).pipe(
          Stream.takeUntil(movedFrom(was)),
          Stream.runForEach((now) => tellDrawn(page, now)),
        );
        const wakeIn = "holds" in answer && answer.holds ? answer.wakeIn : undefined;
        wake =
          wakeIn === undefined ? moved : Effect.race(moved, Effect.sleep(Duration.millis(wakeIn)));
      }
    }),
  );
}
