import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentMessagesAnswerView,
} from "@luke/features/coding-agent-view";
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
 * transcript-follow.ts -- a coding agent's transcript, or one of its workers', read by the window as before but held open here on a Neon Realtime subscription rather than by the service on a clock.
 *
 * The window still asks with the cursor it was last answered, and is
 * answered with the page past it at once where there is something on it, or
 * the agent has ended, or else as soon as there is, or with the empty page
 * once the hold ends, as the service's held read answered it. What changed
 * is who waits: the host subscribes to the statements the transcript's
 * pages are read from (`transcript-live.ts` on the service) the first time
 * a window asks, reads the page at once from the service, and while the
 * service says its held read would have held on it, reads it again only
 * when those statements move, rather than the service looking every half
 * second. The page itself, its usage priced from the model catalog among
 * it, is still the service's. The subscription is let go a while after the
 * last read let go of it. A seal the service did not answer is asked for
 * again every `RESEAL`, and a subscription that stops is marked broken,
 * which has the reader read at once, and sealed and opened again after
 * `RESEAL`; one the account does not reach is not found, as the held read
 * said.
 *
 * Where the service says the clock alone may end the hold in so long, as
 * an agent passing the grace its first turn had to land in or the window of
 * a title it waits on closing, which no row says, the page is read again
 * then too; the delay is the service's own, so the two clocks never meet.
 * The hold ends with one more read of the page, as the service's own does.
 */

/** How long a read is held while nothing stands past its cursor, as the service held it. */
const HOLD = Duration.seconds(20);
/** How long a subscription no read holds is kept, so the window's next read finds it standing. */
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

/** How one read of the transcript is asked. */
export interface TranscriptReads {
  /** The page past the cursor at once, with whether the service's held read would have held on it. */
  readonly now: Effect.Effect<TranscriptNowAnswer | CodingAgentMessagesAnswerView>;
}

/** The subscriptions the windows' reads share, each held while read and a while after. */
export type TranscriptFollows<Key = TranscriptKey> = RcMap.RcMap<Key, Standing>;

/** Every part's rows as one text, in no order of Realtime's, so only a change to a row moves it; held here alone, so it needs no hash, and the host loads where no `node:` module does. */
function digestOf(rows: typeof agentTranscriptLiveRowsSchema.Type): string {
  const parts = Object.entries(rows).map(
    ([part, list]) => [part, list.map((row) => JSON.stringify(row)).toSorted()] as const,
  );
  return JSON.stringify(parts);
}

/** The transcript sealed, asked again every `RESEAL` until the service seals it; none where the account does not reach it. */
function sealedOf(
  dependencies: TranscriptFollowDependencies,
  key: TranscriptKey,
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
function windowsPage(
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

/**
 * The page read at once, again each time the statements move, their
 * subscription stops or opens again, or the clock reaches the edge the
 * service named, while the service says its held read would hold on it.
 * Never ends of itself while the page holds.
 */
function readUntilSaid(
  state: SubscriptionRef.SubscriptionRef<LiveState>,
  reads: TranscriptReads,
): Effect.Effect<CodingAgentMessagesAnswerView> {
  return Effect.gen(function* () {
    while (true) {
      const was = yield* SubscriptionRef.get(state);
      const answer = yield* reads.now;
      if (!("holds" in answer) || !answer.holds) return windowsPage(answer);
      const moved = SubscriptionRef.changes(state).pipe(
        Stream.filter(movedFrom(was)),
        Stream.runHead,
      );
      // Note that an edge only the clock reaches is waited for beside the rows, since no row says it.
      yield* answer.wakeIn === undefined
        ? moved
        : Effect.race(moved, Effect.sleep(Duration.millis(answer.wakeIn)));
    }
  });
}

/**
 * The transcript past the reader's cursor: at once where something stands
 * past it or the agent has ended, or as soon as something does within the
 * hold, or the page as it stands once the hold ends, a transcript not yet
 * sealed among them.
 */
export function transcriptPast<Key>(
  follows: TranscriptFollows<Key>,
  key: Key,
  reads: TranscriptReads,
): Effect.Effect<CodingAgentMessagesAnswerView> {
  return Effect.scoped(
    Effect.gen(function* () {
      const said = yield* Effect.gen(function* () {
        const standing = yield* RcMap.get(follows, key);
        if (standing.kind === "refused") {
          return { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND } as const;
        }
        return yield* readUntilSaid(standing.state, reads);
      }).pipe(Effect.timeoutOption(HOLD));
      return Option.isSome(said) ? said.value : windowsPage(yield* reads.now);
    }),
  );
}
