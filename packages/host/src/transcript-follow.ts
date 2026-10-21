import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentMessagesAnswerView,
  type CodingAgentTranscriptPage,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_BOUNDS,
  type CodingAgentNewestAnswer,
} from "@luke/features/coding-agent-wire";
import {
  type AgentTranscriptLiveAnswer,
  agentTranscriptLiveRowsSchema,
  LIVE_SIGNED_OUT,
  type TranscriptNowAnswer,
} from "@luke/features/live-wire";
import {
  Data,
  Duration,
  Effect,
  Fiber,
  Option,
  RcMap,
  Schedule,
  Schema,
  type Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import { LiveBroken, type LiveClient, liveRows } from "./live-follow.js";

/**
 * transcript-follow.ts -- a coding agent's transcript, or one of its workers', followed here on a Neon Realtime subscription for the windows that draw it, each page told as it is read.
 *
 * A follow opens with the transcript's newest page, read beside the seal
 * rather than after it, so the window draws the end of the transcript after
 * one request; the older pages are the window's to ask for. Once the
 * statements the pages are read from (`transcript-live.ts` on the service)
 * are subscribed to, the follow reads past the newest page's cursor, which
 * misses nothing written meanwhile, then the next page at once while the
 * last came back full, and otherwise again only when those statements move.
 * A page with fewer than a page's most is caught up. The page itself, its
 * usage priced from the model catalog among it, is still the service's.
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

/** What the statements last delivered, as one digest any change to any of them moves. */
type LiveState =
  | { readonly kind: "waiting" }
  | { readonly kind: "standing"; readonly digest: string }
  | { readonly kind: "broken" }
  | { readonly kind: "unsealed" };

/** What a transcript's read is answered from. */
type Standing =
  | { readonly kind: "live"; readonly state: SubscriptionRef.SubscriptionRef<LiveState> }
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

/** Every part's rows as one text, in no order of Realtime's, so only a change to a row moves it; held here alone, so it needs no hash, and the host loads where no `node:` module does. */
function digestOf(rows: typeof agentTranscriptLiveRowsSchema.Type): string {
  const parts = Object.entries(rows).map(
    ([part, list]) => [part, list.map((row) => JSON.stringify(row)).toSorted()] as const,
  );
  return JSON.stringify(parts);
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
  const decode = Schema.decodeUnknownOption(agentTranscriptLiveRowsSchema);
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
        /** One seal followed until its subscription stops, which marks the state broken. */
        const follow = (sealed: AgentTranscriptLiveAnswer) =>
          Stream.runForEach(
            liveRows(
              {
                openLive: dependencies.openLive,
                reseal: () => seal(false),
                poll: (after) => seal(true, after),
                now: dependencies.now,
              },
              sealed,
            ),
            (read) =>
              Option.match(decode(read), {
                onNone: () => Effect.fail(new LiveBroken({ reason: "a row did not decode" })),
                onSome: (decoded) =>
                  SubscriptionRef.set(state, { kind: "standing", digest: digestOf(decoded) }),
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
        return { kind: "live", state } as const;
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

/**
 * The transcript followed until interrupted, each page told as it is read:
 * the newest first, read while the transcript is sealed, then the page past
 * its cursor once the subscription stands, the next at once while the last
 * came back full, and otherwise once the statements move, their
 * subscription stops or opens again, or the clock reaches the edge the
 * service named. One the account does not reach is told not found, which
 * ends the follow, as does a seal the service stopped answering, told as a
 * page that could not be read and let go, so a follow after it seals anew;
 * a page the service did not answer is told as such and read again after
 * `RESEAL`.
 */
export function followTranscript<Key>(
  follows: TranscriptFollows<Key>,
  key: Key,
  reads: TranscriptReads,
  tell: (page: CodingAgentTranscriptPage) => Effect.Effect<void>,
): Effect.Effect<void> {
  return Effect.scoped(
    Effect.gen(function* () {
      // Note that the newest page is read beside the seal, not after it, so the window draws the end while the subscription opens; its cursor is what makes following on from it safe.
      let toldNotFound = false;
      const opening = yield* Effect.forkScoped(
        reads.newest().pipe(
          Effect.tap((answer) => {
            if (!("failure" in answer)) return tell({ ...answer, newest: true, caughtUp: false });
            toldNotFound = answer.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND;
            return tell(answer);
          }),
          Effect.repeat({
            schedule: Schedule.spaced(RESEAL),
            until: (answer) => !unanswered(answer),
          }),
        ),
      );
      const sealed = yield* Effect.result(RcMap.get(follows, key));
      if (sealed._tag === "Failure" || sealed.success.kind === "refused") {
        yield* Fiber.interrupt(opening);
        if (sealed._tag === "Failure") {
          yield* RcMap.invalidate(follows, key);
          return yield* tell(UNANSWERED_PAGE);
        }
        if (toldNotFound) return;
        return yield* tell({ failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND });
      }
      const { state } = sealed.success;
      const newest = yield* Fiber.join(opening);
      if ("failure" in newest) return;
      let after = newest.cursor;
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
        const answer = yield* reads.after(after);
        yield* tell(toldPage(answer));
        if ("failure" in answer) {
          if (answer.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND) return;
          wake = Effect.sleep(RESEAL);
          continue;
        }
        after = answer.cursor;
        // Note that a full page is followed by the next at once, and a short one is caught up, with no empty page read to say so.
        if (answer.messages.length >= CODING_AGENT_BOUNDS.MESSAGES_PAGE) {
          wake = Effect.void;
          continue;
        }
        const moved = SubscriptionRef.changes(state).pipe(
          Stream.filter(movedFrom(was)),
          Stream.runHead,
        );
        const wakeIn = "holds" in answer && answer.holds ? answer.wakeIn : undefined;
        wake =
          wakeIn === undefined ? moved : Effect.race(moved, Effect.sleep(Duration.millis(wakeIn)));
      }
    }),
  );
}
