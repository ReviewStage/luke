import type { MemoriesFollowParams } from "@repo/features/agent-view";
import { Effect, MutableHashMap, Stream } from "effect";
import { ACCOUNT_ASK_ACT_KIND } from "../contract/index.js";
import { type ActSender, actPort } from "./base.js";
import { followedStream, type OpenFollows, streamed } from "./followed-stream.js";

/**
 * account-ask-procedures.ts -- the account's holds from Settings: its provider keys, its GitHub token, and a workspace's memories, each followed and asked again.
 *
 * The one check these procedures make is who asked: only a panel draws
 * Settings, so every one refuses the takeover and any other window, in its
 * own sentence. The account's provider keys and GitHub token, and each
 * workspace's memories, are held at the host while a panel holds their
 * stream open, and reach every panel on app state; how many streams stand
 * open is all that is held here. The account's plain asks are declared
 * (`contract/account-asks.ts`) and answered by the agents' composer.
 */
export interface AccountAskProceduresDependencies {
  host: {
    /** The account's provider keys held at the host while any stream of them stands; what it holds reaches the panel on app state. */
    providerKeysFollow(): Effect.Effect<void>;
    providerKeysUnfollow(): Effect.Effect<void>;
    /** The account's held provider keys asked again at once, as Try again asks; done once the ask has landed. */
    providerKeysRetry(): Effect.Effect<void>;
    /** The account's GitHub token held at the host while any stream of it stands; what it holds reaches the panel on app state. */
    githubTokenFollow(): Effect.Effect<void>;
    githubTokenUnfollow(): Effect.Effect<void>;
    /** The account's held GitHub token asked again at once, as Try again asks; done once the ask has landed. */
    githubTokenRetry(): Effect.Effect<void>;
    /** A workspace's memories held at the host while any stream of them stands; what it holds reaches the panel on app state. */
    memoriesFollow(params: MemoriesFollowParams): Effect.Effect<void>;
    memoriesUnfollow(params: MemoriesFollowParams): Effect.Effect<void>;
    /** A workspace's held memories asked again at once, as Try again asks; done once the ask has landed. */
    memoriesRetry(params: MemoriesFollowParams): Effect.Effect<void>;
  };
}

/** The refusal a window that draws no Settings hears, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

export function accountAskProcedures(dependencies: AccountAskProceduresDependencies) {
  const { host } = dependencies;
  /** The account's keys while a window holds a stream open of them, so the host lets them go only with the last. */
  const openKeys: OpenFollows = MutableHashMap.empty();
  /** The account's GitHub token while a window holds a stream open of it, so the host lets it go only with the last. */
  const openToken: OpenFollows = MutableHashMap.empty();
  /** Each workspace's memories while a window holds a stream open of them, by the workspace. */
  const openMemories: OpenFollows = MutableHashMap.empty();
  return {
    [ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_FOLLOW]: actPort[
      ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const hold = followedStream(
        {
          keyOf: () => "keys",
          follow: () => host.providerKeysFollow(),
          unfollow: () => host.providerKeysUnfollow(),
        },
        openKeys,
        input,
      );
      return streamed(yield* Stream.toAsyncIterableEffect(hold));
    }),
    [ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_RETRY]: actPort[
      ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_RETRY
    ].effect(function* ({ context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.providerKeysRetry();
    }),
    [ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_FOLLOW]: actPort[
      ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const hold = followedStream(
        {
          keyOf: () => "token",
          follow: () => host.githubTokenFollow(),
          unfollow: () => host.githubTokenUnfollow(),
        },
        openToken,
        input,
      );
      return streamed(yield* Stream.toAsyncIterableEffect(hold));
    }),
    [ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_RETRY]: actPort[
      ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_RETRY
    ].effect(function* ({ context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.githubTokenRetry();
    }),
    [ACCOUNT_ASK_ACT_KIND.MEMORIES_FOLLOW]: actPort[ACCOUNT_ASK_ACT_KIND.MEMORIES_FOLLOW].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const hold = followedStream(
          {
            keyOf: (held: MemoriesFollowParams) => held.workspaceId,
            follow: host.memoriesFollow,
            unfollow: host.memoriesUnfollow,
          },
          openMemories,
          input,
        );
        return streamed(yield* Stream.toAsyncIterableEffect(hold));
      },
    ),
    [ACCOUNT_ASK_ACT_KIND.MEMORIES_RETRY]: actPort[ACCOUNT_ASK_ACT_KIND.MEMORIES_RETRY].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        yield* host.memoriesRetry(input);
      },
    ),
  };
}
