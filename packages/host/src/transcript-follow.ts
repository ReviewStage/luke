import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentMessagesAnswerView,
  type CodingAgentTranscriptPage,
} from "@luke/features/coding-agent-view";
import {
  applyMessagesPage,
  CODING_AGENT_BOUNDS,
  type CodingAgentMessage,
  type CodingAgentNewestAnswer,
} from "@luke/features/coding-agent-wire";
import {
  type AgentTranscriptLiveAnswer,
  agentTranscriptLiveRowsSchema,
  LIVE_SIGNED_OUT,
  type TranscriptNowAnswer,
} from "@luke/features/live-wire";
import { windowMessagesOf } from "@luke/features/transcript-window";
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
import { confirmWrite, decodedLiveRows, type LiveClient, type TxWait } from "./live-follow.js";

/**
 * transcript-follow.ts -- a coding agent's transcript, or one of its workers', followed here on a Neon Realtime subscription for the windows that draw it, each page told as it is read.
 *
 * A follow opens with the window this host last told of the transcript,
 * where it holds one (`transcript-held.ts`), before it asks the service
 * anything, and reads on from its cursor; otherwise with the transcript's
 * newest page, read beside the seal rather than after it, so the window
 * draws the end of the transcript after one request. The older pages are
 * the window's to ask for. Once the
 * statements the pages are read from (`transcript-live.ts` on the service)
 * are subscribed to, the follow reads past the newest page's cursor, which
 * misses nothing written meanwhile, then the next page at once while the
 * last came back full. A page with fewer than a page's most is caught up.
 * From then on the newest messages are the statements' own rows (`window`,
 * `windowParts`), which the follow draws (`windowMessagesOf`) and tells as
 * they change, with no page read again; a page is read again only when the
 * turns, the titles, or the workers move, since what it carries beside its
 * messages, the agent's status, its usage priced from the model catalog,
 * its context and its workers, is still the service's.
 * Where the service says the clock alone may move the page in so long, as
 * an agent passing the grace its first turn had to land in or the window of
 * a title it waits on closing, which no row says, the page is read again
 * then too.
 *
 * The subscription is let go a while after the last follow let go of it. A
 * seal the service did not answer is asked for again every `RESEAL`, at
 * most `RESEALS` times, and then the follow is told the transcript could
 * not be read, which the window offers to try again; a subscription that
 * stops is marked broken, which has the follow read at once, and sealed and
 * opened again the same way. One the account does not reach is told not
 * found.
 */

/** How long a subscription no read holds is kept, so the window's next read finds it standing. */
const IDLE = Duration.seconds(30);
/** How long after a seal the service did not answer, or a subscription that stopped, the transcript is sealed again. */
const RESEAL = Duration.seconds(1);
/** How many times in a row a seal the service did not answer is asked for again before the follow says the transcript could not be read. */
const RESEALS = 30;

/** The service did not seal the transcript, asked `RESEALS` times over. */
class SealUnanswered extends Data.TaggedError("SealUnanswered")<{ readonly failure: string }> {}

/** Which transcript: an agent's own, or one of its workers' by the delegation call that started it. A task's planning workers are keyed by their composer's own key, on the same terms. */
export class TranscriptKey extends Data.Class<{
  readonly agentId: string;
  readonly callId: string | undefined;
}> {}

/** The newest messages as the rows last drew them, and the lowest and highest sequence among them. */
interface Drawn {
  readonly messages: readonly CodingAgentMessage[];
  readonly lowest: number;
  readonly highest: number;
}

/** What the statements last delivered: what a page beside the messages is read by, as one digest any change to it moves, and the newest messages drawn. */
type LiveState =
  | { readonly kind: "waiting" }
  | { readonly kind: "standing"; readonly digest: string; readonly drawn: Drawn }
  | { readonly kind: "broken" }
  | { readonly kind: "unsealed" };

/** What a transcript's read is answered from. */
type Standing =
  | {
      readonly kind: "live";
      readonly state: SubscriptionRef.SubscriptionRef<LiveState>;
      /** The wait for a write's transaction on the subscription standing now; none while it is polled or not yet live. */
      readonly txWait: () => TxWait | undefined;
    }
  | { readonly kind: "refused" };

/** A failure as the service answered one. */
interface Failed {
  readonly failure: string;
}

export interface TranscriptFollowDependencies<Key = TranscriptKey> {
  /** The transcript sealed for following, or with `poll` its rows inline, held past `after`; not found, or a failure where the service sealed none. */
  readonly seal: (
    key: Key,
    poll: boolean,
    userId: string,
    after?: string,
  ) => Effect.Effect<AgentTranscriptLiveAnswer | Failed>;
  /** The account signed in now, which a follow is sealed for from its first seal on; none where nobody is. */
  readonly accountId: () => string | undefined;
  readonly openLive: (url: string) => LiveClient | PromiseLike<LiveClient>;
  readonly now: () => number;
}

