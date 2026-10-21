import type { ChatJoinAnswer } from "@luke/features/chat-wire";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentCallFailure,
  type CodingAgentChatAnswerView,
} from "@luke/features/coding-agent-view";
import {
  LIVE_SIGNED_OUT,
  type WorkspaceChatLiveAnswer,
  workspaceChatLiveRowsSchema,
  workspaceChatOfLiveRows,
} from "@luke/features/live-wire";
import { Duration, Effect, Option, Schema, Stream } from "effect";
import { LiveBroken, type LiveClient, liveRows, type TxWait } from "./live-follow.js";

/**
 * chat-follow.ts -- a workspace's chat followed over Neon Realtime: joined once, sealed, and each change told whole.
 *
 * A follow first joins the chat, the one write a reader makes, then fetches
 * the chat's sealed statements from the service and follows them
 * (`live-follow.ts`, which polls the read while Realtime fails it); every
 * change is the window's chat whole, built from the rows where they arrive.
 * The sealed statements stay here, where the account's own bearer is: only
 * the chat built from the rows is told.
 *
 * A workspace the account is not in, or whose chat it cannot read, is told
 * not found, which ends the follow; a seal refused as signed out ends it too,
 * told unanswered, and is never asked again, as Neon's guide says. A join
 * or a seal the service did not
 * answer is told unanswered, and it, or a follow that stopped, is joined and
 * sealed again after `LIVE_RESTART`.
 *
 * A write to a followed chat is confirmed as Neon's mutations guide says:
 * the follow hands out the wait for a transaction to reach its read
 * (`onTxWait`) while it is subscribed over Realtime, and the write waits on
 * it with the txid the service answered (`confirmWrite`).
 */

/** How long after a join or seal went unanswered, or a follow stopped, the chat is followed again. */
const LIVE_RESTART = Duration.seconds(5);

/** Why the service answered no join or seal. */
interface Failed {
  readonly failure: CodingAgentCallFailure;
}

export interface ChatFollowDependencies {
  /** The account's person joining the chat; a failure where the service answered none. */
  readonly join: () => Effect.Effect<ChatJoinAnswer | Failed>;
  /** The chat's sealed statements, or with `poll` its rows inline, held past `after` until they move, fetched from the service; signed out where the session is not the follow's. */
  readonly live: (
    poll: boolean,
    after?: string,
  ) => Effect.Effect<WorkspaceChatLiveAnswer | Failed | typeof LIVE_SIGNED_OUT>;
  readonly openLive: (url: string) => LiveClient | PromiseLike<LiveClient>;
  /** Now, by the host's own clock, which renewals are timed by. */
  readonly now: () => number;
  /** The chat whole, or why there is none, each time it changes. */
  readonly tell: (chat: CodingAgentChatAnswerView) => Effect.Effect<void>;
  /** Hears the wait for a write's transaction while the chat is subscribed over Realtime, and none once it is not. */
  readonly onTxWait?: (wait: TxWait | undefined) => void;
}

/** The chat sealed again, gone where the account no longer reaches it, so the follow ends. */
function resealed(
  dependencies: ChatFollowDependencies,
  poll: boolean,
  after?: string,
): Effect.Effect<WorkspaceChatLiveAnswer | { readonly failure: string; readonly gone?: boolean }> {
  // Note that a signed-out answer is passed on as it stands, which liveRows ends the read on.
  return Effect.map(dependencies.live(poll, after), (answer) =>
    "failure" in answer && answer.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND
      ? { failure: answer.failure, gone: true }
      : answer,
  );
}

/**
 * The chat the live rows make, each change told, for as long as the read
 * stands. It fails where the read is gone, a row does not decode, or the
 * reader's own member is no longer among the rows.
 */
function tellLive(
  dependencies: ChatFollowDependencies,
  first: WorkspaceChatLiveAnswer,
): Effect.Effect<void, LiveBroken> {
  const decode = Schema.decodeUnknownOption(workspaceChatLiveRowsSchema);
  const rows = liveRows(
    {
      openLive: dependencies.openLive,
      reseal: () => resealed(dependencies, false),
      poll: (after) => resealed(dependencies, true, after),
      now: dependencies.now,
      ...(dependencies.onTxWait === undefined ? {} : { onTxWait: dependencies.onTxWait }),
    },
    first,
  );
  return Stream.runForEach(rows, (read) => {
    const chat = Option.map(decode(read), workspaceChatOfLiveRows);
    if (Option.isNone(chat)) return Effect.fail(new LiveBroken({ reason: "a row did not decode" }));
    if (chat.value === undefined) {
      return Effect.fail(new LiveBroken({ reason: "the reader is no longer in the chat" }));
    }
    return dependencies.tell(chat.value);
  });
}

/** One join, seal, and follow, until it stops; whether the follow ends, as a chat not found does. */
function attempt(dependencies: ChatFollowDependencies): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const joined = yield* dependencies.join();
    const sealed = "failure" in joined ? joined : yield* dependencies.live(false);
    if ("failure" in sealed) {
      const notFound = sealed.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND;
      yield* dependencies.tell({
        failure: notFound
          ? CODING_AGENT_CALL_FAILURE.NOT_FOUND
          : CODING_AGENT_CALL_FAILURE.UNANSWERED,
      });
      return notFound || sealed.failure === LIVE_SIGNED_OUT.failure;
    }
    yield* tellLive(dependencies, sealed).pipe(Effect.catch(() => Effect.void));
    return false;
  });
}

/** A workspace's chat followed live until interrupted, or until it is told not found. */
export function followWorkspaceChat(dependencies: ChatFollowDependencies): Effect.Effect<void> {
  const loop: Effect.Effect<void> = Effect.flatMap(attempt(dependencies), (ended) =>
    ended ? Effect.void : Effect.andThen(Effect.sleep(LIVE_RESTART), loop),
  );
  return loop;
}
