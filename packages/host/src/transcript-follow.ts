import { createHash } from "node:crypto";
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
 * last read let go of it. A transcript the service seals nothing for, an
 * older service or one without Realtime, is read through the held read as
 * before, and so is one whose subscription stopped; one the account does
 * not reach is not found, as the held read said.
 *
 * Note that the hold ends with one more read of the page, as the service's
 * own hold does, so where an agent stands only by the clock, such as one
 * past the grace its first turn had to land in, it is heard by then.
 */

/** How long a read is held while nothing stands past its cursor, as the service held it. */
const HOLD = Duration.seconds(20);
/** How long a subscription no read holds is kept, so the window's next read finds it standing. */
const IDLE = Duration.seconds(30);

/** Which transcript: an agent's own, or one of its workers' by the delegation call that started it. */
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
  | { readonly kind: "held" }
  | { readonly kind: "refused" };

/** A failure as the service answered one. */
interface Failed {
  readonly failure: string;
}

export interface TranscriptFollowDependencies {
  /** The transcript sealed for following; not found, or a failure where the service sealed none. */
  readonly seal: (key: TranscriptKey) => Effect.Effect<AgentTranscriptLiveAnswer | Failed>;
  readonly openLive: (url: string) => LiveClient | PromiseLike<LiveClient>;
  readonly now: () => number;
}

/** How one read of the transcript is asked. */
export interface TranscriptReads {
  /** The page past the cursor at once, with whether the service's held read would have held on it. */
  readonly now: Effect.Effect<TranscriptNowAnswer | CodingAgentMessagesAnswerView>;
  /** The service's own held read, as the window asked it before. */
  readonly held: Effect.Effect<CodingAgentMessagesAnswerView>;
}

/** The subscriptions the windows' reads share, each held while read and a while after. */
export type TranscriptFollows = RcMap.RcMap<TranscriptKey, Standing>;

/** A digest of every part's rows, in no order of Realtime's, so only a change to a row moves it. */
function digestOf(rows: typeof agentTranscriptLiveRowsSchema.Type): string {
  const parts = Object.entries(rows).map(
    ([part, list]) => [part, list.map((row) => JSON.stringify(row)).toSorted()] as const,
  );
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** The map a composer holds for as long as it stands. */
export function transcriptFollows(
  dependencies: TranscriptFollowDependencies,
): Effect.Effect<TranscriptFollows, never, Scope.Scope> {
  const decode = Schema.decodeUnknownOption(agentTranscriptLiveRowsSchema);
  return RcMap.make({
    idleTimeToLive: IDLE,
    lookup: (key: TranscriptKey) =>
      Effect.gen(function* () {
        const first = yield* dependencies.seal(key);
        if ("failure" in first) {
          return first.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND
            ? ({ kind: "refused" } as const)
            : ({ kind: "held" } as const);
        }
        const state = yield* SubscriptionRef.make<LiveState>({ kind: "waiting" });
        const rows = liveRows(
          {
            openLive: dependencies.openLive,
            reseal: () => dependencies.seal(key),
            now: dependencies.now,
          },
          first,
        );
        yield* Effect.forkScoped(
          Stream.runForEach(rows, (read) =>
            Option.match(decode(read), {
              onNone: () => Effect.fail(new LiveBroken({ reason: "a row did not decode" })),
              onSome: (decoded) =>
                SubscriptionRef.set(state, { kind: "standing", digest: digestOf(decoded) }),
            }),
          ).pipe(Effect.catch(() => SubscriptionRef.set(state, { kind: "broken" }))),
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
 * The page read at once, again each time the statements move while the
 * service says its held read would hold on it; the held read where the
 * subscription stops. Never ends of itself while the page holds.
 */
function readUntilSaid(
  state: SubscriptionRef.SubscriptionRef<LiveState>,
  reads: TranscriptReads,
): Effect.Effect<CodingAgentMessagesAnswerView> {
  return Effect.gen(function* () {
    while (true) {
      const was = yield* SubscriptionRef.get(state);
      if (was.kind === "broken") return yield* reads.held;
      const answer = yield* reads.now;
      if (!("holds" in answer) || !answer.holds) return windowsPage(answer);
      yield* SubscriptionRef.changes(state).pipe(Stream.filter(movedFrom(was)), Stream.runHead);
    }
  });
}

/**
 * The transcript past the reader's cursor: at once where something stands
 * past it or the agent has ended, or as soon as something does within the
 * hold, or the page as it stands once the hold ends. The held read answers
 * it where the transcript is not followed live, or where its subscription
 * stopped.
 */
export function transcriptPast(
  follows: TranscriptFollows,
  key: TranscriptKey,
  reads: TranscriptReads,
): Effect.Effect<CodingAgentMessagesAnswerView> {
  return Effect.scoped(
    Effect.gen(function* () {
      const standing = yield* RcMap.get(follows, key);
      if (standing.kind === "held") return yield* reads.held;
      if (standing.kind === "refused") return { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND };
      const said = yield* readUntilSaid(standing.state, reads).pipe(Effect.timeoutOption(HOLD));
      return Option.isSome(said) ? said.value : windowsPage(yield* reads.now);
    }),
  );
}