/** The subscriptions the windows' reads share, each held while read and a while after. */
export type TranscriptFollows<Key = TranscriptKey> = RcMap.RcMap<Key, Standing, SealUnanswered>;

/**
 * The rows a page beside the messages is read by as one text, in no order of
 * Realtime's, so only a change to one moves it: the turns, the titles, and
 * the workers. Note that the messages and the journal's revision are left
 * out, because the window's own rows carry the messages. Held here alone,
 * so it needs no hash, and the host loads where no `node:` module does.
 */
function digestOf(rows: typeof agentTranscriptLiveRowsSchema.Type): string {
  const parts = {
    turns: rows.turns,
    conversation: rows.conversation.map(({ id, title }) => ({ id, title })),
    agent: rows.agent,
    workers: rows.workers,
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
  return {
    messages: windowMessagesOf(rows.window, rows.windowParts),
    lowest: seqs.length === 0 ? 0 : Math.min(...seqs),
    highest: seqs.length === 0 ? 0 : Math.max(...seqs),
  };
}

/** A cursor's highest message sequence, and the journal revision it was read at. */
function cursorParts(cursor: string): { readonly seq: number; readonly revision: string } {
  const [seq = "0", revision = "0"] = cursor.split(":");
  return { seq: Number(seq), revision };
}

/**
 * The read as the host follows it: every statement the service sealed but
 * the count of its messages, which released desktops wake on and this host
 * needs no longer, since the window's own rows carry the messages.
 */
function followedRead(sealed: AgentTranscriptLiveAnswer) {
  const { messages: _messages, ...queries } = sealed.queries;
  return { url: sealed.url, queries };
}

/** A seal's answer as the host follows it: the read without the count of its messages, or the failure as answered. */
function followedAnswer<Failure extends Failed>(answer: AgentTranscriptLiveAnswer | Failure) {
  return "failure" in answer ? answer : followedRead(answer);
}

/** The transcript sealed, asked again every `RESEAL` up to `RESEALS` times while the service does not answer; none where the account does not reach it. */
function sealedOf(
  seal: (poll: boolean, after?: string) => Effect.Effect<AgentTranscriptLiveAnswer | Failed>,
): Effect.Effect<Option.Option<AgentTranscriptLiveAnswer>, SealUnanswered> {
  return seal(false).pipe(
    Effect.flatMap((answer) => {
      if (!("failure" in answer)) return Effect.succeed(Option.some(answer));
      if (
        answer.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND ||
        answer.failure === LIVE_SIGNED_OUT.failure
      ) {
        return Effect.succeed(Option.none());
      }
      return Effect.fail(new SealUnanswered({ failure: answer.failure }));
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
        // The account the follow starts for, which every renewal and poll names, so one under another's session is refused as signed out.
        const userId = dependencies.accountId();
        const seal = (poll: boolean, after?: string) =>
          userId === undefined
            ? Effect.succeed(LIVE_SIGNED_OUT)
            : dependencies.seal(key, poll, userId, after);
        const first = yield* sealedOf(seal);
        if (Option.isNone(first)) return { kind: "refused" } as const;
        const state = yield* SubscriptionRef.make<LiveState>({ kind: "waiting" });
        let txWait: TxWait | undefined;
        /** One seal followed until its subscription stops, which marks the state broken. */
        const follow = (sealed: AgentTranscriptLiveAnswer) =>
          Stream.runForEach(
            decodedLiveRows(
              {
                openLive: dependencies.openLive,
                reseal: () => Effect.map(seal(false), followedAnswer),
                poll: (after) => Effect.map(seal(true, after), followedAnswer),
                now: dependencies.now,
                onTxWait: (wait) => {
                  txWait = wait;
                },
              },
              followedRead(sealed),
              agentTranscriptLiveRowsSchema,
            ),
            (decoded) =>
              SubscriptionRef.set(state, {
                kind: "standing",
                digest: digestOf(decoded),
                drawn: drawnOf(decoded),
              }),
          ).pipe(Effect.catch(() => SubscriptionRef.set(state, { kind: "broken" })));
        yield* Effect.forkScoped(
          Effect.gen(function* () {
            let sealed = first.value;
            while (true) {
              yield* follow(sealed);
              yield* Effect.sleep(RESEAL);
              const again = yield* Effect.result(sealedOf(seal));
              // A seal the service stopped answering is said, so the follow tells the window rather than waiting on a subscription that never opens again.
              if (again._tag === "Failure") {
                return yield* SubscriptionRef.set(state, { kind: "unsealed" });
              }
              if (Option.isNone(again.success)) return;
              sealed = again.success.value;
            }
          }),
        );
        return { kind: "live", state, txWait: () => txWait } as const;
      }),
  });
}

