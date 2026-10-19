import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentMessagesAnswerView,
} from "@luke/features/coding-agent-view";
import { CODING_AGENT_CURSOR_START } from "@luke/features/coding-agent-wire";
import {
  type AgentTranscriptLiveAnswer,
  agentTranscriptLiveRowsSchema,
  type TranscriptNowAnswer,
} from "@luke/features/live-wire";
import {
  Data,
  Duration,
  Effect,
  Option,
  RcMap,
  Schema,
  type Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import { LiveBroken, type LiveClient, liveRows } from "./live-follow.js";

/**
 * transcript-follow.ts -- a coding agent's transcript, or one of its workers', or a task's planning worker's, followed here on a Neon Realtime subscription for the windows that draw it, each page told as it is read.
 *
 * The host subscribes to the statements the transcript's pages are read
 * from (`transcript-live.ts` on the service) when main first follows it,
 * and reads the page at once from the service: from the start, then the
 * next past it at once while the last said something, and otherwise again
 * only when those statements move, rather than the service looking every
 * half second. The page itself, its usage priced from the model catalog
 * among it, is still the service's. Where the service says the clock alone
 * may move the page in so long, as an agent passing the grace its first
 * turn had to land in or the window of a title it waits on closing, which
 * no row says, the page is read again then too; the delay is the
 * service's own, so the two clocks never meet.
 *
 * The subscription is let go a while after the last follow let go of it. A
 * seal the service did not answer is asked for again every `RESEAL`, and
 * a subscription that stops is marked broken, which has the follow read at
 * once, and sealed and opened again after `RESEAL`; one the account does
 * not reach is told not found.
 */

/** How long a subscription no follow holds is kept, so a tab shown again finds it standing. */
const IDLE = Duration.seconds(30);
/** How long after a seal the service did not answer, or a subscription that stopped, the transcript is sealed again. */
const RESEAL = Duration.seconds(1);

/** Which transcript: an agent's own, or one of its workers' by the delegation call that started it. A plan's planning workers are keyed by their composer's own key, on the same terms. */
export class TranscriptKey extends Data.Class<{
  readonly agentId: string;
  readonly callId: string | undefined;
}> {}

/** What the statements last delivered, as one digest any change to any of them moves. */
type LiveState =
  | { readonly kind: "waiting" }
  | { readonly kind: "standing"; readonly digest: string }
  | { readonly kind: "broken" };

/** What a transcript's read is answered from. */
type Standing =
  | { readonly kind: "live"; readonly state: SubscriptionRef.SubscriptionRef<LiveState> }
  | { readonly kind: "refused" };

/** A failure as the service answered one. */
interface Failed {
  readonly failure: string;
}

export interface TranscriptFollowDependencies<Key = TranscriptKey> {
  /** The transcript sealed for following; not found, or a failure where the service sealed none. */
  readonly seal: (key: Key) => Effect.Effect<AgentTranscriptLiveAnswer | Failed>;
  readonly openLive: (url: string) => LiveClient | PromiseLike<LiveClient>;
  readonly now: () => number;
}

/** The subscriptions the followed transcripts share, each held while followed and a while after. */
export type TranscriptFollows<Key = TranscriptKey> = RcMap.RcMap<Key, Standing>;

/** Every part's rows as one text, in no order of Realtime's, so only a change to a row moves it; held here alone, so it needs no hash, and the host loads where no `node:` module does. */
function digestOf(rows: typeof agentTranscriptLiveRowsSchema.Type): string {
  const parts = Object.entries(rows).map(
    ([part, list]) => [part, list.map((row) => JSON.stringify(row)).toSorted()] as const,
  );
  return JSON.stringify(parts);
}

/** The transcript sealed, asked again every `RESEAL` until the service seals it; none where the account does not reach it. */
function sealedOf<Key>(
  dependencies: TranscriptFollowDependencies<Key>,
  key: Key,
): Effect.Effect<Option.Option<AgentTranscriptLiveAnswer>> {
  return Effect.gen(function* () {
    while (true) {
      const answer = yield* dependencies.seal(key);
      if (!("failure" in answer)) return Option.some(answer);
      if (answer.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND) return Option.none();
      yield* Effect.sleep(RESEAL);
    }
  });
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
        const first = yield* sealedOf(dependencies, key);
        if (Option.isNone(first)) return { kind: "refused" } as const;
        const state = yield* SubscriptionRef.make<LiveState>({ kind: "waiting" });
        /** One seal followed until its subscription stops, which marks the state broken. */
        const follow = (sealed: AgentTranscriptLiveAnswer) =>
          Stream.runForEach(
            liveRows(
              {
                openLive: dependencies.openLive,
                reseal: () => dependencies.seal(key),
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
              const again = yield* sealedOf(dependencies, key);
              if (Option.isNone(again)) return;
              sealed = again.value;
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

/** Whether a state is another than the one a page was read at. */
function movedFrom(was: LiveState): (state: LiveState) => boolean {
  return (state) =>
    state.kind !== was.kind ||
    (state.kind === "standing" && was.kind === "standing" && state.digest !== was.digest);
}

/** How one followed transcript's next page is read: the page past the cursor at once, with whether the service's held read would have held on it. */
export type TranscriptPageAfter = (
  after: string,
) => Effect.Effect<TranscriptNowAnswer | CodingAgentMessagesAnswerView>;

/**
 * The transcript followed until interrupted, each page told as it is read:
 * the first from the start, then the next past it at once while the last
 * said something, and otherwise once the statements move, their
 * subscription stops or opens again, or the clock reaches the edge the
 * service named. One the account does not reach is told not found, which
 * ends the follow; a page the service did not answer is told as such and
 * read again after `RESEAL`.
 */
export function followTranscript<Key>(
  follows: TranscriptFollows<Key>,
  key: Key,
  pageAfter: TranscriptPageAfter,
  tell: (page: CodingAgentMessagesAnswerView) => Effect.Effect<void>,
): Effect.Effect<void> {
  return Effect.scoped(
    Effect.gen(function* () {
      const standing = yield* RcMap.get(follows, key);
      if (standing.kind === "refused") {
        return yield* tell({ failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND });
      }
      let after = CODING_AGENT_CURSOR_START;
      while (true) {
        const was = yield* SubscriptionRef.get(standing.state);
        const answer = yield* pageAfter(after);
        yield* tell(windowsPage(answer));
        if ("failure" in answer) {
          if (answer.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND) return;
          yield* Effect.sleep(RESEAL);
          continue;
        }
        after = answer.cursor;
        // Note that a page that said something is followed by the next at once, since a page has a most it carries.
        if (answer.messages.length > 0) continue;
        const moved = SubscriptionRef.changes(standing.state).pipe(
          Stream.filter(movedFrom(was)),
          Stream.runHead,
        );
        const wakeIn = "holds" in answer && answer.holds ? answer.wakeIn : undefined;
        yield* wakeIn === undefined
          ? moved
          : Effect.race(moved, Effect.sleep(Duration.millis(wakeIn)));
      }
    }),
  );
}