/** The page as the window reads it: the service's word on whether it would have held left here. */
export function windowsPage(
  answer: TranscriptNowAnswer | CodingAgentMessagesAnswerView,
): CodingAgentMessagesAnswerView {
  if (!("holds" in answer)) return answer;
  const { holds: _holds, ...page } = answer;
  return page;
}

/** A page past a cursor as the follow tells it: caught up where it came back short of a page's most. */
function toldPage(
  answer: TranscriptNowAnswer | CodingAgentMessagesAnswerView,
): CodingAgentTranscriptPage {
  const page = windowsPage(answer);
  if ("failure" in page) return page;
  return { ...page, caughtUp: page.messages.length < CODING_AGENT_BOUNDS.MESSAGES_PAGE };
}

/** Whether a state is another than the one a page was read at. */
function movedFrom(was: LiveState): (state: LiveState) => boolean {
  return (state) =>
    state.kind !== was.kind ||
    (state.kind === "standing" && was.kind === "standing" && state.digest !== was.digest);
}

/** A page the service did not answer, which is read again after `RESEAL`; not found is the service's last word. */
function unanswered(answer: { readonly failure: string } | object): boolean {
  return "failure" in answer && answer.failure !== CODING_AGENT_CALL_FAILURE.NOT_FOUND;
}

const UNANSWERED_PAGE = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

/** How one followed transcript is read at once: its newest page, which the follow opens with, and the page past a cursor, with whether the service's held read would have held on it. */
export interface TranscriptReads {
  readonly newest: () => Effect.Effect<
    CodingAgentNewestAnswer | Extract<CodingAgentMessagesAnswerView, { failure: unknown }>
  >;
  readonly after: (
    after: string,
  ) => Effect.Effect<TranscriptNowAnswer | CodingAgentMessagesAnswerView>;
}

/** What this host holds of one followed transcript (`transcript-held.ts`): its window as last told, recalled as a follow opens, kept as each page is told, and forgotten where the transcript is gone. */
export interface TranscriptMemory {
  readonly recall: Effect.Effect<Option.Option<CodingAgentNewestAnswer>>;
  readonly keep: (window: CodingAgentNewestAnswer) => Effect.Effect<void>;
  readonly forget: Effect.Effect<void>;
}

/** The window held, with a page past its cursor joined on by id: the page's word on the agent, its cursor, and the held window's `before`. */
function joinedWindow(
  window: CodingAgentNewestAnswer,
  answer: TranscriptNowAnswer | CodingAgentMessagesAnswerView,
): CodingAgentNewestAnswer {
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
 * otherwise the newest page, read while the transcript is sealed; then the
 * page past that one's cursor once the subscription stands, the next at
 * once while the last came back full, and otherwise once the turns,
 * titles, or workers move, their subscription stops or opens again, or the
 * clock reaches the edge the service named; meanwhile each message the
 * window's rows draw anew is told at once, beside what the last page said
 * of the agent, as caught up. A held cursor the service refuses is let go
 * for the newest page, as a follow holding nothing opens with. One the
 * account does not reach is told not found, which ends the follow and lets
 * go of what was held of it, as does a seal the service stopped answering,
 * told as a page that could not be read and let go, so a follow after it
 * seals anew; a page the service did not answer is told as such and read
 * again after `RESEAL`. Every page told is kept in `memory`.
 */
export function followTranscript<Key>(
  follows: TranscriptFollows<Key>,
  key: Key,
  reads: TranscriptReads,
  memory: TranscriptMemory,
  tell: (page: CodingAgentTranscriptPage) => Effect.Effect<void>,
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
          toldNotFound = answer.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND;
          return Effect.andThen(toldNotFound ? memory.forget : Effect.void, tell(answer));
        }),
        // Note that a newest page the service keeps not answering is asked for `RESEALS` times, as a seal is, and then ends the follow on the failure told, so the window offers Try again.
        Effect.repeat({
          schedule: Schedule.spaced(RESEAL),
          times: RESEALS,
          until: (answer) => !unanswered(answer),
        }),
      );
      // Note that a window held is told before the service is asked anything, so the window draws it with no round trip; one holding nothing reads the newest page beside the seal, not after it, its cursor what makes following on from it safe.
      const held = yield* memory.recall;
      if (Option.isSome(held)) {
        yield* tell({ ...held.value, newest: true, held: true, caughtUp: false });
      }
      const opening = Option.isSome(held) ? undefined : yield* Effect.forkScoped(readNewest);
      const sealed = yield* Effect.result(RcMap.get(follows, key));
      if (sealed._tag === "Failure" || sealed.success.kind === "refused") {
        if (opening !== undefined) yield* Fiber.interrupt(opening);
        if (sealed._tag === "Failure") {
          yield* RcMap.invalidate(follows, key);
          return yield* tell(UNANSWERED_PAGE);
        }
        yield* memory.forget;
        if (toldNotFound) return;
        return yield* tell({ failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND });
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
      /** Each message told, as it was told, so a row drawn again alike is not told again. */
      const told = new Map<string, string>();
      const heard = (messages: readonly CodingAgentMessage[]) =>
        messages.filter((message) => {
          const said = canonical(message);
          if (told.get(message.id) === said) return false;
          told.set(message.id, said);
          return true;
        });
      heard(window.messages);
      /** The rows' messages not yet told, beside what the last page said of the agent; the cursor moves past them where they follow on from it. */
      const tellDrawn = (page: CodingAgentTranscriptPage, state: LiveState) =>
        Effect.gen(function* () {
          if (state.kind !== "standing" || "failure" in page) return;
          const fresh = heard(state.drawn.messages);
          if (fresh.length === 0) return;
          const { seq, revision } = cursorParts(window.cursor);
          // Note that the cursor moves only where the window holds every message past it, so a read past it misses none.
          const cursor =
            state.drawn.lowest <= seq + 1 && state.drawn.highest > seq
              ? `${state.drawn.highest}:${revision}`
              : window.cursor;
          yield* tell({ ...page, messages: fresh, caughtUp: true });
          window = { ...window, messages: applyMessagesPage(window.messages, fresh), cursor };
          yield* memory.keep(window);
        });
      // Note that the newest page may have been read before the subscription stood, so the page past it is read once its first rows land.
      let wake: Effect.Effect<unknown> = SubscriptionRef.changes(state).pipe(
        Stream.filter(movedFrom({ kind: "waiting" })),
        Stream.runHead,
      );
      while (true) {
        yield* wake;
        const was = yield* SubscriptionRef.get(state);
        if (was.kind === "unsealed") {
          yield* RcMap.invalidate(follows, key);
          return yield* tell(UNANSWERED_PAGE);
        }
        const answer = yield* reads.after(window.cursor);
        // Note that a held cursor the service refuses, gone or stale, is let go untold, and the follow opens on the newest page as one holding nothing does; the window joins it or takes it in place of what it drew.
        if (fromHeld && unanswered(answer)) {
          yield* memory.forget;
          const newest = yield* readNewest;
          if ("failure" in newest) {
            if (newest.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND) return;
            // Note that a service that answers neither read is down rather than refusing the cursor, so the follow stays and tries both again, as any page it did not answer is read again.
            wake = Effect.sleep(RESEAL);
            continue;
          }
          fromHeld = false;
          window = newest;
          heard(newest.messages);
          wake = Effect.void;
          continue;
        }
        // Note that a page read at another rewind than the window's says messages the window holds were dropped, which a join would keep, so the newest page is read in its place.
        if (!("failure" in answer) && (answer.rewound ?? 0) !== (window.rewound ?? 0)) {
          fromHeld = false;
          const newest = yield* readNewest;
          if ("failure" in newest) {
            if (newest.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND) return yield* memory.forget;
            wake = Effect.sleep(RESEAL);
            continue;
          }
          window = newest;
          told.clear();
          heard(newest.messages);
          wake = Effect.void;
          continue;
        }
        fromHeld = false;
        const page = toldPage(answer);
        if (!("failure" in page)) heard(page.messages);
        yield* tell(page);
        if ("failure" in answer) {
          if (answer.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND) return yield* memory.forget;
          wake = Effect.sleep(RESEAL);
          continue;
        }
        window = joinedWindow(window, answer);
        yield* memory.keep(window);
        // Note that a full page is followed by the next at once, and a short one is caught up, with no empty page read to say so.
        if (answer.messages.length >= CODING_AGENT_BOUNDS.MESSAGES_PAGE) {
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

/**
 * Confirms a write to a transcript once its transaction has reached the
 * transcript's live subscription, so the page it moved is told first; at
 * once where the transcript is not followed, is polled, or the write
 * answered no transaction.
 */
export function confirmTranscriptWrite<Key>(
  follows: TranscriptFollows<Key>,
  key: Key,
  txid: string | undefined,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (txid === undefined || !(yield* RcMap.has(follows, key))) return;
    yield* Effect.scoped(
      Effect.flatMap(RcMap.get(follows, key), (standing) =>
        standing.kind === "live" ? confirmWrite(standing.txWait(), txid) : Effect.void,
      ),
    ).pipe(
      // A follow the service never sealed shows nothing to wait for.
      Effect.catchTag("SealUnanswered", () => Effect.void),
    );
  });
}
